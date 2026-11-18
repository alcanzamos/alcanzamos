package servidor_test

import (
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/web/servidor/internal/servidor"
)

// entorno arma la función getenv de una prueba con un mapa.
func entorno(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestAPIURLValida(t *testing.T) {
	casos := []struct{ nombre, entrada, origen string }{
		{"https normal", "https://api.alcanzamos.co", "https://api.alcanzamos.co"},
		{"UAT", "https://api-uat.alcanzamos.co", "https://api-uat.alcanzamos.co"},
		{"barra final se quita", "https://api.alcanzamos.co/", "https://api.alcanzamos.co"},
		{"mayúsculas se bajan", "HTTPS://API.Alcanzamos.CO", "https://api.alcanzamos.co"},
		{"con puerto", "https://api.alcanzamos.co:8443", "https://api.alcanzamos.co:8443"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			cfg, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": c.entrada}))
			if err != nil {
				t.Fatalf("error inesperado: %v", err)
			}
			if cfg.OrigenAPI != c.origen {
				t.Fatalf("origen %q, se esperaba %q", cfg.OrigenAPI, c.origen)
			}
		})
	}
}

func TestAPIURLInvalida(t *testing.T) {
	casos := []struct{ nombre, entrada, texto string }{
		{"falta", "", "API_URL falta"},
		{"solo espacios", "   ", "API_URL falta"},
		{"sin esquema", "api.alcanzamos.co", "https://"},
		{"ruta relativa", "/api", "https://"},
		{"http", "http://api.alcanzamos.co", "https://"},
		{"http de localhost sin la variable de desarrollo", "http://localhost:8080", "https://"},
		{"otro esquema", "ftp://api.alcanzamos.co", "https://"},
		{"sin host", "https://", "host"},
		{"con usuario", "https://usuario:clave@api.alcanzamos.co", "usuario"},
		{"con ruta", "https://api.alcanzamos.co/api", "ruta"},
		{"con consulta", "https://api.alcanzamos.co?x=1", "ruta"},
		{"con fragmento", "https://api.alcanzamos.co#x", "ruta"},
		// Lo que llega al connect-src de la CSP no puede abrir otra directiva ni otra fuente.
		{"punto y coma", "https://a.com;script-src *", "host"},
		{"coma", "https://a.com,b.com", "host"},
		{"espacio", "https://a.com b.com", "host"},
		{"comodín", "https://*.alcanzamos.co", "host"},
		{"comilla", "https://a.com'", "host"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			_, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": c.entrada}))
			if err == nil {
				t.Fatal("se esperaba un error")
			}
			if !strings.Contains(err.Error(), "API_URL") || !strings.Contains(err.Error(), c.texto) {
				t.Fatalf("error %q: debe nombrar API_URL y contener %q", err, c.texto)
			}
			if strings.Contains(err.Error(), "clave") {
				t.Fatalf("el error no debe repetir las credenciales: %q", err)
			}
		})
	}
}

func TestAPIURLLocalSoloConLaVariableDeDesarrollo(t *testing.T) {
	validas := []struct{ entrada, origen string }{
		{"http://localhost:8080", "http://localhost:8080"},
		{"http://127.0.0.1:8080", "http://127.0.0.1:8080"},
		{"http://[::1]:8080", "http://[::1]:8080"},
		{"https://api.alcanzamos.co", "https://api.alcanzamos.co"},
	}
	for _, c := range validas {
		t.Run(c.entrada, func(t *testing.T) {
			cfg, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": c.entrada, "PERMITIR_API_LOCAL": "true"}))
			if err != nil {
				t.Fatalf("error inesperado: %v", err)
			}
			if cfg.OrigenAPI != c.origen {
				t.Fatalf("origen %q, se esperaba %q", cfg.OrigenAPI, c.origen)
			}
		})
	}
	rechazadas := []struct{ nombre, entrada, bandera string }{
		{"http de otro host aun con la variable", "http://api.alcanzamos.co", "true"},
		{"http de un nombre que empieza como localhost", "http://localhost.alcanzamos.co", "true"},
		{"la variable solo vale con true", "http://localhost:8080", "1"},
		{"la variable vacía no cuenta", "http://localhost:8080", ""},
	}
	for _, c := range rechazadas {
		t.Run(c.nombre, func(t *testing.T) {
			if _, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": c.entrada, "PERMITIR_API_LOCAL": c.bandera})); err == nil {
				t.Fatal("se esperaba un error")
			}
		})
	}
}

func TestPuertoYDirectorio(t *testing.T) {
	cfg, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": "https://api.alcanzamos.co"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Puerto != 8080 || cfg.Directorio != "dist" {
		t.Fatalf("por defecto puerto %d y directorio %q; se esperaba 8080 y dist", cfg.Puerto, cfg.Directorio)
	}
	cfg, err = servidor.LeerConfig(entorno(map[string]string{"API_URL": "https://api.alcanzamos.co", "PUERTO": "9090", "DIRECTORIO_WEB": "/web"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Puerto != 9090 || cfg.Directorio != "/web" {
		t.Fatalf("puerto %d y directorio %q; se esperaba 9090 y /web", cfg.Puerto, cfg.Directorio)
	}
	for _, malo := range []string{"abc", "-1", "70000", "80.5"} {
		_, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": "https://api.alcanzamos.co", "PUERTO": malo}))
		if err == nil || !strings.Contains(err.Error(), "PUERTO") {
			t.Fatalf("PUERTO=%q: error %v; se esperaba uno que nombre PUERTO", malo, err)
		}
	}
}
