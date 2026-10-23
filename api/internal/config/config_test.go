package config

import (
	"strings"
	"testing"
)

func entorno(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func valido() map[string]string {
	return map[string]string{
		VariableCorreoSMTP:       "127.0.0.1:1025",
		VariableCorreoRemitente:  "no-responder@avisos.ejemplo.test",
		VariableCorreoPrivacidad: "privacidad@ejemplo.test",
		VariableURLPublica:       "https://app.ejemplo.test/",
	}
}

func TestCargar(t *testing.T) {
	casos := []struct {
		nombre   string
		cambiar  func(map[string]string)
		mensaje  string // fragmento esperado en el error; vacío si debe cargar
		urlFinal string
	}{
		{"completa, sin barra final", func(map[string]string) {}, "", "https://app.ejemplo.test"},
		{"falta todo", func(m map[string]string) { clear(m) }, "CORREO_PRIVACIDAD falta; CORREO_REMITENTE falta; CORREO_SMTP falta; URL_PUBLICA falta", ""},
		{"falta una", func(m map[string]string) { delete(m, VariableURLPublica) }, "URL_PUBLICA falta", ""},
		{"solo espacios cuenta como falta", func(m map[string]string) { m[VariableCorreoSMTP] = "  " }, "CORREO_SMTP falta", ""},
		{"SMTP sin puerto", func(m map[string]string) { m[VariableCorreoSMTP] = "localhost" }, "CORREO_SMTP debe ser host:puerto", ""},
		{"remitente con nombre", func(m map[string]string) { m[VariableCorreoRemitente] = "Avisos <a@b.test>" }, "CORREO_REMITENTE debe ser una dirección", ""},
		{"privacidad sin @", func(m map[string]string) { m[VariableCorreoPrivacidad] = "privacidad" }, "CORREO_PRIVACIDAD debe ser una dirección", ""},
		{"URL sin esquema", func(m map[string]string) { m[VariableURLPublica] = "app.ejemplo.test" }, "URL_PUBLICA debe ser una URL", ""},
		{"URL con parámetros", func(m map[string]string) { m[VariableURLPublica] = "https://a.test/?x=1" }, "URL_PUBLICA debe ser una URL", ""},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			m := valido()
			c.cambiar(m)
			cfg, err := Cargar(entorno(m))
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
