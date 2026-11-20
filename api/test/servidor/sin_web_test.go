package servidor_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// politicaCSP es la Content-Security-Policy que debe llevar toda respuesta del API (E11-INF 2.16, D-205 (10)): el API solo
// responde JSON y archivos descargados, nunca una página, así que no carga nada y nadie lo incrusta. La política de la
// web (`default-src 'self'; connect-src …`) es la de ca-web, no la de este servidor.
const politicaCSP = "default-src 'none'; frame-ancestors 'none'"

// El API ya no sirve la web: la sirve ca-web (E11-INF 2.16). Ni la raíz ni los archivos de la web ni una ruta de la SPA
// existen aquí, con ningún método, y la respuesta nunca es HTML.
func TestElAPINoSirveLaWeb(t *testing.T) {
	rutas := []string{"/", "/index.html", "/assets/index-abc123.js", "/assets/", "/fuentes/figtree-OFL.txt", "/movimientos", "/alguna/ruta", "/config.json"}
	for _, ruta := range rutas {
		for _, metodo := range []string{http.MethodGet, http.MethodHead, http.MethodPost} {
			t.Run(metodo+" "+ruta, func(t *testing.T) {
				rr := httptest.NewRecorder()
				servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(metodo, ruta, nil))
				if rr.Code != http.StatusNotFound {
					t.Fatalf("código %d, se esperaba 404 (cuerpo %q)", rr.Code, rr.Body.String())
				}
				if strings.Contains(rr.Header().Get("Content-Type"), "text/html") || strings.Contains(rr.Body.String(), "<html") {
					t.Fatalf("el API no devuelve HTML: %q %q", rr.Header().Get("Content-Type"), rr.Body.String())
				}
			})
		}
	}
}

// PRESERVE: lo que no es la web sigue igual. /salud responde 200 y /api/ desconocida da 404 en JSON, ahora sin que haya una
// web a la que caer.
func TestSinWebLaSaludYElAPISiguenIgual(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/salud", nil))
	if rr.Code != http.StatusOK || strings.TrimSpace(rr.Body.String()) != `{"estado":"ok"}` {
		t.Fatalf("/salud: %d %q", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/no-existe", nil))
	if rr.Code != http.StatusNotFound || rr.Header().Get("Content-Type") != "application/json" || strings.TrimSpace(rr.Body.String()) != `{"error":"no_encontrado"}` {
		t.Fatalf("/api/ desconocida: %d %q %q", rr.Code, rr.Header().Get("Content-Type"), rr.Body.String())
	}
}

// La CSP del API es la misma en toda respuesta: la de /salud, la de /api/ y los errores (404, 405, 401, 403, 415).
func TestContentSecurityPolicyDelAPIEnTodasLasRespuestas(t *testing.T) {
	json := func(r *http.Request) *http.Request { r.Header.Set("Content-Type", "application/json"); return r }
	casos := []struct {
		nombre string
		pedido *http.Request
		codigo int
	}{
		{"salud", httptest.NewRequest(http.MethodGet, "/salud", nil), 200},
		{"ruta del API", httptest.NewRequest(http.MethodGet, "/api/v1/prueba/ok", nil), 200},
		{"API desconocida", httptest.NewRequest(http.MethodGet, "/api/no-existe", nil), 404},
		{"raíz", httptest.NewRequest(http.MethodGet, "/", nil), 404},
		{"método no permitido", httptest.NewRequest(http.MethodPost, "/salud", nil), 405},
		{"sin sesión", httptest.NewRequest(http.MethodGet, "/api/v1/prueba/privada", nil), 401},
		{"CSRF", func() *http.Request {
			r := json(httptest.NewRequest(http.MethodPost, "/api/v1/prueba/cambia", strings.NewReader("{}")))
			r.Header.Set("Sec-Fetch-Site", "cross-site")
			return r
		}(), 403},
		{"tipo no permitido", func() *http.Request {
			r := httptest.NewRequest(http.MethodPost, "/api/v1/prueba/cambia", strings.NewReader("x"))
			r.Header.Set("Sec-Fetch-Site", "same-origin")
			return r
		}(), 415},
		{"preflight", func() *http.Request {
			r := httptest.NewRequest(http.MethodOptions, "/api/v1/prueba/cambia", nil)
			r.Header.Set("Origin", "https://app.b.test")
			r.Header.Set("Access-Control-Request-Method", "POST")
			return r
		}(), 204},
	}
	h := apiConErrores(t, sesionFalsa{err: servidor.ErrSinSesion})
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, c.pedido)
			if rr.Code != c.codigo {
				t.Fatalf("código %d, se esperaba %d", rr.Code, c.codigo)
			}
			if got := rr.Header().Values("Content-Security-Policy"); len(got) != 1 || got[0] != politicaCSP {
				t.Fatalf("Content-Security-Policy %q, se esperaba %q", got, politicaCSP)
			}
		})
	}
}
