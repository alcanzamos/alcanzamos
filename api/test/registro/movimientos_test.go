package registro_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

const (
	idSuelto     = "0192f3c4-0000-7000-8000-000000000001"
	idRecurrente = "0192f3c4-0000-7000-8000-000000000002"
	idAporte     = "0192f3c4-0000-7000-8000-000000000003"
)

func categoria(n int) *int { return &n }

// repoConMovimientos tiene un movimiento suelto, la fecha de una repetición (D-168) y un aporte a una meta.
func repoConMovimientos() *repoFalso {
	return &repoFalso{movimientos: map[string]registro.Movimiento{
		idSuelto: {ID: idSuelto, Tipo: "gasto", MontoCentavos: 4500000, Fecha: "2026-10-25", CategoriaID: categoria(1), Medio: "efectivo"},
		idRecurrente: {ID: idRecurrente, Tipo: "ingreso", MontoCentavos: 120000000, Fecha: "2026-10-26", CategoriaID: categoria(17), Medio: "transferencia",
			Recurrente: &registro.DeRecurrente{RecurrenteID: "r-1", FechaProgramada: "2026-10-26", Periodicidad: "quincenal", VuelveAPendiente: true}},
		idAporte: {ID: idAporte, Tipo: "aporte", MontoCentavos: 10000000, Fecha: "2026-10-20", Medio: "transferencia",
			Meta: &registro.MetaDeAporte{ID: "m-1", Nombre: "Arriendo de enero"}},
	}}
}

func TestListarUsaElMesDeHoyEnColombiaPorDefecto(t *testing.T) {
	repo := &repoFalso{}
	// 01:00 UTC del 1 de noviembre son las 20:00 del 31 de octubre en Colombia.
	codigo, resp, cabeceras := llamar(api(t, repo, "2026-11-01T01:00:00Z"), "GET", "/api/v1/movimientos", "")
	if codigo != 200 || cabeceras.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %s %v", codigo, resp, cabeceras)
	}
	if len(repo.pedidos) != 1 || repo.pedidos[0] != (pedidoDeLista{persona, "2026-10", nil}) {
		t.Errorf("pedidos: %+v", repo.pedidos)
	}
	if strings.Contains(resp, "total_centavos") && !strings.Contains(resp, `"total_centavos":null`) {
		t.Errorf("sin categoría no hay total: %s", resp)
	}
	for _, trozo := range []string{`"periodo_actual":"2026-10"`, `"periodo":"2026-10"`, `"categoria_id":null`, `"movimientos":[]`} {
		if !strings.Contains(resp, trozo) {
			t.Errorf("falta %s en %s", trozo, resp)
		}
	}
}

func TestListarConCategoriaSumaLosMontosSinPerderCentavosNiDesbordar(t *testing.T) {
	repo := &repoFalso{listados: []registro.Movimiento{{MontoCentavos: 9223372036854775807}, {MontoCentavos: 9223372036854775807}}}
	codigo, resp, _ := llamar(api(t, repo, hoy), "GET", "/api/v1/movimientos?periodo=2026-09&categoria=4", "")
	if codigo != 200 || !strings.Contains(resp, `"resumen":{"movimientos":2,"total_centavos":18446744073709551614}`) || !strings.Contains(resp, `"categoria_id":4`) {
		t.Fatalf("%d %s", codigo, resp)
	}
	if len(repo.pedidos) != 1 || repo.pedidos[0].mes != "2026-09" || repo.pedidos[0].categoria == nil || *repo.pedidos[0].categoria != 4 {
		t.Errorf("pedidos: %+v", repo.pedidos)
	}
}

func TestListarRechazaPeriodoYCategoriaInvalidosJuntos(t *testing.T) {
	for _, consulta := range []string{"periodo=2026-13&categoria=x", "periodo=2026-1&categoria=0", "periodo=1899-12&categoria=40000", "periodo=hoy&categoria=1.5"} {
		codigo, resp, _ := llamar(api(t, &repoFalso{}, hoy), "GET", "/api/v1/movimientos?"+consulta, "")
		if codigo != 422 || resp != `{"campos":{"categoria":"categoria_invalida","periodo":"periodo_invalido"},"error":"datos_invalidos"}` {
			t.Errorf("%s: %d %s", consulta, codigo, resp)
		}
	}
}

func TestListarPasaElErrorDelRepositorioComoFalloInterno(t *testing.T) {
	codigo, resp, _ := llamar(api(t, &repoFalso{error: errors.New("sin base")}, hoy), "GET", "/api/v1/movimientos", "")
	if codigo != 500 || resp != `{"error":"error_interno"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestDetalleYBorrarNoRevelanSiExisteElMovimiento(t *testing.T) {
	h := api(t, repoConMovimientos(), hoy)
	for _, id := range []string{"0192f3c4-0000-7000-8000-0000000000ff", "no-es-un-id", "1"} {
		for _, metodo := range []string{"GET", "PUT", "DELETE"} {
			codigo, resp, _ := llamar(h, metodo, "/api/v1/movimientos/"+id, cuerpoDeCorreccion(""))
			if codigo != 404 || resp != `{"error":"no_encontrado"}` {
				t.Errorf("%s %s: %d %s", metodo, id, codigo, resp)
			}
		}
	}
}

func TestDetalleEntregaElMovimientoConSuRepeticion(t *testing.T) {
	codigo, resp, cabeceras := llamar(api(t, repoConMovimientos(), hoy), "GET", "/api/v1/movimientos/"+idRecurrente, "")
	const quiere = `{"id":"` + idRecurrente + `","tipo":"ingreso","monto_centavos":120000000,"fecha":"2026-10-26","categoria_id":17,"medio":"transferencia",` +
		`"descripcion":null,"compartido":false,"meta":null,"sentido":null,` +
		`"recurrente":{"recurrente_id":"r-1","fecha_programada":"2026-10-26","periodicidad":"quincenal","vuelve_a_pendiente":true}}`
	if codigo != 200 || resp != quiere || cabeceras.Get("Cache-Control") != "no-store" {
		t.Errorf("%d %s", codigo, resp)
	}
}

func cuerpoDeCorreccion(extra string) string {
	return `{"tipo":"gasto","monto_centavos":4000000,"fecha":"2026-10-24","categoria_id":3,"medio":"transferencia"` + extra + `}`
}

func TestCorregirReemplazaLosCamposDeUnMovimientoSuelto(t *testing.T) {
	repo := repoConMovimientos()
	codigo, resp, _ := llamar(api(t, repo, hoy), "PUT", "/api/v1/movimientos/"+idSuelto, cuerpoDeCorreccion(`,"descripcion":"  Mercado  "`))
	if codigo != 200 || !strings.Contains(resp, `"id":"`+idSuelto+`"`) {
		t.Fatalf("%d %s", codigo, resp)
	}
	c := repo.corregidos[0]
	if c.Tipo != "gasto" || c.Monto != 4000000 || c.Fecha == nil || c.Fecha.Format(time.DateOnly) != "2026-10-24" ||
		c.CategoriaID == nil || *c.CategoriaID != 3 || c.Medio != "transferencia" || c.Descripcion == nil || *c.Descripcion != "Mercado" {
		t.Errorf("corrección: %+v", c)
	}
	if codigo, resp, _ := llamar(api(t, repo, hoy), "PUT", "/api/v1/movimientos/"+idSuelto, cuerpoDeCorreccion("")); codigo != 200 || repo.corregidos[1].Descripcion != nil {
		t.Errorf("sin descripción la borra: %d %s %+v", codigo, resp, repo.corregidos[1])
	}
}

func TestCorregirAplicaLasValidacionesDelPOST(t *testing.T) {
	h := api(t, repoConMovimientos(), hoy)
	codigo, resp, _ := llamar(h, "PUT", "/api/v1/movimientos/"+idSuelto, `{"tipo":"","monto_centavos":0,"fecha":"2026-02-30","medio":"tarjeta","descripcion":"`+strings280()+`"}`)
	const quiere = `{"campos":{"categoria_id":"categoria_requerida","descripcion":"descripcion_larga","fecha":"fecha_invalida","medio":"medio_invalido","monto_centavos":"monto_no_positivo","tipo":"tipo_requerido"},"error":"datos_invalidos"}`
	if codigo != 422 || resp != quiere {
		t.Errorf("%d %s", codigo, resp)
	}
	if codigo, resp, _ := llamar(h, "PUT", "/api/v1/movimientos/"+idSuelto, `{"tipo":"gasto","monto_centavos":1,"medio":"efectivo","categoria_id":1}`); codigo != 422 || !strings.Contains(resp, `"fecha":"fecha_requerida"`) {
		t.Errorf("la fecha es obligatoria en un movimiento suelto: %d %s", codigo, resp)
	}
	if codigo, resp, _ := llamar(h, "PUT", "/api/v1/movimientos/"+idSuelto, cuerpoDeCorreccion(`,"hogar_id":"x"`)); codigo != 400 || resp != `{"error":"solicitud_invalida"}` {
		t.Errorf("un campo fuera del contrato: %d %s", codigo, resp)
	}
}

func strings280() string {
	b := make([]byte, 281)
	for i := range b {
		b[i] = 'a'
	}
	return string(b)
}

func TestCorregirTraduceLaCategoriaQueNoVale(t *testing.T) {
	repo := repoConMovimientos()
	repo.errorAlCorregir = registro.ErrCategoriaInvalida
	codigo, resp, _ := llamar(api(t, repo, hoy), "PUT", "/api/v1/movimientos/"+idSuelto, cuerpoDeCorreccion(""))
	if codigo != 422 || resp != `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}` {
		t.Errorf("%d %s", codigo, resp)
	}
	repo.errorAlCorregir = errors.New("sin base")
	if codigo, _, _ := llamar(api(t, repo, hoy), "PUT", "/api/v1/movimientos/"+idSuelto, cuerpoDeCorreccion("")); codigo != 500 {
		t.Errorf("fallo del repositorio: %d", codigo)
	}
}

// D-168: la fecha de un recurrente no se corrige; lo demás cambia solo en esa fila.
func TestD168LaFechaDeUnRecurrenteNoCambiaYLoDemasSi(t *testing.T) {
	repo := repoConMovimientos()
	h := api(t, repo, hoy)
	ruta := "/api/v1/movimientos/" + idRecurrente
	sinFecha := `{"tipo":"ingreso","monto_centavos":110000000,"categoria_id":18,"medio":"efectivo","descripcion":"Con descuento"}`
	if codigo, resp, _ := llamar(h, "PUT", ruta, sinFecha); codigo != 200 {
		t.Fatalf("sin Fecha: %d %s", codigo, resp)
	}
	if c := repo.corregidos[0]; c.Fecha != nil || c.Monto != 110000000 || c.Medio != "efectivo" || c.CategoriaID == nil || *c.CategoriaID != 18 {
		t.Errorf("la fecha no se toca: %+v", c)
	}
	igual := `{"tipo":"ingreso","monto_centavos":1,"fecha":"2026-10-26","categoria_id":17,"medio":"efectivo"}`
	if codigo, resp, _ := llamar(h, "PUT", ruta, igual); codigo != 200 || repo.corregidos[1].Fecha != nil {
		t.Errorf("la misma fecha se acepta y no se guarda: %d %s %+v", codigo, resp, repo.corregidos[1])
	}
	for _, fecha := range []string{"2026-10-27", "basura"} {
		codigo, resp, _ := llamar(h, "PUT", ruta, `{"tipo":"ingreso","monto_centavos":1,"fecha":"`+fecha+`","categoria_id":17,"medio":"efectivo"}`)
		if codigo != 422 || resp != `{"campos":{"fecha":"fecha_no_editable"},"error":"datos_invalidos"}` {
			t.Errorf("fecha %s: %d %s", fecha, codigo, resp)
		}
	}
	codigo, resp, _ := llamar(h, "PUT", ruta, `{"tipo":"gasto","monto_centavos":1,"categoria_id":4,"medio":"efectivo"}`)
	if codigo != 422 || resp != `{"campos":{"tipo":"tipo_no_editable"},"error":"datos_invalidos"}` {
		t.Errorf("el tipo de una fecha de recurrente: %d %s", codigo, resp)
	}
	if len(repo.corregidos) != 2 {
		t.Errorf("lo rechazado no se guarda: %+v", repo.corregidos)
	}
}

func TestCorregirUnAporteConservaSuTipoYNoLlevaCategoria(t *testing.T) {
	repo := repoConMovimientos()
	h := api(t, repo, hoy)
	ruta := "/api/v1/movimientos/" + idAporte
	if codigo, resp, _ := llamar(h, "PUT", ruta, `{"tipo":"aporte","monto_centavos":9000000,"fecha":"2026-10-21","medio":"efectivo"}`); codigo != 200 {
		t.Fatalf("%d %s", codigo, resp)
	}
	if c := repo.corregidos[0]; c.Tipo != "aporte" || c.CategoriaID != nil || c.Monto != 9000000 || c.Fecha == nil {
		t.Errorf("aporte: %+v", c)
	}
	const quiere = `{"campos":{"categoria_id":"categoria_no_aplica","tipo":"tipo_no_editable"},"error":"datos_invalidos"}`
	if codigo, resp, _ := llamar(h, "PUT", ruta, `{"tipo":"gasto","monto_centavos":1,"fecha":"2026-10-21","categoria_id":4,"medio":"efectivo"}`); codigo != 422 || resp != quiere {
		t.Errorf("%d %s", codigo, resp)
	}
	if codigo, resp, _ := llamar(h, "PUT", ruta, `{"monto_centavos":1,"fecha":"2026-10-21","medio":"efectivo"}`); codigo != 422 || resp != `{"campos":{"tipo":"tipo_requerido"},"error":"datos_invalidos"}` {
		t.Errorf("%d %s", codigo, resp)
	}
}

func TestBorrarResponde204YLaSegundaVez404(t *testing.T) {
	repo := repoConMovimientos()
	h := api(t, repo, hoy)
	if codigo, resp, _ := llamar(h, "DELETE", "/api/v1/movimientos/"+idRecurrente, ""); codigo != 204 || resp != "" || len(repo.borrados) != 1 {
		t.Errorf("%d %q %v", codigo, resp, repo.borrados)
	}
	if codigo, _, _ := llamar(h, "DELETE", "/api/v1/movimientos/"+idRecurrente, ""); codigo != 404 {
		t.Errorf("la segunda vez: %d", codigo)
	}
}
