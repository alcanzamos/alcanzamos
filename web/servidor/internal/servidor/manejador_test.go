package servidor_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/alcanzamos/alcanzamos/web/servidor/internal/servidor"
)

const (
	indiceDePrueba = "<!doctype html><title>indice</title>"
	origenAPI      = "https://api-uat.alcanzamos.co"
	// La CSP de la web: la misma que mandaba el API (api/src/servidor/servidor.go) con el connect-src del API.
	cspEsperada = "default-src 'self'; connect-src 'self' https://api-uat.alcanzamos.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
)

func raizDePrueba() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                {Data: []byte(indiceDePrueba)},
		"assets/index-abc123.js":    {Data: []byte("console.log(1)")},
		"assets/Figtree-abc123.ttf": {Data: []byte("fuente")},
		"fuentes/figtree-OFL.txt":   {Data: []byte("licencia")},
		// Un config.json en el directorio no debe tapar al que arma el servidor.
		"config.json": {Data: []byte(`{"url_api":"https://viejo.example"}`)},
	}
}

func manejadorDePrueba(t *testing.T) http.Handler {
	t.Helper()
	cfg, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": origenAPI}))
	if err != nil {
		t.Fatal(err)
	}
	return servidor.Manejador(raizDePrueba(), cfg)
}

func TestRutasYCache(t *testing.T) {
	casos := []struct {
		nombre, metodo, ruta string
		codigo               int
		tipo                 string // prefijo esperado del Content-Type; vacío = no se comprueba
		cuerpo               string // subcadena esperada; vacío = no se comprueba
		cache                string // Cache-Control esperado; vacío = no se comprueba
	}{
		{"raíz devuelve index.html", "GET", "/", 200, "text/html", indiceDePrueba, "no-cache"},
		{"index.html directo", "GET", "/index.html", 200, "text/html", indiceDePrueba, "no-cache"},
		{"asset real con su tipo", "GET", "/assets/index-abc123.js", 200, "text/javascript", "console.log(1)", "public, max-age=31536000, immutable"},
		{"fuente con tipo font/ttf", "GET", "/assets/Figtree-abc123.ttf", 200, "font/ttf", "fuente", "public, max-age=31536000, immutable"},
		{"HEAD de un asset", "HEAD", "/assets/index-abc123.js", 200, "text/javascript", "", "public, max-age=31536000, immutable"},
		{"archivo fuera de assets sin caché largo", "GET", "/fuentes/figtree-OFL.txt", 200, "text/plain", "licencia", "no-cache"},
		{"ruta de la SPA devuelve index.html", "GET", "/alguna/ruta", 200, "text/html", indiceDePrueba, "no-cache"},
		{"HEAD de ruta de la SPA", "HEAD", "/movimientos", 200, "text/html", "", "no-cache"},
		{"asset inexistente cae a index.html", "GET", "/assets/no-existe.js", 200, "text/html", indiceDePrueba, "no-cache"},
		{"un directorio no se lista", "GET", "/assets/", 200, "text/html", indiceDePrueba, "no-cache"},
		{"una ruta de /api/ también cae a index.html", "GET", "/api/v1/algo", 200, "text/html", indiceDePrueba, "no-cache"},
		{"POST a la raíz da 405", "POST", "/", 405, "", "", ""},
		{"POST a una ruta de la SPA da 405", "POST", "/movimientos", 405, "", "", ""},
		{"DELETE a un asset da 405", "DELETE", "/assets/index-abc123.js", 405, "", "", ""},
		{"salud", "GET", "/salud", 200, "application/json", `{"estado":"ok"}`, "no-store"},
		{"salud solo GET", "POST", "/salud", 405, "", "", ""},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			manejadorDePrueba(t).ServeHTTP(rr, httptest.NewRequest(c.metodo, c.ruta, nil))
			if rr.Code != c.codigo {
				t.Fatalf("código %d, se esperaba %d (cuerpo %q)", rr.Code, c.codigo, rr.Body.String())
			}
			if !strings.HasPrefix(rr.Header().Get("Content-Type"), c.tipo) {
				t.Fatalf("Content-Type %q, se esperaba %q", rr.Header().Get("Content-Type"), c.tipo)
			}
			if !strings.Contains(rr.Body.String(), c.cuerpo) {
				t.Fatalf("cuerpo %q no contiene %q", rr.Body.String(), c.cuerpo)
			}
			if c.cache != "" && rr.Header().Get("Cache-Control") != c.cache {
				t.Fatalf("Cache-Control %q, se esperaba %q", rr.Header().Get("Cache-Control"), c.cache)
			}
			if c.codigo == 405 && rr.Header().Get("Allow") != "GET, HEAD" {
				t.Fatalf("Allow %q, se esperaba %q", rr.Header().Get("Allow"), "GET, HEAD")
			}
			if c.metodo == "HEAD" && rr.Body.Len() != 0 {
				t.Fatalf("HEAD no debe traer cuerpo: %q", rr.Body.String())
			}
		})
	}
}

func TestConfigJSON(t *testing.T) {
	h := manejadorDePrueba(t)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/config.json", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("código %d", rr.Code)
	}
	if got := rr.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control %q, se esperaba no-store", got)
	}
	if got := rr.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("Content-Type %q", got)
	}
	var cuerpo map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("el cuerpo no es JSON: %v (%q)", err, rr.Body.String())
	}
	if len(cuerpo) != 1 || cuerpo["url_api"] != origenAPI {
		t.Fatalf("config.json %v; se esperaba solo url_api=%s", cuerpo, origenAPI)
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodHead, "/config.json", nil))
	if rr.Code != http.StatusOK || rr.Header().Get("Cache-Control") != "no-store" || rr.Body.Len() != 0 {
		t.Fatalf("HEAD: código %d, Cache-Control %q, cuerpo %q", rr.Code, rr.Header().Get("Cache-Control"), rr.Body.String())
	}

	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/config.json", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: código %d, se esperaba 405", rr.Code)
	}
}

func TestCabecerasDeSeguridadEnTodasLasRespuestas(t *testing.T) {
	casos := []struct{ nombre, metodo, ruta string }{
		{"raíz", "GET", "/"},
		{"ruta de la SPA", "GET", "/movimientos"},
		{"asset", "GET", "/assets/index-abc123.js"},
		{"archivo suelto", "GET", "/fuentes/figtree-OFL.txt"},
		{"config.json", "GET", "/config.json"},
		{"salud", "GET", "/salud"},
		{"método no permitido", "POST", "/"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			manejadorDePrueba(t).ServeHTTP(rr, httptest.NewRequest(c.metodo, c.ruta, nil))
			if got := rr.Header().Get("Content-Security-Policy"); got != cspEsperada {
				t.Fatalf("Content-Security-Policy %q, se esperaba %q", got, cspEsperada)
			}
			if got := rr.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Fatalf("X-Content-Type-Options %q, se esperaba nosniff", got)
			}
		})
	}
}

func TestCSPLlevaElOrigenExactoDelAPI(t *testing.T) {
	for _, api := range []string{"https://api.alcanzamos.co", "https://api-uat.alcanzamos.co:8443"} {
		cfg, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": api + "/"}))
		if err != nil {
			t.Fatal(err)
		}
		rr := httptest.NewRecorder()
		servidor.Manejador(raizDePrueba(), cfg).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))
		quiere := "connect-src 'self' " + api + ";"
		if csp := rr.Header().Get("Content-Security-Policy"); !strings.Contains(csp, quiere) {
			t.Fatalf("CSP %q no contiene %q", csp, quiere)
		}
	}
}

func TestSinIndiceDa404(t *testing.T) {
	cfg, err := servidor.LeerConfig(entorno(map[string]string{"API_URL": origenAPI}))
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	servidor.Manejador(fstest.MapFS{}, cfg).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("código %d, se esperaba 404", rr.Code)
	}
}

func TestRecorridoDeRutaNoSaleDelSistemaDeArchivos(t *testing.T) {
	rutas := []string{"/../go.mod", "/assets/../../go.mod", "/%2e%2e/go.mod", "/..%2fgo.mod", "/assets/..%2f..%2fgo.mod"}
	for _, ruta := range rutas {
		t.Run(ruta, func(t *testing.T) {
			rr := httptest.NewRecorder()
			manejadorDePrueba(t).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, ruta, nil))
			if strings.Contains(rr.Body.String(), "module ") {
				t.Fatalf("se filtró un archivo fuera de la web: %q", rr.Body.String())
			}
			// El ServeMux normaliza "..": o redirige a la ruta limpia o la sirve como ruta de la SPA.
			if rr.Code != http.StatusOK && rr.Code != http.StatusTemporaryRedirect {
				t.Fatalf("código %d", rr.Code)
			}
		})
	}
}
