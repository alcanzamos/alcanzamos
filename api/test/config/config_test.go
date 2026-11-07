package config_test

import (
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
		{"falta una", func(m map[string]string) { delete(m, config.VariableURLPublica) }, "URL_PUBLICA falta", ""},
		{"solo espacios cuenta como falta", func(m map[string]string) { m[config.VariableCorreoSMTP] = "  " }, "CORREO_SMTP falta", ""},
		{"SMTP sin puerto", func(m map[string]string) { m[config.VariableCorreoSMTP] = "localhost" }, "CORREO_SMTP debe ser host:puerto", ""},
		{"remitente con nombre", func(m map[string]string) { m[config.VariableCorreoRemitente] = "Avisos <a@b.test>" }, "CORREO_REMITENTE debe ser una dirección", ""},
		{"privacidad sin @", func(m map[string]string) { m[config.VariableCorreoPrivacidad] = "privacidad" }, "CORREO_PRIVACIDAD debe ser una dirección", ""},
		{"URL sin esquema", func(m map[string]string) { m[config.VariableURLPublica] = "app.ejemplo.test" }, "URL_PUBLICA debe ser una URL", ""},
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

// D-172 (5): la clave de las sesiones de mentira ya no existe. Una variable suelta en el entorno no se lee ni hace falta.
func TestLaClaveDeLosSenuelosYaNoSeExige(t *testing.T) {
	m := valido()
	if _, err := config.Cargar(entorno(m)); err != nil {
		t.Fatalf("sin SESION_SENUELO_CLAVE debe cargar: %v", err)
	}
	m["SESION_SENUELO_CLAVE"] = "esto ya no se lee"
	if _, err := config.Cargar(entorno(m)); err != nil {
		t.Fatalf("una variable sobrante no hace fallar: %v", err)
	}
}
