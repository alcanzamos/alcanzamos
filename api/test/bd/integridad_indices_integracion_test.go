//go:build integration

package bd_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

const migracion0008 = "0008_integridad_e_indices.sql"

// movimientosEnTexto es lo guardado en `movimiento`, una fila por línea, para comparar la tabla antes y después.
func movimientosEnTexto(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var filas string
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.id), '') FROM movimiento m`).Scan(&filas); err != nil {
		t.Fatal(err)
	}
	return filas
}

func contar(t *testing.T, pool *pgxpool.Pool, tabla string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM `+tabla).Scan(&n); err != nil { // la tabla es una constante de la prueba
		t.Fatal(err)
	}
	return n
}

func definicionDeIndice(t *testing.T, pool *pgxpool.Pool, nombre string) string {
	t.Helper()
	var def string
	if err := pool.QueryRow(context.Background(), `SELECT COALESCE(max(indexdef), '') FROM pg_indexes WHERE indexname = $1`, nombre).Scan(&def); err != nil {
		t.Fatal(err)
	}
	return def
}

// crearAdulta crea una persona adulta con su perfil en una sola transacción (la base exige el perfil al confirmar).
func crearAdulta(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, 'laura@ejemplo.test', true)`, id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return id
}

// sembrarBaseDeLa0007 carga datos con la forma que dejan las migraciones hasta la 0007: Laura con un recurrente que ya
// generó tres movimientos, otro recurrente con uno, un movimiento a mano y una meta. Devuelve los ids que las pruebas usan.
func sembrarBaseDeLa0007(t *testing.T, pool *pgxpool.Pool) (laura, recurrenteA, recurrenteB, meta string) {
	t.Helper()
	ctx := context.Background()
	un := func(sql string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%v\n%s", err, sql)
		}
		return id
	}
	laura = crearAdulta(t, pool)
	recurrenteA = un(`INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio)
	                  VALUES ($1::uuid, 'gasto', 10, 'mensual', 1690000, 'tarjeta', '2026-08-05') RETURNING id::text`, laura)
	recurrenteB = un(`INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio)
	                  VALUES ($1::uuid, 'ingreso', 17, 'mensual', 300000000, 'transferencia', '2026-08-30') RETURNING id::text`, laura)
	meta = un(`INSERT INTO meta (persona_id, nombre, monto_objetivo) VALUES ($1::uuid, 'Viaje', 500000000) RETURNING id::text`, laura)
	for _, f := range []struct{ rec, tipo, fecha string }{
		{recurrenteA, "gasto", "2026-08-05"}, {recurrenteA, "gasto", "2026-09-05"}, {recurrenteA, "gasto", "2026-10-05"},
		{recurrenteB, "ingreso", "2026-08-30"},
	} {
		cat := 10
		if f.tipo == "ingreso" {
			cat = 17
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, recurrente_id, fecha_programada)
			 VALUES ($1::uuid, $2, 1000, $3::date + 1, 'efectivo', $4, $5::uuid, $3::date)`, laura, f.tipo, f.fecha, cat, f.rec); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id) VALUES ($1::uuid, 'gasto', 25000, '2026-10-20', 'efectivo', 1)`, laura); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, meta_id, sentido) VALUES ($1::uuid, 'aporte', 50000, '2026-10-21', 'efectivo', $2::uuid, 'entrada')`, laura, meta); err != nil {
		t.Fatal(err)
	}
	return laura, recurrenteA, recurrenteB, meta
}

// 0008 (US-103, BD-03): borrar un recurrente que ya generó movimientos funciona y cada movimiento conserva su
// `fecha_programada` con `recurrente_id` nulo. Sobre una base con los datos de la 0007: antes de subir el borrado falla
// (el CHECK exigía fecha y recurrente juntos); subir no cambia ninguna fila; después se conservan las demás garantías.
func TestMigracion0008BorrarUnRecurrenteConservaLaFechaProgramada(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.NuevaSinMigrar(t)
	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 7); err != nil {
		t.Fatalf("subir hasta la 0007: %v", err)
	}
	laura, recA, recB, meta := sembrarBaseDeLa0007(t, pool)

	// El defecto que corrige: sobre la forma de la 0007 el borrado falla y no cambia nada.
	if _, err := pool.Exec(ctx, `DELETE FROM movimiento_recurrente WHERE id = $1::uuid`, recA); violacion(err) != "23514 ck_movimiento_recurrencia" {
		t.Fatalf("antes de la 0008 el borrado debía fallar por ck_movimiento_recurrencia: %s", violacion(err))
	}
	if contar(t, pool, "movimiento_recurrente") != 2 || contar(t, pool, "movimiento") != 6 {
		t.Fatal("el borrado fallido cambió filas")
	}

	antes := movimientosEnTexto(t, pool)
	if r, err := p.UpByOne(ctx); err != nil || r.Source.Path != migracion0008 {
		t.Fatalf("subir la 0008: %+v, %v", r, err)
	}
	if despues := movimientosEnTexto(t, pool); despues != antes {
		t.Fatalf("la migración cambió filas de movimiento:\nantes:   %s\ndespués: %s", antes, despues)
	}
	if contar(t, pool, "movimiento_recurrente") != 2 || contar(t, pool, "movimiento") != 6 {
		t.Fatal("la migración cambió el número de filas")
	}

	// Los de B y los demás no se tocan al borrar A.
	var deB, manuales string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.id), '') FROM movimiento m WHERE recurrente_id = $1::uuid`, recB).Scan(&deB); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.id), '') FROM movimiento m WHERE fecha_programada IS NULL`).Scan(&manuales); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM movimiento_recurrente WHERE id = $1::uuid`, recA); err != nil {
		t.Fatalf("borrar un recurrente que ya generó movimientos: %v", err)
	}
	if n := contar(t, pool, "movimiento_recurrente"); n != 1 {
		t.Errorf("recurrentes: %d, se esperaba 1 (el B)", n)
	}
	if n := contar(t, pool, "movimiento"); n != 6 {
		t.Errorf("movimientos: %d, se esperaba 6: borrar el recurrente no borra movimientos", n)
	}
	var huerfanos string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(string_agg(fecha_programada::text, ',' ORDER BY fecha_programada), '') FROM movimiento WHERE recurrente_id IS NULL AND fecha_programada IS NOT NULL`).Scan(&huerfanos); err != nil {
		t.Fatal(err)
	}
	if huerfanos != "2026-08-05,2026-09-05,2026-10-05" {
		t.Errorf("fechas programadas conservadas con recurrente nulo: %q", huerfanos)
	}
	var nulos, conRecurrente int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE recurrente_id IS NULL), count(*) FILTER (WHERE recurrente_id = $1::uuid) FROM movimiento`, recA).Scan(&nulos, &conRecurrente); err != nil || conRecurrente != 0 || nulos != 5 {
		t.Errorf("con recurrente nulo %d (se esperaban 5: los 3 y los 2 a mano), aún apuntan al borrado %d (%v)", nulos, conRecurrente, err)
	}
	var deBDespues, manualesDespues string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.id), '') FROM movimiento m WHERE recurrente_id = $1::uuid`, recB).Scan(&deBDespues); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(string_agg(to_jsonb(m)::text, E'\n' ORDER BY m.id), '') FROM movimiento m WHERE fecha_programada IS NULL`).Scan(&manualesDespues); err != nil {
		t.Fatal(err)
	}
	if deBDespues != deB || manualesDespues != manuales {
		t.Errorf("borrar A cambió movimientos ajenos a A:\nB antes:   %s\nB después: %s\nmanuales antes:   %s\nmanuales después: %s", deB, deBDespues, manuales, manualesDespues)
	}

	// Lo que el CHECK y el UNIQUE garantizaban sigue valiendo, y cada rechazo deja la tabla igual.
	base := movimientosEnTexto(t, pool)
	for _, c := range []struct{ nombre, sql, quiere string }{
		{"un recurrente sin fecha programada",
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, recurrente_id) VALUES ('` + laura + `', 'gasto', 1000, '2026-11-01', 'efectivo', 10, '` + recB + `')`,
			"23514 ck_movimiento_recurrencia"},
		{"un aporte de un recurrente (nunca lo es)",
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, meta_id, sentido, recurrente_id, fecha_programada) VALUES ('` + laura + `', 'aporte', 1000, '2026-11-01', 'efectivo', '` + meta + `', 'entrada', '` + recB + `', '2026-11-01')`,
			"23514 ck_movimiento_recurrencia"},
		{"un aporte con fecha programada y sin recurrente",
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, meta_id, sentido, fecha_programada) VALUES ('` + laura + `', 'aporte', 1000, '2026-11-01', 'efectivo', '` + meta + `', 'entrada', '2026-11-01')`,
			"23514 ck_movimiento_recurrencia"},
		{"la misma fecha programada del mismo recurrente",
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, recurrente_id, fecha_programada) VALUES ('` + laura + `', 'ingreso', 1000, '2026-08-30', 'efectivo', 17, '` + recB + `', '2026-08-30')`,
			"23505 uq_movimiento_recurrente_programada"},
	} {
		_, err := pool.Exec(ctx, c.sql)
		if got := violacion(err); got != c.quiere {
			t.Errorf("%s: %s, se esperaba %s", c.nombre, got, c.quiere)
		}
		if despues := movimientosEnTexto(t, pool); despues != base {
			t.Errorf("%s: el rechazo cambió la tabla", c.nombre)
		}
	}
	// Dos movimientos que se quedaron sin recurrente pueden compartir fecha programada (nulo no choca con nulo): pasa cuando
	// se borran dos recurrentes con una fecha igual. El B también tiene el 2026-08-05, la misma fecha de uno del A.
	if _, err := pool.Exec(ctx,
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, recurrente_id, fecha_programada) VALUES ($1::uuid, 'ingreso', 1000, '2026-08-05', 'efectivo', 17, $2::uuid, '2026-08-05')`, laura, recB); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM movimiento_recurrente WHERE id = $1::uuid`, recB); err != nil {
		t.Fatalf("borrar el otro recurrente: %v", err)
	}
	if n := contar(t, pool, "movimiento_recurrente"); n != 0 {
		t.Errorf("recurrentes: %d, se esperaban 0", n)
	}
	var mismaFecha int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM movimiento WHERE recurrente_id IS NULL AND fecha_programada = '2026-08-05'`).Scan(&mismaFecha); err != nil || mismaFecha != 2 {
		t.Errorf("movimientos sin recurrente con la misma fecha programada: %d (%v), se esperaban 2", mismaFecha, err)
	}
	if n := contar(t, pool, "movimiento"); n != 7 {
		t.Errorf("movimientos tras borrar el segundo recurrente: %d, se esperaban 7", n)
	}
}

// El Down de la 0008 devuelve el CHECK de la 0001. Si ya hay movimientos con fecha programada y sin recurrente, falla con
// un mensaje claro y sin dejar cambios a medias: esas fechas no se borran en silencio al bajar.
func TestMigracion0008BajarSeNiegaSiHayFechasSinRecurrente(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	_, recA, _, _ := sembrarBaseDeLa0007(t, pool)
	if _, err := pool.Exec(ctx, `DELETE FROM movimiento_recurrente WHERE id = $1::uuid`, recA); err != nil {
		t.Fatal(err)
	}
	antes := movimientosEnTexto(t, pool)
	_, err = p.Down(ctx)
	if err == nil || !strings.Contains(err.Error(), "fecha_programada") || !strings.Contains(err.Error(), "recurrente_id") {
		t.Fatalf("bajar con fechas sin recurrente debía fallar nombrando fecha_programada y recurrente_id: %v", err)
	}
	if def := definicionDeIndice(t, pool, "ix_movimiento_persona_categoria_fecha"); def == "" {
		t.Error("el Down fallido dejó cambios a medias: el índice ya no está")
	}
	if movimientosEnTexto(t, pool) != antes {
		t.Error("el Down fallido cambió filas")
	}

	// Sin esas fechas (se anulan aquí, no en el producto) baja y vuelve a subir.
	if _, err := pool.Exec(ctx, `UPDATE movimiento SET fecha_programada = NULL WHERE recurrente_id IS NULL AND fecha_programada IS NOT NULL`); err != nil {
		t.Fatal(err)
	}
	if r, err := p.Down(ctx); err != nil || r.Source.Path != migracion0008 {
		t.Fatalf("Down: %+v, %v", r, err)
	}
	for _, ix := range []string{"ix_movimiento_persona_categoria_fecha", "ix_invitacion_aceptada_por", "ix_propuesta_proponente"} {
		if def := definicionDeIndice(t, pool, ix); def != "" {
			t.Errorf("tras bajar, %s no debe existir: %s", ix, def)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, fecha_programada) SELECT persona_id, 'gasto', 1, '2026-11-01', 'efectivo', 1, '2026-11-01' FROM movimiento LIMIT 1`); violacion(err) != "23514 ck_movimiento_recurrencia" {
		t.Errorf("tras bajar, el CHECK de la 0001 vuelve: %s", violacion(err))
	}
	if _, err := p.UpByOne(ctx); err != nil {
		t.Fatalf("volver a subir: %v", err)
	}
}

// 0008 (BD-05, BD-06): los tres índices nuevos existen con las columnas pedidas, y el de movimiento sirve al filtro por
// categoría de la lista de Movimientos (api/src/pg/movimientos_consulta.go): persona, categoría y rango de fecha.
func TestMigracion0008CreaLosIndices(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	for ix, quiere := range map[string][]string{
		"ix_invitacion_aceptada_por":            {"ON public.invitacion", "(aceptada_por)"},
		"ix_propuesta_proponente":               {"ON public.propuesta_transferencia", "(proponente_id)"},
		"ix_movimiento_persona_categoria_fecha": {"ON public.movimiento", "(persona_id, categoria_id, fecha)"},
	} {
		def := definicionDeIndice(t, pool, ix)
		if def == "" {
			t.Errorf("falta el índice %s", ix)
			continue
		}
		for _, parte := range quiere {
			if !strings.Contains(def, parte) {
				t.Errorf("%s: %q no contiene %q", ix, def, parte)
			}
		}
	}

	// Con volumen, el plan de la lista filtrada por categoría usa el índice nuevo (el literal hace de $4 con valor).
	laura := crearAdulta(t, pool)
	if _, err := pool.Exec(ctx,
		`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id)
		 SELECT $1::uuid, 'gasto', 1000, date '2025-01-01' + (g % 700), 'efectivo', 1 + (g % 16) FROM generate_series(1, 20000) g`, laura); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `ANALYZE movimiento`); err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx,
		fmt.Sprintf(`EXPLAIN SELECT m.id FROM movimiento m
		 WHERE m.persona_id = '%s'::uuid AND m.fecha >= '2026-10-01' AND m.fecha < '2026-11-01' AND (3::smallint IS NULL OR m.categoria_id = 3)
		 ORDER BY m.fecha DESC, m.creado_en DESC, m.id DESC`, laura))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var linea string
		if err := rows.Scan(&linea); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(linea + "\n")
	}
	if !strings.Contains(plan.String(), "ix_movimiento_persona_categoria_fecha") {
		t.Errorf("el filtro por categoría de la lista no usa el índice nuevo:\n%s", plan.String())
	}
}

// La migración sobre una base con datos no reescribe nada: las otras tablas que menciona quedan igual.
func TestMigracion0008NoCambiaOtrasTablas(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.NuevaSinMigrar(t)
	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	sembrarBaseDeLa0007(t, pool)
	foto := func() string {
		var s string
		if err := pool.QueryRow(ctx,
			`SELECT (SELECT COALESCE(string_agg(to_jsonb(p)::text, E'\n' ORDER BY id), '') FROM persona p) || '|' ||
			        (SELECT COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY id), '') FROM movimiento_recurrente r) || '|' ||
			        (SELECT COALESCE(string_agg(to_jsonb(m)::text, E'\n' ORDER BY id), '') FROM meta m)`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	antes := foto()
	if _, err := p.UpByOne(ctx); err != nil {
		t.Fatal(err)
	}
	if foto() != antes {
		t.Error("la migración cambió filas de persona, movimiento_recurrente o meta")
	}
}

// insertarPersonaConPreferencias intenta crear una adulta con esas preferencias y devuelve el error del INSERT (la base exige
// el perfil al confirmar, por eso va en una transacción que se deshace).
func insertarPersonaConPreferencias(t *testing.T, pool *pgxpool.Pool, valor string) error {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `INSERT INTO persona (nombre, etapa, preferencias) VALUES ('Otra', 'adulta', $1::jsonb)`, valor)
	return err
}

func preferenciasEnTexto(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var filas string
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(string_agg(to_jsonb(p)::text, E'\n' ORDER BY p.id), '') FROM persona p`).Scan(&filas); err != nil {
		t.Fatal(err)
	}
	return filas
}

// 0008 (BD-02): `persona.preferencias` es un objeto JSON cuyos valores son todos booleanos. No hay lista cerrada de claves
// (la fija la historia que construye PN-67): cualquier clave con un booleano cabe; un valor que no es booleano, o algo que
// no es un objeto, se rechaza y la tabla queda igual.
func TestMigracion0008PreferenciasSoloAceptaValoresBooleanos(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	laura := crearAdulta(t, pool) // nace con '{}'
	base := preferenciasEnTexto(t, pool)

	for _, c := range []struct{ nombre, valor string }{
		{"un texto", `{"avisos": "si"}`},
		{"un número", `{"avisos": 1}`},
		{"un nulo", `{"avisos": null}`},
		{"un objeto anidado", `{"avisos": {"hogar": true}}`},
		{"una lista", `{"avisos": [true]}`},
		{"uno bueno y uno malo", `{"a": true, "b": "no"}`},
		{"un arreglo en vez de objeto", `[true, false]`},
		{"un booleano suelto", `true`},
	} {
		_, err := pool.Exec(ctx, `UPDATE persona SET preferencias = $2::jsonb WHERE id = $1::uuid`, laura, c.valor)
		if got := violacion(err); got != "23514 ck_persona_preferencias" {
			t.Errorf("%s: %s, se esperaba 23514 ck_persona_preferencias", c.nombre, got)
		}
		if got := violacion(insertarPersonaConPreferencias(t, pool, c.valor)); got != "23514 ck_persona_preferencias" {
			t.Errorf("insertar con %s: %s, se esperaba 23514 ck_persona_preferencias", c.nombre, got)
		}
		if despues := preferenciasEnTexto(t, pool); despues != base {
			t.Errorf("%s: el rechazo cambió la tabla", c.nombre)
		}
	}

	// Claves cualesquiera con booleanos caben, y el objeto vacío también.
	for _, valor := range []string{`{}`, `{"avisos_del_hogar": true, "cualquier_clave": false}`} {
		if _, err := pool.Exec(ctx, `UPDATE persona SET preferencias = $2::jsonb WHERE id = $1::uuid`, laura, valor); err != nil {
			t.Errorf("%s debía caber: %v", valor, err)
		}
	}
	if err := insertarPersonaConPreferencias(t, pool, `{"cualquier_clave": true}`); err != nil {
		t.Errorf("insertar con claves cualesquiera y booleanos: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM persona WHERE preferencias = '{"avisos_del_hogar": true, "cualquier_clave": false}'::jsonb`).Scan(&n); err != nil || n != 1 {
		t.Errorf("la preferencia aceptada no quedó: %d (%v)", n, err)
	}
}

// Sobre una base con datos de la 0007: las preferencias booleanas (y las vacías) pasan sin cambiar; si hubiera una que no
// es booleana, la migración falla nombrando la restricción y no deja nada a medias (no reescribe datos en silencio).
func TestMigracion0008PreferenciasSobreDatosCargados(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.NuevaSinMigrar(t)
	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	laura := crearAdulta(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE persona SET preferencias = '{"avisos_del_hogar": true, "otra": false}' WHERE id = $1::uuid`, laura); err != nil {
		t.Fatal(err)
	}
	antes := preferenciasEnTexto(t, pool)
	if _, err := p.UpByOne(ctx); err != nil {
		t.Fatalf("subir la 0008 con preferencias booleanas: %v", err)
	}
	if preferenciasEnTexto(t, pool) != antes {
		t.Fatal("la migración cambió preferencias")
	}

	// Con una preferencia que no es booleana (posible en la 0007, que solo exigía un objeto) la 0008 falla y no cambia nada.
	if _, err := p.Down(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE persona SET preferencias = '{"avisos": "si"}' WHERE id = $1::uuid`, laura); err != nil {
		t.Fatal(err)
	}
	antes = preferenciasEnTexto(t, pool)
	if _, err := p.UpByOne(ctx); err == nil || !strings.Contains(err.Error(), "ck_persona_preferencias") {
		t.Fatalf("la 0008 debía fallar nombrando ck_persona_preferencias: %v", err)
	}
	if preferenciasEnTexto(t, pool) != antes {
		t.Error("la migración fallida cambió filas")
	}
	if definicionDeIndice(t, pool, "ix_movimiento_persona_categoria_fecha") != "" {
		t.Error("la migración fallida dejó cambios a medias: el índice existe")
	}
}
