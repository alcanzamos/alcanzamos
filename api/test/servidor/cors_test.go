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

// origenDeLaWeb es el de la web (`URL_PUBLICA` = https://app.b.test, con o sin ruta): el único que recibe CORS.
const origenDeLaWeb = "https://app.b.test"

// corsEnTodas son las cabeceras Access-Control-* que solo puede llevar una respuesta al origen de la web.
var corsEnTodas = []string{
	"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Methods",
	"Access-Control-Allow-Headers", "Access-Control-Max-Age", "Access-Control-Expose-Headers",
}

// apiParaCORS arma el manejador completo con una URL pública y, por cada método, una ruta que cuenta cuántas veces se
// alcanzó. urlPublica == "-" no llama a ConURLPublica (el Enrutador sin origen).
func apiParaCORS(t *testing.T, urlPublica string, alcanzadas *int) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	e := servidor.NuevoEnrutador(sesionFalsa{err: servidor.ErrSinSesion}, seguridad.NuevoRegistro(log), log)
	if urlPublica != "-" {
		e.ConURLPublica(urlPublica)
	}
	cuenta := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		*alcanzadas++
		servidor.EscribirJSON(w, http.StatusOK, map[string]string{"estado": "ok"})
	})
	for _, patron := range []string{"GET", "POST", "PUT", "DELETE"} {
		e.Registrar(seguridad.Publica, patron+" /api/v1/prueba/cors", cuenta)
	}
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/prueba/privada", cuenta)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

func pedido(metodo, ruta, origen string, cabeceras ...string) *http.Request {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(""))
	if origen != "" {
		r.Header.Set("Origin", origen)
	}
	for i := 0; i+1 < len(cabeceras); i += 2 {
		r.Header.Set(cabeceras[i], cabeceras[i+1])
	}
	return r
}

func sinCORS(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	for _, c := range corsEnTodas {
		if v := rr.Header().Values(c); len(v) != 0 {
			t.Errorf("%s no debe salir, y sale %q", c, v)
		}
	}
}

func contieneVary(rr *httptest.ResponseRecorder, valor string) bool {
	for _, v := range rr.Header().Values("Vary") {
		for _, parte := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(parte), valor) {
				return true
			}
		}
	}
	return false
}

// El origen exacto de URL_PUBLICA recibe el suyo (nunca «*»), con credenciales y Vary: Origin, en toda respuesta de /api/:
// también en los errores, para que la web pueda leer el 401, el 403 y el 404.
func TestCORSElOrigenExactoRecibeSuOrigenConCredencialesYVary(t *testing.T) {
	casos := []struct {
		nombre string
		pedido *http.Request
		codigo int
	}{
		{"200 de un GET", pedido("GET", "/api/v1/prueba/cors", origenDeLaWeb, "Sec-Fetch-Site", "same-site"), 200},
		{"200 de un POST de la web separada", pedido("POST", "/api/v1/prueba/cors", origenDeLaWeb, "Sec-Fetch-Site", "same-site", "Content-Type", "application/json"), 200},
		{"200 de un PUT", pedido("PUT", "/api/v1/prueba/cors", origenDeLaWeb, "Sec-Fetch-Site", "same-site", "Content-Type", "application/json"), 200},
		{"200 de un DELETE", pedido("DELETE", "/api/v1/prueba/cors", origenDeLaWeb, "Sec-Fetch-Site", "same-site", "Content-Type", "application/json"), 200},
		{"401 sin sesión", pedido("GET", "/api/v1/prueba/privada", origenDeLaWeb), 401},
		{"403 de CSRF", pedido("POST", "/api/v1/prueba/cors", origenDeLaWeb, "Sec-Fetch-Site", "cross-site", "Content-Type", "application/json"), 403},
		{"415 de tipo de contenido", pedido("POST", "/api/v1/prueba/cors", origenDeLaWeb, "Sec-Fetch-Site", "same-site"), 415},
		{"404 de una ruta desconocida", pedido("GET", "/api/v1/no-existe", origenDeLaWeb), 404},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			var n int
			rr := httptest.NewRecorder()
			apiParaCORS(t, origenDeLaWeb+"/inicio/", &n).ServeHTTP(rr, c.pedido)
			if rr.Code != c.codigo {
				t.Fatalf("código %d, se esperaba %d", rr.Code, c.codigo)
			}
			if got := rr.Header().Values("Access-Control-Allow-Origin"); len(got) != 1 || got[0] != origenDeLaWeb {
				t.Fatalf("Access-Control-Allow-Origin %q, se esperaba %q", got, origenDeLaWeb)
			}
			if got := rr.Header().Values("Access-Control-Allow-Credentials"); len(got) != 1 || got[0] != "true" {
				t.Fatalf("Access-Control-Allow-Credentials %q, se esperaba true", got)
			}
			if !contieneVary(rr, "Origin") {
				t.Fatalf("falta Vary: Origin: %q", rr.Header().Values("Vary"))
			}
			for _, extra := range []string{"Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"} {
				if v := rr.Header().Values(extra); len(v) != 0 {
					t.Errorf("%s es de un preflight, no de la respuesta: %q", extra, v)
				}
			}
			if got := rr.Header().Get("Strict-Transport-Security"); got != hsts {
				t.Errorf("Strict-Transport-Security %q, se esperaba %q", got, hsts)
			}
			if got := rr.Header().Get("Content-Security-Policy"); got != politicaCSP {
				t.Errorf("Content-Security-Policy %q, se esperaba %q", got, politicaCSP)
			}
		})
	}
}

// Cualquier otro origen no recibe ninguna cabecera CORS (el navegador bloquea la lectura), y la respuesta es la misma que
// sin CORS. Vary: Origin sale igual, para que una caché no mezcle las respuestas por origen.
func TestCORSOtroOrigenNoRecibeCabeceras(t *testing.T) {
	origenes := map[string]string{
		"ajeno":                       "https://atacante.example",
		"null":                        "null",
		"otro esquema":                "http://app.b.test",
		"otro puerto":                 "https://app.b.test:8443",
		"subdominio":                  "https://x.app.b.test",
		"prefijo del origen":          "https://app.b.test.atacante.example",
		"hermano del mismo dominio":   "https://otro.b.test",
		"mayúsculas":                  "https://APP.B.TEST",
		"con barra final":             "https://app.b.test/",
		"con ruta":                    "https://app.b.test/inicio",
		"sin esquema":                 "app.b.test",
		"comodín":                     "*",
		"dos orígenes en un valor":    "https://app.b.test https://atacante.example",
		"el origen con un espacio":    "https://app.b.test ",
		"origen en minúsculas y raro": "HTTPS://app.b.test",
	}
	for nombre, origen := range origenes {
		t.Run(nombre, func(t *testing.T) {
			var n int
			rr := httptest.NewRecorder()
			apiParaCORS(t, origenDeLaWeb, &n).ServeHTTP(rr, pedido("GET", "/api/v1/prueba/cors", origen))
			if rr.Code != http.StatusOK || n != 1 {
				t.Fatalf("código %d y %d llamadas: la respuesta es la de siempre", rr.Code, n)
			}
			sinCORS(t, rr)
			if !contieneVary(rr, "Origin") {
				t.Errorf("falta Vary: Origin: %q", rr.Header().Values("Vary"))
			}
		})
	}
}

func TestCORSSinOrigenOConDosOrigenesNoRecibeCabeceras(t *testing.T) {
	var n int
	h := apiParaCORS(t, origenDeLaWeb, &n)

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, pedido("GET", "/api/v1/prueba/cors", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("código %d", rr.Code)
	}
	sinCORS(t, rr)

	r := pedido("GET", "/api/v1/prueba/cors", "")
	r.Header["Origin"] = []string{origenDeLaWeb, "https://atacante.example"}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	sinCORS(t, rr)

	r = pedido("GET", "/api/v1/prueba/cors", "")
	r.Header["Origin"] = []string{""}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	sinCORS(t, rr)
}

// Con una URL_PUBLICA vacía, inválida o sin llamar a ConURLPublica, ningún origen vale (ante la duda se niega), ni siquiera
// el que se parece al de la URL.
func TestCORSSinURLPublicaValidaNingunOrigenRecibeCabeceras(t *testing.T) {
	for _, url := range []string{"-", "", "app.b.test", "/solo-ruta", "http://[::1"} {
		t.Run("URL_PUBLICA "+url, func(t *testing.T) {
			var n int
			h := apiParaCORS(t, url, &n)
			for _, origen := range []string{origenDeLaWeb, "app.b.test", "null", "", "http://[::1"} {
				rr := httptest.NewRecorder()
				h.ServeHTTP(rr, pedido("GET", "/api/v1/prueba/cors", origen))
				sinCORS(t, rr)
				rr = httptest.NewRecorder()
				h.ServeHTTP(rr, pedido("OPTIONS", "/api/v1/prueba/cors", origen, "Access-Control-Request-Method", "POST"))
				sinCORS(t, rr)
				if rr.Code == http.StatusNoContent {
					t.Fatalf("un preflight sin URL_PUBLICA válida no se acepta (origen %q)", origen)
				}
			}
		})
	}
}

// El preflight del origen de la web: 204 sin cuerpo, los cuatro métodos y Content-Type, con credenciales y Vary, sin
// llegar a la ruta ni a la defensa contra CSRF (el navegador no manda Sec-Fetch-Site útil ni Content-Type en un preflight).
func TestCORSPreflightDelOrigenDeLaWeb(t *testing.T) {
	rutas := []string{"/api/v1/prueba/cors", "/api/v1/prueba/privada", "/api/v1/no-existe"}
	for _, metodo := range []string{"GET", "POST", "PUT", "DELETE"} {
		for _, ruta := range rutas {
			t.Run(metodo+" "+ruta, func(t *testing.T) {
				var n int
				rr := httptest.NewRecorder()
				apiParaCORS(t, origenDeLaWeb, &n).ServeHTTP(rr, pedido(http.MethodOptions, ruta, origenDeLaWeb,
					"Access-Control-Request-Method", metodo, "Access-Control-Request-Headers", "content-type", "Sec-Fetch-Site", "same-site"))
				if rr.Code != http.StatusNoContent || rr.Body.Len() != 0 {
					t.Fatalf("%d con cuerpo %q, se esperaba 204 sin cuerpo", rr.Code, rr.Body.String())
				}
				if n != 0 {
					t.Fatalf("el preflight llegó a la ruta %d veces", n)
				}
				esperadas := map[string]string{
					"Access-Control-Allow-Origin":      origenDeLaWeb,
					"Access-Control-Allow-Credentials": "true",
					"Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE",
					"Access-Control-Allow-Headers":     "Content-Type",
				}
				for cabecera, valor := range esperadas {
					if got := rr.Header().Values(cabecera); len(got) != 1 || got[0] != valor {
						t.Errorf("%s %q, se esperaba %q", cabecera, got, valor)
					}
				}
				for _, v := range []string{"Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"} {
					if !contieneVary(rr, v) {
						t.Errorf("falta Vary: %s: %q", v, rr.Header().Values("Vary"))
					}
				}
				if rr.Header().Get("Access-Control-Max-Age") == "" {
					t.Error("falta Access-Control-Max-Age: sin él, cada pedido hace dos viajes")
				}
				if v := rr.Header().Values("Set-Cookie"); len(v) != 0 {
					t.Errorf("un preflight no pone cookie: %v", v)
				}
				if got := rr.Header().Get("Strict-Transport-Security"); got != hsts {
					t.Errorf("Strict-Transport-Security %q", got)
				}
				if got := rr.Header().Get("Content-Security-Policy"); got != politicaCSP {
					t.Errorf("Content-Security-Policy %q", got)
				}
			})
		}
	}
}

// Nunca «*»: ni en el origen ni en los métodos ni en las cabeceras, en ninguna respuesta con CORS.
func TestCORSNuncaUnComodin(t *testing.T) {
	var n int
	h := apiParaCORS(t, origenDeLaWeb, &n)
	pedidos := []*http.Request{
		pedido("GET", "/api/v1/prueba/cors", origenDeLaWeb),
		pedido("GET", "/api/v1/prueba/cors", "*"),
		pedido("GET", "/api/v1/prueba/cors", "null"),
		pedido("GET", "/api/v1/prueba/cors", ""),
		pedido(http.MethodOptions, "/api/v1/prueba/cors", origenDeLaWeb, "Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "*"),
		pedido(http.MethodOptions, "/api/v1/prueba/cors", "*", "Access-Control-Request-Method", "POST"),
		pedido(http.MethodOptions, "/api/v1/prueba/cors", "", "Access-Control-Request-Method", "POST"),
	}
	for i, r := range pedidos {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		for _, c := range corsEnTodas {
			for _, v := range rr.Header().Values(c) {
				if strings.Contains(v, "*") {
					t.Errorf("pedido %d: %s lleva un comodín: %q", i, c, v)
				}
			}
		}
	}
}

// El preflight de otro origen no se contesta con CORS: cae a lo de siempre (404 de /api/) y el navegador lo bloquea.
func TestCORSPreflightDeOtroOrigenNoRecibeCabeceras(t *testing.T) {
	for _, origen := range []string{"https://atacante.example", "null", "http://app.b.test", ""} {
		t.Run("origen "+origen, func(t *testing.T) {
			var n int
			rr := httptest.NewRecorder()
			apiParaCORS(t, origenDeLaWeb, &n).ServeHTTP(rr, pedido(http.MethodOptions, "/api/v1/prueba/cors", origen,
				"Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "content-type"))
			sinCORS(t, rr)
			if rr.Code != http.StatusNotFound || n != 0 {
				t.Fatalf("código %d y %d llamadas, se esperaba 404 sin llamar a la ruta", rr.Code, n)
			}
		})
	}
}

// OPTIONS del origen de la web sin Access-Control-Request-Method no es un preflight: sigue su camino (404 de /api/) y solo
// lleva las cabeceras de una respuesta con CORS.
func TestCORSUnOptionsQueNoEsPreflightNoSeResponde(t *testing.T) {
	var n int
	rr := httptest.NewRecorder()
	apiParaCORS(t, origenDeLaWeb, &n).ServeHTTP(rr, pedido(http.MethodOptions, "/api/v1/prueba/cors", origenDeLaWeb))
	if rr.Code == http.StatusNoContent || n != 0 {
		t.Fatalf("código %d y %d llamadas: no es un preflight", rr.Code, n)
	}
	for _, extra := range []string{"Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"} {
		if v := rr.Header().Values(extra); len(v) != 0 {
			t.Errorf("%s no es de un OPTIONS sin preflight: %q", extra, v)
		}
	}
}

// CORS solo en /api/: /salud y todo lo demás no lo llevan, ni en el pedido ni en el preflight, aunque el origen sea el de la web.
func TestCORSSoloEnAPI(t *testing.T) {
	casos := []*http.Request{
		pedido("GET", "/salud", origenDeLaWeb),
		pedido(http.MethodOptions, "/salud", origenDeLaWeb, "Access-Control-Request-Method", "GET"),
		pedido("GET", "/", origenDeLaWeb),
		pedido(http.MethodOptions, "/", origenDeLaWeb, "Access-Control-Request-Method", "GET"),
		pedido("GET", "/assets/index-abc123.js", origenDeLaWeb),
		pedido("GET", "/apix", origenDeLaWeb),
		pedido(http.MethodOptions, "/apix", origenDeLaWeb, "Access-Control-Request-Method", "GET"),
	}
	var n int
	h := apiParaCORS(t, origenDeLaWeb, &n)
	for _, r := range casos {
		t.Run(r.Method+" "+r.URL.Path, func(t *testing.T) {
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, r)
			sinCORS(t, rr)
			if rr.Code == http.StatusNoContent {
				t.Fatalf("fuera de /api/ no hay preflight: %d", rr.Code)
			}
			if got := rr.Header().Get("Strict-Transport-Security"); got != hsts {
				t.Errorf("Strict-Transport-Security %q", got)
			}
		})
	}
}

// Android no manda Origin ni Sec-Fetch-Site (React Native no los agrega): manda `X-Alcanzamos-Cliente: android`, y
// `Authorization: Bearer` con sesión. Con la web separada su pedido pasa igual que antes y no recibe cabeceras CORS: no hay
// navegador que las lea. Se prueba por el Enrutador, que es lo que corre en producción.
func TestAndroidSigueIgualConLaWebSeparada(t *testing.T) {
	casos := []struct {
		nombre string
		pedido *http.Request
	}{
		{"POST de crear con X-Alcanzamos-Cliente", pedido("POST", "/api/v1/prueba/cors", "", "X-Alcanzamos-Cliente", "android", "Content-Type", "application/json")},
		{"POST con Bearer", pedido("POST", "/api/v1/prueba/cors", "", "Authorization", "Bearer abc", "Content-Type", "application/json")},
		{"PUT con Bearer", pedido("PUT", "/api/v1/prueba/cors", "", "X-Alcanzamos-Cliente", "android", "Authorization", "Bearer abc", "Content-Type", "application/json")},
		{"DELETE con las dos cabeceras", pedido("DELETE", "/api/v1/prueba/cors", "", "X-Alcanzamos-Cliente", "android", "Authorization", "Bearer abc", "Content-Type", "application/json")},
		{"GET con Bearer", pedido("GET", "/api/v1/prueba/cors", "", "X-Alcanzamos-Cliente", "android", "Authorization", "Bearer abc")},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			var n int
			rr := httptest.NewRecorder()
			apiParaCORS(t, origenDeLaWeb, &n).ServeHTTP(rr, c.pedido)
			if rr.Code != http.StatusOK || n != 1 {
				t.Fatalf("código %d y %d llamadas, se esperaba 200 y 1: %s", rr.Code, n, rr.Body)
			}
			sinCORS(t, rr)
			if got := rr.Header().Get("Strict-Transport-Security"); got != hsts {
				t.Errorf("Strict-Transport-Security %q", got)
			}
		})
	}
}

// PRESERVE: el CORS no cambia la defensa contra CSRF de lo que ya rechazaba: sin ninguna cabecera de cliente, o con un
// Origin ajeno, el POST sigue en 403 sin llegar a la ruta; el origen de la web con same-origin sigue pasando.
func TestCORSNoAbreLaDefensaContraCSRF(t *testing.T) {
	var n int
	h := apiParaCORS(t, origenDeLaWeb, &n)
	for nombre, r := range map[string]*http.Request{
		"sin cabeceras de cliente":         pedido("POST", "/api/v1/prueba/cors", "", "Content-Type", "application/json"),
		"Origin ajeno":                     pedido("POST", "/api/v1/prueba/cors", "https://atacante.example", "Content-Type", "application/json"),
		"cross-site con el de la web":      pedido("POST", "/api/v1/prueba/cors", origenDeLaWeb, "Sec-Fetch-Site", "cross-site", "Content-Type", "application/json"),
		"same-site sin Origin":             pedido("POST", "/api/v1/prueba/cors", "", "Sec-Fetch-Site", "same-site", "Content-Type", "application/json"),
		"same-site con Origin ajeno":       pedido("POST", "/api/v1/prueba/cors", "https://atacante.example", "Sec-Fetch-Site", "same-site", "Content-Type", "application/json"),
		"same-site con Origin del hermano": pedido("POST", "/api/v1/prueba/cors", "https://otro.b.test", "Sec-Fetch-Site", "same-site", "Content-Type", "application/json"),
	} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusForbidden || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_no_permitida"}` {
			t.Errorf("%s: %d %q, se esperaba 403", nombre, rr.Code, rr.Body.String())
		}
	}
	if n != 0 {
		t.Fatalf("la ruta se alcanzó %d veces con pedidos rechazados", n)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, pedido("POST", "/api/v1/prueba/cors", "", "Sec-Fetch-Site", "same-origin", "Content-Type", "application/json"))
	if rr.Code != http.StatusOK {
		t.Fatalf("same-origin: %d", rr.Code)
	}
}
