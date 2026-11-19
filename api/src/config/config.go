// Package config lee la configuración del API desde variables de entorno. Ningún dominio ni dirección va fija
// en el código (D-129): lo que falta hace fallar el arranque con un error claro.
package config

import (
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

	// Credenciales del SMTP (US-80, D-205 (6)). Son opcionales, pero van juntas: Mailpit en local no autentica.
	// En Azure, CORREO_CONTRASENA es un `secretRef` del Key Vault; nunca va en claro en la plantilla ni en el repositorio.
	VariableCorreoUsuario    = "CORREO_USUARIO"    // usuario del SMTP (Zoho CPaaS: emailapikey)
	VariableCorreoContrasena = "CORREO_CONTRASENA" // contraseña del SMTP (Zoho CPaaS: el token del agente de envío)
)

// textoOculto es lo único que se imprime de un Secreto.
const textoOculto = "[oculto]"

// Secreto es un valor que no debe llegar a un registro ni a un error. Se imprime como «[oculto]» con fmt, slog, JSON
// y texto; solo Revelar da el valor, y solo debe llamarlo quien lo usa para autenticarse.
type Secreto string

// Revelar devuelve el valor. No lo registres.
func (s Secreto) Revelar() string { return string(s) }

// String oculta el valor con los verbos de texto de fmt (%v, %+v, %s, %q, %x); un verbo que no es de texto también pasa por aquí.
func (Secreto) String() string { return textoOculto }

// GoString oculta el valor en %#v.
func (Secreto) GoString() string { return textoOculto }

// LogValue oculta el valor en slog.
func (Secreto) LogValue() slog.Value { return slog.StringValue(textoOculto) }

// MarshalText oculta el valor en JSON y en cualquier codificación de texto.
func (Secreto) MarshalText() ([]byte, error) { return []byte(textoOculto), nil }

// Config es la configuración que necesita el servidor de la API.
type Config struct {
	CorreoSMTP       string
	CorreoRemitente  string
	CorreoPrivacidad string
	URLPublica       string

	// CorreoUsuario y CorreoContrasena van juntos o ninguno. Con ellos el adaptador exige STARTTLS y se autentica.
	CorreoUsuario    string
	CorreoContrasena Secreto
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

	// El usuario y la contraseña van juntos: uno solo es un error de configuración y se nombra el que falta, sin repetir valores.
	c.CorreoUsuario = strings.TrimSpace(entorno(VariableCorreoUsuario))
	c.CorreoContrasena = Secreto(strings.TrimSpace(entorno(VariableCorreoContrasena)))
	switch {
	case c.CorreoUsuario != "" && c.CorreoContrasena == "":
		problemas = append(problemas, VariableCorreoContrasena+" falta ("+VariableCorreoUsuario+" está definida)")
	case c.CorreoUsuario == "" && c.CorreoContrasena != "":
		problemas = append(problemas, VariableCorreoUsuario+" falta ("+VariableCorreoContrasena+" está definida)")
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
