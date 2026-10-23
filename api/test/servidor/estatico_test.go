package servidor_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// politicaCSP es la Content-Security-Policy que debe llevar toda respuesta. web/vite.config.ts y web/e2e/csp.spec.ts
// repiten este texto: si cambia, debe cambiar allá.
const politicaCSP = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

const indiceDePrueba = "<!doctype html><title>indice</title>"

func raizDePrueba() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                {Data: []byte(indiceDePrueba)},
		"assets/index-abc123.js":    {Data: []byte("console.log(1)")},
		"assets/Figtree-abc123.ttf": {Data: []byte("fuente")},
		"fuentes/figtree-OFL.txt":   {Data: []byte("licencia")},
	}
}

func TestWebYRutas(t *testing.T) {
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
		{"archivo fuera de assets sin caché largo", "GET", "/fuentes/figtree-OFL.txt", 200, "text/plain", "licencia", "no-cache"},
		{"ruta de la SPA devuelve index.html", "GET", "/alguna/ruta", 200, "text/html", indiceDePrueba, "no-cache"},
		{"HEAD de ruta de la SPA", "HEAD", "/movimientos", 200, "text/html", "", "no-cache"},
		{"asset inexistente cae a index.html", "GET", "/assets/no-existe.js", 200, "text/html", indiceDePrueba, "no-cache"},
		{"un directorio no se lista", "GET", "/assets/", 200, "text/html", indiceDePrueba, "no-cache"},
		{"API desconocida da 404 JSON", "GET", "/api/no-existe", 404, "application/json", `"no_encontrado"`, ""},
		{"API raíz da 404 JSON", "GET", "/api/", 404, "application/json", `"no_encontrado"`, ""},
		{"API con POST da 404 JSON", "POST", "/api/no-existe", 404, "application/json", `"no_encontrado"`, ""},
		{"POST a la raíz da 405", "POST", "/", 405, "", "", ""},
		{"POST a una ruta de la SPA da 405", "POST", "/movimientos", 405, "", "", ""},
		{"salud no cambia", "GET", "/salud", 200, "application/json", `{"estado":"ok"}`, ""},
		{"salud solo GET", "POST", "/salud", 405, "", "", ""},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			servidor.ManejadorConRaiz(raizDePrueba()).ServeHTTP(rr, httptest.NewRequest(c.metodo, c.ruta, nil))
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
			if c.codigo == 200 && c.ruta != "/salud" && rr.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("falta X-Content-Type-Options: nosniff")
			}
			if c.codigo == 405 && c.ruta != "/salud" && rr.Header().Get("Allow") != "GET, HEAD" {
				t.Fatalf("Allow %q", rr.Header().Get("Allow"))
			}
			if c.tipo == "application/json" && strings.Contains(rr.Body.String(), "<html") {
				t.Fatal("una respuesta JSON no puede traer HTML")
			}
		})
	}
}

func TestRecorridoDeRutaNoSaleDelSistemaDeArchivos(t *testing.T) {
	rutas := []string{"/../go.mod", "/assets/../../go.mod", "/%2e%2e/go.mod", "/..%2fgo.mod", "/assets/..%2f..%2fgo.mod"}
	for _, ruta := range rutas {
		t.Run(ruta, func(t *testing.T) {
			rr := httptest.NewRecorder()
			servidor.ManejadorConRaiz(raizDePrueba()).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, ruta, nil))
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

func TestWebEmbebidaTieneIndice(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.Manejador().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("código %d, Content-Type %q", rr.Code, rr.Header().Get("Content-Type"))
	}
}

func TestSinIndiceDa404(t *testing.T) {
	rr := httptest.NewRecorder()
	servidor.ManejadorConRaiz(fstest.MapFS{}).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("código %d, se esperaba 404", rr.Code)
	}
}

func TestContentSecurityPolicyEnTodasLasRespuestas(t *testing.T) {
	const esperada = politicaCSP
	casos := []struct{ nombre, metodo, ruta string }{
		{"raíz", "GET", "/"},
		{"ruta de la SPA", "GET", "/movimientos"},
		{"asset", "GET", "/assets/index-abc123.js"},
		{"API desconocida", "GET", "/api/no-existe"},
		{"salud", "GET", "/salud"},
		{"método no permitido", "POST", "/"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			servidor.ManejadorConRaiz(raizDePrueba()).ServeHTTP(rr, httptest.NewRequest(c.metodo, c.ruta, nil))
			if got := rr.Header().Get("Content-Security-Policy"); got != esperada {
				t.Fatalf("Content-Security-Policy %q, se esperaba %q", got, esperada)
			}
		})
	}
}
