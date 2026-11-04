package servidor_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// Los casos de E17 3.15 (D-173, D-174, D-175) de DefensaCSRF, sin pasar por ninguna ruta.
func TestDefensaCSRFSegunE17(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	json := "application/json"
	casos := []struct {
		nombre     string
		urlPublica string
		cabeceras  map[string]string
		codigo     int
	}{
		{"(a) same-origin", "https://app.ej.test", map[string]string{"Sec-Fetch-Site": "same-origin", "Content-Type": json}, 204},
		{"(a) cross-site", "https://app.ej.test", map[string]string{"Sec-Fetch-Site": "cross-site", "Content-Type": json}, 403},
		{"(a) same-site", "https://app.ej.test", map[string]string{"Sec-Fetch-Site": "same-site", "Content-Type": json}, 403},
		{"(a) vacía", "https://app.ej.test", map[string]string{"Sec-Fetch-Site": "", "Content-Type": json}, 403},
		{"(a) manda sobre Origin", "https://app.ej.test", map[string]string{"Sec-Fetch-Site": "same-origin", "Origin": "https://otro.test", "Content-Type": json}, 204},
		{"(b) Origin igual", "https://app.ej.test", map[string]string{"Origin": "https://app.ej.test", "Content-Type": json}, 204},
		{"(b) Origin igual con una URL pública con ruta", "https://app.ej.test/inicio/", map[string]string{"Origin": "https://app.ej.test", "Content-Type": json}, 204},
		{"(b) Origin ajeno", "https://app.ej.test", map[string]string{"Origin": "https://otro.test", "Content-Type": json}, 403},
		{"(b) Origin de otro esquema", "https://app.ej.test", map[string]string{"Origin": "http://app.ej.test", "Content-Type": json}, 403},
		{"(b) Origin null", "https://app.ej.test", map[string]string{"Origin": "null", "Content-Type": json}, 403},
		{"(b) sin URL pública", "", map[string]string{"Origin": "https://app.ej.test", "Content-Type": json}, 403},
		{"(b) URL pública inválida", "app.ej.test", map[string]string{"Origin": "app.ej.test", "Content-Type": json}, 403},
		{"(b) URL pública mal escrita", "http://[::1", map[string]string{"Origin": "http://[::1", "Content-Type": json}, 403},
		{"(c) Bearer", "https://app.ej.test", map[string]string{"Authorization": "Bearer abc", "Content-Type": json}, 204},
		{"(c) cliente Android", "https://app.ej.test", map[string]string{"X-Alcanzamos-Cliente": "android", "Content-Type": json}, 204},
		{"(c) Authorization que no es Bearer", "https://app.ej.test", map[string]string{"Authorization": "Basic abc", "Content-Type": json}, 403},
		{"(c) sin nada", "https://app.ej.test", map[string]string{"Content-Type": json}, 403},
		{"(d) json con charset", "https://app.ej.test", map[string]string{"X-Alcanzamos-Cliente": "android", "Content-Type": "application/json; charset=utf-8"}, 204},
		{"(d) mayúsculas", "https://app.ej.test", map[string]string{"X-Alcanzamos-Cliente": "android", "Content-Type": "Application/JSON"}, 204},
		{"(d) text/plain", "https://app.ej.test", map[string]string{"X-Alcanzamos-Cliente": "android", "Content-Type": "text/plain"}, 415},
		{"(d) formulario", "https://app.ej.test", map[string]string{"X-Alcanzamos-Cliente": "android", "Content-Type": "application/x-www-form-urlencoded"}, 415},
		{"(d) sin tipo", "https://app.ej.test", map[string]string{"X-Alcanzamos-Cliente": "android"}, 415},
		{"(d) tipo mal escrito", "https://app.ej.test", map[string]string{"X-Alcanzamos-Cliente": "android", "Content-Type": "application/json;;"}, 415},
		{"(a) antes que (d)", "https://app.ej.test", map[string]string{"Sec-Fetch-Site": "cross-site", "Content-Type": "text/plain"}, 403},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/v1/x", strings.NewReader(""))
			for k, v := range c.cabeceras {
				r.Header.Set(k, v)
			}
			rr := httptest.NewRecorder()
			servidor.DefensaCSRF(c.urlPublica, ok).ServeHTTP(rr, r)
			if rr.Code != c.codigo {
				t.Fatalf("%d %s, se esperaba %d", rr.Code, rr.Body, c.codigo)
			}
			switch c.codigo {
			case 403:
				if got := strings.TrimSpace(rr.Body.String()); got != `{"error":"solicitud_no_permitida"}` {
					t.Errorf("cuerpo %s", got)
				}
			case 415:
				if got := strings.TrimSpace(rr.Body.String()); got != `{"error":"tipo_de_contenido_no_permitido"}` {
					t.Errorf("cuerpo %s", got)
				}
			}
		})
	}
}

func TestLeerJSONHastaCortaElCuerpoGrande(t *testing.T) {
	var destino struct{ A string }
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"A":"`+strings.Repeat("x", 100)+`"}`))
	rr := httptest.NewRecorder()
	if servidor.LeerJSONHasta(rr, r, &destino, 50) || rr.Code != 400 {
		t.Errorf("%d", rr.Code)
	}
	r = httptest.NewRequest("POST", "/", strings.NewReader(`{"A":"`+strings.Repeat("x", 100)+`"}`))
	if !servidor.LeerJSONHasta(httptest.NewRecorder(), r, &destino, 500) || len(destino.A) != 100 {
		t.Error("cabe")
	}
}
