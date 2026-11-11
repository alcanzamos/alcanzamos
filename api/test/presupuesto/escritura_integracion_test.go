//go:build integration

package presupuesto_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

// fotoDePresupuestos es todo lo guardado en `presupuesto`, ordenado.
func (s *servidorDePrueba) fotoDePresupuestos() string {
	s.t.Helper()
	var foto string
	if err := s.pool.QueryRow(context.Background(), `SELECT coalesce(string_agg(concat_ws('|', persona_id, coalesce(hogar_id::text, 'sin hogar'), categoria_id,
		categoria_tipo, periodo, monto_asignado), ' ' ORDER BY persona_id, periodo, categoria_id), '') FROM presupuesto`).Scan(&foto); err != nil {
		s.t.Fatal(err)
	}
	return foto
}

func presupuestoDe(t *testing.T, r respuesta) presupuesto.Presupuesto {
	t.Helper()
	var p presupuesto.Presupuesto
	if err := json.Unmarshal([]byte(r.Cuerpo), &p); err != nil || p.ID == "" {
		t.Fatalf("%v: %d %s", err, r.Codigo, r.Cuerpo)
	}
	return p
}

// CU-09 de punta a punta: poner (201), poner otra vez la misma categoría (200, la misma fila, E13), corregir el error de
// tecleo de E14-PPA 2.2 ($400.000 por $40.000) y quitar (204), que no toca ningún gasto. El presupuesto es propio: con
// `persona_id` y sin `hogar_id` (L3), de tipo gasto y del día 1 del mes.
func TestIntegracionPonerCorregirYQuitar(t *testing.T) {
	formas(t, func(t *testing.T, android bool) {
		s := nuevoServidor(t)
		c := s.nuevaPersona("laura@ejemplo.test", android, true)
		c.registrar(registro.Gasto, 4000000, "2026-11-01", transporte, "")

		r := c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":40000000}`)
		if r.Codigo != 201 || r.Cache != "no-store" {
			t.Fatalf("poner: %d %s", r.Codigo, r.Cuerpo)
		}
		p := presupuestoDe(t, r)
		if p.CategoriaID != transporte || p.Periodo != "2026-11" || p.MontoCentavos != 40000000 {
			t.Errorf("poner: %+v", p)
		}
		if got := s.fotoDePresupuestos(); got != c.persona+"|sin hogar|8|gasto|2026-11-01|40000000" {
			t.Errorf("guardado: %s", got)
		}
		v := leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
		if got := filasDeLaVista(v); got != "8:4000000:40000000:quedan" || *v.Categorias[0].Quedan != "36000000" || v.Categorias[0].Presupuesto.ID != p.ID {
			t.Errorf("con presupuesto: %s %+v", got, v.Categorias)
		}

		r = c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":40000001}`)
		if otra := presupuestoDe(t, r); r.Codigo != 200 || otra.ID != p.ID || otra.MontoCentavos != 40000001 {
			t.Errorf("poner otra vez: %d %s", r.Codigo, r.Cuerpo)
		}
		r = c.llamar("PUT", "/api/v1/presupuestos/"+p.ID, `{"monto_centavos":4000000}`)
		if corregido := presupuestoDe(t, r); r.Codigo != 200 || r.Cache != "no-store" || corregido != (presupuesto.Presupuesto{ID: p.ID, CategoriaID: transporte, Periodo: "2026-11", MontoCentavos: 4000000}) {
			t.Errorf("corregir: %d %s", r.Codigo, r.Cuerpo)
		}
		if got := s.fotoDePresupuestos(); got != c.persona+"|sin hogar|8|gasto|2026-11-01|4000000" {
			t.Errorf("corregido: %s", got)
		}
		v = leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
		if got := filasDeLaVista(v); got != "8:4000000:4000000:usado_todo" {
			t.Errorf("corregido: %s", got)
		}

		if r := c.llamar("DELETE", "/api/v1/presupuestos/"+p.ID, ""); r.Codigo != 204 || r.Cuerpo != "" || r.Cache != "no-store" {
			t.Errorf("quitar: %d %s", r.Codigo, r.Cuerpo)
		}
		if got := s.fotoDePresupuestos(); got != "" {
			t.Errorf("quitado: %s", got)
		}
		v = leerJSON[vistaLeida](t, c.llamar("GET", "/api/v1/presupuestos", ""))
		if got := filasDeLaVista(v); got != "8:4000000:-:-" {
			t.Errorf("tras quitar, el gasto sigue: %s", got)
		}
		if r := c.llamar("DELETE", "/api/v1/presupuestos/"+p.ID, ""); r.Codigo != 404 || r.Cuerpo != `{"error":"no_encontrado"}` {
			t.Errorf("quitar otra vez: %d %s", r.Codigo, r.Cuerpo)
		}
		if r := c.llamar("PUT", "/api/v1/presupuestos/"+p.ID, `{"monto_centavos":1}`); r.Codigo != 404 {
			t.Errorf("corregir lo quitado: %d %s", r.Codigo, r.Cuerpo)
		}
	})
}

// Solo una categoría de gasto que la persona ve: una de ingreso, una que no existe y una oculta dan `422
// categoria_invalida` sin guardar nada. La general («Otros gastos») sí. Una oculta que ya tiene presupuesto en el mes se
// corrige (RN-011: sigue en la lista con «Corregir»).
func TestIntegracionQueCategoriasSePresupuestan(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", false, true)
	s.ejecutar(`INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, $2)`, c.persona, recreacion)
	for _, categoria := range []string{"17", "99", "11"} {
		r := c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":`+categoria+`,"monto_centavos":100}`)
		if r.Codigo != 422 || r.Cuerpo != `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}` {
			t.Errorf("categoría %s: %d %s", categoria, r.Codigo, r.Cuerpo)
		}
	}
	if got := s.fotoDePresupuestos(); got != "" {
		t.Fatalf("no se guarda nada: %s", got)
	}
	if r := c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":16,"monto_centavos":100}`); r.Codigo != 201 {
		t.Errorf("Otros gastos: %d %s", r.Codigo, r.Cuerpo)
	}
	p := presupuestoDe(t, c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":100}`))
	s.ejecutar(`INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, $2)`, c.persona, transporte)
	if r := c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":200}`); r.Codigo != 200 || presupuestoDe(t, r).ID != p.ID {
		t.Errorf("oculta con presupuesto: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("PUT", "/api/v1/presupuestos/"+p.ID, `{"monto_centavos":300}`); r.Codigo != 200 {
		t.Errorf("corregir la oculta: %d %s", r.Codigo, r.Cuerpo)
	}
	if got := s.fotoDePresupuestos(); got != c.persona+"|sin hogar|8|gasto|2026-11-01|300 "+c.persona+"|sin hogar|16|gasto|2026-11-01|100" {
		t.Errorf("guardado: %s", got)
	}
}

// D-094: el presupuesto de otro mes no se pone, corrige ni quita (409, sin cambiar nada); el de otra persona da 404, el
// mismo código que uno que no existe.
func TestIntegracionOtroMesYLoAjeno(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", true, true)
	otra := s.nuevaPersona("otra@ejemplo.test", true, true)
	var octubre, ajeno string
	if err := s.pool.QueryRow(context.Background(), `INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 1, '2026-10-01', 9900) RETURNING id::text`, c.persona).Scan(&octubre); err != nil {
		t.Fatal(err)
	}
	ajeno = presupuestoDe(t, otra.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":1,"monto_centavos":5000}`)).ID
	antes := s.fotoDePresupuestos()
	for _, p := range []struct{ metodo, ruta, cuerpo, quiere string }{
		{"PUT", "/api/v1/presupuestos/" + octubre, `{"monto_centavos":1}`, `{"error":"periodo_no_editable"}`},
		{"DELETE", "/api/v1/presupuestos/" + octubre, "", `{"error":"periodo_no_editable"}`},
		{"POST", "/api/v1/presupuestos", `{"periodo":"2026-10","categoria_id":1,"monto_centavos":1}`, `{"error":"periodo_no_editable"}`},
		{"POST", "/api/v1/presupuestos", `{"periodo":"2026-12","categoria_id":1,"monto_centavos":1}`, `{"error":"periodo_no_editable"}`},
		{"PUT", "/api/v1/presupuestos/" + ajeno, `{"monto_centavos":1}`, `{"error":"no_encontrado"}`},
		{"DELETE", "/api/v1/presupuestos/" + ajeno, "", `{"error":"no_encontrado"}`},
	} {
		if r := c.llamar(p.metodo, p.ruta, p.cuerpo); r.Cuerpo != p.quiere {
			t.Errorf("%s %s: %d %s", p.metodo, p.ruta, r.Codigo, r.Cuerpo)
		}
	}
	if despues := s.fotoDePresupuestos(); despues != antes {
		t.Errorf("cambió:\n%s\n%s", antes, despues)
	}
}

// L14 (cambio 2) de la US-77: la escritura, como la lectura, solo toca los presupuestos propios (`hogar_id` nulo). Uno
// compartido con el hogar, aunque lo haya puesto la misma persona y sea del mes en curso, no se corrige ni se quita
// (`404 no_encontrado`, el mismo de uno ajeno) y el repositorio no lo lee (Obtener), ni lo corrige ni lo quita aunque el
// servicio no lo hubiera comprobado antes. Una categoría oculta que solo tiene un presupuesto compartido no vale para
// «Poner» (`422 categoria_invalida`): la excepción de RN-011 es para la que ya tiene presupuesto propio. Nada cambia.
func TestIntegracionLaEscrituraNoTocaLosPresupuestosCompartidos(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", false, true)
	hogarID := s.nuevoHogar(c.persona)
	var compartido string
	if err := s.pool.QueryRow(context.Background(), `INSERT INTO presupuesto (persona_id, hogar_id, categoria_id, periodo, monto_asignado)
		VALUES ($1::uuid, $2::uuid, $3, '2026-11-01', 5000000), ($1::uuid, $2::uuid, $4, '2026-11-01', 7000000) RETURNING id::text`,
		c.persona, hogarID, transporte, recreacion).Scan(&compartido); err != nil {
		t.Fatal(err)
	}
	s.ejecutar(`INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, $2)`, c.persona, recreacion)
	antes := s.fotoDePresupuestos()

	for _, p := range []struct{ metodo, ruta, cuerpo, quiere string }{
		{"PUT", "/api/v1/presupuestos/" + compartido, `{"monto_centavos":1}`, `{"error":"no_encontrado"}`},
		{"DELETE", "/api/v1/presupuestos/" + compartido, "", `{"error":"no_encontrado"}`},
		{"POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":11,"monto_centavos":1}`, `{"campos":{"categoria_id":"categoria_invalida"},"error":"datos_invalidos"}`},
	} {
		if r := c.llamar(p.metodo, p.ruta, p.cuerpo); r.Cuerpo != p.quiere {
			t.Errorf("%s %s: %d %s", p.metodo, p.ruta, r.Codigo, r.Cuerpo)
		}
	}

	repo := pg.NuevoPresupuestos(s.pool)
	ctx, noviembre := context.Background(), time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	if _, err := repo.Obtener(ctx, c.persona, compartido); !errors.Is(err, presupuesto.ErrNoEncontrado) {
		t.Errorf("obtener: %v", err)
	}
	if err := repo.Corregir(ctx, c.persona, compartido, noviembre, 1); !errors.Is(err, presupuesto.ErrNoEncontrado) {
		t.Errorf("corregir: %v", err)
	}
	if err := repo.Quitar(ctx, c.persona, compartido, noviembre); !errors.Is(err, presupuesto.ErrNoEncontrado) {
		t.Errorf("quitar: %v", err)
	}
	if despues := s.fotoDePresupuestos(); despues != antes {
		t.Errorf("cambió:\n%s\n%s", antes, despues)
	}
}

// D-201 (opción A de L16 de la US-77): la clave única de E13 (persona, periodo, categoría) no
// lleva `hogar_id`, así que «Poner» en una categoría que en el mes ya tiene un presupuesto compartido con el hogar de la
// misma persona chocaría con esa fila. No la toca: `409 presupuesto_compartido`, por HTTP y en el repositorio
// (ErrPresupuestoCompartido), y nada cambia. Lo propio sigue igual: otra categoría del mes se crea (201) y se corrige
// (200), y la misma categoría en otro mes se crea.
func TestIntegracionPonerConUnPresupuestoCompartidoEs409(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", true, true)
	hogarID := s.nuevoHogar(c.persona)
	s.ejecutar(`INSERT INTO presupuesto (persona_id, hogar_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2::uuid, $3, '2026-11-01', 5000000)`,
		c.persona, hogarID, transporte)
	compartido := c.persona + "|" + hogarID + "|8|gasto|2026-11-01|5000000"
	if got := s.fotoDePresupuestos(); got != compartido {
		t.Fatalf("sembrado: %s", got)
	}

	for range 2 {
		if r := c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":1}`); r.Codigo != 409 || r.Cuerpo != `{"error":"presupuesto_compartido"}` {
			t.Errorf("poner sobre el compartido: %d %s", r.Codigo, r.Cuerpo)
		}
	}
	repo := pg.NuevoPresupuestos(s.pool)
	ctx := context.Background()
	noviembre, octubre := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	if g, creado, err := repo.Poner(ctx, c.persona, transporte, noviembre, 2); !errors.Is(err, presupuesto.ErrPresupuestoCompartido) || creado || g != (presupuesto.Guardado{}) {
		t.Errorf("repositorio: %+v %v %v", g, creado, err)
	}
	if got := s.fotoDePresupuestos(); got != compartido {
		t.Fatalf("el compartido cambió: %s", got)
	}

	r := c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":1,"monto_centavos":300}`)
	propio := presupuestoDe(t, r)
	if r.Codigo != 201 {
		t.Errorf("otra categoría: %d %s", r.Codigo, r.Cuerpo)
	}
	if r := c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":1,"monto_centavos":400}`); r.Codigo != 200 || presupuestoDe(t, r).ID != propio.ID {
		t.Errorf("corregir la otra categoría: %d %s", r.Codigo, r.Cuerpo)
	}
	if _, creado, err := repo.Poner(ctx, c.persona, transporte, octubre, 500); err != nil || !creado {
		t.Errorf("la misma categoría en otro mes: %v %v", creado, err)
	}
	if got := s.fotoDePresupuestos(); got != c.persona+"|sin hogar|8|gasto|2026-10-01|500 "+c.persona+"|sin hogar|1|gasto|2026-11-01|400 "+compartido {
		t.Errorf("guardado: %s", got)
	}
}

// S7: la comprobación va dentro de la misma escritura, sin carrera entre comprobar y escribir. Una transacción siembra el
// presupuesto compartido y no confirma; «Poner» de la misma categoría y mes queda esperando en el índice único; la
// transacción confirma y «Poner» responde ErrPresupuestoCompartido sin tocar la fila. Un «comprobar y después escribir»
// no habría visto la fila sin confirmar y la habría pisado al chocar.
func TestIntegracionPonerNoPisaUnCompartidoQueLlegaALaVez(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", false, true)
	hogarID := s.nuevoHogar(c.persona)
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO presupuesto (persona_id, hogar_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2::uuid, $3, '2026-11-01', 5000000)`,
		c.persona, hogarID, transporte); err != nil {
		t.Fatal(err)
	}

	resultado := make(chan error, 1)
	go func() {
		_, _, err := pg.NuevoPresupuestos(s.pool).Poner(ctx, c.persona, transporte, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), 1)
		resultado <- err
	}()
	esperando := false
	for limite := time.Now().Add(10 * time.Second); !esperando && time.Now().Before(limite); time.Sleep(10 * time.Millisecond) {
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock')`).Scan(&esperando); err != nil {
			t.Fatal(err)
		}
	}
	if !esperando {
		t.Fatal("«Poner» no llegó a esperar la fila sin confirmar")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-resultado; !errors.Is(err, presupuesto.ErrPresupuestoCompartido) {
		t.Errorf("poner: %v", err)
	}
	if got := s.fotoDePresupuestos(); got != c.persona+"|"+hogarID+"|8|gasto|2026-11-01|5000000" {
		t.Errorf("el compartido cambió: %s", got)
	}
}

// Solo una persona adulta presupuesta (E12, RF-007): el repositorio no guarda el de una menor (ErrSoloAdultos) ni el de
// una cuenta borrada (ErrSinCuenta). Va contra el repositorio porque un menor todavía no inicia sesión (I11).
func TestIntegracionUnaMenorYUnaCuentaBorradaNoPresupuestan(t *testing.T) {
	s := nuevoServidor(t)
	repo := pg.NuevoPresupuestos(s.pool)
	noviembre := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	if _, _, err := repo.Poner(context.Background(), s.nuevoMenor(), transporte, noviembre, 100); !errors.Is(err, presupuesto.ErrSoloAdultos) {
		t.Errorf("menor: %v", err)
	}
	if _, _, err := repo.Poner(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff", transporte, noviembre, 100); !errors.Is(err, registro.ErrSinCuenta) {
		t.Errorf("cuenta borrada: %v", err)
	}
	if got := s.fotoDePresupuestos(); got != "" {
		t.Errorf("guardado: %s", got)
	}
}

// Ocho «Guardar» a la vez de la misma categoría: una sola fila (E13), uno crea (201) y los demás corrigen (200), sin 500.
func TestIntegracionPonerALaVezDejaUnaSolaFila(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", true, true)
	codigos := make([]int, 8)
	var wg sync.WaitGroup
	for i := range codigos {
		wg.Go(func() {
			codigos[i] = c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":4000000}`).Codigo
		})
	}
	wg.Wait()
	creados := 0
	for _, codigo := range codigos {
		switch codigo {
		case 201:
			creados++
		case 200:
		default:
			t.Errorf("códigos: %v", codigos)
		}
	}
	if creados != 1 || s.fotoDePresupuestos() != c.persona+"|sin hogar|8|gasto|2026-11-01|4000000" {
		t.Errorf("códigos %v, guardado %s", codigos, s.fotoDePresupuestos())
	}
}

// SEG-016 (E17 3.15, D-194) en las cuatro rutas que escriben: lo que la defensa rechaza no guarda, corrige ni quita nada,
// ni deja el mes en cero.
func TestIntegracionLaDefensaContraCSRFNoCambiaNada(t *testing.T) {
	s := nuevoServidor(t)
	c := s.nuevaPersona("laura@ejemplo.test", false, true)
	p := presupuestoDe(t, c.llamar("POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":8,"monto_centavos":4000000}`))
	antes := s.fotoDePresupuestos()
	for _, r := range []struct{ metodo, ruta, cuerpo string }{
		{"POST", "/api/v1/presupuestos", `{"periodo":"2026-11","categoria_id":1,"monto_centavos":1}`},
		{"POST", "/api/v1/presupuestos/en-cero", `{"periodo":"2026-11"}`},
		{"PUT", "/api/v1/presupuestos/" + p.ID, `{"monto_centavos":1}`},
		{"DELETE", "/api/v1/presupuestos/" + p.ID, ""},
	} {
		for _, cabeceras := range []map[string]string{
			{"Sec-Fetch-Site": "cross-site", "Content-Type": "application/json"},
			{"Origin": "https://atacante.example", "Content-Type": "application/json"},
			{"Sec-Fetch-Site": "same-origin", "Content-Type": "text/plain"},
		} {
			req := httptest.NewRequest(r.metodo, r.ruta, strings.NewReader(r.cuerpo))
			req.AddCookie(sesion.Cookie(c.token))
			for k, v := range cabeceras {
				req.Header.Set(k, v)
			}
			rr := httptest.NewRecorder()
			s.h.ServeHTTP(rr, req)
			if rr.Code != 403 && rr.Code != 415 {
				t.Errorf("%s %s %v: %d %s", r.metodo, r.ruta, cabeceras, rr.Code, rr.Body)
			}
		}
	}
	if despues := s.fotoDePresupuestos(); despues != antes {
		t.Errorf("cambió:\n%s\n%s", antes, despues)
	}
	if got := s.fotoDeEnCero(); got != "" {
		t.Errorf("quedó en cero: %q", got)
	}
}

// Con la base caída o una tabla que falta, cada operación del repositorio devuelve un error de infraestructura y no una
// respuesta de negocio (sin cuenta, no encontrado, solo adultos, categoría inválida): una caída nunca se confunde con
// «no existe».
func TestIntegracionConLaBaseRotaCadaOperacionFalla(t *testing.T) {
	ctx := context.Background()
	noviembre := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	deNegocio := []error{registro.ErrSinCuenta, registro.ErrCategoriaInvalida, presupuesto.ErrNoEncontrado, presupuesto.ErrSoloAdultos,
		presupuesto.ErrPeriodoConIngresoOPresupuesto, presupuesto.ErrPresupuestoCompartido}
	operaciones := func(repo *pg.Presupuestos, persona, id string) map[string]error {
		_, errP := repo.Presupuesto(ctx, persona, noviembre)
		_, errI := repo.Ingresos(ctx, persona, noviembre)
		_, _, errPoner := repo.Poner(ctx, persona, transporte, noviembre, 100)
		_, errO := repo.Obtener(ctx, persona, id)
		return map[string]error{"Presupuesto": errP, "Ingresos": errI, "Poner": errPoner, "Obtener": errO,
			"Corregir": repo.Corregir(ctx, persona, id, noviembre, 200), "Quitar": repo.Quitar(ctx, persona, id, noviembre),
			"DejarEnCero": repo.DejarEnCero(ctx, persona, noviembre)}
	}
	casos := []struct {
		nombre, preparar string
		fallan           []string
	}{
		{"pool cerrado", "", []string{"Presupuesto", "Ingresos", "Poner", "Obtener", "Corregir", "Quitar", "DejarEnCero"}},
		{"sin perfil de adulta", `ALTER TABLE perfil_adulto RENAME TO perfil_adulto_x`, []string{"Presupuesto", "Ingresos", "Poner", "DejarEnCero"}},
		{"sin ocultamientos", `ALTER TABLE ocultamiento_categoria RENAME TO ocultamiento_x`, []string{"Presupuesto", "Ingresos", "Poner"}},
		{"sin presupuestos", `ALTER TABLE presupuesto RENAME TO presupuesto_x`, []string{"Presupuesto", "Poner", "Obtener", "Corregir", "Quitar", "DejarEnCero"}},
		{"sin la marca en cero", `ALTER TABLE presupuesto_en_cero RENAME TO en_cero_x`, []string{"Presupuesto"}},
		{"sin movimientos", `ALTER TABLE movimiento RENAME TO movimiento_x`, []string{"Presupuesto", "Ingresos", "DejarEnCero"}},
		{"sin la descripción de los movimientos", `ALTER TABLE movimiento RENAME COLUMN descripcion TO descripcion_x`, []string{"Presupuesto", "Ingresos"}},
		{"sin repeticiones", `ALTER TABLE movimiento_recurrente RENAME TO recurrente_x`, []string{"Presupuesto", "Ingresos"}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			s := nuevoServidor(t)
			persona := s.nuevaPersona("laura@ejemplo.test", false, true)
			var id string
			if err := s.pool.QueryRow(ctx, `INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 1, $2, 100) RETURNING id::text`,
				persona.persona, noviembre).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if c.preparar == "" {
				s.pool.Close()
			} else {
				s.ejecutar(c.preparar)
			}
			errores := operaciones(pg.NuevoPresupuestos(s.pool), persona.persona, id)
			for _, nombre := range c.fallan {
				err := errores[nombre]
				if err == nil {
					t.Errorf("%s: se esperaba un error", nombre)
				}
				for _, n := range deNegocio {
					if errors.Is(err, n) {
						t.Errorf("%s: un fallo de la base se confundió con %v", nombre, n)
					}
				}
			}
		})
	}
}
