package config_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
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

const claveDePrueba = "clave-secreta-de-prueba-7788"

// US-80: el usuario y la contraseña del SMTP son opcionales (Mailpit no autentica), pero van juntos.
func TestCargarCredencialesDelCorreo(t *testing.T) {
	casos := []struct {
		nombre  string
		cambiar func(map[string]string)
		mensaje string // fragmento esperado en el error; vacío si debe cargar
		usuario string
		clave   string
	}{
		{"sin credenciales (Mailpit)", func(map[string]string) {}, "", "", ""},
		{"las dos", func(m map[string]string) {
			m[config.VariableCorreoUsuario] = "emailapikey"
			m[config.VariableCorreoContrasena] = claveDePrueba
		}, "", "emailapikey", claveDePrueba},
		{"la contraseña pierde los espacios y saltos de línea de los extremos", func(m map[string]string) {
			m[config.VariableCorreoUsuario] = "emailapikey"
			m[config.VariableCorreoContrasena] = " " + claveDePrueba + "\n"
		}, "", "emailapikey", claveDePrueba},
		{"usuario sin contraseña", func(m map[string]string) { m[config.VariableCorreoUsuario] = "emailapikey" },
			"CORREO_CONTRASENA falta (CORREO_USUARIO está definida)", "", ""},
		{"usuario con contraseña de solo espacios", func(m map[string]string) {
			m[config.VariableCorreoUsuario] = "emailapikey"
			m[config.VariableCorreoContrasena] = "  "
		}, "CORREO_CONTRASENA falta (CORREO_USUARIO está definida)", "", ""},
		{"contraseña sin usuario", func(m map[string]string) { m[config.VariableCorreoContrasena] = claveDePrueba },
			"CORREO_USUARIO falta (CORREO_CONTRASENA está definida)", "", ""},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			m := valido()
			c.cambiar(m)
			cfg, err := config.Cargar(entorno(m))
			if c.mensaje == "" {
				if err != nil || cfg.CorreoUsuario != c.usuario || cfg.CorreoContrasena.Revelar() != c.clave {
					t.Fatalf("se esperaba carga correcta (usuario %q): %+v, %v", c.usuario, cfg, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.mensaje) {
				t.Fatalf("se esperaba un error con %q, hubo %v", c.mensaje, err)
			}
			if strings.Contains(err.Error(), claveDePrueba) {
				t.Fatalf("el error repite la contraseña: %v", err)
			}
		})
	}
}

// Una contraseña con problemas de otras variables sigue sin salir en el error de la configuración.
func TestElErrorDeConfiguracionNoRepiteLaContrasena(t *testing.T) {
	m := valido()
	m[config.VariableCorreoContrasena] = claveDePrueba
	delete(m, config.VariableURLPublica)
	_, err := config.Cargar(entorno(m))
	if err == nil || strings.Contains(err.Error(), claveDePrueba) {
		t.Fatalf("error inesperado: %v", err)
	}
}

// La contraseña no sale por fmt, por slog ni por JSON, aunque alguien registre la configuración entera.
func TestLaContrasenaNoSaleAlImprimirLaConfiguracion(t *testing.T) {
	m := valido()
	m[config.VariableCorreoUsuario] = "emailapikey"
	m[config.VariableCorreoContrasena] = claveDePrueba
	cfg, err := config.Cargar(entorno(m))
	if err != nil {
		t.Fatal(err)
	}
	var registro bytes.Buffer
	slog.New(slog.NewJSONHandler(&registro, nil)).Info("configuración", "cfg", cfg, "clave", cfg.CorreoContrasena)
	slog.New(slog.NewTextHandler(&registro, nil)).Info("configuración", "cfg", cfg, "clave", cfg.CorreoContrasena)
	json, _ := json.Marshal(cfg)
	salidas := []string{
		fmt.Sprintf("%v|%+v|%#v|%s|%q", cfg, cfg, cfg, cfg, cfg),
		fmt.Sprintf("%v|%+v|%#v|%s|%q|%x", cfg.CorreoContrasena, cfg.CorreoContrasena, cfg.CorreoContrasena, cfg.CorreoContrasena, cfg.CorreoContrasena, cfg.CorreoContrasena),
		registro.String(),
		string(json),
	}
	for i, s := range salidas {
		if strings.Contains(s, claveDePrueba) || strings.Contains(s, hex.EncodeToString([]byte(claveDePrueba))) {
			t.Errorf("la salida %d deja ver la contraseña: %s", i, s)
		}
	}
	if cfg.CorreoContrasena.Revelar() != claveDePrueba {
		t.Fatal("Revelar debe devolver la contraseña")
	}
}
