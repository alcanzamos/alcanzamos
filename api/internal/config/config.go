// Package config lee la configuración del API desde variables de entorno. Ningún dominio ni dirección va fija
// en el código (D-129): lo que falta hace fallar el arranque con un error claro.
package config

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"net/mail"
	"net/url"
	"slices"
	"strings"
)

// Variables de entorno del correo y de la dirección pública.
const (
	VariableCorreoSMTP       = "CORREO_SMTP"       // host:puerto del servidor SMTP (Mailpit en local: 127.0.0.1:1025)
	VariableCorreoRemitente  = "CORREO_REMITENTE"  // dirección que envía; no recibe respuestas (D-120)
	VariableCorreoPrivacidad = "CORREO_PRIVACIDAD" // dirección del pie de cada correo: dónde escribir (D-120, RF-060)
	VariableURLPublica       = "URL_PUBLICA"       // base de los enlaces de los correos, sin barra final
	// VariableSesionSenuelo es la clave que firma las sesiones de mentira (D-141, D-143 (2)): base64 estándar o de URL.
	VariableSesionSenuelo = "SESION_SENUELO_CLAVE"
)

// LongitudMinimaDeClaveDeSenuelo son los bytes que debe tener la clave ya decodificada.
const LongitudMinimaDeClaveDeSenuelo = 32

// Clave es un secreto de la configuración. Nunca se escribe en el registro ni en un error: al imprimirla, con fmt o
// con slog, sale «[oculta]». Los bytes se leen con Bytes.
type Clave struct{ bytes []byte }

// Bytes devuelve el valor de la clave.
func (c Clave) Bytes() []byte { return c.bytes }

// String evita que la clave salga por un %v o un %+v.
func (Clave) String() string { return "[oculta]" }

// GoString evita que la clave salga por un %#v.
func (Clave) GoString() string { return "config.Clave{[oculta]}" }

// LogValue evita que la clave salga por slog.
func (Clave) LogValue() slog.Value { return slog.StringValue("[oculta]") }

// Config es la configuración que necesita el servidor de la API.
type Config struct {
	CorreoSMTP       string
	CorreoRemitente  string
	CorreoPrivacidad string
	URLPublica       string
	SesionSenuelo    Clave
}

// Cargar lee y valida la configuración con la función entorno (os.Getenv en producción).
// Si algo falta o no es válido, el error nombra todas las variables con problema.
func Cargar(entorno func(string) string) (Config, error) {
	var problemas []string
	faltante := func(nombre string) string {
		v := strings.TrimSpace(entorno(nombre))
		if v == "" {
			problemas = append(problemas, nombre+" falta")
		}
		return v
	}

	c := Config{
		CorreoSMTP:       faltante(VariableCorreoSMTP),
		CorreoRemitente:  faltante(VariableCorreoRemitente),
		CorreoPrivacidad: faltante(VariableCorreoPrivacidad),
		URLPublica:       faltante(VariableURLPublica),
	}

	crudo := faltante(VariableSesionSenuelo)
	if crudo != "" {
		clave, err := decodificarClave(crudo)
		switch {
		case err != nil:
			problemas = append(problemas, VariableSesionSenuelo+" debe estar en base64")
		case len(clave) < LongitudMinimaDeClaveDeSenuelo:
			problemas = append(problemas, fmt.Sprintf("%s debe tener al menos %d bytes decodificada", VariableSesionSenuelo, LongitudMinimaDeClaveDeSenuelo))
		default:
			c.SesionSenuelo = Clave{bytes: clave}
		}
	}

	if c.CorreoSMTP != "" {
		if host, puerto, err := net.SplitHostPort(c.CorreoSMTP); err != nil || host == "" || puerto == "" {
			problemas = append(problemas, VariableCorreoSMTP+" debe ser host:puerto")
		}
	}
	for nombre, valor := range map[string]string{
		VariableCorreoRemitente:  c.CorreoRemitente,
		VariableCorreoPrivacidad: c.CorreoPrivacidad,
	} {
		if valor == "" {
			continue
		}
		if dir, err := mail.ParseAddress(valor); err != nil || dir.Address != valor {
			problemas = append(problemas, nombre+" debe ser una dirección de correo sin nombre, como usuario@dominio")
		}
	}
	if c.URLPublica != "" {
		u, err := url.Parse(c.URLPublica)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
			problemas = append(problemas, VariableURLPublica+" debe ser una URL http o https absoluta, sin parámetros")
		}
		c.URLPublica = strings.TrimRight(c.URLPublica, "/")
	}

	if len(problemas) > 0 {
		// El recorrido del mapa no tiene orden: se ordena para que el mensaje sea siempre el mismo.
		slices.Sort(problemas)
		return Config{}, fmt.Errorf("configuración incompleta o inválida: %s", strings.Join(problemas, "; "))
	}
	return c, nil
}

// decodificarClave acepta base64 estándar o de URL, con o sin relleno. El error no repite el valor.
func decodificarClave(v string) ([]byte, error) {
	v = strings.TrimRight(v, "=")
	if b, err := base64.RawStdEncoding.DecodeString(v); err == nil {
		return b, nil
	}
	return base64.RawURLEncoding.DecodeString(v)
}
