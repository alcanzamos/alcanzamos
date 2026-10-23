package config_test

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/config"
)

func entorno(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func valido() map[string]string {
	return map[string]string{
		config.VariableCorreoSMTP:       "127.0.0.1:1025",
		config.VariableCorreoRemitente:  "no-responder@avisos.ejemplo.test",
		config.VariableCorreoPrivacidad: "privacidad@ejemplo.test",
		config.VariableURLPublica:       "https://app.ejemplo.test/",
		config.VariableSesionSenuelo:    claveDePrueba,
	}
}

// 32 bytes 0x00..0x1f en base64 estándar.
var claveDePrueba = base64.StdEncoding.EncodeToString(bytesDePrueba(32))

func bytesDePrueba(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(0xfb + i) // con 0xfb.. salen «+» y «/» en base64 estándar
	}
	return b
}

func TestCargar(t *testing.T) {
	casos := []struct {
		nombre   string
		cambiar  func(map[string]string)
		mensaje  string // fragmento esperado en el error; vacío si debe cargar
		urlFinal string
	}{
		{"completa, sin barra final", func(map[string]string) {}, "", "https://app.ejemplo.test"},
		{"falta todo", func(m map[string]string) { clear(m) }, "CORREO_PRIVACIDAD falta; CORREO_REMITENTE falta; CORREO_SMTP falta; SESION_SENUELO_CLAVE falta; URL_PUBLICA falta", ""},
		{"falta una", func(m map[string]string) { delete(m, config.VariableURLPublica) }, "URL_PUBLICA falta", ""},
		{"solo espacios cuenta como falta", func(m map[string]string) { m[config.VariableCorreoSMTP] = "  " }, "CORREO_SMTP falta", ""},
		{"SMTP sin puerto", func(m map[string]string) { m[config.VariableCorreoSMTP] = "localhost" }, "CORREO_SMTP debe ser host:puerto", ""},
		{"remitente con nombre", func(m map[string]string) { m[config.VariableCorreoRemitente] = "Avisos <a@b.test>" }, "CORREO_REMITENTE debe ser una dirección", ""},
		{"privacidad sin @", func(m map[string]string) { m[config.VariableCorreoPrivacidad] = "privacidad" }, "CORREO_PRIVACIDAD debe ser una dirección", ""},
		{"URL sin esquema", func(m map[string]string) { m[config.VariableURLPublica] = "app.ejemplo.test" }, "URL_PUBLICA debe ser una URL", ""},
		{"clave que no es base64", func(m map[string]string) { m[config.VariableSesionSenuelo] = "esto no es base64!" }, "SESION_SENUELO_CLAVE debe estar en base64", ""},
		{"clave de 31 bytes", func(m map[string]string) {
			m[config.VariableSesionSenuelo] = base64.StdEncoding.EncodeToString(bytesDePrueba(31))
		}, "SESION_SENUELO_CLAVE debe tener al menos 32 bytes", ""},
		{"clave de 32 bytes en base64 de URL sin relleno", func(m map[string]string) {
			m[config.VariableSesionSenuelo] = base64.RawURLEncoding.EncodeToString(bytesDePrueba(32))
		}, "", "https://app.ejemplo.test"},
		{"URL con parámetros", func(m map[string]string) { m[config.VariableURLPublica] = "https://a.test/?x=1" }, "URL_PUBLICA debe ser una URL", ""},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			m := valido()
			c.cambiar(m)
			cfg, err := config.Cargar(entorno(m))
			if c.mensaje == "" {
				if err != nil || cfg.URLPublica != c.urlFinal {
					t.Fatalf("se esperaba carga correcta con URL %q: %+v, %v", c.urlFinal, cfg, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.mensaje) {
				t.Fatalf("se esperaba un error con %q, hubo %v", c.mensaje, err)
			}
		})
	}
}

// La clave decodifica igual en base64 estándar y de URL, y nunca sale por un formato ni por el registro.
func TestLaClaveDelSenueloSeDecodificaYNoSeImprime(t *testing.T) {
	esperada := bytesDePrueba(40)
	for nombre, valor := range map[string]string{
		"estándar":           base64.StdEncoding.EncodeToString(esperada),
		"de URL":             base64.URLEncoding.EncodeToString(esperada),
		"de URL sin relleno": base64.RawURLEncoding.EncodeToString(esperada),
	} {
		m := valido()
		m[config.VariableSesionSenuelo] = valor
		cfg, err := config.Cargar(entorno(m))
		if err != nil {
			t.Fatalf("%s: %v", nombre, err)
		}
		if !bytes.Equal(cfg.SesionSenuelo.Bytes(), esperada) {
			t.Fatalf("%s: la clave decodificada no coincide", nombre)
		}
		var registro bytes.Buffer
		slog.New(slog.NewJSONHandler(&registro, nil)).Info("config", "clave", cfg.SesionSenuelo, "cfg", cfg)
		salida := fmt.Sprintf("%v %+v %#v %s", cfg, cfg, cfg, registro.String())
		if strings.Contains(salida, valor) || strings.Contains(salida, fmt.Sprint(esperada)) {
			t.Fatalf("%s: la clave salió en una impresión: %s", nombre, salida)
		}
	}
}

// Ni el error de una clave inválida repite su valor.
func TestElErrorDeLaClaveNoLaRepite(t *testing.T) {
	m := valido()
	m[config.VariableSesionSenuelo] = "secreto-corto"
	_, err := config.Cargar(entorno(m))
	if err == nil || strings.Contains(err.Error(), "secreto-corto") {
		t.Fatalf("el error debe existir y no repetir la clave: %v", err)
	}
}
