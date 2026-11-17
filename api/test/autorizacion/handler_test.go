package autorizacion_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

const personaDePrueba = "0192f3c4-0000-7000-8000-0000000000aa"

var ahoraDePrueba = time.Date(2026, 10, 30, 15, 0, 0, 0, time.UTC)

// repoFalso guarda lo que el servicio le pide y devuelve los errores que se le fijen.
type repoFalso struct {
	mu          sync.Mutex
	vigentes    []string
	otorgadas   []string
	version     string
	otorgadaEn  time.Time
	rechazos    int
	necesarias  []string
	conservarEn time.Time
	errVigentes error
	errOtorgar  error
	errRechazar error
	// historial: la persona ya autorizó algo antes como titular (vigente o retirado).
	historial       bool
	errHistorial    error
	consultasDeHist int
	retiradas       []string
	retiradaEn      time.Time
	errRetirar      error
}

func (r *repoFalso) Vigentes(context.Context, string) ([]string, error) {
	return r.vigentes, r.errVigentes
}

func (r *repoFalso) ConHistorial(context.Context, string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.consultasDeHist++
	return r.historial, r.errHistorial
}

func (r *repoFalso) Retirar(_ context.Context, _, finalidad string, ahora time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.retiradas = append(r.retiradas, finalidad)
	r.retiradaEn = ahora
	return r.errRetirar
}

func (r *repoFalso) Otorgar(_ context.Context, _ string, finalidades []string, version string, ahora time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.otorgadas, r.version, r.otorgadaEn = finalidades, version, ahora
	return r.errOtorgar
}

func (r *repoFalso) Rechazar(_ context.Context, _ string, necesarias []string, _, conservarHasta time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rechazos++
	r.necesarias, r.conservarEn = necesarias, conservarHasta
	return r.errRechazar
}

// almacenFalso: huella (en texto) → Sujeto de las sesiones reales de la prueba.
type almacenFalso map[string]seguridad.Sujeto

func (a almacenFalso) Sujeto(_ context.Context, huella []byte, _ time.Time) (seguridad.Sujeto, error) {
	if s, ok := a[string(huella)]; ok {
		return s, nil
	}
	return seguridad.Sujeto{}, seguridad.ErrSinSesion
}

type entorno struct {
	api     http.Handler
	repo    *repoFalso
	almacen almacenFalso
	eventos *bytes.Buffer
}

func nuevoEntorno(t *testing.T) *entorno {
	t.Helper()
	e := &entorno{repo: &repoFalso{}, almacen: almacenFalso{}, eventos: &bytes.Buffer{}}
	log := slog.New(slog.NewJSONHandler(e.eventos, nil))
	reloj := &relojtest.Fijo{T: ahoraDePrueba}
	resolutor := sesion.NuevoResolutor(e.almacen, reloj)
	enr := servidor.NuevoEnrutador(resolutor, seguridad.NuevoRegistro(log), log)
	autorizacion.NuevoHandler(autorizacion.NuevoServicio(e.repo, reloj), seguridad.NuevoRegistro(log), log).Registrar(enr)
	h, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	e.api = csrftest.ConCabeceras(servidor.ManejadorConAPI(h))
	return e
}

// sesion registra una sesión real del Sujeto y devuelve su token.
func (e *entorno) sesion(s seguridad.Sujeto) string {
	token, huella := seguridad.NuevoTokenOpaco()
	e.almacen[string(huella)] = s
	return token
}

var (
	sinAutorizar = seguridad.Sujeto{Persona: personaDePrueba, Verificada: true}
	autorizada   = seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true}
	sinVerificar = seguridad.Sujeto{Persona: personaDePrueba}
)

// pedir manda la petición con la cookie de la web, o con Bearer si android (como la app, sin Origin).
func (e *entorno) pedir(metodo, ruta, cuerpo, token string, android bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	switch {
	case token == "":
	case android:
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set(sesion.EncabezadoDeCliente, sesion.ClienteAndroid)
	default:
		r.AddCookie(sesion.Cookie(token))
	}
	rr := httptest.NewRecorder()
	e.api.ServeHTTP(rr, r)
	return rr
}

func cuerpoDe(rr *httptest.ResponseRecorder) string { return strings.TrimSpace(rr.Body.String()) }

const listaSinOtorgar = `{"finalidades":[{"codigo":"cuenta_y_acceso","tipo":"necesaria","otorgada":false},` +
	`{"codigo":"funciones_financieras","tipo":"necesaria","otorgada":false},` +
	`{"codigo":"transmision_a_encargados","tipo":"necesaria","otorgada":false},` +
	`{"codigo":"avisos","tipo":"accesoria","otorgada":false},{"codigo":"horas_de_vida","tipo":"accesoria","otorgada":false}],` +
	`"modo":"completo","version":{"numero":"1.1","fecha":"2026-11-12"}}`

func TestListarDaLasFinalidadesDeLaPersonaAdultaYLaVersion(t *testing.T) {
	e := nuevoEntorno(t)
	token := e.sesion(sinAutorizar)
	for _, android := range []bool{false, true} {
		rr := e.pedir("GET", "/api/v1/autorizaciones", "", token, android)
		if rr.Code != 200 || cuerpoDe(rr) != listaSinOtorgar || rr.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("android=%v: %d %s %v", android, rr.Code, cuerpoDe(rr), rr.Header())
		}
	}
	// Sin cuenta_del_menor, correo_del_menor ni transferencia: lo que no le toca a una persona adulta no se ofrece.
	for _, fuera := range []string{"cuenta_del_menor", "correo_del_menor", "transferencia"} {
		if strings.Contains(listaSinOtorgar, fuera) {
			t.Errorf("la lista no debe traer %s", fuera)
		}
	}
}

func TestListarMarcaLasOtorgadas(t *testing.T) {
	e := nuevoEntorno(t)
	e.repo.vigentes = []string{"cuenta_y_acceso", "avisos", "cuenta_del_menor", "transmision_a_encargados"}
	rr := e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(autorizada), false)
	quiere := strings.NewReplacer(
		`"cuenta_y_acceso","tipo":"necesaria","otorgada":false`, `"cuenta_y_acceso","tipo":"necesaria","otorgada":true`,
		`"transmision_a_encargados","tipo":"necesaria","otorgada":false`, `"transmision_a_encargados","tipo":"necesaria","otorgada":true`,
		`"avisos","tipo":"accesoria","otorgada":false`, `"avisos","tipo":"accesoria","otorgada":true`).Replace(listaSinOtorgar)
	if rr.Code != 200 || cuerpoDe(rr) != quiere {
		t.Fatalf("%d %s", rr.Code, cuerpoDe(rr))
	}
}

func TestListarConFalloDeLaBaseDa500(t *testing.T) {
	e := nuevoEntorno(t)
	e.repo.errVigentes = errors.New("base caída")
	rr := e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(sinAutorizar), false)
	if rr.Code != 500 || cuerpoDe(rr) != `{"error":"error_interno"}` {
		t.Fatalf("%d %s", rr.Code, cuerpoDe(rr))
	}
}

// Las tres rutas exigen una cuenta con el correo verificado; sin sesión, 401.
func TestLasTresRutasExigenSesionYCorreoVerificado(t *testing.T) {
	e := nuevoEntorno(t)
	for _, r := range []struct{ metodo, ruta string }{
		{"GET", "/api/v1/autorizaciones"}, {"POST", "/api/v1/autorizaciones"}, {"POST", "/api/v1/autorizaciones/rechazo"},
	} {
		if rr := e.pedir(r.metodo, r.ruta, "{}", "", false); rr.Code != 401 || cuerpoDe(rr) != `{"error":"sin_sesion"}` {
			t.Errorf("%s %s sin sesión: %d %s", r.metodo, r.ruta, rr.Code, cuerpoDe(rr))
		}
		if rr := e.pedir(r.metodo, r.ruta, "{}", e.sesion(sinVerificar), false); rr.Code != 403 || cuerpoDe(rr) != `{"error":"verificacion_pendiente"}` {
			t.Errorf("%s %s sin verificar: %d %s", r.metodo, r.ruta, rr.Code, cuerpoDe(rr))
		}
	}
	if e.repo.rechazos != 0 || e.repo.otorgadas != nil {
		t.Error("una sesión sin verificar no debe llegar al repositorio")
	}
}

func TestOtorgar(t *testing.T) {
	casos := []struct {
		nombre    string
		cuerpo    string
		codigo    int
		respuesta string
		guardadas []string // nil: no debe llegar al repositorio
	}{
		{"las tres necesarias", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.1"}`, 200, `{"estado":"autorizada"}`,
			[]string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}},
		{"con las dos accesorias", `{"finalidades":["horas_de_vida","avisos","transmision_a_encargados","funciones_financieras","cuenta_y_acceso"],"version":"1.1"}`, 200, `{"estado":"autorizada"}`,
			[]string{"avisos", "cuenta_y_acceso", "funciones_financieras", "horas_de_vida", "transmision_a_encargados"}},
		{"repetidas cuentan una vez", `{"finalidades":["cuenta_y_acceso","cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.1"}`, 200, `{"estado":"autorizada"}`,
			[]string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}},
		// SC-E21-25 criterio 1: sin la aceptación de la transmisión no se guarda ninguna autorización.
		{"sin la transmisión a los encargados", `{"finalidades":["cuenta_y_acceso","funciones_financieras"],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"sin la transmisión, con las accesorias", `{"finalidades":["cuenta_y_acceso","funciones_financieras","avisos","horas_de_vida"],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"solo la transmisión a los encargados", `{"finalidades":["transmision_a_encargados"],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"solo una necesaria", `{"finalidades":["cuenta_y_acceso"],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"solo accesorias", `{"finalidades":["avisos","horas_de_vida"],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"lista vacía", `{"finalidades":[],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"sin lista", `{"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"código desconocido", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados","no_existe"],"version":"1.1"}`, 422, `{"error":"finalidad_invalida"}`, nil},
		{"finalidad del menor", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados","cuenta_del_menor"],"version":"1.1"}`, 422, `{"error":"finalidad_invalida"}`, nil},
		{"correo del menor", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados","correo_del_menor"],"version":"1.1"}`, 422, `{"error":"finalidad_invalida"}`, nil},
		{"transferencia inactiva", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados","transferencia"],"version":"1.1"}`, 422, `{"error":"finalidad_invalida"}`, nil},
		{"versión de antes", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.0"}`, 409, `{"error":"version_desactualizada"}`, nil},
		{"versión distinta", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"0.9"}`, 409, `{"error":"version_desactualizada"}`, nil},
		{"versión nueva que no existe", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.2"}`, 409, `{"error":"version_desactualizada"}`, nil},
		{"sin versión", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"]}`, 409, `{"error":"version_desactualizada"}`, nil},
		{"la versión se revisa antes que los códigos", `{"finalidades":["no_existe"],"version":"2.0"}`, 409, `{"error":"version_desactualizada"}`, nil},
		{"campo que no está en el contrato", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.1","otorgante":"x"}`, 400, `{"error":"solicitud_invalida"}`, nil},
		{"JSON roto", `{"finalidades":`, 400, `{"error":"solicitud_invalida"}`, nil},
	}
	for _, android := range []bool{false, true} {
		for _, c := range casos {
			e := nuevoEntorno(t)
			rr := e.pedir("POST", "/api/v1/autorizaciones", c.cuerpo, e.sesion(sinAutorizar), android)
			if rr.Code != c.codigo || cuerpoDe(rr) != c.respuesta {
				t.Errorf("%s (android=%v): %d %s", c.nombre, android, rr.Code, cuerpoDe(rr))
			}
			if got := e.repo.otorgadas; !equal(got, c.guardadas) {
				t.Errorf("%s: se guardó %v, se esperaba %v", c.nombre, got, c.guardadas)
			}
			if c.guardadas != nil && (e.repo.version != "1.1 del 2026-11-12" || !e.repo.otorgadaEn.Equal(ahoraDePrueba)) {
				t.Errorf("%s: versión %q, otorgada en %v", c.nombre, e.repo.version, e.repo.otorgadaEn)
			}
		}
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestOtorgarConErroresDelRepositorio(t *testing.T) {
	cuerpo := `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.1"}`
	e := nuevoEntorno(t)
	e.repo.errOtorgar = errors.New("base caída")
	if rr := e.pedir("POST", "/api/v1/autorizaciones", cuerpo, e.sesion(sinAutorizar), false); rr.Code != 500 || cuerpoDe(rr) != `{"error":"error_interno"}` {
		t.Errorf("fallo de la base: %d %s", rr.Code, cuerpoDe(rr))
	}
	e.repo.errOtorgar = autorizacion.ErrSinCuenta
	if rr := e.pedir("POST", "/api/v1/autorizaciones", cuerpo, e.sesion(sinAutorizar), false); rr.Code != 401 || cuerpoDe(rr) != `{"error":"sin_sesion"}` {
		t.Errorf("cuenta borrada: %d %s", rr.Code, cuerpoDe(rr))
	}
}

func TestOtorgarNoEsUnEventoDeSeguridad(t *testing.T) {
	e := nuevoEntorno(t)
	e.pedir("POST", "/api/v1/autorizaciones", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.1"}`, e.sesion(sinAutorizar), false)
	if strings.Contains(e.eventos.String(), "evento_seguridad") || strings.Contains(e.eventos.String(), personaDePrueba) {
		t.Errorf("otorgar no es un evento de seguridad ni registra la cuenta: %s", e.eventos)
	}
}

func TestRechazarBorraConLaSesionSinAutorizar(t *testing.T) {
	for _, android := range []bool{false, true} {
		e := nuevoEntorno(t)
		rr := e.pedir("POST", "/api/v1/autorizaciones/rechazo", "", e.sesion(sinAutorizar), android)
		if rr.Code != 204 || rr.Body.Len() != 0 || rr.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("android=%v: %d %q %v", android, rr.Code, rr.Body, rr.Header())
		}
		cookies := rr.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != sesion.NombreDeLaCookie || cookies[0].Value != "" || cookies[0].MaxAge >= 0 {
			t.Errorf("android=%v: la cookie no se vence: %v", android, cookies)
		}
		if e.repo.rechazos != 1 || !equal(e.repo.necesarias, []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}) {
			t.Errorf("repositorio: %d rechazos, necesarias %v", e.repo.rechazos, e.repo.necesarias)
		}
		if !e.repo.conservarEn.Equal(ahoraDePrueba.AddDate(3, 0, 0)) {
			t.Errorf("la prueba mínima se conserva hasta %v", e.repo.conservarEn)
		}
	}
}

// Quien ya autorizó no borra su cuenta por aquí: 403 con evento acceso_denegado y sin tocar la base.
func TestRechazarConLoNecesarioAutorizadoEsUn403ConEvento(t *testing.T) {
	e := nuevoEntorno(t)
	rr := e.pedir("POST", "/api/v1/autorizaciones/rechazo", "", e.sesion(autorizada), false)
	if rr.Code != 403 || cuerpoDe(rr) != `{"error":"ya_autorizada"}` || len(rr.Result().Cookies()) != 0 {
		t.Fatalf("%d %s %v", rr.Code, cuerpoDe(rr), rr.Result().Cookies())
	}
	if e.repo.rechazos != 0 {
		t.Error("no debe llegar al repositorio")
	}
	for _, quiere := range []string{`"evento_seguridad":"acceso_denegado"`, `"cuenta":"` + personaDePrueba + `"`,
		`"ruta":"POST /api/v1/autorizaciones/rechazo"`, `"codigo":403`} {
		if !strings.Contains(e.eventos.String(), quiere) {
			t.Errorf("falta %s en el evento: %s", quiere, e.eventos)
		}
	}
}

// Si autorizó entre la lectura de la sesión y el borrado, el repositorio lo ve y no borra.
func TestRechazarCuandoElRepositorioVeQueYaAutorizo(t *testing.T) {
	e := nuevoEntorno(t)
	e.repo.errRechazar = autorizacion.ErrYaAutorizada
	rr := e.pedir("POST", "/api/v1/autorizaciones/rechazo", "", e.sesion(sinAutorizar), false)
	if rr.Code != 403 || cuerpoDe(rr) != `{"error":"ya_autorizada"}` || len(rr.Result().Cookies()) != 0 {
		t.Fatalf("%d %s", rr.Code, cuerpoDe(rr))
	}
	if !strings.Contains(e.eventos.String(), "acceso_denegado") {
		t.Errorf("falta el evento: %s", e.eventos)
	}
}

func TestRechazarConErroresDelRepositorio(t *testing.T) {
	e := nuevoEntorno(t)
	e.repo.errRechazar = errors.New("base caída")
	if rr := e.pedir("POST", "/api/v1/autorizaciones/rechazo", "", e.sesion(sinAutorizar), false); rr.Code != 500 || len(rr.Result().Cookies()) != 0 {
		t.Errorf("fallo de la base: %d %s", rr.Code, cuerpoDe(rr))
	}
	e.repo.errRechazar = autorizacion.ErrSinCuenta
	if rr := e.pedir("POST", "/api/v1/autorizaciones/rechazo", "", e.sesion(sinAutorizar), false); rr.Code != 401 {
		t.Errorf("cuenta ya borrada: %d %s", rr.Code, cuerpoDe(rr))
	}
}

func TestLaVersionSeGuardaComoNumeroYFecha(t *testing.T) {
	if autorizacion.VersionActual.Texto() != "1.1 del 2026-11-12" {
		t.Errorf("Texto = %q", autorizacion.VersionActual.Texto())
	}
	if n := len(autorizacion.VersionActual.Texto()); n > 20 { // ck_autorizacion_version_del_texto
		t.Errorf("la versión mide %d y la columna admite 20", n)
	}
}

// SC-E21-25, sección 5: una cuenta de antes del cambio, con las dos necesarias viejas, ve en PN-64 solo lo que le falta,
// en el modo «falta una aceptación». Lo que ya autorizó no se pide de nuevo.
func TestListarDeUnaCuentaDeAntesMuestraSoloLoQueFalta(t *testing.T) {
	const soloLaTransmision = `{"finalidades":[{"codigo":"transmision_a_encargados","tipo":"necesaria","otorgada":false}],` +
		`"modo":"falta_una_aceptacion","version":{"numero":"1.1","fecha":"2026-11-12"}}`
	for _, android := range []bool{false, true} {
		e := nuevoEntorno(t)
		e.repo.vigentes = []string{"cuenta_y_acceso", "funciones_financieras", "avisos"}
		e.repo.historial = true
		rr := e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(sinAutorizar), android)
		if rr.Code != 200 || cuerpoDe(rr) != soloLaTransmision || rr.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("android=%v: %d %s %v", android, rr.Code, cuerpoDe(rr), rr.Header())
		}
	}
}

// Sin nada autorizado antes (la persona nueva), PN-64 es la de siempre aunque haya algo en el historial (por ejemplo, una
// autorización retirada): solo con necesarias vigentes y otras faltantes entra el modo.
func TestListarDeUnaCuentaSinHistorialEsLaListaCompleta(t *testing.T) {
	e := nuevoEntorno(t)
	rr := e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(sinAutorizar), false)
	if rr.Code != 200 || cuerpoDe(rr) != listaSinOtorgar {
		t.Fatalf("%d %s", rr.Code, cuerpoDe(rr))
	}
	// La cuenta autorizada con todo no está en el modo, aunque tenga historial: ve la lista completa marcada.
	e = nuevoEntorno(t)
	e.repo.vigentes = []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}
	e.repo.historial = true
	rr = e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(autorizada), false)
	if rr.Code != 200 || !strings.Contains(cuerpoDe(rr), `"modo":"completo"`) || strings.Count(cuerpoDe(rr), `"codigo"`) != 5 {
		t.Fatalf("%d %s", rr.Code, cuerpoDe(rr))
	}
	if e.repo.consultasDeHist != 0 {
		t.Error("con todo lo necesario autorizado no hace falta mirar el historial")
	}
}

func TestListarConFalloAlLeerElHistorialDa500(t *testing.T) {
	e := nuevoEntorno(t)
	e.repo.vigentes = []string{"cuenta_y_acceso", "funciones_financieras"}
	e.repo.errHistorial = errors.New("base caída")
	if rr := e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(sinAutorizar), false); rr.Code != 500 || cuerpoDe(rr) != `{"error":"error_interno"}` {
		t.Fatalf("%d %s", rr.Code, cuerpoDe(rr))
	}
}

// En el modo «falta una aceptación» se manda solo lo que falta: la cuenta de antes no repite las dos viejas y la
// aceptación se guarda con la versión nueva (RF-063: se autoriza solo lo que cambió).
func TestOtorgarDeUnaCuentaDeAntesPideSoloLoQueFalta(t *testing.T) {
	casos := []struct {
		nombre, cuerpo string
		codigo         int
		respuesta      string
		guardadas      []string
	}{
		{"solo la transmisión", `{"finalidades":["transmision_a_encargados"],"version":"1.1"}`, 200, `{"estado":"autorizada"}`, []string{"transmision_a_encargados"}},
		{"la transmisión y los avisos", `{"finalidades":["avisos","transmision_a_encargados"],"version":"1.1"}`, 200, `{"estado":"autorizada"}`, []string{"avisos", "transmision_a_encargados"}},
		{"con las que ya tenía: no se duplican y se acepta", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.1"}`, 200, `{"estado":"autorizada"}`,
			[]string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}},
		{"sin aceptarla no se guarda nada", `{"finalidades":[],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"solo accesorias no basta", `{"finalidades":["avisos"],"version":"1.1"}`, 422, `{"error":"faltan_necesarias"}`, nil},
		{"con la versión de antes", `{"finalidades":["transmision_a_encargados"],"version":"1.0"}`, 409, `{"error":"version_desactualizada"}`, nil},
	}
	for _, c := range casos {
		e := nuevoEntorno(t)
		e.repo.vigentes = []string{"cuenta_y_acceso", "funciones_financieras"}
		e.repo.historial = true
		rr := e.pedir("POST", "/api/v1/autorizaciones", c.cuerpo, e.sesion(sinAutorizar), false)
		if rr.Code != c.codigo || cuerpoDe(rr) != c.respuesta || !equal(e.repo.otorgadas, c.guardadas) {
			t.Errorf("%s: %d %s, se guardó %v", c.nombre, rr.Code, cuerpoDe(rr), e.repo.otorgadas)
		}
		if c.guardadas != nil && e.repo.version != "1.1 del 2026-11-12" {
			t.Errorf("%s: versión %q", c.nombre, e.repo.version)
		}
	}
	// Si la lectura de lo vigente falla, no se guarda nada.
	e := nuevoEntorno(t)
	e.repo.errVigentes = errors.New("base caída")
	rr := e.pedir("POST", "/api/v1/autorizaciones", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.1"}`, e.sesion(sinAutorizar), false)
	if rr.Code != 500 || e.repo.otorgadas != nil {
		t.Errorf("fallo de la base: %d %s, se guardó %v", rr.Code, cuerpoDe(rr), e.repo.otorgadas)
	}
}

// SC-E21-25 sección 5, paso 3: «No autorizo» no borra sin preguntar a una cuenta que ya autorizó algo antes; 403 con
// evento, sin cookie vencida ni borrado. La cuenta con historial usa la hoja: descargar y borrar con la contraseña.
func TestRechazarDeUnaCuentaConHistorialNoBorra(t *testing.T) {
	e := nuevoEntorno(t)
	e.repo.errRechazar = autorizacion.ErrConHistorial
	rr := e.pedir("POST", "/api/v1/autorizaciones/rechazo", "", e.sesion(sinAutorizar), false)
	if rr.Code != 403 || cuerpoDe(rr) != `{"error":"cuenta_con_historial"}` || len(rr.Result().Cookies()) != 0 {
		t.Fatalf("%d %s %v", rr.Code, cuerpoDe(rr), rr.Result().Cookies())
	}
	for _, quiere := range []string{`"evento_seguridad":"acceso_denegado"`, `"ruta":"POST /api/v1/autorizaciones/rechazo"`, `"codigo":403`} {
		if !strings.Contains(e.eventos.String(), quiere) {
			t.Errorf("falta %s en el evento: %s", quiere, e.eventos)
		}
	}
}

// Retirar una accesoria: solo las que PN-67 deja retirar; las necesarias y las que no se ofrecen no se retiran por aquí.
func TestRetirarSoloAccesoriasOfrecidas(t *testing.T) {
	servicio := func(r *repoFalso) *autorizacion.Servicio {
		return autorizacion.NuevoServicio(r, &relojtest.Fijo{T: ahoraDePrueba})
	}
	for _, codigo := range []string{"avisos", "horas_de_vida"} {
		r := &repoFalso{}
		if err := servicio(r).Retirar(context.Background(), personaDePrueba, codigo); err != nil || !equal(r.retiradas, []string{codigo}) || !r.retiradaEn.Equal(ahoraDePrueba) {
			t.Errorf("%s: %v, retiradas %v en %v", codigo, err, r.retiradas, r.retiradaEn)
		}
	}
	for _, codigo := range []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados", "cuenta_del_menor", "correo_del_menor", "transferencia", "no_existe", ""} {
		r := &repoFalso{}
		if err := servicio(r).Retirar(context.Background(), personaDePrueba, codigo); !errors.Is(err, autorizacion.ErrFinalidadInvalida) || r.retiradas != nil {
			t.Errorf("%q: %v, retiradas %v; se esperaba ErrFinalidadInvalida sin tocar la base", codigo, err, r.retiradas)
		}
	}
	r := &repoFalso{errRetirar: errors.New("base caída")}
	if err := servicio(r).Retirar(context.Background(), personaDePrueba, "avisos"); err == nil {
		t.Error("el error del repositorio debe llegar a quien llama")
	}
}
