package registro_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

const persona = "0192f3c4-0000-7000-8000-0000000000aa"

// repoFalso guarda en memoria lo que el servicio le pide y devuelve ids fijos.
type repoFalso struct {
	categorias []registro.Categoria
	guardados  []registro.Guardado
	ahoras     []time.Time
	error      error
}

func (r *repoFalso) Categorias(_ context.Context, p string) ([]registro.Categoria, error) {
	if p != persona {
		return nil, errors.New("persona equivocada")
	}
	return r.categorias, r.error
}

func (r *repoFalso) Guardar(_ context.Context, g registro.Guardado, ahora time.Time) (registro.Creados, error) {
	if r.error != nil {
		return registro.Creados{}, r.error
	}
	r.guardados = append(r.guardados, g)
	r.ahoras = append(r.ahoras, ahora)
	var c registro.Creados
	if g.Periodicidad != "" {
		c.RecurrenteID = "r-1"
	}
	if g.ConMovimiento {
		c.MovimientoID = "m-1"
	}
	return c, nil
}

type sesionFalsa struct{}

func (sesionFalsa) SujetoDe(*http.Request) (seguridad.Sujeto, error) {
	return seguridad.Sujeto{Persona: persona, Verificada: true, Autorizada: true}, nil
}

// api arma el enrutador real con las rutas del registro, la sesión de una persona autorizada y la hora dada.
func api(t *testing.T, repo *repoFalso, ahora string) http.Handler {
	t.Helper()
	hora, err := time.Parse(time.RFC3339, ahora)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	e := servidor.NuevoEnrutador(sesionFalsa{}, seguridad.NuevoRegistro(log), log)
	registro.NuevoHandler(registro.NuevoServicio(repo, &relojtest.Fijo{T: hora}), log).Registrar(e)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

func llamar(h http.Handler, metodo, ruta, cuerpo string) (int, string, http.Header) {
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo)))
	return rr.Code, strings.TrimSpace(rr.Body.String()), rr.Header()
}

const hoy = "2026-10-26T15:00:00Z" // 10:00 del 26 de octubre en Colombia

func cuerpo(extra string) string {
	return `{"tipo":"gasto","monto_centavos":65000000,"fecha":"2026-10-26","categoria_id":4,"medio":"efectivo"` + extra + `}`
}

// S4 (dueño, D-164): el arriendo del 15 de agosto, mensual, escrito el 26 de octubre.
func TestS4ElArriendoDelQuinceDeAgostoRegistraAgostoYLasIntermediasSonHistoria(t *testing.T) {
	repo := &repoFalso{}
	codigo, resp, _ := llamar(api(t, repo, hoy), "POST", "/api/v1/movimientos",
		`{"tipo":"gasto","monto_centavos":65000000,"fecha":"2026-08-15","categoria_id":4,"medio":"transferencia","descripcion":"Arriendo","repeticion":{"periodicidad":"mensual"}}`)
	if codigo != 201 {
		t.Fatalf("%d %s", codigo, resp)
	}
	const quiere = `{"movimiento_id":"m-1","recurrente_id":"r-1","proximas":["2026-11-15","2026-12-15","2027-01-15"],"pendientes":[]}`
	if resp != quiere {
		t.Errorf("respuesta %s, se esperaba %s", resp, quiere)
	}
	if len(repo.guardados) != 1 {
		t.Fatalf("guardados: %+v", repo.guardados)
	}
	g := repo.guardados[0]
	if g.Periodicidad != "mensual" || !g.ConMovimiento || g.Fecha.Format(time.DateOnly) != "2026-08-15" || g.Monto != 65000000 ||
		g.Persona != persona || g.Tipo != "gasto" || g.CategoriaID != 4 || g.Medio != "transferencia" || g.Descripcion == nil || *g.Descripcion != "Arriendo" {
		t.Errorf("guardado: %+v", g)
	}
	if !repo.ahoras[0].Equal(time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC)) {
		t.Errorf("creado_en: %v", repo.ahoras[0])
	}
}

func TestConRepeticionDeUnaFechaFuturaSoloGuardaLaRepeticion(t *testing.T) {
	repo := &repoFalso{}
	codigo, resp, _ := llamar(api(t, repo, hoy), "POST", "/api/v1/movimientos",
		`{"tipo":"gasto","monto_centavos":65000000,"fecha":"2026-11-01","categoria_id":4,"medio":"efectivo","repeticion":{"periodicidad":"mensual"}}`)
	const quiere = `{"movimiento_id":null,"recurrente_id":"r-1","proximas":["2026-11-01","2026-12-01","2027-01-01"],"pendientes":[]}`
	if codigo != 201 || resp != quiere {
		t.Fatalf("%d %s, se esperaba %s", codigo, resp, quiere)
	}
	if g := repo.guardados[0]; g.ConMovimiento || g.Periodicidad != "mensual" || g.Fecha.Format(time.DateOnly) != "2026-11-01" {
		t.Errorf("no debe guardar un movimiento futuro: %+v", g)
	}
}

func TestConRepeticionDeHoyGuardaElMovimientoDeHoyYNadaQuedaPendiente(t *testing.T) {
	repo := &repoFalso{}
	codigo, resp, _ := llamar(api(t, repo, hoy), "POST", "/api/v1/movimientos", cuerpo(`,"repeticion":{"periodicidad":"quincenal"}`))
	const quiere = `{"movimiento_id":"m-1","recurrente_id":"r-1","proximas":["2026-11-11","2026-11-26","2026-12-11"],"pendientes":[]}`
	if codigo != 201 || resp != quiere {
		t.Fatalf("%d %s, se esperaba %s", codigo, resp, quiere)
	}
	if g := repo.guardados[0]; !g.ConMovimiento || g.Fecha.Format(time.DateOnly) != "2026-10-26" {
		t.Errorf("guardado: %+v", g)
	}
}

// E15 5.2: una fecha programada de hoy que no es la escrita sí queda pendiente (el lunes 19, semanal, escrito el lunes 26).
func TestUnaFechaProgramadaDeHoyQueNoEsLaEscritaQuedaPendiente(t *testing.T) {
	codigo, resp, _ := llamar(api(t, &repoFalso{}, hoy), "POST", "/api/v1/movimientos",
		`{"tipo":"ingreso","monto_centavos":5000000,"fecha":"2026-10-19","categoria_id":18,"medio":"efectivo","repeticion":{"periodicidad":"semanal"}}`)
	const quiere = `{"movimiento_id":"m-1","recurrente_id":"r-1","proximas":["2026-11-02","2026-11-09","2026-11-16"],"pendientes":["2026-10-26"]}`
	if codigo != 201 || resp != quiere {
		t.Fatalf("%d %s, se esperaba %s", codigo, resp, quiere)
	}
}

func TestSinRepeticionGuardaUnMovimiento(t *testing.T) {
	repo := &repoFalso{}
	codigo, resp, cabeceras := llamar(api(t, repo, hoy), "POST", "/api/v1/movimientos", cuerpo(`,"descripcion":"  mercado  "`))
	const quiere = `{"movimiento_id":"m-1","recurrente_id":null,"proximas":[],"pendientes":[]}`
	if codigo != 201 || resp != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s %v", codigo, resp, cabeceras)
	}
	g := repo.guardados[0]
	if g.Periodicidad != "" || !g.ConMovimiento || g.Descripcion == nil || *g.Descripcion != "mercado" {
		t.Errorf("guardado: %+v", g)
	}
	// Una descripción vacía no se guarda.
	llamar(api(t, repo, hoy), "POST", "/api/v1/movimientos", cuerpo(`,"descripcion":"   "`))
	if repo.guardados[1].Descripcion != nil {
		t.Errorf("la descripción vacía se guarda como nula: %+v", repo.guardados[1])
	}
}

func TestLaFechaDeHoyEsLaDeColombia(t *testing.T) {
	// 03:00 UTC del 27 son las 22:00 del 26 en Colombia.
	repo := &repoFalso{}
	h := api(t, repo, "2026-10-27T03:00:00Z")
	if codigo, resp, _ := llamar(h, "POST", "/api/v1/movimientos", cuerpo("")); codigo != 201 {
		t.Errorf("el 26 es hoy en Colombia: %d %s", codigo, resp)
	}
	manana := strings.Replace(cuerpo(""), "2026-10-26", "2026-10-27", 1)
	if codigo, resp, _ := llamar(h, "POST", "/api/v1/movimientos", manana); codigo != 422 || !strings.Contains(resp, `"fecha":"fecha_futura"`) {
		t.Errorf("el 27 todavía no llegó: %d %s", codigo, resp)
	}
	if len(repo.guardados) != 1 {
		t.Errorf("solo se guarda el del 26: %d", len(repo.guardados))
	}
}

func TestLosErroresDeValidacionDicenElCampoYElCodigo(t *testing.T) {
	grande := strings.Repeat("ñ", 281)
	casos := []struct{ nombre, cuerpo, campo, codigo string }{
		{"monto ausente", `{"tipo":"gasto","fecha":"2026-10-26","categoria_id":4,"medio":"efectivo"}`, "monto_centavos", "monto_requerido"},
		{"monto nulo", `{"tipo":"gasto","monto_centavos":null,"fecha":"2026-10-26","categoria_id":4,"medio":"efectivo"}`, "monto_centavos", "monto_requerido"},
		{"monto cero", strings.Replace(cuerpo(""), "65000000", "0", 1), "monto_centavos", "monto_no_positivo"},
		{"monto negativo", strings.Replace(cuerpo(""), "65000000", "-100", 1), "monto_centavos", "monto_no_positivo"},
		{"monto decimal", strings.Replace(cuerpo(""), "65000000", "12.5", 1), "monto_centavos", "monto_invalido"},
		{"monto en notación científica", strings.Replace(cuerpo(""), "65000000", "1e3", 1), "monto_centavos", "monto_invalido"},
		{"monto en texto", strings.Replace(cuerpo(""), "65000000", `"100"`, 1), "monto_centavos", "monto_invalido"},
		{"monto que no cabe en int64", strings.Replace(cuerpo(""), "65000000", "9223372036854775808", 1), "monto_centavos", "monto_invalido"},
		{"monto booleano", strings.Replace(cuerpo(""), "65000000", "true", 1), "monto_centavos", "monto_invalido"},
		{"tipo ausente", strings.Replace(cuerpo(""), `"tipo":"gasto",`, "", 1), "tipo", "tipo_requerido"},
		{"tipo desconocido", strings.Replace(cuerpo(""), `"gasto"`, `"aporte"`, 1), "tipo", "tipo_invalido"},
		{"fecha ausente", strings.Replace(cuerpo(""), `"fecha":"2026-10-26",`, "", 1), "fecha", "fecha_requerida"},
		{"fecha con otro formato", strings.Replace(cuerpo(""), "2026-10-26", "26/10/2026", 1), "fecha", "fecha_invalida"},
		{"fecha que no existe", strings.Replace(cuerpo(""), "2026-10-26", "2026-02-30", 1), "fecha", "fecha_invalida"},
		{"fecha con hora", strings.Replace(cuerpo(""), "2026-10-26", "2026-10-26T10:00:00Z", 1), "fecha", "fecha_invalida"},
		{"fecha de hace siglos", strings.Replace(cuerpo(""), "2026-10-26", "0001-01-01", 1), "fecha", "fecha_invalida"},
		{"fecha futura sin repetición", strings.Replace(cuerpo(""), "2026-10-26", "2026-10-27", 1), "fecha", "fecha_futura"},
		{"categoría ausente", strings.Replace(cuerpo(""), `"categoria_id":4,`, "", 1), "categoria_id", "categoria_requerida"},
		{"categoría cero", strings.Replace(cuerpo(""), `"categoria_id":4`, `"categoria_id":0`, 1), "categoria_id", "categoria_invalida"},
		{"categoría fuera de smallint", strings.Replace(cuerpo(""), `"categoria_id":4`, `"categoria_id":40000`, 1), "categoria_id", "categoria_invalida"},
		{"medio ausente", strings.Replace(cuerpo(""), `,"medio":"efectivo"`, "", 1), "medio", "medio_requerido"},
		{"tarjeta no se ofrece (D-164)", strings.Replace(cuerpo(""), `"efectivo"`, `"tarjeta"`, 1), "medio", "medio_invalido"},
		{"medio desconocido", strings.Replace(cuerpo(""), `"efectivo"`, `"cripto"`, 1), "medio", "medio_invalido"},
		{"descripción de 281 caracteres", cuerpo(`,"descripcion":"` + grande + `"`), "descripcion", "descripcion_larga"},
		{"periodicidad ausente", cuerpo(`,"repeticion":{}`), "repeticion", "periodicidad_requerida"},
		{"periodicidad desconocida", cuerpo(`,"repeticion":{"periodicidad":"diaria"}`), "repeticion", "periodicidad_invalida"},
		{"periodicidad con otra capitalización", cuerpo(`,"repeticion":{"periodicidad":"Mensual"}`), "repeticion", "periodicidad_invalida"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			repo := &repoFalso{}
			codigo, resp, _ := llamar(api(t, repo, hoy), "POST", "/api/v1/movimientos", c.cuerpo)
			quiere := `{"campos":{"` + c.campo + `":"` + c.codigo + `"},"error":"datos_invalidos"}`
			if c.campo == "monto_centavos" && c.codigo == "monto_invalido" && strings.Contains(resp, "solicitud_invalida") {
				t.Fatalf("un monto mal escrito es un 422 del campo, no un 400: %d %s", codigo, resp)
			}
			if codigo != 422 || resp != quiere {
				t.Errorf("%d %s, se esperaba 422 %s", codigo, resp, quiere)
			}
			if len(repo.guardados) != 0 {
				t.Errorf("un error no guarda nada: %+v", repo.guardados)
			}
		})
	}
}

func TestLosErroresSeMuestranTodosALaVez(t *testing.T) {
	codigo, resp, _ := llamar(api(t, &repoFalso{}, hoy), "POST", "/api/v1/movimientos", `{"monto_centavos":0,"medio":"tarjeta"}`)
	const quiere = `{"campos":{"categoria_id":"categoria_requerida","fecha":"fecha_requerida","medio":"medio_invalido","monto_centavos":"monto_no_positivo","tipo":"tipo_requerido"},"error":"datos_invalidos"}`
	if codigo != 422 || resp != quiere {
		t.Errorf("%d %s, se esperaba %s", codigo, resp, quiere)
	}
}

func TestLosLimitesDeLosCamposSonValidos(t *testing.T) {
	repo := &repoFalso{}
	h := api(t, repo, hoy)
	exacto := strings.Repeat("ñ", 280) // 280 caracteres (560 bytes): el largo se cuenta en caracteres, como en la base
	for _, c := range []string{
		strings.Replace(cuerpo(`,"descripcion":"`+exacto+`"`), "65000000", "9223372036854775807", 1),
		strings.Replace(cuerpo(""), "65000000", "1", 1),
		strings.Replace(cuerpo(""), `"categoria_id":4`, `"categoria_id":32767`, 1),
	} {
		if codigo, resp, _ := llamar(h, "POST", "/api/v1/movimientos", c); codigo != 201 {
			t.Errorf("%d %s", codigo, resp)
		}
	}
	if repo.guardados[0].Monto != 9223372036854775807 || repo.guardados[1].Monto != 1 {
		t.Errorf("montos: %d, %d", repo.guardados[0].Monto, repo.guardados[1].Monto)
	}
}

// Los centavos pasan enteros de punta a punta: sin pasar por float64 (EXA-001, D-082).
func TestLosCentavosNoPierdenExactitud(t *testing.T) {
	repo := &repoFalso{}
	h := api(t, repo, hoy)
	// 2^53 + 1 no cabe en un float64: si el monto pasara por uno, volvería como 9007199254740992.
	for _, monto := range []string{"12345678901", "9007199254740993", "9223372036854775807"} {
		if codigo, resp, _ := llamar(h, "POST", "/api/v1/movimientos", strings.Replace(cuerpo(""), "65000000", monto, 1)); codigo != 201 {
			t.Fatalf("%s: %d %s", monto, codigo, resp)
		}
	}
	for i, quiere := range []int64{12345678901, 9007199254740993, 9223372036854775807} {
		if repo.guardados[i].Monto != quiere {
			t.Errorf("monto %d: %d, se esperaba %d", i, repo.guardados[i].Monto, quiere)
		}
	}
}

// La dueña de la fila es siempre la persona de la sesión: el cuerpo no puede traer otra (ni el hogar).
func TestElCuerpoNoPuedeTraerOtraPersonaNiHogar(t *testing.T) {
	repo := &repoFalso{}
	h := api(t, repo, hoy)
	for _, extra := range []string{`,"persona_id":"0192f3c4-0000-7000-8000-0000000000bb"`, `,"hogar_id":"0192f3c4-0000-7000-8000-0000000000cc"`, `,"id":"x"`} {
		if codigo, resp, _ := llamar(h, "POST", "/api/v1/movimientos", cuerpo(extra)); codigo != 400 || resp != `{"error":"solicitud_invalida"}` {
			t.Errorf("%s: %d %s", extra, codigo, resp)
		}
	}
	if len(repo.guardados) != 0 {
		t.Errorf("no se guarda nada: %+v", repo.guardados)
	}
	llamar(h, "POST", "/api/v1/movimientos", cuerpo(""))
	if repo.guardados[0].Persona != persona {
		t.Errorf("la persona es la de la sesión: %s", repo.guardados[0].Persona)
	}
}

func TestCuerpoQueNoEsJSONDa400(t *testing.T) {
	for _, c := range []string{"", "no es json", `{"tipo":5}`, `{"categoria_id":"4"}`, `{"categoria_id":4.5}`, cuerpo("") + cuerpo("")} {
		if codigo, resp, _ := llamar(api(t, &repoFalso{}, hoy), "POST", "/api/v1/movimientos", c); codigo != 400 || resp != `{"error":"solicitud_invalida"}` {
			t.Errorf("%q: %d %s", c, codigo, resp)
		}
	}
}

func TestUnaCategoriaDelOtroTipoEsUn422(t *testing.T) {
	repo := &repoFalso{error: registro.ErrCategoriaInvalida}
	codigo, resp, _ := llamar(api(t, repo, hoy), "POST", "/api/v1/movimientos", cuerpo(""))
	if codigo != 422 || resp != `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestUnFalloDeLaBaseEsUn500SinDetalles(t *testing.T) {
	repo := &repoFalso{error: errors.New("conexión caída: secreto")}
	for _, c := range [][3]string{{"POST", "/api/v1/movimientos", cuerpo("")}, {"GET", "/api/v1/categorias", ""}} {
		codigo, resp, _ := llamar(api(t, repo, hoy), c[0], c[1], c[2])
		if codigo != 500 || resp != `{"error":"error_interno"}` {
			t.Errorf("%s: %d %s", c[1], codigo, resp)
		}
	}
}

func TestCategoriasPorTipo(t *testing.T) {
	repo := &repoFalso{categorias: []registro.Categoria{
		{ID: 1, Nombre: "Alimentación", Tipo: "gasto"},
		{ID: 16, Nombre: "Otros gastos", Tipo: "gasto", General: true},
		{ID: 17, Nombre: "Salario", Tipo: "ingreso"},
	}}
	codigo, resp, cabeceras := llamar(api(t, repo, hoy), "GET", "/api/v1/categorias", "")
	const quiere = `{"gasto":[{"id":1,"nombre":"Alimentación","general":false},{"id":16,"nombre":"Otros gastos","general":true}],"ingreso":[{"id":17,"nombre":"Salario","general":false}]}`
	if codigo != 200 || resp != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Errorf("%d %s %v", codigo, resp, cabeceras)
	}
	// Sin categorías, listas vacías y no nulas.
	if _, resp, _ := llamar(api(t, &repoFalso{}, hoy), "GET", "/api/v1/categorias", ""); resp != `{"gasto":[],"ingreso":[]}` {
		t.Errorf("vacío: %s", resp)
	}
}
