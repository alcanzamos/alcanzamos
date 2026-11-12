//go:build integration

// Pruebas de integración de las tareas de limpieza de cuentas contra PostgreSQL (D-135). Solo datos sintéticos.
package pg_test

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/pg"
)

// semillaEdad crea una cuenta de la edad dada: si verificada, completada con el enlace (con contraseña y sesión); si no,
// pendiente (solo el correo y el enlace). autorizadas son las finalidades otorgadas por la propia persona.
func (e *entornoDeCuentas) semillaEdad(t *testing.T, correo string, diasDeCreada int, verificada bool, autorizadas ...string) string {
	t.Helper()
	if verificada {
		e.crear(t, correo)
	} else {
		e.pendiente(t, correo)
	}
	id := personaDe(t, e.entorno, correo)
	if _, err := e.pool.Exec(context.Background(), `UPDATE persona SET creada_en = $1 WHERE id = $2::uuid`, ahora.Add(-time.Duration(diasDeCreada)*24*time.Hour), id); err != nil {
		t.Fatal(err)
	}
	for _, f := range autorizadas {
		otorgar(t, e.pool, id, id, f)
	}
	return id
}

// DAT-006 (D-135): la tarea con la hora de hoy fija.
func TestBorrarCuentasSinConfirmar(t *testing.T) {
	ctx := context.Background()
	e := nuevoEntornoDeCuentas(t)
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}
	e.semillaEdad(t, "sin-confirmar-7@ejemplo.test", 7, false)                                                     // se borra
	e.semillaEdad(t, "sin-confirmar-6@ejemplo.test", 6, false)                                                     // se queda: faltan horas
	e.semillaEdad(t, "sin-confirmar-90@ejemplo.test", 90, false)                                                   // se borra
	e.semillaEdad(t, "confirmada-sin-autorizar-7@ejemplo.test", 7, true)                                           // se borra: nunca autorizó nada
	e.semillaEdad(t, "confirmada-sin-autorizar-6@ejemplo.test", 6, true)                                           // se queda
	sinConfirmarAutorizada := e.semillaEdad(t, "autorizada-sin-confirmar-7@ejemplo.test", 7, false, necesarias...) // se borra: no confirmó el correo
	e.semillaEdad(t, "confirmada-y-autorizada-7@ejemplo.test", 7, true, necesarias...)                             // nunca
	e.semillaEdad(t, "confirmada-y-autorizada-400@ejemplo.test", 400, true, necesarias...)
	// Con alguna autorización como titular ya no se borra, aunque le falten necesarias (SC-E21-25, sección 5): se queda en
	// `sin_autorizacion` hasta que acepte, sin plazo (D-202).
	e.semillaEdad(t, "autorizacion-parcial-7@ejemplo.test", 7, true, "cuenta_y_acceso", "avisos") // se queda: ya autorizó algo
	// Una cuenta con una autorización de otra persona sobre ella y la propia incompleta: tiene filas como titular.
	ajena := e.semillaEdad(t, "autorizada-por-otra-7@ejemplo.test", 7, true, "cuenta_y_acceso")
	otorgar(t, e.pool, ajena, personaDe(t, e.entorno, "confirmada-y-autorizada-7@ejemplo.test"), "funciones_financieras")
	// Una cuenta que pasó de menor a adulta: sin correo, con fecha_de_paso. No es de esta tarea.
	var pasada string
	tx, err := e.pool.Begin(ctx) // el disparador diferido exige persona y perfil en la misma transacción
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Mateo', 'adulta', $1) RETURNING id::text`, ahora.Add(-4000*24*time.Hour)).Scan(&pasada); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, fecha_de_paso) VALUES ($1::uuid, '2026-10-01')`, pasada); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	enviadosAntes := len(e.correo.Enviados())

	n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora)
	if err != nil || n != 4 {
		t.Fatalf("borradas %d (%v), se esperaban 4", n, err)
	}
	quedan := map[string]bool{}
	filas, err := e.pool.Query(ctx, `SELECT correo FROM perfil_adulto WHERE correo IS NOT NULL`)
	if err != nil {
		t.Fatal(err)
	}
	for filas.Next() {
		var c string
		if err := filas.Scan(&c); err != nil {
			t.Fatal(err)
		}
		quedan[c] = true
	}
	filas.Close()
	for _, c := range []string{"sin-confirmar-6@ejemplo.test", "confirmada-sin-autorizar-6@ejemplo.test", "confirmada-y-autorizada-7@ejemplo.test",
		"confirmada-y-autorizada-400@ejemplo.test", "autorizacion-parcial-7@ejemplo.test", "autorizada-por-otra-7@ejemplo.test"} {
		if !quedan[c] {
			t.Errorf("%s debía quedarse", c)
		}
	}
	if len(quedan) != 6 {
		t.Errorf("quedan %v", quedan)
	}
	if contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, pasada) != 1 {
		t.Error("la cuenta que pasó de menor a adulta no entra en esta tarea")
	}
	// El CASCADE se lleva lo demás de las cuentas borradas, las sesiones incluidas. Se quedan 6 cuentas: 5 completadas (con
	// credencial, sesión y su enlace ya usado) y la pendiente de 6 días (solo con su enlace sin usar).
	for tabla, esperado := range map[string]int{"credencial": 5, "enlace_un_uso": 6, "sesion": 5} {
		if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != esperado {
			t.Errorf("%s: %d, se esperaban %d", tabla, n, esperado)
		}
	}
	if len(e.correo.Enviados()) != enviadosAntes {
		t.Error("la tarea no envía ningún correo")
	}
	// La prueba mínima de la autorización de la cuenta sin confirmar que se borró queda retirada y con plazo (E13 §7); la de
	// las que se quedan, intacta.
	var retirada, conservar time.Time
	if err := e.pool.QueryRow(ctx, `SELECT retirada_en, conservar_hasta FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'cuenta_y_acceso'`, sinConfirmarAutorizada).Scan(&retirada, &conservar); err != nil {
		t.Fatal(err)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE retirada_en IS NOT NULL`); n != 3 {
		t.Errorf("solo las tres autorizaciones de la cuenta borrada quedan retiradas: %d", n)
	}
	if !retirada.Equal(ahora) || conservar.Format("2006-01-02") != "2029-11-10" {
		t.Errorf("retirada %v, conservar_hasta %v", retirada, conservar)
	}
	// Idempotente: una segunda pasada no encuentra nada.
	if n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora); err != nil || n != 0 {
		t.Errorf("segunda pasada: %d, %v", n, err)
	}
	// Un día después las de 6 días cumplen el plazo; las confirmadas y autorizadas, nunca.
	if n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora.Add(24*time.Hour)); err != nil || n != 2 {
		t.Errorf("un día después: %d, %v; se esperaban 2 (las de 6 días)", n, err)
	}
	if n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora.Add(60*24*time.Hour)); err != nil || n != 0 {
		t.Errorf("a los 60 días las confirmadas y autorizadas siguen: %d, %v", n, err)
	}
	if contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE correo LIKE 'confirmada-y-autorizada%'`) != 2 {
		t.Error("las confirmadas y autorizadas nunca se borran")
	}
}

func TestLimpiarSesionesYEnlaces(t *testing.T) {
	ctx := context.Background()
	e := nuevoEntornoDeCuentas(t)
	id := e.semillaEdad(t, "laura@ejemplo.test", 1, true)
	// La creación dejó una sesión y un enlace vigentes; se parte de una base limpia de ambos.
	if _, err := e.pool.Exec(ctx, `DELETE FROM sesion; DELETE FROM enlace_un_uso`); err != nil {
		t.Fatal(err)
	}
	l := pg.NuevoLimpieza(e.pool)
	sesionDe := func(clave byte, vence time.Time) {
		t.Helper()
		if _, err := e.pool.Exec(ctx,
			`INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en) VALUES ($1, $2::uuid, $3, $3, $4)`,
			bytes.Repeat([]byte{clave}, 32), id, ahora.Add(-48*time.Hour), vence); err != nil {
			t.Fatal(err)
		}
	}
	enlaceDe := func(clave byte, vence time.Time) {
		t.Helper()
		if _, err := e.pool.Exec(ctx,
			`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en) VALUES ($1, $2::uuid, 'recuperacion', $3, $4)`,
			bytes.Repeat([]byte{clave}, 32), id, ahora.Add(-48*time.Hour), vence); err != nil {
			t.Fatal(err)
		}
	}
	sesionDe(1, ahora.Add(-time.Second)) // vencida
	sesionDe(2, ahora)                   // vence justo ahora: todavía no (vence_en < ahora)
	sesionDe(3, ahora.Add(time.Hour))
	enlaceDe(1, ahora.Add(-time.Minute)) // vencido
	enlaceDe(2, ahora.Add(time.Hour))
	s, en, err := l.LimpiarSesionesYEnlaces(ctx, ahora)
	if err != nil || s != 1 || en != 1 {
		t.Fatalf("borradas: %d sesiones, %d enlaces (%v)", s, en, err)
	}
	if contar(t, e.pool, `SELECT count(*) FROM sesion`) != 2 || contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE proposito = 'recuperacion'`) != 1 {
		t.Error("quedaron filas de más o de menos")
	}
	if s, en, err := l.LimpiarSesionesYEnlaces(ctx, ahora); err != nil || s != 0 || en != 0 {
		t.Errorf("segunda pasada: %d, %d, %v", s, en, err)
	}
}

// SC-E21-25, sección 5 y criterio 9 (D-202): la tarea diaria no borra una cuenta que ya autorizó algo antes. Una cuenta de más
// de 7 días, con el correo confirmado y las dos necesarias de antes pero sin `transmision_a_encargados`, sigue existiendo
// con todos sus datos; una sin ninguna autorización se borra, como hoy (D-135). La prueba falla si la tarea borra la primera.
func TestLaTareaNoBorraUnaCuentaQueYaAutorizoAlgo(t *testing.T) {
	ctx := context.Background()
	e := nuevoEntornoDeCuentas(t)
	antes := e.semillaEdad(t, "autorizo-antes@ejemplo.test", 8, true, "cuenta_y_acceso", "funciones_financieras")
	control := e.semillaEdad(t, "nunca-autorizo@ejemplo.test", 8, true)
	retirada := e.semillaEdad(t, "autorizo-y-retiro@ejemplo.test", 8, true, "avisos")
	if _, err := e.pool.Exec(ctx, `UPDATE autorizacion SET retirada_en = otorgada_en + interval '1 minute' WHERE titular_id = $1::uuid`, retirada); err != nil {
		t.Fatal(err)
	}
	// Los datos de la cuenta de antes: un movimiento propio, para comprobar que no se pierde nada.
	if _, err := e.pool.Exec(ctx,
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 25000, '2026-11-02', 'efectivo', 'mercado', 1)`, antes); err != nil {
		t.Fatal(err)
	}
	vigentesAntes := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL AND conservar_hasta IS NULL`, antes)
	if vigentesAntes != 2 {
		t.Fatalf("la semilla debía dejar 2 autorizaciones vigentes: %d", vigentesAntes)
	}

	// La primera pasada borra solo la de control; las siguientes, aun a los 60 y a los 400 días, no encuentran nada más.
	for i, hoy := range []time.Time{ahora, ahora, ahora.Add(60 * 24 * time.Hour), ahora.Add(400 * 24 * time.Hour)} {
		quiere := 0
		if i == 0 {
			quiere = 1
		}
		if n, err := e.svc.BorrarCuentasSinConfirmar(ctx, hoy); err != nil || n != quiere {
			t.Fatalf("pasada %d: borradas %d (%v), se esperaban %d", i+1, n, err, quiere)
		}
	}
	existe := func(id string) bool {
		return contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, id) == 1
	}
	if !existe(antes) {
		t.Fatal("la tarea borró una cuenta de más de 7 días con el correo confirmado y las necesarias de antes: ya autorizó algo (SC-E21-25, criterio 9)")
	}
	if !existe(retirada) {
		t.Error("una cuenta con una autorización retirada también ya autorizó algo: no se borra")
	}
	if existe(control) {
		t.Error("la cuenta de control, sin ninguna autorización, debía borrarse como hoy (D-135)")
	}
	// Con todos sus datos: perfil, credencial, sesión, movimiento y las dos autorizaciones vigentes, sin retirar ni plazo.
	for tabla, consulta := range map[string]string{
		"perfil_adulto": `SELECT count(*) FROM perfil_adulto WHERE persona_id = $1::uuid AND correo_verificado`,
		"credencial":    `SELECT count(*) FROM credencial WHERE persona_id = $1::uuid`,
		"sesion":        `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`,
		"movimiento":    `SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid AND descripcion = 'mercado'`,
	} {
		if contar(t, e.pool, consulta, antes) != 1 {
			t.Errorf("a la cuenta que ya autorizó algo le falta %s", tabla)
		}
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL AND conservar_hasta IS NULL`, antes); n != 2 {
		t.Errorf("sus autorizaciones debían seguir vigentes y sin plazo de conservación: %d", n)
	}
	// El control se fue entero, sin dejar autorizaciones (no tenía).
	if contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE persona_id = $1::uuid`, control) != 0 {
		t.Error("el perfil de la cuenta de control debía borrarse")
	}
}
