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
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras"}
	e.semillaEdad(t, "sin-confirmar-7@ejemplo.test", 7, false)                           // se borra
	e.semillaEdad(t, "sin-confirmar-6@ejemplo.test", 6, false)                           // se queda: faltan horas
	e.semillaEdad(t, "sin-confirmar-90@ejemplo.test", 90, false)                         // se borra
	e.semillaEdad(t, "confirmada-sin-autorizar-7@ejemplo.test", 7, true)                 // se borra: no autorizó
	e.semillaEdad(t, "confirmada-sin-autorizar-6@ejemplo.test", 6, true)                 // se queda
	e.semillaEdad(t, "autorizada-sin-confirmar-7@ejemplo.test", 7, false, necesarias...) // se borra: no confirmó el correo
	e.semillaEdad(t, "confirmada-y-autorizada-7@ejemplo.test", 7, true, necesarias...)   // nunca
	e.semillaEdad(t, "confirmada-y-autorizada-400@ejemplo.test", 400, true, necesarias...)
	parcial := e.semillaEdad(t, "autorizacion-parcial-7@ejemplo.test", 7, true, "cuenta_y_acceso", "avisos") // se borra: falta funciones_financieras
	// Una confirmada cuya autorización necesaria la dio otra persona no cuenta como autorizada (D-139).
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
	if err != nil || n != 6 {
		t.Fatalf("borradas %d (%v), se esperaban 6", n, err)
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
	for _, c := range []string{"sin-confirmar-6@ejemplo.test", "confirmada-sin-autorizar-6@ejemplo.test", "confirmada-y-autorizada-7@ejemplo.test", "confirmada-y-autorizada-400@ejemplo.test"} {
		if !quedan[c] {
			t.Errorf("%s debía quedarse", c)
		}
	}
	if len(quedan) != 4 {
		t.Errorf("quedan %v", quedan)
	}
	if contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, pasada) != 1 {
		t.Error("la cuenta que pasó de menor a adulta no entra en esta tarea")
	}
	// El CASCADE se lleva lo demás de las cuentas borradas, las sesiones incluidas. Se quedan 4 cuentas: 3 completadas (con
	// credencial, sesión y su enlace ya usado) y la pendiente de 6 días (solo con su enlace sin usar).
	for tabla, esperado := range map[string]int{"credencial": 3, "enlace_un_uso": 4, "sesion": 3} {
		if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != esperado {
			t.Errorf("%s: %d, se esperaban %d", tabla, n, esperado)
		}
	}
	if len(e.correo.Enviados()) != enviadosAntes {
		t.Error("la tarea no envía ningún correo")
	}
	// La prueba mínima de la autorización parcial queda retirada y con plazo (E13 §7).
	var retirada, conservar time.Time
	if err := e.pool.QueryRow(ctx, `SELECT retirada_en, conservar_hasta FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'cuenta_y_acceso'`, parcial).Scan(&retirada, &conservar); err != nil {
		t.Fatal(err)
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
