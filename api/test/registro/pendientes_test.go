package registro_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

const (
	urlPublica = "https://app.ej.test"

	recSalario  = "0192f3c4-0000-7000-8000-0000000000a1" // ingreso quincenal desde el 1 de octubre; el 1 ya está confirmado
	recArriendo = "0192f3c4-0000-7000-8000-0000000000a2" // gasto mensual desde el 15 de septiembre
	recFuturo   = "0192f3c4-0000-7000-8000-0000000000a3" // gasto mensual que empieza mañana
	recDetenido = "0192f3c4-0000-7000-8000-0000000000a4" // gasto semanal detenido el 19 de octubre
	recAjeno    = "0192f3c4-0000-7000-8000-0000000000ff" // de otra persona: el repositorio no lo entrega
)

type pedidoDeDecision struct {
	persona    string
	confirmar  []registro.Confirmacion
	omitir     []registro.Omision
	ahora      time.Time
	idsPedidos []string
}

func (r *repoFalso) Recurrentes(_ context.Context, p string) ([]registro.Recurrente, error) {
	if p != persona {
		return nil, errors.New("persona equivocada")
	}
	return r.recurrentes, r.error
}

func (r *repoFalso) Decidir(_ context.Context, p string, confirmar []registro.Confirmacion, omitir []registro.Omision, ahora time.Time) ([]string, error) {
	if r.errorAlDecidir != nil {
		return nil, r.errorAlDecidir
	}
	ids := make([]string, len(confirmar))
	for i := range confirmar {
		ids[i] = fmt.Sprintf("m-%d", len(r.decisiones)*100+i+1)
	}
	r.decisiones = append(r.decisiones, pedidoDeDecision{p, confirmar, omitir, ahora, ids})
	if r.idsDeMenos {
		return ids[:len(ids)-1], nil
	}
	return ids, nil
}

// apiSinURL es api sin la URL pública configurada en el manejador.
func apiSinURL(t *testing.T, repo *repoFalso) http.Handler {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	e := servidor.NuevoEnrutador(sesionFalsa{}, seguridad.NuevoRegistro(log), log)
	registro.NuevoHandler(registro.NuevoServicio(repo, &relojtest.Fijo{T: time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)}), log).Registrar(e)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func dia(texto string) time.Time {
	f, err := time.Parse(time.DateOnly, texto)
	if err != nil {
		panic(err)
	}
	return f
}

func dias(textos ...string) []time.Time {
	var fs []time.Time
	for _, t := range textos {
		fs = append(fs, dia(t))
	}
	return fs
}

// repoConRepeticiones: hoy es el 26 de octubre de 2026. Lo que ya llegó y está pendiente: el salario del 16 de octubre y
// el arriendo del 15 de septiembre y del 15 de octubre.
func repoConRepeticiones() *repoFalso {
	detenidoEn := dia("2026-10-19")
	return &repoFalso{recurrentes: []registro.Recurrente{
		{ID: recSalario, Tipo: "ingreso", CategoriaID: 17, Medio: "transferencia", Periodicidad: fechas.Quincenal, Monto: 120000000,
			Inicio: dia("2026-10-01"), CreadoEl: dia("2026-10-01"), Confirmadas: dias("2026-10-01")},
		{ID: recArriendo, Tipo: "gasto", CategoriaID: 4, Medio: "transferencia", Periodicidad: fechas.Mensual, Monto: 65000000,
			Inicio: dia("2026-09-15"), CreadoEl: dia("2026-09-15")},
		{ID: recFuturo, Tipo: "gasto", CategoriaID: 5, Medio: "efectivo", Periodicidad: fechas.Mensual, Monto: 1000000,
			Inicio: dia("2026-10-27"), CreadoEl: dia("2026-10-26")},
		{ID: recDetenido, Tipo: "gasto", CategoriaID: 6, Medio: "efectivo", Periodicidad: fechas.Semanal, Monto: 500000,
			Inicio: dia("2026-10-05"), CreadoEl: dia("2026-10-05"), DetenidoEn: &detenidoEn, Confirmadas: dias("2026-10-05", "2026-10-12")},
	}}
}

// post es un POST de un cliente Android: cumple la defensa contra CSRF de E17 3.15 (c) y (d).
func post(h http.Handler, ruta, cuerpo string) (int, string, http.Header) {
	return publicar(h, ruta, cuerpo, "X-Alcanzamos-Cliente", "android", "Content-Type", "application/json")
}

func publicar(h http.Handler, ruta, cuerpo string, cabeceras ...string) (int, string, http.Header) {
	r := httptest.NewRequest("POST", ruta, strings.NewReader(cuerpo))
	for i := 0; i < len(cabeceras); i += 2 {
		r.Header.Set(cabeceras[i], cabeceras[i+1])
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr.Code, strings.TrimSpace(rr.Body.String()), rr.Header()
}

const rutaPendientes = "/api/v1/repeticiones/pendientes"

func TestPendientesListaLoQueYaLlegoDeLaMasAntiguaALaMasReciente(t *testing.T) {
	codigo, resp, cabeceras := llamar(api(t, repoConRepeticiones(), hoy), "GET", rutaPendientes, "")
	const quiere = `{"pendientes":[` +
		`{"recurrente_id":"` + recArriendo + `","fecha":"2026-09-15","tipo":"gasto","categoria_id":4,"medio":"transferencia","monto_habitual_centavos":65000000,"periodicidad":"mensual"},` +
		`{"recurrente_id":"` + recArriendo + `","fecha":"2026-10-15","tipo":"gasto","categoria_id":4,"medio":"transferencia","monto_habitual_centavos":65000000,"periodicidad":"mensual"},` +
		`{"recurrente_id":"` + recSalario + `","fecha":"2026-10-16","tipo":"ingreso","categoria_id":17,"medio":"transferencia","monto_habitual_centavos":120000000,"periodicidad":"quincenal"}` +
		`],"resumen":{"total":3,"ingresos":1,"gastos":2}}`
	if codigo != 200 || resp != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Errorf("%d %s\nse esperaba %s", codigo, resp, quiere)
	}
}

func TestPendientesConLaMismaFechaPoneElIngresoPrimero(t *testing.T) {
	repo := repoConRepeticiones()
	repo.recurrentes = []registro.Recurrente{
		{ID: recArriendo, Tipo: "gasto", CategoriaID: 4, Medio: "transferencia", Periodicidad: fechas.Mensual, Monto: 65000000, Inicio: dia("2026-10-01"), CreadoEl: dia("2026-10-01")},
		{ID: recSalario, Tipo: "ingreso", CategoriaID: 17, Medio: "transferencia", Periodicidad: fechas.Mensual, Monto: 120000000, Inicio: dia("2026-10-01"), CreadoEl: dia("2026-10-01")},
	}
	_, resp, _ := llamar(api(t, repo, hoy), "GET", rutaPendientes, "")
	if i, j := strings.Index(resp, recSalario), strings.Index(resp, recArriendo); i < 0 || j < 0 || i > j {
		t.Errorf("el ingreso va primero: %s", resp)
	}
}

func TestPendientesSinNadaQueConfirmarDaListaVaciaYCeros(t *testing.T) {
	codigo, resp, _ := llamar(api(t, &repoFalso{}, hoy), "GET", rutaPendientes, "")
	if codigo != 200 || resp != `{"pendientes":[],"resumen":{"total":0,"ingresos":0,"gastos":0}}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestPendientesNoCuentaLasOmitidasNiLasConfirmadasNiLasFuturas(t *testing.T) {
	repo := repoConRepeticiones()
	repo.recurrentes[1].Omitidas = dias("2026-09-15")
	repo.recurrentes[1].Confirmadas = dias("2026-10-15")
	_, resp, _ := llamar(api(t, repo, hoy), "GET", rutaPendientes, "")
	if strings.Contains(resp, recArriendo) || strings.Contains(resp, recFuturo) || !strings.Contains(resp, `"total":1`) {
		t.Errorf("solo queda el salario del 16: %s", resp)
	}
}

func TestPendientesUsaElDiaDeColombiaParaSaberQueYaLlego(t *testing.T) {
	// 03:00 UTC del 16 de octubre son las 22:00 del 15 en Colombia: el salario del 16 todavía no llegó.
	_, resp, _ := llamar(api(t, repoConRepeticiones(), "2026-10-16T03:00:00Z"), "GET", rutaPendientes, "")
	if strings.Contains(resp, recSalario) || !strings.Contains(resp, `"total":2`) {
		t.Errorf("%s", resp)
	}
}

func TestPendientesPasaElErrorDelRepositorioComoFalloInterno(t *testing.T) {
	codigo, resp, _ := llamar(api(t, &repoFalso{error: errors.New("sin base")}, hoy), "GET", rutaPendientes, "")
	if codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func confirmacion(id string) string { return "/api/v1/repeticiones/" + id + "/confirmacion" }
func omision(id string) string      { return "/api/v1/repeticiones/" + id + "/omision" }

// D-094: el movimiento nace con la fecha programada, no con la de hoy; y con `creado_en` de hoy.
func TestConfirmarGuardaElMovimientoConSuFechaProgramadaYElMontoHabitual(t *testing.T) {
	repo := repoConRepeticiones()
	codigo, resp, cabeceras := post(api(t, repo, hoy), confirmacion(recSalario), `{"fecha":"2026-10-16"}`)
	const quiere = `{"id":"m-1","tipo":"ingreso","monto_centavos":120000000,"fecha":"2026-10-16","categoria_id":17,"medio":"transferencia","descripcion":null,` +
		`"compartido":false,"meta":null,"sentido":null,"recurrente":{"recurrente_id":"` + recSalario + `","fecha_programada":"2026-10-16","periodicidad":"quincenal","vuelve_a_pendiente":true}}`
	if codigo != 201 || resp != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s\nse esperaba %s", codigo, resp, quiere)
	}
	if len(repo.decisiones) != 1 {
		t.Fatalf("decisiones: %+v", repo.decisiones)
	}
	d := repo.decisiones[0]
	c := d.confirmar[0]
	if d.persona != persona || len(d.confirmar) != 1 || len(d.omitir) != 0 || !d.ahora.Equal(time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)) ||
		c != (registro.Confirmacion{RecurrenteID: recSalario, Fecha: dia("2026-10-16"), Tipo: "ingreso", Monto: 120000000, CategoriaID: 17, Medio: "transferencia"}) {
		t.Errorf("decisión: %+v", d)
	}
}

func TestConfirmarConAtrasoGuardaLaFechaProgramadaYNoLaDeHoy(t *testing.T) {
	repo := repoConRepeticiones()
	// El 14 de diciembre la cuota de septiembre sigue pendiente y se guarda en septiembre (FP-22).
	codigo, resp, _ := post(api(t, repo, "2026-12-14T15:00:00Z"), confirmacion(recArriendo), `{"fecha":"2026-09-15"}`)
	if codigo != 201 || !strings.Contains(resp, `"fecha":"2026-09-15"`) || repo.decisiones[0].confirmar[0].Fecha != dia("2026-09-15") {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestConfirmarConUnMontoCambiadoGuardaEseMontoSoloEnEsaFecha(t *testing.T) {
	repo := repoConRepeticiones()
	codigo, resp, _ := post(api(t, repo, hoy), confirmacion(recArriendo), `{"fecha":"2026-10-15","monto_centavos":55000000}`)
	if codigo != 201 || !strings.Contains(resp, `"monto_centavos":55000000`) || repo.decisiones[0].confirmar[0].Monto != 55000000 {
		t.Fatalf("%d %s", codigo, resp)
	}
	if repo.recurrentes[1].Monto != 65000000 {
		t.Error("el monto habitual no cambia")
	}
}

func TestConfirmarRechazaLoQueNoEstaPendienteConUn409(t *testing.T) {
	casos := map[string]struct{ id, fecha string }{
		"ya confirmada":         {recSalario, "2026-10-01"},
		"todavía no llegó":      {recFuturo, "2026-10-27"},
		"no es fecha del ciclo": {recSalario, "2026-10-17"},
		"historia":              {recArriendo, "2026-08-15"},
		"detenida":              {recDetenido, "2026-10-26"},
	}
	for nombre, c := range casos {
		repo := repoConRepeticiones()
		codigo, resp, _ := post(api(t, repo, hoy), confirmacion(c.id), `{"fecha":"`+c.fecha+`"}`)
		if codigo != 409 || resp != `{"error":"fecha_no_pendiente"}` || len(repo.decisiones) != 0 {
			t.Errorf("%s: %d %s %+v", nombre, codigo, resp, repo.decisiones)
		}
	}
}

func TestConfirmarUnaOmitidaEsUn409(t *testing.T) {
	repo := repoConRepeticiones()
	repo.recurrentes[1].Omitidas = dias("2026-09-15")
	codigo, resp, _ := post(api(t, repo, hoy), confirmacion(recArriendo), `{"fecha":"2026-09-15"}`)
	if codigo != 409 || resp != `{"error":"fecha_no_pendiente"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestLaRepeticionDeOtraPersonaOUnIdMalFormadoEsUn404(t *testing.T) {
	for _, id := range []string{recAjeno, "no-es-un-uuid"} {
		for ruta, cuerpo := range map[string]string{confirmacion(id): `{"fecha":"2026-10-16"}`, omision(id): `{"fecha":"2026-10-16"}`} {
			repo := repoConRepeticiones()
			codigo, resp, _ := post(api(t, repo, hoy), ruta, cuerpo)
			if codigo != 404 || resp != `{"error":"no_encontrado"}` || len(repo.decisiones) != 0 {
				t.Errorf("%s: %d %s", ruta, codigo, resp)
			}
		}
	}
}

func TestConfirmarValidaFechaYMontoJuntos(t *testing.T) {
	casos := map[string]string{
		`{}`:                     `{"campos":{"fecha":"fecha_requerida"},"error":"datos_invalidos"}`,
		`{"fecha":"16/10/2026"}`: `{"campos":{"fecha":"fecha_invalida"},"error":"datos_invalidos"}`,
		`{"fecha":"2026-10-16","monto_centavos":0}`:   `{"campos":{"monto_centavos":"monto_no_positivo"},"error":"datos_invalidos"}`,
		`{"fecha":"2026-10-16","monto_centavos":-5}`:  `{"campos":{"monto_centavos":"monto_no_positivo"},"error":"datos_invalidos"}`,
		`{"fecha":"x","monto_centavos":1.5}`:          `{"campos":{"fecha":"fecha_invalida","monto_centavos":"monto_invalido"},"error":"datos_invalidos"}`,
		`{"fecha":"2026-10-16","monto_centavos":"9"}`: `{"campos":{"monto_centavos":"monto_invalido"},"error":"datos_invalidos"}`,
	}
	for cuerpo, quiere := range casos {
		repo := repoConRepeticiones()
		codigo, resp, _ := post(api(t, repo, hoy), confirmacion(recSalario), cuerpo)
		if codigo != 422 || resp != quiere || len(repo.decisiones) != 0 {
			t.Errorf("%s: %d %s", cuerpo, codigo, resp)
		}
	}
	// `monto_centavos: null` es el monto habitual.
	if codigo, resp, _ := post(api(t, repoConRepeticiones(), hoy), confirmacion(recSalario), `{"fecha":"2026-10-16","monto_centavos":null}`); codigo != 201 {
		t.Errorf("null: %d %s", codigo, resp)
	}
}

func TestConfirmarRechazaUnCampoFueraDelContratoYUnCuerpoMalFormado(t *testing.T) {
	for _, cuerpo := range []string{`{"fecha":"2026-10-16","persona_id":"x"}`, `{"fecha":`, ``, `[]`} {
		codigo, resp, _ := post(api(t, repoConRepeticiones(), hoy), confirmacion(recSalario), cuerpo)
		if codigo != 400 || resp != `{"error":"solicitud_invalida"}` {
			t.Errorf("%q: %d %s", cuerpo, codigo, resp)
		}
	}
}

// Dos pedidos a la vez de la misma fecha: el segundo lo para la restricción única; el servicio lo responde con un 409.
func TestUnaViolacionUnicaDelRepositorioEsUn409Claro(t *testing.T) {
	repo := repoConRepeticiones()
	repo.errorAlDecidir = registro.ErrFechaNoPendiente
	for ruta, cuerpo := range map[string]string{
		confirmacion(recSalario): `{"fecha":"2026-10-16"}`, omision(recSalario): `{"fecha":"2026-10-16"}`,
		"/api/v1/repeticiones/decisiones": `{"decisiones":[{"recurrente_id":"` + recSalario + `","fecha":"2026-10-16"}]}`,
	} {
		if codigo, resp, _ := post(api(t, repo, hoy), ruta, cuerpo); codigo != 409 || resp != `{"error":"fecha_no_pendiente"}` {
			t.Errorf("%s: %d %s", ruta, codigo, resp)
		}
	}
}

func TestConfirmarPasaElErrorDelRepositorioComoFalloInterno(t *testing.T) {
	repo := repoConRepeticiones()
	repo.errorAlDecidir = errors.New("sin base")
	codigo, resp, _ := post(api(t, repo, hoy), confirmacion(recSalario), `{"fecha":"2026-10-16"}`)
	if codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("%d %s", codigo, resp)
	}
	repo = repoConRepeticiones()
	repo.error = errors.New("sin base")
	if codigo, _, _ := post(api(t, repo, hoy), confirmacion(recSalario), `{"fecha":"2026-10-16"}`); codigo != 500 {
		t.Errorf("al leer las repeticiones: %d", codigo)
	}
}

func TestOmitirGuardaLaFechaOmitidaYNoCreaNingunMovimiento(t *testing.T) {
	repo := repoConRepeticiones()
	codigo, resp, cabeceras := post(api(t, repo, hoy), omision(recSalario), `{"fecha":"2026-10-16"}`)
	if codigo != 204 || resp != "" || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s", codigo, resp)
	}
	d := repo.decisiones[0]
	if len(d.confirmar) != 0 || len(d.omitir) != 1 || d.omitir[0] != (registro.Omision{RecurrenteID: recSalario, Fecha: dia("2026-10-16")}) {
		t.Errorf("decisión: %+v", d)
	}
}

func TestOmitirRechazaLoQueNoEstaPendienteYValidaLaFecha(t *testing.T) {
	repo := repoConRepeticiones()
	if codigo, resp, _ := post(api(t, repo, hoy), omision(recSalario), `{"fecha":"2026-10-01"}`); codigo != 409 || resp != `{"error":"fecha_no_pendiente"}` {
		t.Errorf("ya confirmada: %d %s", codigo, resp)
	}
	if codigo, resp, _ := post(api(t, repo, hoy), omision(recFuturo), `{"fecha":"2026-10-27"}`); codigo != 409 {
		t.Errorf("futura: %d %s", codigo, resp)
	}
	if codigo, resp, _ := post(api(t, repo, hoy), omision(recSalario), `{"fecha":"mañana"}`); codigo != 422 || resp != `{"campos":{"fecha":"fecha_invalida"},"error":"datos_invalidos"}` {
		t.Errorf("fecha: %d %s", codigo, resp)
	}
	// «No pasó» no lleva monto: el campo no está en el contrato.
	if codigo, resp, _ := post(api(t, repo, hoy), omision(recSalario), `{"fecha":"2026-10-16","monto_centavos":5}`); codigo != 400 {
		t.Errorf("con monto: %d %s", codigo, resp)
	}
	if len(repo.decisiones) != 0 {
		t.Errorf("no se guardó nada: %+v", repo.decisiones)
	}
}

const rutaDecisiones = "/api/v1/repeticiones/decisiones"

func decision(id, fecha, extra string) string {
	return `{"recurrente_id":"` + id + `","fecha":"` + fecha + `"` + extra + `}`
}

func decisiones(ds ...string) string { return `{"decisiones":[` + strings.Join(ds, ",") + `]}` }

// FP-17 con las fechas del repositorio: el arriendo de septiembre se omite, el de octubre llega con menos y el salario
// se confirma. Se guardan dos movimientos y una fecha omitida.
func TestConfirmarVariasGuardaLoMarcadoOmiteLoQueNoPasoYCuenta(t *testing.T) {
	repo := repoConRepeticiones()
	codigo, resp, cabeceras := post(api(t, repo, hoy), rutaDecisiones, decisiones(
		decision(recArriendo, "2026-09-15", `,"omitida":true`),
		decision(recArriendo, "2026-10-15", `,"monto_centavos":55000000`),
		decision(recSalario, "2026-10-16", ``)))
	const quiere = `{"movimientos":[` +
		`{"id":"m-1","tipo":"gasto","monto_centavos":55000000,"fecha":"2026-10-15","categoria_id":4,"medio":"transferencia","descripcion":null,"compartido":false,"meta":null,"sentido":null,` +
		`"recurrente":{"recurrente_id":"` + recArriendo + `","fecha_programada":"2026-10-15","periodicidad":"mensual","vuelve_a_pendiente":true}},` +
		`{"id":"m-2","tipo":"ingreso","monto_centavos":120000000,"fecha":"2026-10-16","categoria_id":17,"medio":"transferencia","descripcion":null,"compartido":false,"meta":null,"sentido":null,` +
		`"recurrente":{"recurrente_id":"` + recSalario + `","fecha_programada":"2026-10-16","periodicidad":"quincenal","vuelve_a_pendiente":true}}],` +
		`"omitidas":[{"recurrente_id":"` + recArriendo + `","fecha":"2026-09-15"}],"siguen_pendientes":0,` +
		`"resumen":{"guardados":2,"omitidas":1,"ingresos_centavos":120000000,"gastos_centavos":55000000}}`
	if codigo != 200 || resp != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s\nse esperaba %s", codigo, resp, quiere)
	}
	if len(repo.decisiones) != 1 || len(repo.decisiones[0].confirmar) != 2 || len(repo.decisiones[0].omitir) != 1 {
		t.Errorf("una sola operación con todo: %+v", repo.decisiones)
	}
}

// FP-18: lo desmarcado no entra y sigue pendiente.
func TestConfirmarVariasDejaPendienteLoQueNoEntra(t *testing.T) {
	repo := repoConRepeticiones()
	codigo, resp, _ := post(api(t, repo, hoy), rutaDecisiones, decisiones(decision(recSalario, "2026-10-16", ``)))
	if codigo != 200 || !strings.Contains(resp, `"siguen_pendientes":2`) || !strings.Contains(resp, `"omitidas":[]`) ||
		!strings.Contains(resp, `"resumen":{"guardados":1,"omitidas":0,"ingresos_centavos":120000000,"gastos_centavos":0}`) {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestConfirmarVariasSoloConOmitidasNoCreaMovimientos(t *testing.T) {
	repo := repoConRepeticiones()
	codigo, resp, _ := post(api(t, repo, hoy), rutaDecisiones, decisiones(decision(recSalario, "2026-10-16", `,"omitida":true`)))
	if codigo != 200 || !strings.HasPrefix(resp, `{"movimientos":[],"omitidas":[{`) || !strings.Contains(resp, `"guardados":0,"omitidas":1`) {
		t.Errorf("%d %s", codigo, resp)
	}
}

// FP-19 a FP-21: una decisión inválida no guarda ninguna, ni la válida («No se guardó ninguno»).
func TestConfirmarVariasEsTodoONadaYDiceCualFalla(t *testing.T) {
	valida := decision(recSalario, "2026-10-16", ``)
	casos := map[string]struct {
		cuerpo, resp string
		codigo       int
	}{
		"FP-19 fecha ya confirmada": {decisiones(valida, decision(recSalario, "2026-10-01", ``)), `{"error":"fecha_no_pendiente"}`, 409},
		"FP-20 dos decisiones":      {decisiones(valida, decision(recSalario, "2026-10-16", `,"omitida":true`)), `{"error":"fecha_no_pendiente"}`, 409},
		"FP-21 monto en cero": {decisiones(valida, decision(recArriendo, "2026-10-15", `,"monto_centavos":0`)),
			`{"campos":{"decisiones[1].monto_centavos":"monto_no_positivo"},"error":"datos_invalidos"}`, 422},
		"omitida con monto": {decisiones(valida, decision(recArriendo, "2026-10-15", `,"omitida":true,"monto_centavos":5`)),
			`{"campos":{"decisiones[1].monto_centavos":"monto_invalido"},"error":"datos_invalidos"}`, 422},
		"fecha mal escrita y id mal formado": {decisiones(decision("x", "ayer", ``)),
			`{"campos":{"decisiones[0].fecha":"fecha_invalida","decisiones[0].recurrente_id":"recurrente_invalido"},"error":"datos_invalidos"}`, 422},
		"id sin fecha ni id": {decisiones(`{}`),
			`{"campos":{"decisiones[0].fecha":"fecha_requerida","decisiones[0].recurrente_id":"recurrente_requerido"},"error":"datos_invalidos"}`, 422},
		"sin decisiones": {`{"decisiones":[]}`, `{"campos":{"decisiones":"decisiones_requeridas"},"error":"datos_invalidos"}`, 422},
		"sin la lista":   {`{}`, `{"campos":{"decisiones":"decisiones_requeridas"},"error":"datos_invalidos"}`, 422},
		"ajena":          {decisiones(valida, decision(recAjeno, "2026-10-16", ``)), `{"error":"no_encontrado"}`, 404},
	}
	for nombre, c := range casos {
		repo := repoConRepeticiones()
		codigo, resp, _ := post(api(t, repo, hoy), rutaDecisiones, c.cuerpo)
		if codigo != c.codigo || resp != c.resp || len(repo.decisiones) != 0 {
			t.Errorf("%s: %d %s (guardó %+v)", nombre, codigo, resp, repo.decisiones)
		}
	}
}

func TestConfirmarVariasPoneUnTopeALasDecisiones(t *testing.T) {
	var ds []string
	for range registro.DecisionesMaximas + 1 {
		ds = append(ds, decision(recSalario, "2026-10-16", ``))
	}
	codigo, resp, _ := post(api(t, repoConRepeticiones(), hoy), rutaDecisiones, decisiones(ds...))
	if codigo != 422 || resp != `{"campos":{"decisiones":"demasiadas_decisiones"},"error":"datos_invalidos"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestConfirmarVariasRechazaUnCampoFueraDelContrato(t *testing.T) {
	codigo, resp, _ := post(api(t, repoConRepeticiones(), hoy), rutaDecisiones, `{"decisiones":[{"recurrente_id":"`+recSalario+`","fecha":"2026-10-16","persona_id":"x"}]}`)
	if codigo != 400 || resp != `{"error":"solicitud_invalida"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestConfirmarVariasPasaElErrorDelRepositorioComoFalloInterno(t *testing.T) {
	repo := repoConRepeticiones()
	repo.errorAlDecidir = errors.New("sin base")
	codigo, resp, _ := post(api(t, repo, hoy), rutaDecisiones, decisiones(decision(recSalario, "2026-10-16", ``)))
	if codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

// E17 3.15 en los POST nuevos (D-173, D-174, D-175): (a) a (c) responden 403 sin cambiar nada y (d) responde 415.
func TestLosPOSTDeUS60CumplenLaDefensaContraCSRF(t *testing.T) {
	rutas := map[string]string{
		confirmacion(recSalario): `{"fecha":"2026-10-16"}`, omision(recSalario): `{"fecha":"2026-10-16"}`,
		rutaDecisiones: decisiones(decision(recSalario, "2026-10-16", ``)),
	}
	codigoNormal := map[string]int{confirmacion(recSalario): 201, omision(recSalario): 204, rutaDecisiones: 200}
	json := []string{"Content-Type", "application/json"}
	casos := []struct {
		nombre    string
		cabeceras []string
		codigo    int
	}{
		{"cross-site", append([]string{"Sec-Fetch-Site", "cross-site"}, json...), 403},
		{"same-site", append([]string{"Sec-Fetch-Site", "same-site"}, json...), 403},
		{"none", append([]string{"Sec-Fetch-Site", "none"}, json...), 403},
		{"Origin recAjeno", append([]string{"Origin", "https://otro.test"}, json...), 403},
		{"sin cabeceras de cliente", json, 403},
		{"Sec-Fetch-Site same-origin manda sobre un Origin recAjeno", append([]string{"Sec-Fetch-Site", "same-origin", "Origin", "https://otro.test"}, json...), 201},
		{"web: same-origin", append([]string{"Sec-Fetch-Site", "same-origin"}, json...), 201},
		{"web: Origin igual a URL_PUBLICA", append([]string{"Origin", urlPublica}, json...), 201},
		{"Android: X-Alcanzamos-Cliente", append([]string{"X-Alcanzamos-Cliente", "android"}, json...), 201},
		{"Android: Bearer", append([]string{"Authorization", "Bearer abc"}, json...), 201},
		{"text/plain", []string{"X-Alcanzamos-Cliente", "android", "Content-Type", "text/plain"}, 415},
		{"sin Content-Type", []string{"X-Alcanzamos-Cliente", "android"}, 415},
		{"application/json con parámetros", []string{"X-Alcanzamos-Cliente", "android", "Content-Type", "application/json; charset=utf-8"}, 201},
		{"otro tipo que empieza igual", []string{"X-Alcanzamos-Cliente", "android", "Content-Type", "application/jsonx"}, 415},
	}
	for ruta, cuerpo := range rutas {
		for _, c := range casos {
			repo := repoConRepeticiones()
			codigo, resp, _ := publicar(api(t, repo, hoy), ruta, cuerpo, c.cabeceras...)
			esperado := c.codigo
			if esperado == 201 { // lo válido responde el código normal de su ruta
				esperado = codigoNormal[ruta]
			}
			if codigo != esperado {
				t.Errorf("%s %s: %d %s, se esperaba %d", ruta, c.nombre, codigo, resp, esperado)
			}
			if c.codigo != 201 && len(repo.decisiones) != 0 {
				t.Errorf("%s %s: el rechazo no debe cambiar nada", ruta, c.nombre)
			}
			if c.codigo == 403 && resp != `{"error":"solicitud_no_permitida"}` {
				t.Errorf("%s %s: %s", ruta, c.nombre, resp)
			}
			if c.codigo == 415 && resp != `{"error":"tipo_de_contenido_no_permitido"}` {
				t.Errorf("%s %s: %s", ruta, c.nombre, resp)
			}
		}
	}
}

// Sin URL_PUBLICA, ningún Origin vale: se niega ante la duda.
func TestSinURLPublicaNingunOriginVale(t *testing.T) {
	h := apiSinURL(t, repoConRepeticiones())
	if codigo, _, _ := publicar(h, omision(recSalario), `{"fecha":"2026-10-16"}`, "Origin", urlPublica, "Content-Type", "application/json"); codigo != 403 {
		t.Errorf("%d", codigo)
	}
}

// Datos que E15 5.2 rechaza (una fecha confirmada y omitida a la vez, `ErrFechaConfirmadaYOmitida`) son un fallo interno,
// no un 409: la base no deja que pase (E13), así que si llega es un defecto y no algo que la persona pueda arreglar.
func TestUnaRepeticionConDatosIncoherentesEsUnFalloInterno(t *testing.T) {
	repo := repoConRepeticiones()
	repo.recurrentes[0].Omitidas = dias("2026-10-01")
	if codigo, resp, _ := llamar(api(t, repo, hoy), "GET", rutaPendientes, ""); codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("listar: %d %s", codigo, resp)
	}
	if codigo, resp, _ := post(api(t, repo, hoy), confirmacion(recSalario), `{"fecha":"2026-10-16"}`); codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("confirmar: %d %s", codigo, resp)
	}
	if len(repo.decisiones) != 0 {
		t.Errorf("no se guardó nada: %+v", repo.decisiones)
	}
}

func TestSiElRepositorioNoDevuelveUnIdPorMovimientoEsUnFalloInterno(t *testing.T) {
	repo := repoConRepeticiones()
	repo.idsDeMenos = true
	if codigo, resp, _ := post(api(t, repo, hoy), confirmacion(recSalario), `{"fecha":"2026-10-16"}`); codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

// Con la misma fecha va primero el ingreso, sea cual sea el orden en que el repositorio entrega las repeticiones; y con
// el mismo tipo, el id de la repetición desempata, para que la lista no cambie de un pedido a otro.
func TestPendientesDeLaMismaFechaTienenUnOrdenEstable(t *testing.T) {
	gasto := func(id string) registro.Recurrente {
		return registro.Recurrente{ID: id, Tipo: "gasto", CategoriaID: 4, Medio: "efectivo", Periodicidad: fechas.Mensual, Monto: 100, Inicio: dia("2026-10-01"), CreadoEl: dia("2026-10-01")}
	}
	ingreso := gasto("0192f3c4-0000-7000-8000-0000000000b0")
	ingreso.Tipo, ingreso.CategoriaID, ingreso.Medio = "ingreso", 17, "transferencia"
	quiere := ingreso.ID + "," + recSalario + "," + recArriendo
	for _, orden := range [][]registro.Recurrente{
		{gasto(recSalario), gasto(recArriendo), ingreso}, {ingreso, gasto(recArriendo), gasto(recSalario)}, {gasto(recArriendo), ingreso, gasto(recSalario)},
	} {
		_, resp, _ := llamar(api(t, &repoFalso{recurrentes: orden}, hoy), "GET", rutaPendientes, "")
		var visto struct {
			Pendientes []struct {
				ID string `json:"recurrente_id"`
			} `json:"pendientes"`
		}
		if err := json.Unmarshal([]byte(resp), &visto); err != nil {
			t.Fatal(err)
		}
		var ids []string
		for _, p := range visto.Pendientes {
			ids = append(ids, p.ID)
		}
		if got := strings.Join(ids, ","); got != quiere {
			t.Errorf("orden %s, se esperaba %s", got, quiere)
		}
	}
}

// Un bloqueo mutuo o un fallo de serialización de la base es un 409 `conflicto_concurrente` que se puede reintentar, no un 500.
func TestUnConflictoConcurrenteDelRepositorioEsUn409Reintentable(t *testing.T) {
	repo := repoConRepeticiones()
	repo.errorAlDecidir = registro.ErrConflictoConcurrente
	for ruta, cuerpo := range map[string]string{
		confirmacion(recSalario): `{"fecha":"2026-10-16"}`, omision(recSalario): `{"fecha":"2026-10-16"}`,
		rutaDecisiones: decisiones(decision(recSalario, "2026-10-16", ``)),
	} {
		if codigo, resp, _ := post(api(t, repo, hoy), ruta, cuerpo); codigo != 409 || resp != `{"error":"conflicto_concurrente"}` {
			t.Errorf("%s: %d %s", ruta, codigo, resp)
		}
	}
}
