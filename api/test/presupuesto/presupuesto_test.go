package presupuesto_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
	"github.com/alcanzamos/alcanzamos/api/test/servidor/csrftest"
)

const (
	persona     = "0192f3c4-0000-7000-8000-0000000000aa"
	urlPublica  = "https://app.ej.test"
	recSalario  = "0192f3c4-0000-7000-8000-0000000000a1"
	recVentas   = "0192f3c4-0000-7000-8000-0000000000a2"
	recArriendo = "0192f3c4-0000-7000-8000-0000000000a3"

	// El 2 de noviembre de 2026 a las 10:00 en Colombia: la fecha de referencia de E14-PPA 2.1.
	dosDeNoviembre = "2026-11-02T15:00:00Z"
)

// Categorías del catálogo de E09 que usan las pruebas.
const (
	alimentacion = 1
	arriendo     = 4
	servicios    = 5
	hogar        = 6
	transporte   = 8
	recreacion   = 11
	educacion    = 12
	restaurantes = 13
	salario      = 17
	ventas       = 18
	ayudas       = 20
)

// catalogo es el de 0002_catalogo.sql, con las ocultas que se pidan.
func catalogo(ocultas ...int) []presupuesto.CategoriaDelCatalogo {
	nombres := []string{"Alimentación", "Bebidas alcohólicas y tabaco", "Ropa y calzado", "Arriendo o cuota de vivienda", "Servicios públicos",
		"Hogar y mantenimiento", "Salud", "Transporte", "Comunicaciones", "Suscripciones", "Recreación y cultura", "Educación",
		"Restaurantes y hoteles", "Pagos de deudas", "Mesada", "Otros gastos", "Salario", "Trabajo independiente o ventas",
		"Remesas o giros familiares", "Ayudas y subsidios", "Mesada", "Prima de servicios", "Intereses de cesantías",
		"Retiro de cesantías", "Otros ingresos", "Ayuda a la familia"}
	lista := make([]presupuesto.CategoriaDelCatalogo, len(nombres))
	for i, n := range nombres {
		id := i + 1
		tipo := registro.Gasto
		if id >= salario && id <= 25 {
			tipo = registro.Ingreso
		}
		c := presupuesto.CategoriaDelCatalogo{ID: id, Nombre: n, Tipo: tipo}
		for _, o := range ocultas {
			c.Oculta = c.Oculta || o == id
		}
		lista[i] = c
	}
	return lista
}

// repoFalso devuelve lo que la prueba pone y anota lo que el servicio le pide.
type repoFalso struct {
	presupuesto presupuesto.DatosDelPresupuesto
	ingresos    presupuesto.DatosDeIngresos
	error       error
	meses       []string // el periodo de cada lectura, AAAA-MM
}

func (r *repoFalso) Presupuesto(_ context.Context, p string, mes time.Time) (presupuesto.DatosDelPresupuesto, error) {
	if p != persona {
		return presupuesto.DatosDelPresupuesto{}, errors.New("persona equivocada")
	}
	r.meses = append(r.meses, mes.Format("2006-01"))
	return r.presupuesto, r.error
}

func (r *repoFalso) Ingresos(_ context.Context, p string, mes time.Time) (presupuesto.DatosDeIngresos, error) {
	if p != persona {
		return presupuesto.DatosDeIngresos{}, errors.New("persona equivocada")
	}
	r.meses = append(r.meses, mes.Format("2006-01"))
	return r.ingresos, r.error
}

type sesionFalsa struct{}

func (sesionFalsa) SujetoDe(*http.Request) (seguridad.Sujeto, error) {
	return seguridad.Sujeto{Persona: persona, Verificada: true, Autorizada: true}, nil
}

// api arma el enrutador real con las rutas del presupuesto, la sesión de una persona autorizada y la hora dada.
func api(t *testing.T, repo presupuesto.Repositorio, ahora string) http.Handler {
	t.Helper()
	hora, err := time.Parse(time.RFC3339, ahora)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	e := servidor.NuevoEnrutador(sesionFalsa{}, seguridad.NuevoRegistro(log), log).ConURLPublica(urlPublica)
	presupuesto.NuevoHandler(presupuesto.NuevoServicio(repo, &relojtest.Fijo{T: hora}), log).Registrar(e)
	h, err := e.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(h)
}

func llamar(h http.Handler, metodo, ruta, cuerpo string) (int, string, http.Header) {
	rr := httptest.NewRecorder()
	csrftest.ConCabeceras(h).ServeHTTP(rr, httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo)))
	return rr.Code, strings.TrimSpace(rr.Body.String()), rr.Header()
}

func dia(texto string) time.Time {
	f, err := time.Parse(time.DateOnly, texto)
	if err != nil {
		panic(err)
	}
	return f
}

func grande(texto string) *big.Int {
	n, ok := new(big.Int).SetString(texto, 10)
	if !ok {
		panic(texto)
	}
	return n
}

func texto(s string) *string { return &s }

// salarioQuincenal es el salario de Laura (E14-PPA 2.1): quincenal de $1.200.000 desde el 1 de noviembre de 2026, con el
// 1 ya confirmado; el 16 está esperado.
func salarioQuincenal() registro.Recurrente {
	return registro.Recurrente{ID: recSalario, Tipo: registro.Ingreso, CategoriaID: salario, Medio: "transferencia", Periodicidad: fechas.Quincenal,
		Monto: 120000000, Inicio: dia("2026-11-01"), CreadoEl: dia("2026-11-01"), Confirmadas: []time.Time{dia("2026-11-01")}}
}

// arriendoMensual es un gasto recurrente: nunca es un ingreso que llega después.
func arriendoMensual() registro.Recurrente {
	return registro.Recurrente{ID: recArriendo, Tipo: registro.Gasto, CategoriaID: arriendo, Medio: "transferencia", Periodicidad: fechas.Mensual,
		Monto: 65000000, Inicio: dia("2026-10-01"), CreadoEl: dia("2026-10-01")}
}

// noviembreDeLaura es E14-PPA 2.2: $1.200.000 registrados el 1, el 16 esperado, Transporte con $40.000 de presupuesto y
// los gastos de E14-PPN 9.2.
func noviembreDeLaura() presupuesto.DatosDelPresupuesto {
	return presupuesto.DatosDelPresupuesto{
		Adulta:       true,
		Categorias:   catalogo(),
		Presupuestos: []presupuesto.Guardado{{ID: "p-transporte", CategoriaID: transporte, Periodo: dia("2026-11-01"), Monto: 4000000}},
		Gastado: map[int]*big.Int{transporte: big.NewInt(4000000), arriendo: big.NewInt(65000000), alimentacion: big.NewInt(12000000),
			restaurantes: big.NewInt(2500000), recreacion: big.NewInt(1500000)},
		Ingresos:    []presupuesto.IngresoRegistrado{{MovimientoID: "m-1", CategoriaID: salario, Monto: 120000000, Fecha: dia("2026-11-01"), Medio: "transferencia"}},
		Recurrentes: []registro.Recurrente{salarioQuincenal(), arriendoMensual()},
	}
}

func verPresupuesto(t *testing.T, repo *repoFalso, ahora, consulta string) string {
	t.Helper()
	codigo, cuerpo, cabeceras := llamar(api(t, repo, ahora), "GET", "/api/v1/presupuestos"+consulta, "")
	if codigo != 200 || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s %v", codigo, cuerpo, cabeceras)
	}
	return cuerpo
}

// E14-PPA 2.2 y caso F: «Sin asignar $1.160.000», «Llega después: $1.200.000 (esperado)», Transporte primero (tiene
// presupuesto, «Ya usaste todo lo presupuestado.») y las demás de mayor a menor gasto.
func TestPN06NoviembreDeLauraConSinAsignarYLlegaDespues(t *testing.T) {
	repo := &repoFalso{presupuesto: noviembreDeLaura()}
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-11","editable":true,` +
		`"resumen":{"modo":"normal","ingreso_registrado_centavos":120000000,"asignado_centavos":4000000,"sin_asignar_centavos":116000000,` +
		`"asignado_supera_por_centavos":null,"llega_despues_centavos":120000000},` +
		`"llega_despues":[{"recurrente_id":"` + recSalario + `","fecha":"2026-11-16","categoria_id":17,"monto_centavos":120000000,"marca":"esperado"}],` +
		`"categorias":[` +
		`{"categoria_id":8,"nombre":"Transporte","oculta":false,"presupuesto":{"id":"p-transporte","monto_centavos":4000000},"gastado_centavos":4000000,"estado":"usado_todo","quedan_centavos":null},` +
		`{"categoria_id":4,"nombre":"Arriendo o cuota de vivienda","oculta":false,"presupuesto":null,"gastado_centavos":65000000,"estado":null,"quedan_centavos":null},` +
		`{"categoria_id":1,"nombre":"Alimentación","oculta":false,"presupuesto":null,"gastado_centavos":12000000,"estado":null,"quedan_centavos":null},` +
		`{"categoria_id":13,"nombre":"Restaurantes y hoteles","oculta":false,"presupuesto":null,"gastado_centavos":2500000,"estado":null,"quedan_centavos":null},` +
		`{"categoria_id":11,"nombre":"Recreación y cultura","oculta":false,"presupuesto":null,"gastado_centavos":1500000,"estado":null,"quedan_centavos":null}]}`
	if got := verPresupuesto(t, repo, dosDeNoviembre, ""); got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
	if len(repo.meses) != 1 || repo.meses[0] != "2026-11" {
		t.Errorf("periodo pedido: %v", repo.meses)
	}
}

// RNF-002: las sumas son exactas al centavo, también cuando no caben en int64.
func TestPN06LasSumasSonExactasAlCentavoSinDesbordar(t *testing.T) {
	d := presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo(),
		Ingresos: []presupuesto.IngresoRegistrado{
			{MovimientoID: "m-1", CategoriaID: salario, Monto: 100000001, Fecha: dia("2026-11-01"), Medio: "efectivo"},
			{MovimientoID: "m-2", CategoriaID: ventas, Monto: 99999999, Fecha: dia("2026-11-02"), Medio: "efectivo"},
			{MovimientoID: "m-3", CategoriaID: ventas, Monto: 33, Fecha: dia("2026-11-02"), Medio: "efectivo"}},
		Presupuestos: []presupuesto.Guardado{
			{ID: "p-1", CategoriaID: alimentacion, Monto: 12345}, {ID: "p-2", CategoriaID: transporte, Monto: 67}}}
	got := verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, "")
	if !strings.Contains(got, `"ingreso_registrado_centavos":200000033,"asignado_centavos":12412,"sin_asignar_centavos":199987621,`) {
		t.Errorf("sumas: %s", got)
	}

	// Dos ingresos del máximo de int64 y un presupuesto de un centavo.
	d.Ingresos = []presupuesto.IngresoRegistrado{
		{MovimientoID: "m-1", CategoriaID: salario, Monto: 1<<63 - 1, Fecha: dia("2026-11-01"), Medio: "efectivo"},
		{MovimientoID: "m-2", CategoriaID: salario, Monto: 1<<63 - 1, Fecha: dia("2026-11-01"), Medio: "efectivo"}}
	d.Presupuestos = []presupuesto.Guardado{{ID: "p-1", CategoriaID: alimentacion, Monto: 1}}
	d.Gastado = map[int]*big.Int{alimentacion: grande("18446744073709551614")}
	got = verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, "")
	if !strings.Contains(got, `"ingreso_registrado_centavos":18446744073709551614,"asignado_centavos":1,"sin_asignar_centavos":18446744073709551613,`) ||
		!strings.Contains(got, `"gastado_centavos":18446744073709551614,"estado":"superado","quedan_centavos":null`) {
		t.Errorf("sumas grandes: %s", got)
	}
}

// Un mes vacío: ingreso nulo (PN-07), todo en cero, sin «Sin asignar» ni filas, y sin nada que llegue después.
func TestPN07MesVacioEsIngresoNuloSinSinAsignar(t *testing.T) {
	repo := &repoFalso{presupuesto: presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo()}}
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-11","editable":true,` +
		`"resumen":{"modo":"ingreso_nulo","ingreso_registrado_centavos":0,"asignado_centavos":0,"sin_asignar_centavos":null,` +
		`"asignado_supera_por_centavos":null,"llega_despues_centavos":0},"llega_despues":[],"categorias":[]}`
	if got := verPresupuesto(t, repo, dosDeNoviembre, ""); got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
}

// Caso P bajo (E14-PPA 2.3): $150.000 registrados y $160.000 asignados. Lo asignado supera lo registrado por $10.000; no
// hay «Sin asignar». Sin gasto, cada presupuesto «queda» entero; con el mismo gasto, por nombre.
func TestPN07IngresoBajoDaLoQueSuperaLoAsignado(t *testing.T) {
	d := presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo(),
		Ingresos: []presupuesto.IngresoRegistrado{{MovimientoID: "m-1", CategoriaID: ventas, Monto: 15000000, Fecha: dia("2026-11-02"), Medio: "efectivo"}},
		Presupuestos: []presupuesto.Guardado{
			{ID: "p-transporte", CategoriaID: transporte, Monto: 6000000}, {ID: "p-alimentacion", CategoriaID: alimentacion, Monto: 10000000}}}
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-11","editable":true,` +
		`"resumen":{"modo":"ingreso_bajo","ingreso_registrado_centavos":15000000,"asignado_centavos":16000000,"sin_asignar_centavos":null,` +
		`"asignado_supera_por_centavos":1000000,"llega_despues_centavos":0},"llega_despues":[],"categorias":[` +
		`{"categoria_id":1,"nombre":"Alimentación","oculta":false,"presupuesto":{"id":"p-alimentacion","monto_centavos":10000000},"gastado_centavos":0,"estado":"quedan","quedan_centavos":10000000},` +
		`{"categoria_id":8,"nombre":"Transporte","oculta":false,"presupuesto":{"id":"p-transporte","monto_centavos":6000000},"gastado_centavos":0,"estado":"quedan","quedan_centavos":6000000}]}`
	if got := verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, ""); got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
}

// D-094, P-3: el modo depende solo de lo registrado y lo asignado.
func TestElModoSigueDP3(t *testing.T) {
	casos := []struct {
		nombre            string
		ingreso, asignado int64
		modo, sin, supera string
	}{
		{"ingreso cero y nada asignado", 0, 0, "ingreso_nulo", "null", "null"},
		{"ingreso cero con algo asignado: sin diferencia", 0, 500, "ingreso_nulo", "null", "null"},
		{"lo asignado igual a lo registrado", 500, 500, "normal", "0", "null"},
		{"lo asignado por debajo", 501, 500, "normal", "1", "null"},
		{"lo asignado supera por un centavo", 500, 501, "ingreso_bajo", "null", "1"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			d := presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo()}
			if c.ingreso > 0 {
				d.Ingresos = []presupuesto.IngresoRegistrado{{MovimientoID: "m-1", CategoriaID: salario, Monto: c.ingreso, Fecha: dia("2026-11-01"), Medio: "efectivo"}}
			}
			if c.asignado > 0 {
				d.Presupuestos = []presupuesto.Guardado{{ID: "p-1", CategoriaID: alimentacion, Monto: c.asignado}}
			}
			got := verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, "")
			if !strings.Contains(got, `"modo":"`+c.modo+`"`) || !strings.Contains(got, `"sin_asignar_centavos":`+c.sin+`,`) ||
				!strings.Contains(got, `"asignado_supera_por_centavos":`+c.supera+`,`) {
				t.Errorf("%s", got)
			}
		})
	}
}

// E14-PPA 4.1, estados: Alimentación $300.000 con $120.000 gastados (quedan $180.000), Transporte $40.000 con $40.000 y
// Restaurantes $100.000 con $120.000 (superado). Con presupuesto, también de mayor a menor gasto.
func TestPN06EstadosDeUnaCategoriaConPresupuesto(t *testing.T) {
	d := presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo(),
		Ingresos: []presupuesto.IngresoRegistrado{{MovimientoID: "m-1", CategoriaID: salario, Monto: 120000000, Fecha: dia("2026-11-01"), Medio: "efectivo"}},
		Presupuestos: []presupuesto.Guardado{{ID: "p-a", CategoriaID: alimentacion, Monto: 30000000}, {ID: "p-t", CategoriaID: transporte, Monto: 4000000},
			{ID: "p-r", CategoriaID: restaurantes, Monto: 10000000}},
		Gastado: map[int]*big.Int{alimentacion: big.NewInt(12000000), transporte: big.NewInt(4000000), restaurantes: big.NewInt(12000001)}}
	got := verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, "")
	const filas = `"categorias":[` +
		`{"categoria_id":13,"nombre":"Restaurantes y hoteles","oculta":false,"presupuesto":{"id":"p-r","monto_centavos":10000000},"gastado_centavos":12000001,"estado":"superado","quedan_centavos":null},` +
		`{"categoria_id":1,"nombre":"Alimentación","oculta":false,"presupuesto":{"id":"p-a","monto_centavos":30000000},"gastado_centavos":12000000,"estado":"quedan","quedan_centavos":18000000},` +
		`{"categoria_id":8,"nombre":"Transporte","oculta":false,"presupuesto":{"id":"p-t","monto_centavos":4000000},"gastado_centavos":4000000,"estado":"usado_todo","quedan_centavos":null}]}`
	if !strings.HasSuffix(got, filas) {
		t.Errorf("filas\n%s\nse esperaba que terminara en\n%s", got, filas)
	}
}

// RN-011, CU-55 2c: una categoría oculta con presupuesto sigue en la lista, marcada; una oculta sin presupuesto, aunque
// tenga gasto, no aparece (la persona dejó de verla).
func TestPN06LaCategoriaOcultaConPresupuestoSigueYLaOcultaSinPresupuestoNo(t *testing.T) {
	d := presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo(transporte, recreacion),
		Presupuestos: []presupuesto.Guardado{{ID: "p-t", CategoriaID: transporte, Monto: 4000000}},
		Gastado:      map[int]*big.Int{transporte: big.NewInt(1000000), recreacion: big.NewInt(1500000), alimentacion: big.NewInt(100)}}
	got := verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, "")
	const filas = `"categorias":[` +
		`{"categoria_id":8,"nombre":"Transporte","oculta":true,"presupuesto":{"id":"p-t","monto_centavos":4000000},"gastado_centavos":1000000,"estado":"quedan","quedan_centavos":3000000},` +
		`{"categoria_id":1,"nombre":"Alimentación","oculta":false,"presupuesto":null,"gastado_centavos":100,"estado":null,"quedan_centavos":null}]}`
	if !strings.HasSuffix(got, filas) {
		t.Errorf("filas\n%s\nse esperaba que terminara en\n%s", got, filas)
	}
}

// idsDeLasFilas son los `categoria_id` de «Por categoría», en el orden de la respuesta.
func idsDeLasFilas(t *testing.T, cuerpo string) []int {
	t.Helper()
	var v struct {
		Categorias []struct {
			CategoriaID int `json:"categoria_id"`
		} `json:"categorias"`
	}
	if err := json.Unmarshal([]byte(cuerpo), &v); err != nil {
		t.Fatal(err)
	}
	ids := make([]int, len(v.Categorias))
	for i, c := range v.Categorias {
		ids[i] = c.CategoriaID
	}
	return ids
}

// E14-PPA 4.1, PN-06 fila 4, y L6 (6) de la US-77: con el mismo gasto, por nombre y no por id. Con presupuesto y sin
// gasto, Educación (12) va antes que Transporte (8); sin presupuesto y con el mismo gasto, Hogar y mantenimiento (6) va
// antes que Servicios públicos (5). Las que tienen presupuesto siguen primero.
func TestPN06ConElMismoGastoOrdenaPorNombre(t *testing.T) {
	d := presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo(),
		Presupuestos: []presupuesto.Guardado{{ID: "p-t", CategoriaID: transporte, Monto: 100}, {ID: "p-e", CategoriaID: educacion, Monto: 100}},
		Gastado:      map[int]*big.Int{servicios: big.NewInt(500), hogar: big.NewInt(500)}}
	got := idsDeLasFilas(t, verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, ""))
	if quiere := []int{educacion, transporte, hogar, servicios}; !slices.Equal(got, quiere) {
		t.Errorf("orden %v, se esperaba %v", got, quiere)
	}
}

// El nombre se compara con la intercalación del español de Unicode (CLDR, golang.org/x/text/collate), no por bytes: la
// tilde y la mayúscula no mandan a una categoría al final, la «ñ» va entre la «n» y la «o», sin tilde va antes que con
// tilde, y dos nombres iguales quedan por id. Por bytes saldría Arbol, Bebida, Igual, Igual, Nube, Oso, abeja, Árbol,
// Ñame, Óleo; por id, del 1 al 10.
func TestPN06ElNombreSeComparaComoEnEspanol(t *testing.T) {
	nombres := []string{"Óleo", "Ñame", "Nube", "Árbol", "Bebida", "Oso", "Igual", "Igual", "Arbol", "abeja"}
	d := presupuesto.DatosDelPresupuesto{Adulta: true, Gastado: map[int]*big.Int{}}
	for i, n := range nombres {
		d.Categorias = append(d.Categorias, presupuesto.CategoriaDelCatalogo{ID: i + 1, Nombre: n, Tipo: registro.Gasto})
		d.Gastado[i+1] = big.NewInt(700)
	}
	got := idsDeLasFilas(t, verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, ""))
	if quiere := []int{10, 9, 4, 5, 7, 8, 3, 2, 1, 6}; !slices.Equal(got, quiere) {
		t.Errorf("orden %v, se esperaba %v", got, quiere)
	}
}

// Un mes pasado no se edita (D-094) y su fecha pendiente que ya llegó está por confirmar; una fecha omitida («No pasó»,
// D-092) y una repetición detenida no llegan después; un gasto recurrente tampoco.
func TestPN06MesPasadoNoEditableConLoPorConfirmarYSinLoOmitido(t *testing.T) {
	detenida := dia("2026-10-20")
	d := presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo(), Recurrentes: []registro.Recurrente{
		{ID: recSalario, Tipo: registro.Ingreso, CategoriaID: salario, Medio: "transferencia", Periodicidad: fechas.Quincenal, Monto: 120000000,
			Inicio: dia("2026-10-01"), CreadoEl: dia("2026-10-01"), Confirmadas: []time.Time{dia("2026-10-01")}, Omitidas: nil},
		{ID: recVentas, Tipo: registro.Ingreso, CategoriaID: ventas, Medio: "efectivo", Periodicidad: fechas.Semanal, Monto: 2000000,
			Inicio: dia("2026-10-06"), CreadoEl: dia("2026-10-06"), Confirmadas: []time.Time{dia("2026-10-06")}, Omitidas: []time.Time{dia("2026-10-13")}, DetenidoEn: &detenida},
		arriendoMensual()}}
	got := verPresupuesto(t, &repoFalso{presupuesto: d}, dosDeNoviembre, "?periodo=2026-10")
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-10","editable":false,` +
		`"resumen":{"modo":"ingreso_nulo","ingreso_registrado_centavos":0,"asignado_centavos":0,"sin_asignar_centavos":null,` +
		`"asignado_supera_por_centavos":null,"llega_despues_centavos":120000000},` +
		`"llega_despues":[{"recurrente_id":"` + recSalario + `","fecha":"2026-10-16","categoria_id":17,"monto_centavos":120000000,"marca":"por_confirmar"}],"categorias":[]}`
	if got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
}

// Sin `periodo` es el mes de hoy en Colombia, no el del servidor: el 1 de diciembre a las 03:00 UTC aún es 30 de noviembre.
func TestElPeriodoPorDefectoEsElMesDeColombia(t *testing.T) {
	repo := &repoFalso{presupuesto: presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo()}}
	got := verPresupuesto(t, repo, "2026-12-01T03:00:00Z", "")
	if !strings.HasPrefix(got, `{"periodo_actual":"2026-11","periodo":"2026-11","editable":true,`) || repo.meses[0] != "2026-11" {
		t.Errorf("%s %v", got, repo.meses)
	}
	got = verPresupuesto(t, repo, "2026-12-01T05:00:00Z", "?periodo=2026-11")
	if !strings.HasPrefix(got, `{"periodo_actual":"2026-12","periodo":"2026-11","editable":false,`) {
		t.Errorf("%s", got)
	}
}

// Los errores de la lectura: periodo inválido (422, sin leer), una persona menor (403), la cuenta borrada (401) y un fallo.
func TestErroresDeLasLecturas(t *testing.T) {
	for _, ruta := range []string{"/api/v1/presupuestos", "/api/v1/ingresos"} {
		for _, periodo := range []string{"2026-13", "2026-1", "1899-12", "noviembre", "2026-11-01"} {
			repo := &repoFalso{}
			codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "GET", ruta+"?periodo="+periodo, "")
			if codigo != 422 || cuerpo != `{"campos":{"periodo":"periodo_invalido"},"error":"datos_invalidos"}` || len(repo.meses) != 0 {
				t.Errorf("%s %s: %d %s %v", ruta, periodo, codigo, cuerpo, repo.meses)
			}
		}
		codigo, cuerpo, _ := llamar(api(t, &repoFalso{error: registro.ErrSinCuenta}, dosDeNoviembre), "GET", ruta, "")
		if codigo != 401 || cuerpo != `{"error":"sin_sesion"}` {
			t.Errorf("%s sin cuenta: %d %s", ruta, codigo, cuerpo)
		}
		codigo, cuerpo, _ = llamar(api(t, &repoFalso{error: errors.New("la base se cayó")}, dosDeNoviembre), "GET", ruta, "")
		if codigo != 500 || cuerpo != `{"error":"error_interno"}` {
			t.Errorf("%s fallo: %d %s", ruta, codigo, cuerpo)
		}
	}
	codigo, cuerpo, _ := llamar(api(t, &repoFalso{presupuesto: presupuesto.DatosDelPresupuesto{Adulta: false, Categorias: catalogo()}}, dosDeNoviembre), "GET", "/api/v1/presupuestos", "")
	if codigo != 403 || cuerpo != `{"error":"solo_personas_adultas"}` {
		t.Errorf("menor: %d %s", codigo, cuerpo)
	}
	// Una categoría de ingreso con gasto o una categoría que no está en el catálogo son datos incoherentes: 500.
	for _, gastado := range []map[int]*big.Int{{salario: big.NewInt(1)}, {99: big.NewInt(1)}} {
		repo := &repoFalso{presupuesto: presupuesto.DatosDelPresupuesto{Adulta: true, Categorias: catalogo(), Gastado: gastado}}
		if codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "GET", "/api/v1/presupuestos", ""); codigo != 500 {
			t.Errorf("datos incoherentes: %d %s", codigo, cuerpo)
		}
	}
}

// --- PN-08 ---

func verIngresos(t *testing.T, repo *repoFalso, ahora, consulta string) string {
	t.Helper()
	codigo, cuerpo, cabeceras := llamar(api(t, repo, ahora), "GET", "/api/v1/ingresos"+consulta, "")
	if codigo != 200 || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s %v", codigo, cuerpo, cabeceras)
	}
	return cuerpo
}

// E14-PPA 2.4, Laura en noviembre: «Entran este mes $2.400.000», «Ya registrado $1.200.000» y «Esperado $1.200.000», con
// una fuente, Salario, que trae el 1 registrado y el 16 esperado (el 2 de noviembre todavía no llega).
func TestPN08NoviembreDeLauraRegistradoYEsperado(t *testing.T) {
	repo := &repoFalso{ingresos: presupuesto.DatosDeIngresos{Categorias: catalogo(), Meses: []string{"2026-11", "2026-10"},
		Ingresos:    []presupuesto.IngresoRegistrado{{MovimientoID: "m-1", CategoriaID: salario, Monto: 120000000, Fecha: dia("2026-11-01"), Medio: "transferencia"}},
		Recurrentes: []registro.Recurrente{salarioQuincenal(), arriendoMensual()}}}
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-11","meses":["2026-11","2026-10"],` +
		`"total":{"entran_centavos":240000000,"registrado_centavos":120000000,"esperado_centavos":120000000,"por_confirmar":0},` +
		`"fuentes":[{"categoria_id":17,"nombre":"Salario","oculta":false,"total_centavos":240000000,"ingresos":[` +
		`{"fecha":"2026-11-01","marca":"registrado","monto_centavos":120000000,"medio":"transferencia","descripcion":null,"movimiento_id":"m-1","recurrente_id":null},` +
		`{"fecha":"2026-11-16","marca":"esperado","monto_centavos":120000000,"medio":"transferencia","descripcion":null,"movimiento_id":null,"recurrente_id":"` + recSalario + `"}]}]}`
	if got := verIngresos(t, repo, dosDeNoviembre, ""); got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
}

// E14-PPA 2.4, caso P en octubre: tres ingresos de dos fuentes, de mayor a menor total; «Entraron este mes $550.000».
func TestPN08CasoPOctubreVariasFuentes(t *testing.T) {
	venta := texto("Venta de artesanías")
	repo := &repoFalso{ingresos: presupuesto.DatosDeIngresos{Categorias: catalogo(), Meses: []string{"2026-10"},
		Ingresos: []presupuesto.IngresoRegistrado{
			{MovimientoID: "m-1", CategoriaID: ventas, Monto: 30000000, Fecha: dia("2026-10-03"), Medio: "efectivo", Descripcion: venta},
			{MovimientoID: "m-2", CategoriaID: ayudas, Monto: 16000000, Fecha: dia("2026-10-15"), Medio: "transferencia", Descripcion: texto("Subsidio")},
			{MovimientoID: "m-3", CategoriaID: ventas, Monto: 9000000, Fecha: dia("2026-10-28"), Medio: "efectivo", Descripcion: venta}}}}
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-10","meses":["2026-10"],` +
		`"total":{"entran_centavos":55000000,"registrado_centavos":55000000,"esperado_centavos":0,"por_confirmar":0},"fuentes":[` +
		`{"categoria_id":18,"nombre":"Trabajo independiente o ventas","oculta":false,"total_centavos":39000000,"ingresos":[` +
		`{"fecha":"2026-10-03","marca":"registrado","monto_centavos":30000000,"medio":"efectivo","descripcion":"Venta de artesanías","movimiento_id":"m-1","recurrente_id":null},` +
		`{"fecha":"2026-10-28","marca":"registrado","monto_centavos":9000000,"medio":"efectivo","descripcion":"Venta de artesanías","movimiento_id":"m-3","recurrente_id":null}]},` +
		`{"categoria_id":20,"nombre":"Ayudas y subsidios","oculta":false,"total_centavos":16000000,"ingresos":[` +
		`{"fecha":"2026-10-15","marca":"registrado","monto_centavos":16000000,"medio":"transferencia","descripcion":"Subsidio","movimiento_id":"m-2","recurrente_id":null}]}]}`
	if got := verIngresos(t, repo, dosDeNoviembre, "?periodo=2026-10"); got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
}

// El 17 de noviembre la fecha del 16 ya llegó: está por confirmar (con «Confirmar» y «Más», el id de la US-60) y sigue
// contando como esperada en el total (D-091). Con la misma fecha, lo registrado va primero; las fuentes empatadas, por id.
func TestPN08PorConfirmarCuentaComoEsperadoYLoRegistradoVaPrimero(t *testing.T) {
	repo := &repoFalso{ingresos: presupuesto.DatosDeIngresos{Categorias: catalogo(ventas),
		Ingresos: []presupuesto.IngresoRegistrado{
			{MovimientoID: "m-1", CategoriaID: salario, Monto: 120000000, Fecha: dia("2026-11-01"), Medio: "transferencia"},
			{MovimientoID: "m-2", CategoriaID: salario, Monto: 5, Fecha: dia("2026-11-16"), Medio: "efectivo"},
			{MovimientoID: "m-3", CategoriaID: ventas, Monto: 240000005, Fecha: dia("2026-11-03"), Medio: "efectivo"}},
		Recurrentes: []registro.Recurrente{salarioQuincenal()}}}
	got := verIngresos(t, repo, "2026-11-17T15:00:00Z", "")
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-11","meses":[],` +
		`"total":{"entran_centavos":480000010,"registrado_centavos":360000010,"esperado_centavos":120000000,"por_confirmar":1},"fuentes":[` +
		`{"categoria_id":17,"nombre":"Salario","oculta":false,"total_centavos":240000005,"ingresos":[` +
		`{"fecha":"2026-11-01","marca":"registrado","monto_centavos":120000000,"medio":"transferencia","descripcion":null,"movimiento_id":"m-1","recurrente_id":null},` +
		`{"fecha":"2026-11-16","marca":"registrado","monto_centavos":5,"medio":"efectivo","descripcion":null,"movimiento_id":"m-2","recurrente_id":null},` +
		`{"fecha":"2026-11-16","marca":"por_confirmar","monto_centavos":120000000,"medio":"transferencia","descripcion":null,"movimiento_id":null,"recurrente_id":"` + recSalario + `"}]},` +
		`{"categoria_id":18,"nombre":"Trabajo independiente o ventas","oculta":true,"total_centavos":240000005,"ingresos":[` +
		`{"fecha":"2026-11-03","marca":"registrado","monto_centavos":240000005,"medio":"efectivo","descripcion":null,"movimiento_id":"m-3","recurrente_id":null}]}]}`
	if got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
}

// «Confirmar todos» se ofrece con dos o más fechas por confirmar: el total las cuenta.
func TestPN08CuentaLasFechasPorConfirmar(t *testing.T) {
	semanal := registro.Recurrente{ID: recVentas, Tipo: registro.Ingreso, CategoriaID: ventas, Medio: "efectivo", Periodicidad: fechas.Semanal,
		Monto: 2000000, Inicio: dia("2026-11-02"), CreadoEl: dia("2026-11-02")}
	repo := &repoFalso{ingresos: presupuesto.DatosDeIngresos{Categorias: catalogo(), Recurrentes: []registro.Recurrente{semanal}}}
	got := verIngresos(t, repo, "2026-11-17T15:00:00Z", "")
	// 2, 9 y 16 ya llegaron; 23 y 30 se esperan.
	if !strings.Contains(got, `"total":{"entran_centavos":10000000,"registrado_centavos":0,"esperado_centavos":10000000,"por_confirmar":3}`) {
		t.Errorf("%s", got)
	}
}

// Sin ingresos en el periodo: todo en cero y sin fuentes («Todavía no registras ingresos este mes.»).
func TestPN08SinIngresos(t *testing.T) {
	got := verIngresos(t, &repoFalso{ingresos: presupuesto.DatosDeIngresos{Categorias: catalogo()}}, dosDeNoviembre, "?periodo=2026-12")
	const quiere = `{"periodo_actual":"2026-11","periodo":"2026-12","meses":[],` +
		`"total":{"entran_centavos":0,"registrado_centavos":0,"esperado_centavos":0,"por_confirmar":0},"fuentes":[]}`
	if got != quiere {
		t.Errorf("respuesta\n%s\nse esperaba\n%s", got, quiere)
	}
}

// Un ingreso con una categoría de gasto o fuera del catálogo es un dato incoherente: 500.
func TestPN08DatosIncoherentes(t *testing.T) {
	for _, categoria := range []int{alimentacion, 99} {
		repo := &repoFalso{ingresos: presupuesto.DatosDeIngresos{Categorias: catalogo(),
			Ingresos: []presupuesto.IngresoRegistrado{{MovimientoID: "m-1", CategoriaID: categoria, Monto: 1, Fecha: dia("2026-11-01"), Medio: "efectivo"}}}}
		if codigo, cuerpo, _ := llamar(api(t, repo, dosDeNoviembre), "GET", "/api/v1/ingresos", ""); codigo != 500 || cuerpo != `{"error":"error_interno"}` {
			t.Errorf("categoría %d: %d %s", categoria, codigo, cuerpo)
		}
	}
}
