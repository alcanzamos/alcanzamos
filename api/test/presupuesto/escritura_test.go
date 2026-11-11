package presupuesto_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

const (
	idNoviembre = "0192f3c4-0000-7000-8000-0000000000b1" // Transporte, noviembre de 2026
	idOctubre   = "0192f3c4-0000-7000-8000-0000000000b2" // Alimentación, octubre de 2026
	idAjeno     = "0192f3c4-0000-7000-8000-0000000000ff"
)

// repoDeEscritura guarda los presupuestos en memoria, como la tabla de E13: únicos por (categoría, periodo).
type repoDeEscritura struct {
	repoFalso
	guardados map[string]presupuesto.Guardado
	siguiente int
	errorAlPoner,
	errorAlCorregir,
	errorAlDejarEnCero error
	enCero  map[string]bool // las marcas «en cero», por periodo AAAA-MM-DD: una por persona y mes, como la tabla de 0004
	pedidos []string        // lo que el servicio pidió, en orden
}

func nuevoRepoDeEscritura() *repoDeEscritura {
	return &repoDeEscritura{guardados: map[string]presupuesto.Guardado{
		idNoviembre: {ID: idNoviembre, CategoriaID: transporte, Periodo: dia("2026-11-01"), Monto: 4000000},
		idOctubre:   {ID: idOctubre, CategoriaID: alimentacion, Periodo: dia("2026-10-01"), Monto: 9900},
	}, enCero: map[string]bool{}}
}

func (r *repoDeEscritura) DejarEnCero(_ context.Context, p string, periodo time.Time) error {
	r.pedidos = append(r.pedidos, "en cero "+p+" "+periodo.Format(time.DateOnly))
	if r.errorAlDejarEnCero != nil {
		return r.errorAlDejarEnCero
	}
	r.enCero[periodo.Format(time.DateOnly)] = true
	return nil
}

func (r *repoDeEscritura) Poner(_ context.Context, p string, categoria int, periodo time.Time, monto int64) (presupuesto.Guardado, bool, error) {
	r.pedidos = append(r.pedidos, fmt.Sprintf("poner %s %d %s %d", p, categoria, periodo.Format(time.DateOnly), monto))
	if r.errorAlPoner != nil {
		return presupuesto.Guardado{}, false, r.errorAlPoner
	}
	for id, g := range r.guardados {
		if g.CategoriaID == categoria && g.Periodo.Equal(periodo) {
			g.Monto = monto
			r.guardados[id] = g
			return g, false, nil
		}
	}
	r.siguiente++
	g := presupuesto.Guardado{ID: fmt.Sprintf("0192f3c4-0000-7000-8000-%012d", r.siguiente), CategoriaID: categoria, Periodo: periodo, Monto: monto}
	r.guardados[g.ID] = g
	return g, true, nil
}

func (r *repoDeEscritura) Obtener(_ context.Context, p, id string) (presupuesto.Guardado, error) {
	r.pedidos = append(r.pedidos, "obtener "+id)
	g, existe := r.guardados[id]
	if !existe || p != persona {
		return presupuesto.Guardado{}, presupuesto.ErrNoEncontrado
	}
	return g, nil
}

func (r *repoDeEscritura) Corregir(_ context.Context, p, id string, periodo time.Time, monto int64) error {
	r.pedidos = append(r.pedidos, fmt.Sprintf("corregir %s %s %d", id, periodo.Format(time.DateOnly), monto))
	if r.errorAlCorregir != nil {
		return r.errorAlCorregir
	}
	g, existe := r.guardados[id]
	if !existe || p != persona || !g.Periodo.Equal(periodo) {
		return presupuesto.ErrNoEncontrado
	}
	g.Monto = monto
	r.guardados[id] = g
	return nil
}

func (r *repoDeEscritura) Quitar(_ context.Context, p, id string, periodo time.Time) error {
	r.pedidos = append(r.pedidos, fmt.Sprintf("quitar %s %s", id, periodo.Format(time.DateOnly)))
	g, existe := r.guardados[id]
	if !existe || p != persona || !g.Periodo.Equal(periodo) {
		return presupuesto.ErrNoEncontrado
	}
	delete(r.guardados, id)
	return nil
}

// apiConRegistro es api con el registro del API en `log`.
func apiConRegistro(t *testing.T, repo presupuesto.Repositorio, ahora string, log *bytes.Buffer) http.Handler {
	t.Helper()
	hora, err := time.Parse(time.RFC3339, ahora)
	if err != nil {
		t.Fatal(err)
	}
	l := slog.New(slog.NewJSONHandler(log, nil))
	e := servidor.NuevoEnrutador(sesionFalsa{}, seguridad.NuevoRegistro(l), l).ConURLPublica(urlPublica)
	presupuesto.NuevoHandler(presupuesto.NuevoServicio(repo, &relojtest.Fijo{T: hora}), l).Registrar(e)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

// «Poner presupuesto» (CU-09 3): Servicios públicos con $400.000 en noviembre (SM-06). `201` con el presupuesto, propio
// de la persona de la sesión.
func TestPonerPresupuestoDelMesEnCurso(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	codigo, cuerpo, cabeceras := llamar(api(t, repo, dosDeNoviembre), "POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":5,"monto_centavos":40000000}`)
	const quiere = `{"id":"0192f3c4-0000-7000-8000-000000000001","categoria_id":5,"periodo":"2026-11","monto_centavos":40000000}`
	if codigo != 201 || cuerpo != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s %v, se esperaba 201 %s", codigo, cuerpo, cabeceras, quiere)
	}
	if strings.Join(repo.pedidos, "|") != "poner "+persona+" 5 2026-11-01 40000000" {
		t.Errorf("pedidos: %v", repo.pedidos)
	}
}

// E13 (único por persona, periodo y categoría): poner otra vez el de una categoría que ya tiene presupuesto en el mes es
// corregirlo. `200` con el mismo id y el monto nuevo; no hay dos.
func TestPonerOtraVezLaMismaCategoriaCorrige(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":4500050}`)
	const quiere = `{"id":"` + idNoviembre + `","categoria_id":8,"periodo":"2026-11","monto_centavos":4500050}`
	if codigo != 200 || cuerpo != quiere || len(repo.guardados) != 2 {
		t.Fatalf("%d %s %v, se esperaba 200 %s", codigo, cuerpo, repo.guardados, quiere)
	}
}

// Los errores de campo de E14-PPN 3.1 que E14-PPA 4.1 reusa, todos a la vez y sin tocar el repositorio: «Falta el monto.»
// (monto_requerido), «El monto puede tener hasta dos decimales.» (la app; el API recibe centavos enteros: monto_invalido)
// y «El monto debe ser mayor que $0.» (monto_no_positivo).
func TestPonerValidaTodosLosCamposALaVez(t *testing.T) {
	casos := []struct{ cuerpo, campos string }{
		{`{}`, `{"categoria_id":"categoria_requerida","monto_centavos":"monto_requerido","periodo":"periodo_requerido"}`},
		{`{"periodo":"2026-13","categoria_id":0,"monto_centavos":0}`, `{"categoria_id":"categoria_invalida","monto_centavos":"monto_no_positivo","periodo":"periodo_invalido"}`},
		{`{"periodo":"2026-11","categoria_id":32768,"monto_centavos":-1}`, `{"categoria_id":"categoria_invalida","monto_centavos":"monto_no_positivo"}`},
		{`{"periodo":"2026-11","categoria_id":8,"monto_centavos":12.5}`, `{"monto_centavos":"monto_invalido"}`},
		{`{"periodo":"2026-11","categoria_id":8,"monto_centavos":"4000000"}`, `{"monto_centavos":"monto_invalido"}`},
		{`{"periodo":"2026-11","categoria_id":8,"monto_centavos":1e6}`, `{"monto_centavos":"monto_invalido"}`},
		{`{"periodo":"2026-11","categoria_id":8,"monto_centavos":9223372036854775808}`, `{"monto_centavos":"monto_invalido"}`},
		{`{"periodo":"2026-11","categoria_id":8,"monto_centavos":null}`, `{"monto_centavos":"monto_requerido"}`},
		{`{"periodo":"","categoria_id":8,"monto_centavos":1}`, `{"periodo":"periodo_requerido"}`},
		{`{"periodo":"1899-12","categoria_id":8,"monto_centavos":1}`, `{"periodo":"periodo_invalido"}`},
	}
	for _, c := range casos {
		repo := nuevoRepoDeEscritura()
		codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "POST", "/api/v1/presupuestos", c.cuerpo)
		if quiere := `{"campos":` + c.campos + `,"error":"datos_invalidos"}`; codigo != 422 || cuerpo != quiere || len(repo.pedidos) != 0 {
			t.Errorf("%s: %d %s %v, se esperaba 422 %s", c.cuerpo, codigo, cuerpo, repo.pedidos, quiere)
		}
	}
}

// Un campo fuera del contrato (`persona_id`, `hogar_id`) es `400`: la dueña es siempre la persona de la sesión y el
// presupuesto es propio (L3: el hogar llega en I08).
func TestPonerConUnCampoFueraDelContratoEs400(t *testing.T) {
	for _, extra := range []string{`,"persona_id":"` + idAjeno + `"`, `,"hogar_id":"` + idAjeno + `"`} {
		repo := nuevoRepoDeEscritura()
		codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":1`+extra+`}`)
		if codigo != 400 || cuerpo != `{"error":"solicitud_invalida"}` || len(repo.pedidos) != 0 {
			t.Errorf("%s: %d %s", extra, codigo, cuerpo)
		}
	}
}

// D-094, SC-E21-13: solo el mes en curso. Presupuestar otro mes, pasado o futuro, es `409 periodo_no_editable`.
func TestPonerEnOtroMesEs409(t *testing.T) {
	for _, periodo := range []string{"2026-10", "2026-12", "2025-11"} {
		repo := nuevoRepoDeEscritura()
		codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "POST", "/api/v1/presupuestos", `{"periodo":"`+periodo+`","categoria_id":8,"monto_centavos":1}`)
		if codigo != 409 || cuerpo != `{"error":"periodo_no_editable"}` || len(repo.pedidos) != 0 {
			t.Errorf("%s: %d %s %v", periodo, codigo, cuerpo, repo.pedidos)
		}
	}
}

// Lo que el repositorio rechaza: una categoría que no es de gasto, no existe o la persona ocultó (422), una persona menor
// (403), la cuenta borrada (401), una categoría con un presupuesto compartido con el hogar en el mes (409, D-201) y un fallo (500).
func TestPonerTraduceLoQueElRepositorioRechaza(t *testing.T) {
	casos := []struct {
		err    error
		codigo int
		cuerpo string
	}{
		{registro.ErrCategoriaInvalida, 422, `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}`},
		{presupuesto.ErrSoloAdultos, 403, `{"error":"solo_personas_adultas"}`},
		{registro.ErrSinCuenta, 401, `{"error":"sin_sesion"}`},
		{presupuesto.ErrPresupuestoCompartido, 409, `{"error":"presupuesto_compartido"}`},
		{errors.New("la base se cayó"), 500, `{"error":"error_interno"}`},
	}
	for _, c := range casos {
		repo := nuevoRepoDeEscritura()
		repo.errorAlPoner = c.err
		codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":17,"monto_centavos":1}`)
		if codigo != c.codigo || cuerpo != c.cuerpo {
			t.Errorf("%v: %d %s", c.err, codigo, cuerpo)
		}
	}
}

// «Corregir» (CU-09 3a): el error de tecleo de E14-PPA 2.2, Transporte de $400.000 corregido a $40.000. `200` con el
// presupuesto; el repositorio corrige solo la fila del mes en curso.
func TestCorregirElPresupuestoDelMesEnCurso(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	codigo, cuerpo, cabeceras := llamar(api(t, repo, dosDeNoviembre), "PUT", "/api/v1/presupuestos/"+idNoviembre, `{"monto_centavos":4000001}`)
	const quiere = `{"id":"` + idNoviembre + `","categoria_id":8,"periodo":"2026-11","monto_centavos":4000001}`
	if codigo != 200 || cuerpo != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s, se esperaba 200 %s", codigo, cuerpo, quiere)
	}
	if strings.Join(repo.pedidos, "|") != "obtener "+idNoviembre+"|corregir "+idNoviembre+" 2026-11-01 4000001" {
		t.Errorf("pedidos: %v", repo.pedidos)
	}
}

// El orden de los errores al corregir: forma (422, sin leer), dueña (404) y estado (409, D-094).
func TestCorregirErrores(t *testing.T) {
	casos := []struct {
		nombre, id, cuerpo string
		codigo             int
		respuesta          string
	}{
		{"monto cero", idAjeno, `{"monto_centavos":0}`, 422, `{"campos":{"monto_centavos":"monto_no_positivo"},"error":"datos_invalidos"}`},
		{"sin monto", idNoviembre, `{}`, 422, `{"campos":{"monto_centavos":"monto_requerido"},"error":"datos_invalidos"}`},
		{"campo fuera del contrato", idNoviembre, `{"monto_centavos":1,"categoria_id":5}`, 400, `{"error":"solicitud_invalida"}`},
		{"ajeno o inexistente", idAjeno, `{"monto_centavos":1}`, 404, `{"error":"no_encontrado"}`},
		{"id mal formado", "transporte", `{"monto_centavos":1}`, 404, `{"error":"no_encontrado"}`},
		{"otro mes", idOctubre, `{"monto_centavos":1}`, 409, `{"error":"periodo_no_editable"}`},
	}
	for _, c := range casos {
		repo := nuevoRepoDeEscritura()
		codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "PUT", "/api/v1/presupuestos/"+c.id, c.cuerpo)
		if codigo != c.codigo || cuerpo != c.respuesta {
			t.Errorf("%s: %d %s, se esperaba %d %s", c.nombre, codigo, cuerpo, c.codigo, c.respuesta)
		}
		if repo.guardados[idOctubre].Monto != 9900 || repo.guardados[idNoviembre].Monto != 4000000 {
			t.Errorf("%s: cambió un presupuesto: %v", c.nombre, repo.guardados)
		}
	}
	// Si se quitó entre leerlo y corregirlo, 404; un fallo, 500.
	for err, quiere := range map[error]string{presupuesto.ErrNoEncontrado: `{"error":"no_encontrado"}`, errors.New("caída"): `{"error":"error_interno"}`} {
		repo := nuevoRepoDeEscritura()
		repo.errorAlCorregir = err
		if _, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "PUT", "/api/v1/presupuestos/"+idNoviembre, `{"monto_centavos":1}`); cuerpo != quiere {
			t.Errorf("%v: %s", err, cuerpo)
		}
	}
}

// «Quitar» (CU-09 3b): `204`; la segunda vez, `404`. Un presupuesto de otro mes no se quita (409); uno ajeno, 404.
func TestQuitarElPresupuestoDelMesEnCurso(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	h := api(t, repo, dosDeNoviembre)
	codigo, cuerpo, cabeceras := llamar(h, "DELETE", "/api/v1/presupuestos/"+idNoviembre, "")
	if codigo != 204 || cuerpo != "" || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s", codigo, cuerpo)
	}
	if _, queda := repo.guardados[idNoviembre]; queda {
		t.Error("no se quitó")
	}
	for _, c := range []struct {
		id        string
		codigo    int
		respuesta string
	}{
		{idNoviembre, 404, `{"error":"no_encontrado"}`},
		{idAjeno, 404, `{"error":"no_encontrado"}`},
		{"x", 404, `{"error":"no_encontrado"}`},
		{idOctubre, 409, `{"error":"periodo_no_editable"}`},
	} {
		if codigo, cuerpo, _ := llamar(h, "DELETE", "/api/v1/presupuestos/"+c.id, ""); codigo != c.codigo || cuerpo != c.respuesta {
			t.Errorf("%s: %d %s", c.id, codigo, cuerpo)
		}
	}
	if repo.guardados[idOctubre].Monto != 9900 {
		t.Error("se quitó el de octubre")
	}
}

// «Mes en curso» es el de Colombia (E12: el `Reloj` en Bogotá): a las 22:00 del 30 de noviembre en Colombia (03:00 UTC
// del 1 de diciembre) noviembre sigue en curso; a las 00:00 del 1 de diciembre ya no.
func TestElMesEnCursoEsElDeColombia(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	h := api(t, repo, "2026-12-01T04:59:59Z")
	if codigo, cuerpo, _ := llamar(h, "PUT", "/api/v1/presupuestos/"+idNoviembre, `{"monto_centavos":7}`); codigo != 200 {
		t.Errorf("el 30 de noviembre en Colombia: %d %s", codigo, cuerpo)
	}
	if codigo, cuerpo, _ := llamar(h, "POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":1,"monto_centavos":7}`); codigo != 201 {
		t.Errorf("el 30 de noviembre en Colombia: %d %s", codigo, cuerpo)
	}
	h = api(t, repo, "2026-12-01T05:00:00Z")
	for _, p := range [][3]string{{"PUT", "/api/v1/presupuestos/" + idNoviembre, `{"monto_centavos":8}`}, {"DELETE", "/api/v1/presupuestos/" + idNoviembre, ""},
		{"POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":1,"monto_centavos":8}`}} {
		if codigo, cuerpo, _ := llamar(h, p[0], p[1], p[2]); codigo != 409 || cuerpo != `{"error":"periodo_no_editable"}` {
			t.Errorf("el 1 de diciembre, %s: %d %s", p[0], codigo, cuerpo)
		}
	}
	if repo.guardados[idNoviembre].Monto != 7 {
		t.Errorf("monto: %v", repo.guardados[idNoviembre])
	}
}

// «Dejar el presupuesto en cero» (PN-07, E14-PPA 4.2, CU-10 2a; L6 (5) de la US-77): `204` sin cuerpo y la marca del
// mes en curso de la persona de la sesión. Otra vez, también `204`: es idempotente y la marca es una sola.
func TestDejarEnCeroElMesEnCurso(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	h := api(t, repo, dosDeNoviembre)
	for i := range 2 {
		codigo, cuerpo, cabeceras := llamar(h, "POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`)
		if codigo != 204 || cuerpo != "" || cabeceras.Get("Cache-Control") != "no-store" {
			t.Fatalf("vez %d: %d %s %v", i+1, codigo, cuerpo, cabeceras)
		}
	}
	quiere := "en cero " + persona + " 2026-11-01"
	if strings.Join(repo.pedidos, "|") != quiere+"|"+quiere || len(repo.enCero) != 1 || !repo.enCero["2026-11-01"] {
		t.Errorf("pedidos %v, marcas %v", repo.pedidos, repo.enCero)
	}
}

// Los errores de «Dejar el presupuesto en cero», en orden: forma (`422` o `400`, sin tocar el repositorio), mes en curso
// (`409 periodo_no_editable`, sin tocar el repositorio) y lo que el repositorio rechaza: el periodo ya tiene ingreso
// registrado o algo asignado (`409 periodo_con_ingreso_o_presupuesto`: el botón solo se ofrece con ingreso nulo y nada
// asignado, E14-PPA 4.2), una persona menor (`403`), la cuenta borrada (`401`) o un fallo (`500`). Ninguno guarda la marca.
func TestDejarEnCeroErrores(t *testing.T) {
	casos := []struct {
		nombre, cuerpo string
		err            error
		codigo         int
		respuesta      string
		pedidos        int
	}{
		{"sin periodo", `{}`, nil, 422, `{"campos":{"periodo":"periodo_requerido"},"error":"datos_invalidos"}`, 0},
		{"periodo vacío", `{"periodo":""}`, nil, 422, `{"campos":{"periodo":"periodo_requerido"},"error":"datos_invalidos"}`, 0},
		{"periodo mal formado", `{"periodo":"2026-13"}`, nil, 422, `{"campos":{"periodo":"periodo_invalido"},"error":"datos_invalidos"}`, 0},
		{"periodo con día", `{"periodo":"2026-11-01"}`, nil, 422, `{"campos":{"periodo":"periodo_invalido"},"error":"datos_invalidos"}`, 0},
		{"campo fuera del contrato", `{"periodo":"2026-11","persona_id":"` + idAjeno + `"}`, nil, 400, `{"error":"solicitud_invalida"}`, 0},
		{"un mes pasado", `{"periodo":"2026-10"}`, nil, 409, `{"error":"periodo_no_editable"}`, 0},
		{"un mes futuro", `{"periodo":"2026-12"}`, nil, 409, `{"error":"periodo_no_editable"}`, 0},
		{"con ingreso o con algo asignado", `{"periodo":"2026-11"}`, presupuesto.ErrPeriodoConIngresoOPresupuesto, 409, `{"error":"periodo_con_ingreso_o_presupuesto"}`, 1},
		{"una persona menor", `{"periodo":"2026-11"}`, presupuesto.ErrSoloAdultos, 403, `{"error":"solo_personas_adultas"}`, 1},
		{"la cuenta borrada", `{"periodo":"2026-11"}`, registro.ErrSinCuenta, 401, `{"error":"sin_sesion"}`, 1},
		{"un fallo", `{"periodo":"2026-11"}`, errors.New("la base se cayó"), 500, `{"error":"error_interno"}`, 1},
	}
	for _, c := range casos {
		repo := nuevoRepoDeEscritura()
		repo.errorAlDejarEnCero = c.err
		codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "POST", "/api/v1/presupuestos/en-cero", c.cuerpo)
		if codigo != c.codigo || cuerpo != c.respuesta || len(repo.pedidos) != c.pedidos || len(repo.enCero) != 0 {
			t.Errorf("%s: %d %s, pedidos %v, marcas %v; se esperaba %d %s", c.nombre, codigo, cuerpo, repo.pedidos, repo.enCero, c.codigo, c.respuesta)
		}
	}
}

// El mes en curso de «Dejar el presupuesto en cero» también es el de Colombia: a las 23:59:59 del 30 de noviembre en
// Colombia (04:59:59 UTC del 1 de diciembre) noviembre se deja en cero; a las 00:00 del 1 de diciembre ya no.
func TestDejarEnCeroEnElMesDeColombia(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	if codigo, cuerpo, _ := llamar(api(t, repo, "2026-12-01T04:59:59Z"), "POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`); codigo != 204 {
		t.Errorf("el 30 de noviembre en Colombia: %d %s", codigo, cuerpo)
	}
	if codigo, cuerpo, _ := llamar(api(t, repo, "2026-12-01T05:00:00Z"), "POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`); codigo != 409 || cuerpo != `{"error":"periodo_no_editable"}` {
		t.Errorf("el 1 de diciembre en Colombia: %d %s", codigo, cuerpo)
	}
	if len(repo.pedidos) != 1 {
		t.Errorf("pedidos: %v", repo.pedidos)
	}
}

// SEG-006: el registro dice qué pasó, nunca el monto, la categoría, el id ni la persona.
func TestElRegistroNoLlevaMontosNiIds(t *testing.T) {
	repo := nuevoRepoDeEscritura()
	var log bytes.Buffer
	h := apiConRegistro(t, repo, dosDeNoviembre, &log)
	llamar(h, "POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":5,"monto_centavos":48213977}`)
	llamar(h, "PUT", "/api/v1/presupuestos/"+idNoviembre, `{"monto_centavos":73915533}`)
	llamar(h, "DELETE", "/api/v1/presupuestos/"+idNoviembre, "")
	llamar(h, "POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`)
	texto := log.String()
	for _, msg := range []string{`"msg":"presupuesto guardado"`, `"msg":"presupuesto corregido"`, `"msg":"presupuesto quitado"`,
		`"msg":"presupuesto dejado en cero"`} {
		if !strings.Contains(texto, msg) {
			t.Errorf("falta %s en %s", msg, texto)
		}
	}
	for _, secreto := range []string{"48213977", "482139", "73915533", "739155", idNoviembre, persona, "categoria"} {
		if strings.Contains(texto, secreto) {
			t.Errorf("el registro lleva %q: %s", secreto, texto)
		}
	}
}
