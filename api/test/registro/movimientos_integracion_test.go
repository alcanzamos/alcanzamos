//go:build integration

// Pruebas de punta a punta de la US-52 (lista, detalle, corregir y borrar) contra PostgreSQL y el enrutador real, de caja
// negra: por HTTP, en web con cookie y en Android con Bearer. Los datos que todavía no tienen pantalla (hogares y metas)
// se siembran por SQL. Solo datos sintéticos. La hora es el 26 de octubre de 2026 a las 10:00 en Colombia.
package registro_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
)

// Lo que PN-01 y PN-02 leen; los nombres de los campos son el contrato.
type movimientoVisto struct {
	ID            string  `json:"id"`
	Tipo          string  `json:"tipo"`
	MontoCentavos int64   `json:"monto_centavos"`
	Fecha         string  `json:"fecha"`
	CategoriaID   *int    `json:"categoria_id"`
	Medio         string  `json:"medio"`
	Descripcion   *string `json:"descripcion"`
	Compartido    bool    `json:"compartido"`
	Meta          *struct {
		ID     string `json:"id"`
		Nombre string `json:"nombre"`
	} `json:"meta"`
	Sentido    *string `json:"sentido"`
	Recurrente *struct {
		RecurrenteID    string `json:"recurrente_id"`
		FechaProgramada string `json:"fecha_programada"`
		Periodicidad    string `json:"periodicidad"`
	} `json:"recurrente"`
}

type listaVista struct {
	PeriodoActual string `json:"periodo_actual"`
	Periodo       string `json:"periodo"`
	CategoriaID   *int   `json:"categoria_id"`
	Resumen       struct {
		Movimientos   int          `json:"movimientos"`
		TotalCentavos *json.Number `json:"total_centavos"`
	} `json:"resumen"`
	Meses      []string `json:"meses"`
	Categorias []struct {
		CategoriaID int  `json:"categoria_id"`
		Movimientos int  `json:"movimientos"`
		Oculta      bool `json:"oculta"`
	} `json:"categorias"`
	Movimientos []movimientoVisto `json:"movimientos"`
}

func (s *servidorDePrueba) lista(c *cliente, consulta string) listaVista {
	s.t.Helper()
	r := c.llamar("GET", rutaMovimientos+consulta, "")
	if r.Codigo != 200 || r.Cache != "no-store" {
		s.t.Fatalf("listar %q: %d %s", consulta, r.Codigo, r.Cuerpo)
	}
	var l listaVista
	if err := json.Unmarshal([]byte(r.Cuerpo), &l); err != nil {
		s.t.Fatal(err)
	}
	return l
}

func (s *servidorDePrueba) detalle(c *cliente, id string) movimientoVisto {
	s.t.Helper()
	r := c.llamar("GET", rutaMovimientos+"/"+id, "")
	if r.Codigo != 200 {
		s.t.Fatalf("detalle: %d %s", r.Codigo, r.Cuerpo)
	}
	var m movimientoVisto
	if err := json.Unmarshal([]byte(r.Cuerpo), &m); err != nil {
		s.t.Fatal(err)
	}
	return m
}

// registrar crea un movimiento y avanza un minuto el reloj, para que el orden por «registrado después» se pueda probar.
func (s *servidorDePrueba) registrar(c *cliente, tipo, monto, fecha, categoria, extra string) string {
	s.t.Helper()
	res := s.crear(c, cuerpoDe(tipo, monto, fecha, categoria, extra))
	s.reloj.T = s.reloj.T.Add(time.Minute)
	if res.MovimientoID == nil {
		s.t.Fatal("sin movimiento")
	}
	return *res.MovimientoID
}

func ids(l listaVista) string {
	var textos []string
	for _, m := range l.Movimientos {
		textos = append(textos, m.ID)
	}
	return strings.Join(textos, ",")
}

// PN-01: lo del mes, del más reciente al más antiguo (con la misma fecha, el que se registró después va primero), con lo
// que necesitan los filtros de periodo y de categoría.
func TestLaListaDelMesTraeLoPropioOrdenadoYLoQueNecesitanLosFiltros(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		otra, _ := s.nuevaCuenta("otra@ejemplo.test", android, true)
		s.registrar(otra, "gasto", "999", "2026-10-25", "1", "")
		mercado := s.registrar(c, "gasto", "4500000", "2026-10-25", "1", `,"descripcion":"Mercado"`)
		transporte := s.registrar(c, "gasto", "1500000", "2026-10-26", "4", "")
		comida := s.registrar(c, "gasto", "7500000", "2026-10-25", "1", "")
		salario := s.registrar(c, "ingreso", "120000000", "2026-10-01", "17", "")
		septiembre := s.registrar(c, "gasto", "1990000", "2026-09-05", "3", "")
		diciembre := s.registrar(c, "gasto", "50000000", "2026-12-20", "16", "")
		if _, err := s.pool.Exec(context.Background(), `INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, 3)`, persona); err != nil {
			t.Fatal(err)
		}

		l := s.lista(c, "")
		if l.Periodo != "2026-10" || l.PeriodoActual != "2026-10" || l.CategoriaID != nil || l.Resumen.TotalCentavos != nil || l.Resumen.Movimientos != 4 {
			t.Errorf("octubre por defecto: %+v", l)
		}
		if quiere := strings.Join([]string{transporte, comida, mercado, salario}, ","); ids(l) != quiere {
			t.Errorf("orden: %s, se esperaba %s", ids(l), quiere)
		}
		if strings.Join(l.Meses, ",") != "2026-12,2026-10,2026-09" {
			t.Errorf("meses con movimientos: %v", l.Meses)
		}
		if len(l.Categorias) != 3 || l.Categorias[0].CategoriaID != 1 || l.Categorias[0].Movimientos != 2 || l.Categorias[0].Oculta {
			t.Errorf("categorías de octubre: %+v", l.Categorias)
		}
		if m := l.Movimientos[2]; m.Tipo != "gasto" || m.MontoCentavos != 4500000 || m.Fecha != "2026-10-25" || *m.CategoriaID != 1 || m.Medio != "transferencia" ||
			m.Descripcion == nil || *m.Descripcion != "Mercado" || m.Compartido || m.Meta != nil || m.Recurrente != nil || m.Sentido != nil {
			t.Errorf("fila de Mercado: %+v", m)
		}

		// Con una categoría: solo esas filas y la suma exacta.
		l = s.lista(c, "?categoria=1")
		if ids(l) != comida+","+mercado || l.Resumen.Movimientos != 2 || l.Resumen.TotalCentavos == nil || l.Resumen.TotalCentavos.String() != "12000000" || *l.CategoriaID != 1 {
			t.Errorf("Alimentación: %+v", l)
		}
		if len(l.Categorias) != 3 {
			t.Errorf("los chips no dependen del filtro: %+v", l.Categorias)
		}
		if l = s.lista(c, "?categoria=2"); len(l.Movimientos) != 0 || l.Movimientos == nil || l.Resumen.Movimientos != 0 || l.Resumen.TotalCentavos.String() != "0" {
			t.Errorf("una categoría sin movimientos: %+v", l)
		}

		// Otro periodo: septiembre trae la categoría oculta, que sigue filtrable (RN-011).
		l = s.lista(c, "?periodo=2026-09")
		if ids(l) != septiembre || l.PeriodoActual != "2026-10" || len(l.Categorias) != 1 || l.Categorias[0].CategoriaID != 3 || !l.Categorias[0].Oculta {
			t.Errorf("septiembre: %+v", l)
		}
		if l = s.lista(c, "?periodo=2026-09&categoria=3"); ids(l) != septiembre {
			t.Errorf("una oculta se filtra: %+v", l)
		}
		if l = s.lista(c, "?periodo=2026-12"); ids(l) != diciembre {
			t.Errorf("diciembre (fecha futura sin repetición): %+v", l)
		}
		if l = s.lista(c, "?periodo=2026-11"); len(l.Movimientos) != 0 || len(l.Meses) != 3 {
			t.Errorf("noviembre vacío: %+v", l)
		}

		if r := c.llamar("GET", rutaMovimientos+"?periodo=oct&categoria=x", ""); r.Codigo != 422 || r.Cuerpo != `{"campos":{"categoria":"categoria_invalida","periodo":"periodo_invalido"},"error":"datos_invalidos"}` {
			t.Errorf("filtros inválidos: %d %s", r.Codigo, r.Cuerpo)
		}

		// La otra persona solo ve lo suyo.
		if l = s.lista(otra, ""); l.Resumen.Movimientos != 1 || len(l.Meses) != 1 || l.Movimientos[0].MontoCentavos != 999 {
			t.Errorf("la otra persona: %+v", l)
		}
	})
}

// sembrarHogar crea «Nuestro hogar» con la persona como administradora y miembro (la llave que lo exige se revisa al
// cerrar la transacción) y devuelve su id.
func (s *servidorDePrueba) sembrarHogar(persona string) string {
	s.t.Helper()
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	var hogar string
	if err := tx.QueryRow(ctx, `INSERT INTO hogar (nombre, creado_en, administrador_id) VALUES ('Nuestro hogar', '2026-10-01', $1::uuid) RETURNING id::text`, persona).Scan(&hogar); err != nil {
		s.t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO miembro_hogar (persona_id, hogar_id) VALUES ($1::uuid, $2::uuid)`, persona, hogar); err != nil {
		s.t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		s.t.Fatal(err)
	}
	return hogar
}

// Detalle, corregir y borrar sobre el movimiento de otra persona dan 404 y no tocan nada: igual que un id que no existe.
func TestElMovimientoDeOtraPersonaEsUn404ParaDetalleCorregirYBorrar(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		otra, _ := s.nuevaCuenta("otra@ejemplo.test", android, true)
		ajeno := s.registrar(otra, "gasto", "5000", "2026-10-25", "1", "")
		cuerpo := cuerpoDe("gasto", "1", "2026-10-24", "2", "")
		for _, id := range []string{ajeno, "0192f3c4-0000-7000-8000-0000000000ff", "no-es-un-id"} {
			for _, p := range [][2]string{{"GET", ""}, {"PUT", cuerpo}, {"DELETE", ""}} {
				if r := c.llamar(p[0], rutaMovimientos+"/"+id, p[1]); r.Codigo != 404 || r.Cuerpo != `{"error":"no_encontrado"}` {
					t.Errorf("%s %s: %d %s", p[0], id, r.Codigo, r.Cuerpo)
				}
			}
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE id = $1::uuid AND monto = 5000 AND fecha = '2026-10-25' AND categoria_id = 1`, ajeno); n != 1 {
			t.Errorf("el movimiento ajeno sigue igual: %d", n)
		}
		if d := s.detalle(otra, ajeno); d.MontoCentavos != 5000 {
			t.Errorf("su dueña sí lo ve: %+v", d)
		}
	})
}

// CU-08: un movimiento suelto se corrige completo, con las validaciones del POST, y se borra.
func TestCorregirYBorrarUnMovimientoSuelto(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		id := s.registrar(c, "gasto", "4500000", "2026-10-25", "1", `,"descripcion":"Mercado"`)
		ruta := rutaMovimientos + "/" + id

		// Corregir el monto, la fecha, la categoría y el medio; la descripción omitida se borra.
		r := c.llamar("PUT", ruta, `{"tipo":"gasto","monto_centavos":4000000,"fecha":"2026-10-24","categoria_id":5,"medio":"efectivo"}`)
		if r.Codigo != 200 || r.Cache != "no-store" {
			t.Fatalf("corregir: %d %s", r.Codigo, r.Cuerpo)
		}
		var m movimientoVisto
		if err := json.Unmarshal([]byte(r.Cuerpo), &m); err != nil {
			t.Fatal(err)
		}
		if m.ID != id || m.MontoCentavos != 4000000 || m.Fecha != "2026-10-24" || *m.CategoriaID != 5 || m.Medio != "efectivo" || m.Descripcion != nil {
			t.Errorf("corregido: %+v", m)
		}
		if d := s.detalle(c, id); d.MontoCentavos != 4000000 || d.Fecha != "2026-10-24" {
			t.Errorf("detalle tras corregir: %+v", d)
		}

		// Tipo: de gasto a ingreso con una categoría de ingreso; con una de gasto la llave (categoría, tipo) lo rechaza.
		if r := c.llamar("PUT", ruta, `{"tipo":"ingreso","monto_centavos":4000000,"fecha":"2026-10-24","categoria_id":5,"medio":"efectivo"}`); r.Codigo != 422 ||
			r.Cuerpo != `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}` {
			t.Errorf("ingreso con categoría de gasto: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("PUT", ruta, `{"tipo":"ingreso","monto_centavos":4000000,"fecha":"2026-10-24","categoria_id":17,"medio":"transferencia"}`); r.Codigo != 200 ||
			!strings.Contains(r.Cuerpo, `"tipo":"ingreso"`) {
			t.Errorf("a ingreso: %d %s", r.Codigo, r.Cuerpo)
		}

		// Las validaciones del POST, todas a la vez, sin tocar la fila.
		const invalido = `{"tipo":"","monto_centavos":"12,5","fecha":"","medio":"tarjeta","descripcion":null}`
		if r := c.llamar("PUT", ruta, invalido); r.Codigo != 422 ||
			r.Cuerpo != `{"campos":{"categoria_id":"categoria_requerida","fecha":"fecha_requerida","medio":"medio_invalido","monto_centavos":"monto_invalido","tipo":"tipo_requerido"},"error":"datos_invalidos"}` {
			t.Errorf("inválido: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("PUT", ruta, cuerpoDe("gasto", "1", "2026-10-24", "9", `,"persona_id":"x"`)); r.Codigo != 400 {
			t.Errorf("campo fuera del contrato: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE id = $1::uuid AND tipo = 'ingreso' AND monto = 4000000 AND categoria_id = 17`, id); n != 1 {
			t.Errorf("lo rechazado no cambia la fila: %d", n)
		}

		if r := c.llamar("DELETE", ruta, ""); r.Codigo != 204 || r.Cuerpo != "" {
			t.Errorf("borrar: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("DELETE", ruta, ""); r.Codigo != 404 {
			t.Errorf("borrar otra vez: %d", r.Codigo)
		}
		if r := c.llamar("GET", ruta, ""); r.Codigo != 404 {
			t.Errorf("detalle de lo borrado: %d", r.Codigo)
		}
		if l := s.lista(c, ""); l.Resumen.Movimientos != 0 {
			t.Errorf("la lista ya no lo trae: %+v", l)
		}
	})
}

// Una categoría que la persona ocultó no se elige al corregir, pero el movimiento conserva la suya (RN-011).
func TestCorregirNoEligeUnaCategoriaOcultaPeroConservaLaDelMovimiento(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuenta("laura@ejemplo.test", false, true)
	id := s.registrar(c, "gasto", "100", "2026-10-25", "3", "")
	otro := s.registrar(c, "gasto", "100", "2026-10-25", "1", "")
	if _, err := s.pool.Exec(context.Background(), `INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, 3)`, persona); err != nil {
		t.Fatal(err)
	}
	if r := c.llamar("PUT", rutaMovimientos+"/"+otro, cuerpoDe("gasto", "100", "2026-10-25", "3", "")); r.Codigo != 422 {
		t.Errorf("elegir una oculta: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("PUT", rutaMovimientos+"/"+id, cuerpoDe("gasto", "250", "2026-10-25", "3", "")); r.Codigo != 200 {
		t.Errorf("conservar la suya aunque se ocultó: %d %s", r.Codigo, r.Cuerpo)
	}
}

// D-168: una fecha confirmada de una repetición no cambia de fecha; monto, categoría, medio y descripción cambian solo
// en esa fila y la repetición queda como estaba.
func TestD168CorregirUnaFechaDeUnRecurrenteNoCambiaLaFechaNiLaRepeticion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, true)
		res := s.crear(c, cuerpoDe("ingreso", "120000000", "2026-10-26", "17", `,"repeticion":{"periodicidad":"quincenal"}`))
		id := *res.MovimientoID
		ruta := rutaMovimientos + "/" + id

		d := s.detalle(c, id)
		if d.Recurrente == nil || d.Recurrente.RecurrenteID != *res.RecurrenteID || d.Recurrente.FechaProgramada != "2026-10-26" || d.Recurrente.Periodicidad != "quincenal" {
			t.Fatalf("la fecha confirmada dice de qué repetición viene: %+v", d.Recurrente)
		}
		if l := s.lista(c, ""); l.Movimientos[0].Recurrente == nil || l.Movimientos[0].Recurrente.Periodicidad != "quincenal" {
			t.Errorf("la lista también: %+v", l.Movimientos[0])
		}

		// Sin Fecha (el formulario no la muestra): cambia solo esa fila.
		if r := c.llamar("PUT", ruta, `{"tipo":"ingreso","monto_centavos":110000000,"categoria_id":18,"medio":"efectivo","descripcion":"Con descuento"}`); r.Codigo != 200 {
			t.Fatalf("sin fecha: %d %s", r.Codigo, r.Cuerpo)
		}
		d = s.detalle(c, id)
		if d.MontoCentavos != 110000000 || *d.CategoriaID != 18 || d.Medio != "efectivo" || *d.Descripcion != "Con descuento" || d.Fecha != "2026-10-26" ||
			d.Recurrente == nil || d.Recurrente.FechaProgramada != "2026-10-26" {
			t.Errorf("corregido: %+v", d)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente WHERE id = $1::uuid AND monto_habitual = 120000000 AND categoria_id = 17 AND medio = 'transferencia' AND periodicidad = 'quincenal' AND inicio = '2026-10-26'`, *res.RecurrenteID); n != 1 {
			t.Errorf("la repetición no cambia: %d", n)
		}

		// La misma fecha se acepta; otra no, y tampoco cambia el tipo.
		if r := c.llamar("PUT", ruta, `{"tipo":"ingreso","monto_centavos":110000000,"fecha":"2026-10-26","categoria_id":18,"medio":"efectivo"}`); r.Codigo != 200 {
			t.Errorf("la misma fecha: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("PUT", ruta, `{"tipo":"ingreso","monto_centavos":1,"fecha":"2026-10-27","categoria_id":18,"medio":"efectivo"}`); r.Codigo != 422 ||
			r.Cuerpo != `{"campos":{"fecha":"fecha_no_editable"},"error":"datos_invalidos"}` {
			t.Errorf("otra fecha: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("PUT", ruta, `{"tipo":"gasto","monto_centavos":1,"categoria_id":4,"medio":"efectivo"}`); r.Codigo != 422 ||
			r.Cuerpo != `{"campos":{"tipo":"tipo_no_editable"},"error":"datos_invalidos"}` {
			t.Errorf("otro tipo: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE id = $1::uuid AND monto = 110000000 AND fecha = '2026-10-26' AND tipo = 'ingreso'`, id); n != 1 {
			t.Errorf("lo rechazado no cambia la fila: %d", n)
		}
	})
}

// pendientesDe aplica E15 5.2 (`fechas.PorConfirmar`) a lo que hay en la base para una repetición, con hoy = 26 de octubre.
func (s *servidorDePrueba) pendientesDe(recurrente string) []string {
	s.t.Helper()
	ctx := context.Background()
	var periodicidad string
	var inicio, creado time.Time
	var detenido *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT periodicidad, inicio, creado_en AT TIME ZONE 'America/Bogota', detenido_en FROM movimiento_recurrente WHERE id = $1::uuid`, recurrente).
		Scan(&periodicidad, &inicio, &creado, &detenido); err != nil {
		s.t.Fatal(err)
	}
	fechasDe := func(sql string) []time.Time {
		filas, err := s.pool.Query(ctx, sql, recurrente)
		if err != nil {
			s.t.Fatal(err)
		}
		defer filas.Close()
		var lista []time.Time
		for filas.Next() {
			var f time.Time
			if err := filas.Scan(&f); err != nil {
				s.t.Fatal(err)
			}
			lista = append(lista, f)
		}
		return lista
	}
	confirmadas := fechasDe(`SELECT fecha_programada FROM movimiento WHERE recurrente_id = $1::uuid`)
	omitidas := fechasDe(`SELECT fecha_programada FROM ocurrencia_omitida WHERE recurrente_id = $1::uuid`)
	hoy := fechas.HoyEnColombia(s.reloj.T)
	pendientes, err := fechas.PorConfirmar(fechas.Periodicidad(periodicidad), inicio, confirmadas, omitidas, fechas.HoyEnColombia(creado), hoy, detenido)
	if err != nil {
		s.t.Fatal(err)
	}
	textos := []string{}
	for _, f := range pendientes {
		textos = append(textos, f.Format(time.DateOnly))
	}
	return textos
}

// D-168 y D-091: borrar una fecha confirmada de una repetición la devuelve a pendiente. No se omite (no hay
// `ocurrencia_omitida`), la repetición sigue y la restricción única permite confirmarla otra vez.
func TestD168BorrarUnaFechaDeUnRecurrenteLaDevuelveAPendiente(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		res := s.crear(c, cuerpoDe("ingreso", "120000000", "2026-10-26", "17", `,"repeticion":{"periodicidad":"quincenal"}`))
		confirmar := func() error {
			_, err := s.pool.Exec(context.Background(),
				`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, recurrente_id, fecha_programada)
				 VALUES ($1::uuid, 'ingreso', 120000000, '2026-10-26', 'transferencia', 17, $2::uuid, '2026-10-26')`, persona, *res.RecurrenteID)
			return err
		}
		if p := s.pendientesDe(*res.RecurrenteID); len(p) != 0 {
			t.Fatalf("confirmada: no hay pendientes, hay %v", p)
		}
		if err := confirmar(); err == nil || !strings.Contains(err.Error(), "uq_movimiento_recurrente_programada") {
			t.Fatalf("confirmada dos veces, la restricción única lo impide: %v", err)
		}

		if r := c.llamar("DELETE", rutaMovimientos+"/"+*res.MovimientoID, ""); r.Codigo != 204 {
			t.Fatalf("borrar: %d %s", r.Codigo, r.Cuerpo)
		}
		if p := s.pendientesDe(*res.RecurrenteID); strings.Join(p, ",") != "2026-10-26" {
			t.Errorf("E15 5.2 vuelve a ofrecer la fecha: %v", p)
		}
		if n := s.contar(`SELECT count(*) FROM ocurrencia_omitida`); n != 0 {
			t.Errorf("no se omite: %d", n)
		}
		if n := s.contar(`SELECT count(*) FROM movimiento_recurrente WHERE id = $1::uuid AND detenido_en IS NULL`, *res.RecurrenteID); n != 1 {
			t.Errorf("la repetición sigue: %d", n)
		}
		if err := confirmar(); err != nil {
			t.Errorf("volver a confirmar la fecha: %v", err)
		}
		if p := s.pendientesDe(*res.RecurrenteID); len(p) != 0 {
			t.Errorf("confirmada otra vez: %v", p)
		}
	})
}

// SEG-002 y NC-E16-40 (RNF-003, NM-05): PN-01 muestra el aporte «Arriendo de enero», de $100.000, con la marca «Compartido
// con el hogar», y su meta en lugar de la categoría; quien no es de ese hogar no lo ve, ni en la lista ni por su id. Se
// siembra por SQL porque todavía no hay pantallas de hogares ni de metas.
func TestSEG002ElAporteArriendoDeEneroLlegaCompartidoConSuMeta(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		laura, persona := s.nuevaCuenta("laura@ejemplo.test", android, true)
		ajena, _ := s.nuevaCuenta("otra@ejemplo.test", android, true)
		hogar := s.sembrarHogar(persona)
		ctx := context.Background()
		var meta, aporte string
		if err := s.pool.QueryRow(ctx,
			`INSERT INTO meta (persona_id, hogar_id, nombre, monto_objetivo) VALUES ($1::uuid, $2::uuid, 'Arriendo de enero', 130000000) RETURNING id::text`,
			persona, hogar).Scan(&meta); err != nil {
			t.Fatal(err)
		}
		if err := s.pool.QueryRow(ctx,
			`INSERT INTO movimiento (persona_id, hogar_id, tipo, monto, fecha, medio, meta_id, sentido, creado_en)
			 VALUES ($1::uuid, $2::uuid, 'aporte', 10000000, '2026-10-25', 'transferencia', $3::uuid, 'entrada', $4) RETURNING id::text`,
			persona, hogar, meta, s.reloj.T.Add(-time.Hour)).Scan(&aporte); err != nil {
			t.Fatal(err)
		}
		propio := s.registrar(laura, "gasto", "7500000", "2026-10-25", "1", "")

		quiere := fmt.Sprintf(`{"id":"%s","tipo":"aporte","monto_centavos":10000000,"fecha":"2026-10-25","categoria_id":null,"medio":"transferencia",`+
			`"descripcion":null,"compartido":true,"meta":{"id":"%s","nombre":"Arriendo de enero"},"sentido":"entrada","recurrente":null}`, aporte, meta)
		lista := laura.llamar("GET", rutaMovimientos, "")
		if lista.Codigo != 200 || !strings.Contains(lista.Cuerpo, quiere) {
			t.Fatalf("la lista debe traer %s\nllegó %d %s", quiere, lista.Codigo, lista.Cuerpo)
		}
		if r := laura.llamar("GET", rutaMovimientos+"/"+aporte, ""); r.Codigo != 200 || r.Cuerpo != quiere {
			t.Errorf("detalle: %d %s", r.Codigo, r.Cuerpo)
		}
		l := s.lista(laura, "")
		if len(l.Movimientos) != 2 || l.Movimientos[0].ID != propio || l.Movimientos[0].Compartido || !l.Movimientos[1].Compartido {
			t.Errorf("solo el compartido lleva la marca: %+v", l.Movimientos)
		}
		if l = s.lista(laura, "?categoria=1"); len(l.Movimientos) != 1 || l.Movimientos[0].ID != propio {
			t.Errorf("un aporte no tiene categoría: se ve con «Todas»: %+v", l.Movimientos)
		}

		// RNF-003: quien no es del hogar no lo ve por ninguna ruta.
		if l := s.lista(ajena, ""); len(l.Movimientos) != 0 || len(l.Meses) != 0 {
			t.Errorf("la lista de quien no es del hogar: %+v", l)
		}
		for _, p := range [][2]string{{"GET", ""}, {"PUT", `{"tipo":"aporte","monto_centavos":1,"fecha":"2026-10-25","medio":"efectivo"}`}, {"DELETE", ""}} {
			if r := ajena.llamar(p[0], rutaMovimientos+"/"+aporte, p[1]); r.Codigo != 404 {
				t.Errorf("%s del aporte, sin ser del hogar: %d %s", p[0], r.Codigo, r.Cuerpo)
			}
		}

		// Corregir un aporte: monto, fecha, medio y descripción; sigue compartido, de su meta y sin categoría.
		const corregido = `{"tipo":"aporte","monto_centavos":9000000,"fecha":"2026-10-24","medio":"efectivo","descripcion":"Menos este mes"}`
		if r := laura.llamar("PUT", rutaMovimientos+"/"+aporte, corregido); r.Codigo != 200 {
			t.Fatalf("corregir el aporte: %d %s", r.Codigo, r.Cuerpo)
		}
		if d := s.detalle(laura, aporte); d.MontoCentavos != 9000000 || d.Fecha != "2026-10-24" || d.Medio != "efectivo" || !d.Compartido || d.CategoriaID != nil || d.Meta == nil || d.Meta.Nombre != "Arriendo de enero" {
			t.Errorf("aporte corregido: %+v", d)
		}
		if r := laura.llamar("PUT", rutaMovimientos+"/"+aporte, `{"tipo":"gasto","monto_centavos":9000000,"fecha":"2026-10-24","categoria_id":1,"medio":"efectivo"}`); r.Codigo != 422 ||
			r.Cuerpo != `{"campos":{"categoria_id":"categoria_no_aplica","tipo":"tipo_no_editable"},"error":"datos_invalidos"}` {
			t.Errorf("un aporte no cambia de tipo ni lleva categoría: %d %s", r.Codigo, r.Cuerpo)
		}

		// Borrar el aporte: la meta sigue y su avance, que se calcula de sus aportes, baja solo.
		if r := laura.llamar("DELETE", rutaMovimientos+"/"+aporte, ""); r.Codigo != 204 {
			t.Fatalf("borrar el aporte: %d %s", r.Codigo, r.Cuerpo)
		}
		if n := s.contar(`SELECT count(*) FROM meta WHERE id = $1::uuid`, meta) + 10*s.contar(`SELECT count(*) FROM movimiento WHERE meta_id = $1::uuid`, meta); n != 1 {
			t.Errorf("la meta sigue y sin aportes: %d", n)
		}
	})
}

// Corregir un movimiento propio compartido con el hogar no cambia de quién es (D-077: «Solo mío» o compartido no se corrige aquí).
func TestCorregirUnMovimientoCompartidoSigueSiendoCompartido(t *testing.T) {
	s := nuevoServidor(t)
	c, persona := s.nuevaCuenta("laura@ejemplo.test", false, true)
	id := s.registrar(c, "gasto", "100", "2026-10-25", "1", "")
	hogar := s.sembrarHogar(persona)
	if _, err := s.pool.Exec(context.Background(), `UPDATE movimiento SET hogar_id = $2::uuid WHERE persona_id = $1::uuid`, persona, hogar); err != nil {
		t.Fatal(err)
	}
	if r := c.llamar("PUT", rutaMovimientos+"/"+id, cuerpoDe("gasto", "250", "2026-10-25", "1", "")); r.Codigo != 200 || !strings.Contains(r.Cuerpo, `"compartido":true`) {
		t.Errorf("corregir: %d %s", r.Codigo, r.Cuerpo)
	}
	if n := s.contar(`SELECT count(*) FROM movimiento WHERE id = $1::uuid AND hogar_id = $2::uuid AND monto = 250`, id, hogar); n != 1 {
		t.Errorf("sigue compartido con el mismo hogar: %d", n)
	}
}

// Las cuatro rutas son requiere_autorizacion: sin autorizar dan 403 antes de leer o tocar nada; sin sesión, 401.
func TestLasRutasDeMovimientosExigenAutorizacion(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		autorizada, _ := s.nuevaCuenta("otra@ejemplo.test", android, true)
		id := s.registrar(autorizada, "gasto", "100", "2026-10-25", "1", "")
		c, _ := s.nuevaCuenta("laura@ejemplo.test", android, false)
		for _, p := range [][3]string{
			{"GET", rutaMovimientos, ""}, {"GET", rutaMovimientos + "/" + id, ""},
			{"PUT", rutaMovimientos + "/" + id, cuerpoDe("gasto", "1", "2026-10-25", "1", "")}, {"DELETE", rutaMovimientos + "/" + id, ""},
		} {
			if r := c.llamar(p[0], p[1], p[2]); r.Codigo != 403 || r.Cuerpo != `{"error":"autorizacion_pendiente"}` {
				t.Errorf("%s %s sin autorizar: %d %s", p[0], p[1], r.Codigo, r.Cuerpo)
			}
			if r := (&cliente{s: s, android: android}).llamar(p[0], p[1], p[2]); r.Codigo != 401 || r.Cuerpo != `{"error":"sin_sesion"}` {
				t.Errorf("%s %s sin sesión: %d %s", p[0], p[1], r.Codigo, r.Cuerpo)
			}
		}
		if n := s.contar(`SELECT count(*) FROM movimiento WHERE id = $1::uuid AND monto = 100`, id); n != 1 {
			t.Errorf("nada cambia antes de autorizar: %d", n)
		}
		if r := c.llamar("POST", "/api/v1/autorizaciones", cuerpoAutorizar); r.Codigo != 200 {
			t.Fatal(r.Cuerpo)
		}
		if r := c.llamar("GET", rutaMovimientos, ""); r.Codigo != 200 {
			t.Errorf("tras autorizar: %d %s", r.Codigo, r.Cuerpo)
		}
	})
}
