// Package csrftest es el ayudante de las pruebas de manejadores que no son la defensa contra CSRF (E17 3.15, D-173):
// el Enrutador rechaza todo POST sin las cabeceras de un cliente real, y esas pruebas hablan de otra cosa. ConCabeceras
// le pone al pedido las de la web (`Sec-Fetch-Site: same-origin`, `Content-Type: application/json`) solo cuando no
// trae ninguna de las que la defensa mira, así una prueba que manda las suyas (Origin, Authorization, cliente Android,
// otro tipo de contenido) las conserva.
package csrftest

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// ConCabeceras devuelve un manejador que completa las cabeceras de cliente de un pedido que no trae ninguna.
func ConCabeceras(siguiente http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, sitio := r.Header["Sec-Fetch-Site"]
		_, origen := r.Header["Origin"]
		if !sitio && !origen && r.Header.Get("Authorization") == "" && r.Header.Get("X-Alcanzamos-Cliente") == "" {
			r.Header.Set("Sec-Fetch-Site", "same-origin")
		}
		if r.Header.Get("Content-Type") == "" {
			r.Header.Set("Content-Type", "application/json")
		}
		siguiente.ServeHTTP(w, r)
	})
}

// Caso es un pedido de la web o de Android a una ruta que cambia algo (POST, PUT o DELETE), con sus cabeceras, y lo que la defensa de E17 3.15 debe responder:
// Estado 403 o 415 con su código de error, o 0 si debe dejarlo pasar.
type Caso struct {
	Nombre    string
	Cabeceras map[string]string
	Estado    int
}

const (
	errorDe403 = `{"error":"solicitud_no_permitida"}`
	errorDe415 = `{"error":"tipo_de_contenido_no_permitido"}`
)

// Casos son los de SEG-016 (a) a (d) y la reproducción de A-18, con `urlPublica` como `URL_PUBLICA`.
func Casos(urlPublica string) []Caso {
	json := "application/json"
	h := func(kv ...string) map[string]string {
		m := map[string]string{}
		for i := 0; i < len(kv); i += 2 {
			m[kv[i]] = kv[i+1]
		}
		return m
	}
	return []Caso{
		{"(a) cross-site", h("Sec-Fetch-Site", "cross-site", "Content-Type", json), 403},
		{"(a) same-site", h("Sec-Fetch-Site", "same-site", "Content-Type", json), 403},
		{"(a) none", h("Sec-Fetch-Site", "none", "Content-Type", json), 403},
		{"(a) cross-site con Bearer", h("Sec-Fetch-Site", "cross-site", "Authorization", "Bearer abc", "Content-Type", json), 403},
		{"(a) cross-site con Origin de URL_PUBLICA", h("Sec-Fetch-Site", "cross-site", "Origin", urlPublica, "Content-Type", json), 403},
		{"(a) same-origin", h("Sec-Fetch-Site", "same-origin", "Content-Type", json), 0},
		{"(b) Origin ajeno", h("Origin", "https://atacante.example", "Content-Type", json), 403},
		{"(b) Origin ajeno con Bearer", h("Origin", "https://atacante.example", "Authorization", "Bearer abc", "Content-Type", json), 403},
		{"(b) Origin null", h("Origin", "null", "Content-Type", json), 403},
		{"(b) Origin de URL_PUBLICA", h("Origin", urlPublica, "Content-Type", json), 0},
		{"(c) sin ninguna cabecera de cliente", h("Content-Type", json), 403},
		{"(c) Authorization que no es Bearer", h("Authorization", "Basic abc", "Content-Type", json), 403},
		{"(c) Authorization: Bearer", h("Authorization", "Bearer abc", "Content-Type", json), 0},
		{"(c) X-Alcanzamos-Cliente", h("X-Alcanzamos-Cliente", "android", "Content-Type", json), 0},
		{"(d) text/plain con same-origin", h("Sec-Fetch-Site", "same-origin", "Content-Type", "text/plain"), 415},
		{"(d) text/plain con el Origin de URL_PUBLICA", h("Origin", urlPublica, "Content-Type", "text/plain"), 415},
		{"(d) text/plain con Android", h("X-Alcanzamos-Cliente", "android", "Content-Type", "text/plain"), 415},
		{"(d) formulario", h("Sec-Fetch-Site", "same-origin", "Content-Type", "application/x-www-form-urlencoded"), 415},
		{"(d) sin Content-Type", h("Sec-Fetch-Site", "same-origin"), 415},
		{"A-18: text/plain, Origin ajeno y cross-site", h("Sec-Fetch-Site", "cross-site", "Origin", "https://atacante.example", "Content-Type", "text/plain"), 403},
	}
}

// ProbarDefensa es SEG-016: para cada ruta que no es GET (POST, PUT y DELETE, D-194; las de Enrutador.Rutas) hace cada
// Caso contra `api`, con el método de la ruta, y comprueba el estado, el cuerpo de error, que no haya `Set-Cookie` y que
// `estado()` (lo que la prueba llame «todo lo guardado») no cambie con un rechazo. Una ruta que cambia algo sin la
// defensa responde otra cosa y hace fallar la prueba. Falla si no hay ninguna ruta POST, PUT ni DELETE, porque una lista
// vacía no prueba nada.
func ProbarDefensa(t *testing.T, api http.Handler, rutas []servidor.Ruta, urlPublica string, estado func() string) {
	t.Helper()
	if estado == nil {
		estado = func() string { return "" }
	}
	comodin := regexp.MustCompile(`\{[^}]*\}`)
	probadas := 0
	for _, ruta := range rutas {
		metodo, camino, ok := strings.Cut(ruta.Patron, " ")
		if !ok || metodo == http.MethodGet {
			continue
		}
		probadas++
		camino = comodin.ReplaceAllString(camino, "0192f3c4-0000-7000-8000-0000000000ee")
		for _, c := range Casos(urlPublica) {
			t.Run(ruta.Patron+" · "+c.Nombre, func(t *testing.T) {
				antes := estado()
				r := httptest.NewRequest(metodo, camino, strings.NewReader(`{}`))
				r.RemoteAddr = "10.1.1.1:1"
				for k, v := range c.Cabeceras {
					r.Header.Set(k, v)
				}
				rr := httptest.NewRecorder()
				api.ServeHTTP(rr, r)
				cuerpo := strings.TrimSpace(rr.Body.String())
				switch c.Estado {
				case 403:
					if rr.Code != 403 || cuerpo != errorDe403 {
						t.Errorf("%d %s, se esperaba 403 %s", rr.Code, cuerpo, errorDe403)
					}
				case 415:
					if rr.Code != 415 || cuerpo != errorDe415 {
						t.Errorf("%d %s, se esperaba 415 %s", rr.Code, cuerpo, errorDe415)
					}
				default:
					if cuerpo == errorDe403 || cuerpo == errorDe415 {
						t.Errorf("la defensa rechazó un pedido válido: %d %s", rr.Code, cuerpo)
					}
					return
				}
				if v := rr.Header().Values("Set-Cookie"); len(v) != 0 {
					t.Errorf("un rechazo no pone cookie: %v", v)
				}
				if despues := estado(); despues != antes {
					t.Errorf("un rechazo no cambia nada:\nantes   %s\ndespués %s", antes, despues)
				}
			})
		}
	}
	if probadas == 0 {
		t.Fatal("no hay ninguna ruta POST, PUT ni DELETE que probar")
	}
}
