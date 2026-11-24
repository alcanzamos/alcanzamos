package servidor_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// hstsEsperada es el valor exacto de Strict-Transport-Security, igual al del API (E11-INF v0.20, 2.16).
const hstsEsperada = "max-age=31536000; includeSubDomains"

// Todas las comprobaciones leen rr.Result().Header: las cabeceras ya confirmadas con el código de estado, no las que
// el manejador dejó en el mapa antes de escribir (en un 404 o un 405 la diferencia importa).
func TestStrictTransportSecurityEnTodasLasRespuestas(t *testing.T) {
	casos := []struct {
		nombre, metodo, ruta string
		codigo               int
	}{
		{"raíz", "GET", "/", 200},
		{"index.html directo", "GET", "/index.html", 200},
		{"ruta de la SPA (index de respaldo)", "GET", "/movimientos", 200},
		{"HEAD de ruta de la SPA", "HEAD", "/movimientos", 200},
		{"asset", "GET", "/assets/index-abc123.js", 200},
		{"HEAD de un asset", "HEAD", "/assets/index-abc123.js", 200},
		{"archivo suelto", "GET", "/fuentes/figtree-OFL.txt", 200},
		{"config.json", "GET", "/config.json", 200},
		{"HEAD de config.json", "HEAD", "/config.json", 200},
		{"salud", "GET", "/salud", 200},
		{"asset inexistente", "GET", "/assets/no-existe.js", 404},
		{"asset inexistente en una subcarpeta", "GET", "/assets/viejo/no-existe.css", 404},
		{"directorio de assets", "GET", "/assets/", 404},
		{"assets sin barra", "GET", "/assets", 404},
		{"POST a la raíz", "POST", "/", 405},
		{"DELETE a un asset", "DELETE", "/assets/index-abc123.js", 405},
		{"POST a salud", "POST", "/salud", 405},
		{"POST a config.json", "POST", "/config.json", 405},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			manejadorDePrueba(t).ServeHTTP(rr, httptest.NewRequest(c.metodo, c.ruta, nil))
			resp := rr.Result()
			t.Cleanup(func() {
				if err := resp.Body.Close(); err != nil {
					t.Error(err)
				}
			})
			if resp.StatusCode != c.codigo {
				t.Fatalf("código %d, se esperaba %d", resp.StatusCode, c.codigo)
			}
			if got := resp.Header.Values("Strict-Transport-Security"); len(got) != 1 || got[0] != hstsEsperada {
				t.Fatalf("Strict-Transport-Security %q, se esperaba exactamente [%q]", got, hstsEsperada)
			}
		})
	}
}

func TestStrictTransportSecurityNoLlevaPreload(t *testing.T) {
	for _, ruta := range []string{"/", "/assets/no-existe.js", "/salud"} {
		rr := httptest.NewRecorder()
		manejadorDePrueba(t).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, ruta, nil))
		got := rr.Result().Header.Get("Strict-Transport-Security")
		if got == "" || strings.Contains(strings.ToLower(got), "preload") {
			t.Fatalf("%s: Strict-Transport-Security %q; debe existir y no llevar preload", ruta, got)
		}
	}
}

// El servidor no sabe si hay TLS delante (la entrada de Container Apps lo termina): la cabecera sale siempre, también
// sobre HTTP simple. Los navegadores la ignoran sobre HTTP (RFC 6797, 8.1).
func TestStrictTransportSecuritySaleTambienSobreHTTPSinTLS(t *testing.T) {
	srv := httptest.NewServer(manejadorDePrueba(t))
	defer srv.Close()
	if !strings.HasPrefix(srv.URL, "http://") {
		t.Fatalf("la prueba necesita HTTP sin TLS, no %s", srv.URL)
	}
	for _, ruta := range []string{"/", "/assets/no-existe.js", "/config.json"} {
		resp, err := srv.Client().Get(srv.URL + ruta)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.Copy(io.Discard, resp.Body); err != nil {
			t.Fatal(err)
		}
		if err := resp.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if resp.TLS != nil {
			t.Fatalf("%s: la respuesta no debería venir por TLS", ruta)
		}
		if got := resp.Header.Get("Strict-Transport-Security"); got != hstsEsperada {
			t.Fatalf("%s: Strict-Transport-Security %q, se esperaba %q", ruta, got, hstsEsperada)
		}
	}
}

// Sumar HSTS no cambia ninguna otra cabecera: ni la CSP, ni nosniff, ni Cache-Control, ni Allow, ni el conjunto de
// cabeceras de cada respuesta.
func TestHSTSNoCambiaLasDemasCabeceras(t *testing.T) {
	const (
		csp   = "Content-Security-Policy"
		nosn  = "X-Content-Type-Options"
		cache = "Cache-Control"
		tipo  = "Content-Type"
		rango = "Accept-Ranges"
	)
	casos := []struct {
		nombre, metodo, ruta string
		esperadas            map[string]string // todas las cabeceras salvo HSTS y Content-Length
	}{
		{"index de respaldo", "GET", "/movimientos", map[string]string{
			csp: cspEsperada, nosn: "nosniff", rango: "bytes", cache: "no-cache", tipo: "text/html; charset=utf-8"}},
		{"asset", "GET", "/assets/index-abc123.js", map[string]string{
			csp: cspEsperada, nosn: "nosniff", rango: "bytes", cache: "public, max-age=31536000, immutable", tipo: "text/javascript; charset=utf-8"}},
		{"config.json", "GET", "/config.json", map[string]string{
			csp: cspEsperada, nosn: "nosniff", rango: "bytes", cache: "no-store", tipo: "application/json"}},
		{"salud", "GET", "/salud", map[string]string{
			csp: cspEsperada, nosn: "nosniff", rango: "bytes", cache: "no-store", tipo: "application/json"}},
		{"404 bajo assets", "GET", "/assets/no-existe.js", map[string]string{
			csp: cspEsperada, nosn: "nosniff", cache: "no-store", tipo: "text/plain; charset=utf-8"}},
		{"405", "POST", "/", map[string]string{
			csp: cspEsperada, nosn: "nosniff", "Allow": "GET, HEAD", tipo: "text/plain; charset=utf-8"}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rr := httptest.NewRecorder()
			manejadorDePrueba(t).ServeHTTP(rr, httptest.NewRequest(c.metodo, c.ruta, nil))
			resp := rr.Result()
			t.Cleanup(func() {
				if err := resp.Body.Close(); err != nil {
					t.Error(err)
				}
			})
			recibidas := map[string]string{}
			for nombre := range resp.Header {
				if nombre == "Strict-Transport-Security" || nombre == "Content-Length" {
					continue
				}
				recibidas[nombre] = resp.Header.Get(nombre)
			}
			if !reflect.DeepEqual(recibidas, c.esperadas) {
				t.Fatalf("cabeceras %v, se esperaban %v (más Strict-Transport-Security)", recibidas, c.esperadas)
			}
		})
	}
}
