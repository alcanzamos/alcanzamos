package servidor_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// E11-INF 2.16: toda respuesta del API lleva `X-Content-Type-Options: nosniff`, también la de /salud, la de /api/, el 404 de
// una ruta desconocida y el preflight de CORS.
func TestT17NosniffEnJSONYPreflight(t *testing.T) {
	casos := []struct {
		nombre string
		pedido *http.Request
		codigo int
	}{
		{"GET /salud", pedido("GET", "/salud", ""), 200},
		{"GET de /api/", pedido("GET", "/api/v1/prueba/cors", origenDeLaWeb), 200},
		{"404 de /api/", pedido("GET", "/api/v1/no-existe", origenDeLaWeb), 404},
		{"404 fuera de /api/", pedido("GET", "/index.html", ""), 404},
		{"preflight", pedido("OPTIONS", "/api/v1/prueba/cors", origenDeLaWeb, "Access-Control-Request-Method", "POST"), 204},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			var n int
			rr := httptest.NewRecorder()
			apiParaCORS(t, origenDeLaWeb, &n).ServeHTTP(rr, c.pedido)
			resp := rr.Result()
			t.Cleanup(func() {
				if err := resp.Body.Close(); err != nil {
					t.Error(err)
				}
			})
			if resp.StatusCode != c.codigo {
				t.Fatalf("código %d, se esperaba %d", resp.StatusCode, c.codigo)
			}
			if got := resp.Header.Values("X-Content-Type-Options"); len(got) != 1 || got[0] != "nosniff" {
				t.Fatalf("X-Content-Type-Options %q, se esperaba nosniff", got)
			}
		})
	}
}

// Una ruta de /api/ con barras de más (`/api//v1/...`) la redirige el ServeMux a su forma canónica; esa redirección también
// lleva `Vary: Origin` y, solo para el origen de la web, las cabeceras de CORS.
func TestT17VaryYCORSEnRedireccionCanonica(t *testing.T) {
	casos := []struct {
		nombre  string
		origen  string
		conCORS bool
	}{
		{"origen de la web", origenDeLaWeb, true},
		{"otro origen", "https://otro.test", false},
		{"sin origen", "", false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			var n int
			rr := httptest.NewRecorder()
			apiParaCORS(t, origenDeLaWeb, &n).ServeHTTP(rr, pedido("GET", "/api//v1/prueba/cors", c.origen))
			if rr.Code != http.StatusTemporaryRedirect {
				t.Fatalf("código %d, se esperaba 307 a la ruta canónica", rr.Code)
			}
			if got := rr.Header().Get("Location"); got != "/api/v1/prueba/cors" {
				t.Errorf("Location %q, se esperaba /api/v1/prueba/cors", got)
			}
			if !contieneVary(rr, "Origin") {
				t.Errorf("falta Vary: Origin: %q", rr.Header().Values("Vary"))
			}
			if !c.conCORS {
				sinCORS(t, rr)
				return
			}
			if got := rr.Header().Values("Access-Control-Allow-Origin"); len(got) != 1 || got[0] != origenDeLaWeb {
				t.Errorf("Access-Control-Allow-Origin %q, se esperaba %q", got, origenDeLaWeb)
			}
			if got := rr.Header().Values("Access-Control-Allow-Credentials"); len(got) != 1 || got[0] != "true" {
				t.Errorf("Access-Control-Allow-Credentials %q, se esperaba true", got)
			}
			if n != 0 {
				t.Errorf("la redirección no debe alcanzar la ruta: %d veces", n)
			}
		})
	}
}
