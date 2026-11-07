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
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

const urlPublicaDePrueba = "https://app.ej.test"

// enrutadorConPOST registra un POST por cada nivel de acceso, y un GET, un PUT y un DELETE; cada manejador anota que lo
// alcanzaron y pone una cookie, para ver que un rechazo ni siquiera llega a él.
func enrutadorConPOST(t *testing.T, conURL bool, alcanzados *[]string) *servidor.Enrutador {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	e := servidor.NuevoEnrutador(servidor.SinSesiones{}, seguridad.NuevoRegistro(log), log)
	if conURL {
		e.ConURLPublica(urlPublicaDePrueba)
	}
	anotar := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*alcanzados = append(*alcanzados, r.Pattern)
		http.SetCookie(w, &http.Cookie{Name: "sesion", Value: "x"})
		servidor.EscribirJSON(w, http.StatusOK, map[string]string{"estado": "ok"})
	})
	e.Registrar(seguridad.Publica, "POST /api/v1/prueba/publica", anotar)
	e.Registrar(seguridad.SinAutorizacion, "POST /api/v1/prueba/sin-autorizacion", anotar)
	e.Registrar(seguridad.RequiereAutorizacion, "POST /api/v1/prueba/autorizada/{id}", anotar)
	e.Registrar(seguridad.Publica, "GET /api/v1/prueba/lectura", anotar)
	e.Registrar(seguridad.Publica, "PUT /api/v1/prueba/cambio", anotar)
	e.Registrar(seguridad.Publica, "DELETE /api/v1/prueba/borrado", anotar)
	return e
}

func manejadorDe(t *testing.T, e *servidor.Enrutador) http.Handler {
	t.Helper()
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

// SEG-016 contra el Enrutador: la defensa vale en todo POST, sea cual sea su nivel, sin que el manejador la ponga; los
// rechazos no llegan al manejador (nada cambia, ninguna cookie).
func TestElEnrutadorAplicaLaDefensaContraCSRFATodoPOST(t *testing.T) {
	var alcanzados []string
	e := enrutadorConPOST(t, true, &alcanzados)
	csrftest.ProbarDefensa(t, manejadorDe(t, e), e.Rutas(), urlPublicaDePrueba, func() string { return strings.Join(alcanzados, ",") })
}

// El rechazo va antes del guard de acceso: un POST de otro sitio a una ruta con sesión da 403 de la defensa, no 401, y
// no deja el evento de seguridad `error_autorizacion`.
func TestLaDefensaContraCSRFVaAntesQueElGuardDeAcceso(t *testing.T) {
	var salida strings.Builder
	log := slog.New(slog.NewJSONHandler(&salida, nil))
	e := servidor.NuevoEnrutador(servidor.SinSesiones{}, seguridad.NuevoRegistro(log), log).ConURLPublica(urlPublicaDePrueba)
	e.Registrar(seguridad.RequiereAutorizacion, "POST /api/v1/prueba/autorizada", http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("no debía llegar al manejador")
	}))
	r := httptest.NewRequest(http.MethodPost, "/api/v1/prueba/autorizada", strings.NewReader("{}"))
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	r.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	manejadorDe(t, e).ServeHTTP(rr, r)
	if rr.Code != 403 || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_no_permitida"}` {
		t.Errorf("%d %s", rr.Code, rr.Body)
	}
	if strings.Contains(salida.String(), "evento_seguridad") {
		t.Errorf("sin evento de acceso: %s", salida.String())
	}
}

// Sin URL_PUBLICA ningún Origin vale (se niega ante la duda), y los demás métodos no llevan la defensa: E17 3.15 y D-173
// la piden en todo POST.
func TestSinURLPublicaNingunOriginValeYLoQueNoEsPOSTNoLaLleva(t *testing.T) {
	var alcanzados []string
	h := manejadorDe(t, enrutadorConPOST(t, false, &alcanzados))
	pedir := func(metodo, ruta string, cabeceras ...string) int {
		r := httptest.NewRequest(metodo, ruta, strings.NewReader("{}"))
		for i := 0; i < len(cabeceras); i += 2 {
			r.Header.Set(cabeceras[i], cabeceras[i+1])
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr.Code
	}
	if c := pedir("POST", "/api/v1/prueba/publica", "Origin", urlPublicaDePrueba, "Content-Type", "application/json"); c != 403 {
		t.Errorf("POST con Origin y sin URL_PUBLICA: %d", c)
	}
	for _, p := range [][2]string{{"GET", "/api/v1/prueba/lectura"}, {"PUT", "/api/v1/prueba/cambio"}, {"DELETE", "/api/v1/prueba/borrado"}} {
		if c := pedir(p[0], p[1], "Sec-Fetch-Site", "cross-site", "Content-Type", "text/plain"); c != 200 {
			t.Errorf("%s %s conserva su comportamiento: %d", p[0], p[1], c)
		}
	}
}

// SEG-016: «Una ruta POST nueva sin la defensa hace fallar la prueba». Un patrón sin método o con otro separador
// atendería POST sin pasar por la defensa: el Enrutador lo rechaza al construir y el servidor no arranca.
func TestUnPatronSinMetodoClaroNoSeRegistra(t *testing.T) {
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	for _, patron := range []string{"/api/v1/prueba/sin-metodo", "POST\t /api/v1/prueba/tab", "POST  /api/v1/prueba/dos-espacios", "post /api/v1/prueba/minusculas", "OPTIONS /api/v1/prueba/otro"} {
		e := servidor.NuevoEnrutador(servidor.SinSesiones{}, seguridad.NuevoRegistro(log), log).ConURLPublica(urlPublicaDePrueba)
		alcanzado := false
		e.Registrar(seguridad.Publica, patron, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { alcanzado = true }))
		h, err := e.Construir()
		if err == nil {
			r := httptest.NewRequest(http.MethodPost, patron[strings.Index(patron, "/api/"):], strings.NewReader("x"))
			r.Header.Set("Sec-Fetch-Site", "cross-site")
			r.Header.Set("Content-Type", "text/plain")
			servidor.ManejadorConAPI(h).ServeHTTP(httptest.NewRecorder(), r)
			t.Errorf("%q se registró (alcanzado=%v); debía ser un error de arranque", patron, alcanzado)
		}
	}
}
