package servidor_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// HSTS y la CSP llegan en las cabeceras ya enviadas, también en un 204, una redirección y http.Error (E11-INF v0.20, 2.16).
func TestHSTSEnCabecerasConfirmadas(t *testing.T) {
	casos := []struct {
		nombre string
		codigo int
		h      http.HandlerFunc
	}{
		{"sin cuerpo", http.StatusNoContent,
			func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			}},
		{"redireccion", http.StatusTemporaryRedirect,
			func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, "/salud", http.StatusTemporaryRedirect)
			}},
		{"http.Error", http.StatusBadRequest,
			func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "solicitud inválida", http.StatusBadRequest)
			}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			servidor.ManejadorConAPI(c.h).ServeHTTP(
				rr, httptest.NewRequest(http.MethodGet, "/api/prueba", nil),
			)
			resp := rr.Result()
			t.Cleanup(func() {
				if err := resp.Body.Close(); err != nil {
					t.Error(err)
				}
			})
			if resp.StatusCode != c.codigo {
				t.Fatalf("estado %d, esperado %d", resp.StatusCode, c.codigo)
			}
			valores := resp.Header.Values("Strict-Transport-Security")
			if len(valores) != 1 || valores[0] != hsts {
				t.Fatalf("HSTS confirmado: %q", valores)
			}
			if got := resp.Header.Get("Content-Security-Policy"); got != politicaCSP {
				t.Fatalf("CSP confirmada: %q", got)
			}
		})
	}
}
