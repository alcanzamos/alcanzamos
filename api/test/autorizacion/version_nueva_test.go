package autorizacion_test

import (
	"strings"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
)

// Bug 308 (D-210): la versión guardada es anterior a la vigente solo si su número es menor; la fecha no cuenta.
func TestVersionAnterior(t *testing.T) {
	casos := []struct {
		guardada, actual string
		anterior         bool
	}{
		{"1.1", "1.2", true},
		{"1.1 del 2026-11-12", "1.2 del 2026-11-17", true},
		{"1.0 del 2026-10-30", "1.2 del 2026-11-17", true},
		{"1.2", "1.2 del 2026-11-17", false},
		{"1.2 del 2026-11-16", "1.2 del 2026-11-17", false}, // mismo número: no se pide de nuevo
		{"1.2 del 2026-11-17", "1.2 del 2026-11-17", false},
		{"1.10", "1.2", false}, // se compara por números, no por texto
		{"1.9", "1.10", true},
		{"2.0", "1.2", false},
		{"1.2.1", "1.2", false},
		{"1", "1.0", false},
		{"1.2", "1.2.1", true},
		{"", "1.2", true},             // sin versión legible no cuenta
		{"abc", "1.2", true},          // ni la que no es un número
		{"1.x", "1.2", true},          // ni a medias
		{"1.1", "sin versión", false}, // si la vigente no se lee no se pide nada
	}
	for _, c := range casos {
		if got := autorizacion.VersionAnterior(c.guardada, c.actual); got != c.anterior {
			t.Errorf("VersionAnterior(%q, %q) = %v, se esperaba %v", c.guardada, c.actual, got, c.anterior)
		}
	}
}

// Una necesaria con versión anterior a la vigente no cuenta como otorgada; una opcional cuenta con cualquier versión.
func TestCuentaComoOtorgada(t *testing.T) {
	actual := autorizacion.VersionActual.Texto()
	casos := []struct {
		finalidad, version string
		cuenta             bool
	}{
		{"cuenta_y_acceso", actual, true},
		{"cuenta_y_acceso", "1.0 del 2026-10-30", false},
		{"funciones_financieras", "1.0", false},
		{"transmision_a_encargados", "1.1 del 2026-11-12", false},
		{"cuenta_del_menor", "1.1", false}, // la necesaria del menor también
		{"avisos", "1.0 del 2026-10-30", true},
		{"horas_de_vida", "", true},
	}
	for _, c := range casos {
		if got := autorizacion.CuentaComoOtorgada(c.finalidad, c.version); got != c.cuenta {
			t.Errorf("CuentaComoOtorgada(%q, %q) = %v, se esperaba %v", c.finalidad, c.version, got, c.cuenta)
		}
	}
}

// Una cuenta con las tres necesarias de la 1.1 y los avisos de la 1.1 ve solo las tres en `falta_una_aceptacion`, sin los
// avisos, y las acepta sin tocar los avisos.
func TestListarYOtorgarConNecesariasDeUnaVersionAnterior(t *testing.T) {
	const lista = `{"finalidades":[{"codigo":"cuenta_y_acceso","tipo":"necesaria","otorgada":false},` +
		`{"codigo":"funciones_financieras","tipo":"necesaria","otorgada":false},` +
		`{"codigo":"transmision_a_encargados","tipo":"necesaria","otorgada":false}],` +
		`"modo":"falta_una_aceptacion","version":{"numero":"1.2","fecha":"2026-11-17"}}`
	preparar := func() *entorno {
		e := nuevoEntorno(t)
		e.repo.vigentes = []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados", "avisos"}
		e.repo.versiones = map[string]string{"cuenta_y_acceso": "1.1 del 2026-11-12", "funciones_financieras": "1.1 del 2026-11-12",
			"transmision_a_encargados": "1.1 del 2026-11-12", "avisos": "1.1 del 2026-11-12"}
		e.repo.historial = true
		return e
	}
	e := preparar()
	if rr := e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(sinAutorizar), false); rr.Code != 200 || cuerpoDe(rr) != lista {
		t.Fatalf("GET: %d %s", rr.Code, cuerpoDe(rr))
	}
	e = preparar()
	if rr := e.pedir("POST", "/api/v1/autorizaciones", `{"finalidades":["cuenta_y_acceso"],"version":"1.2"}`, e.sesion(sinAutorizar), false); rr.Code != 422 || cuerpoDe(rr) != `{"error":"faltan_necesarias"}` || e.repo.otorgadas != nil {
		t.Errorf("POST con una: %d %s, se guardó %v", rr.Code, cuerpoDe(rr), e.repo.otorgadas)
	}
	e = preparar()
	if rr := e.pedir("POST", "/api/v1/autorizaciones", `{"finalidades":["cuenta_y_acceso","funciones_financieras","transmision_a_encargados"],"version":"1.2"}`, e.sesion(sinAutorizar), false); rr.Code != 200 ||
		!equal(e.repo.otorgadas, []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}) || e.repo.version != "1.2 del 2026-11-17" {
		t.Errorf("POST con las tres: %d %s, se guardó %v (%s)", rr.Code, cuerpoDe(rr), e.repo.otorgadas, e.repo.version)
	}
	// Con las tres al día y los avisos de la 1.1 no falta nada: es la lista completa y los avisos siguen otorgados.
	e = preparar()
	e.repo.versiones = map[string]string{"avisos": "1.1 del 2026-11-12"}
	rr := e.pedir("GET", "/api/v1/autorizaciones", "", e.sesion(autorizada), false)
	if rr.Code != 200 || !strings.Contains(cuerpoDe(rr), `"modo":"completo"`) || !strings.Contains(cuerpoDe(rr), `{"codigo":"avisos","tipo":"accesoria","otorgada":true}`) {
		t.Errorf("con las necesarias al día: %d %s", rr.Code, cuerpoDe(rr))
	}
}
