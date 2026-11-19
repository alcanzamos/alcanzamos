package servidor_test

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// hsts es el valor exacto de Strict-Transport-Security: un año y los subdominios, sin `preload` (esa inclusión en la
// lista de los navegadores casi no se deshace y es otra decisión).
const hsts = "max-age=31536000; includeSubDomains"

// apiConErrores arma el manejador completo con rutas que dan las clases de respuesta que no salen de /salud:
// 429 (límite de intentos), 500 y un POST protegido por la defensa contra CSRF.
func apiConErrores(t *testing.T, sesiones servidor.Sesiones) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	e := servidor.NuevoEnrutador(sesiones, seguridad.NuevoRegistro(log), log).ConURLPublica("https://app.b.test")
	e.Registrar(seguridad.Publica, "GET /api/v1/prueba/ok", alcanzado)
	e.Registrar(seguridad.Publica, "GET /api/v1/prueba/limite", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
	}))
	e.Registrar(seguridad.Publica, "GET /api/v1/prueba/fallo", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
	}))
	e.Registrar(seguridad.Publica, "POST /api/v1/prueba/cambia", alcanzado)
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/prueba/privada", alcanzado)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

func TestStrictTransportSecurityEnTodasLasRespuestas(t *testing.T) {
	json := func(r *http.Request) *http.Request { r.Header.Set("Content-Type", "application/json"); return r }
	casos := []struct {
		nombre string
		pedido *http.Request
		codigo int
	}{
		{"200 de /salud", httptest.NewRequest(http.MethodGet, "/salud", nil), 200},
		{"200 de una ruta del API", httptest.NewRequest(http.MethodGet, "/api/v1/prueba/ok", nil), 200},
		{"200 del API con HEAD", httptest.NewRequest(http.MethodHead, "/salud", nil), 200},
		{"404 de /api/ desconocida", httptest.NewRequest(http.MethodGet, "/api/v1/no-existe", nil), 404},
		{"405 de /salud", httptest.NewRequest(http.MethodPost, "/salud", nil), 405},
		{"401 sin sesión", httptest.NewRequest(http.MethodGet, "/api/v1/prueba/privada", nil), 401},
		{"403 de CSRF por Origin ajeno", func() *http.Request {
			r := json(httptest.NewRequest(http.MethodPost, "/api/v1/prueba/cambia", strings.NewReader("{}")))
			r.Header.Set("Origin", "https://otro.test")
			return r
		}(), 403},
		{"403 de CSRF por Sec-Fetch-Site", func() *http.Request {
			r := json(httptest.NewRequest(http.MethodPost, "/api/v1/prueba/cambia", strings.NewReader("{}")))
			r.Header.Set("Sec-Fetch-Site", "cross-site")
			return r
		}(), 403},
		{"415 de CSRF por tipo de contenido", func() *http.Request {
			r := httptest.NewRequest(http.MethodPost, "/api/v1/prueba/cambia", strings.NewReader("x"))
			r.Header.Set("Sec-Fetch-Site", "same-origin")
			return r
		}(), 415},
		{"204 de un preflight de CORS", func() *http.Request {
			r := httptest.NewRequest(http.MethodOptions, "/api/v1/prueba/cambia", nil)
			r.Header.Set("Origin", "https://app.b.test")
			r.Header.Set("Access-Control-Request-Method", "POST")
			return r
		}(), 204},
		{"429 del límite de intentos", httptest.NewRequest(http.MethodGet, "/api/v1/prueba/limite", nil), 429},
		{"500 de un error", httptest.NewRequest(http.MethodGet, "/api/v1/prueba/fallo", nil), 500},
		{"404 de la raíz (el API ya no sirve la web)", httptest.NewRequest(http.MethodGet, "/", nil), 404},
		{"404 de un archivo de la web", httptest.NewRequest(http.MethodGet, "/assets/index-abc123.js", nil), 404},
	}
	h := apiConErrores(t, sesionFalsa{err: servidor.ErrSinSesion})
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, c.pedido)
			if rr.Code != c.codigo {
				t.Fatalf("código %d, se esperaba %d", rr.Code, c.codigo)
			}
			if got := rr.Header().Get("Strict-Transport-Security"); got != hsts {
				t.Fatalf("Strict-Transport-Security %q, se esperaba %q", got, hsts)
			}
			if n := len(rr.Header().Values("Strict-Transport-Security")); n != 1 {
				t.Fatalf("la cabecera sale %d veces, se esperaba 1", n)
			}
		})
	}
}

func TestStrictTransportSecurityNoLlevaPreload(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/salud", nil))
	if got := rr.Header().Get("Strict-Transport-Security"); strings.Contains(strings.ToLower(got), "preload") {
		t.Fatalf("Strict-Transport-Security %q no debe llevar preload", got)
	}
}

// En una ejecución local sin TLS (http://) la cabecera sale igual: los navegadores la ignoran sobre HTTP y así el
// servidor no necesita saber si hay TLS delante.
func TestStrictTransportSecuritySaleTambienSobreHTTPSinTLS(t *testing.T) {
	srv := httptest.NewServer(servidor.Manejador())
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/salud")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.TLS != nil {
		t.Fatal("la prueba debía ir sin TLS")
	}
	if got := resp.Header.Get("Strict-Transport-Security"); got != hsts {
		t.Fatalf("Strict-Transport-Security %q, se esperaba %q", got, hsts)
	}
}

// PRESERVE: añadir HSTS no quita ni cambia lo que ya ponía el manejador: la CSP, el tipo y el cuerpo del error.
func TestHSTSNoCambiaLasDemasCabeceras(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/nada", nil))
	if rr.Code != http.StatusNotFound || rr.Header().Get("Content-Type") != "application/json" ||
		rr.Header().Get("Content-Security-Policy") != politicaCSP ||
		strings.TrimSpace(rr.Body.String()) != `{"error":"no_encontrado"}` {
		t.Fatalf("404 del API cambiado: %d %v %q", rr.Code, rr.Header(), rr.Body)
	}
}
