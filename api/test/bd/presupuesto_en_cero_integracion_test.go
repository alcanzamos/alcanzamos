//go:build integration

package bd_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// columnasDeEnCero son las columnas de `presupuesto_en_cero` con su tipo, en orden; vacío si la tabla no existe.
func columnasDeEnCero(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var columnas string
	if err := pool.QueryRow(context.Background(),
		`SELECT coalesce(string_agg(column_name || ' ' || data_type || ' ' || is_nullable, ', ' ORDER BY ordinal_position), '')
		 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'presupuesto_en_cero'`).Scan(&columnas); err != nil {
		t.Fatal(err)
	}
	return columnas
}

// violacion es el código y la restricción del error de la base, o "ninguna".
func violacion(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code + " " + pgErr.ConstraintName
	}
	if err != nil {
		return err.Error()
	}
	return "ninguna"
}

// 0004 (L6 (5) de la US-77): la marca «en cero» por persona adulta y mes. Tras subir, la tabla tiene sus columnas y sus
// restricciones (día 1, solo adultos, una por persona y mes, y se va con la cuenta); bajar solo esa migración la quita sin
// tocar `presupuesto` ni el catálogo, y vuelve a subir.
func TestMigracion0004CreaYQuitaPresupuestoEnCero(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	if got := columnasDeEnCero(t, pool); got != "persona_id uuid NO, periodo date NO, creado_en timestamp with time zone NO" {
		t.Fatalf("columnas: %q", got)
	}

	var adulta, menor string
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []struct {
		sql string
		id  *string
	}{
		{`INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`, &adulta},
		{`INSERT INTO persona (nombre, etapa) VALUES ('Mateo', 'menor') RETURNING id::text`, &menor},
	} {
		if err := tx.QueryRow(ctx, q.sql).Scan(q.id); err != nil {
			t.Fatal(err)
		}
	}
	for _, q := range []string{
		`INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ('` + adulta + `', 'laura@ejemplo.test', true)`,
		`INSERT INTO perfil_menor (persona_id, nombre_de_usuario) VALUES ('` + menor + `', 'mateo.p')`,
		`INSERT INTO nacimiento_menor (persona_id, valor_cifrado, version_clave) VALUES ('` + menor + `', decode(repeat('ab', 38), 'hex'), 1)`,
	} {
		if _, err := tx.Exec(ctx, q); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	insertar := func(persona, periodo string) string {
		_, err := pool.Exec(ctx, `INSERT INTO presupuesto_en_cero (persona_id, periodo) VALUES ($1::uuid, $2::date)`, persona, periodo)
		return violacion(err)
	}
	for _, c := range []struct{ nombre, persona, periodo, quiere string }{
		{"la marca de noviembre", adulta, "2026-11-01", "ninguna"},
		{"otra vez el mismo mes", adulta, "2026-11-01", "23505 pk_presupuesto_en_cero"},
		{"un día que no es el 1", adulta, "2026-12-02", "23514 ck_presupuesto_en_cero_periodo"},
		{"una persona menor", menor, "2026-11-01", "23503 fk_presupuesto_en_cero_persona_id"},
	} {
		if got := insertar(c.persona, c.periodo); got != c.quiere {
			t.Errorf("%s: %s, se esperaba %s", c.nombre, got, c.quiere)
		}
	}
	var creado bool
	if err := pool.QueryRow(ctx, `SELECT creado_en IS NOT NULL FROM presupuesto_en_cero WHERE persona_id = $1::uuid`, adulta).Scan(&creado); err != nil || !creado {
		t.Errorf("creado_en: %v %v", creado, err)
	}
	// Se va con la cuenta: el CASCADE de la persona al perfil de adulta y de este a la marca.
	if _, err := pool.Exec(ctx, `DELETE FROM persona WHERE id = $1::uuid`, adulta); err != nil {
		t.Fatal(err)
	}
	var quedan int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM presupuesto_en_cero`).Scan(&quedan); err != nil || quedan != 0 {
		t.Errorf("quedan %d marcas tras borrar la cuenta (%v)", quedan, err)
	}

	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	for _, despues := range []string{"0006_aviso_de_purga.sql", "0005_transmision_a_encargados.sql"} { // las que van después
		if r, err := p.Down(ctx); err != nil || r.Source.Path != despues {
			t.Fatalf("Down: %+v, %v; se esperaba %s", r, err, despues)
		}
	}
	r, err := p.Down(ctx) // revierte la 0004
	if err != nil || r.Source.Path != "0004_presupuesto_en_cero.sql" {
		t.Fatalf("Down: %+v, %v", r, err)
	}
	if got := columnasDeEnCero(t, pool); got != "" {
		t.Fatalf("tras bajar, la tabla no debe existir: %q", got)
	}
	var presupuestos, finalidades int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'presupuesto'), (SELECT count(*) FROM finalidad)`).
		Scan(&presupuestos, &finalidades); err != nil || presupuestos != 1 || finalidades == 0 {
		t.Fatalf("bajar 0004 no debe tocar `presupuesto` ni el catálogo: %d %d (%v)", presupuestos, finalidades, err)
	}
	if _, err := p.UpByOne(ctx); err != nil || columnasDeEnCero(t, pool) == "" {
		t.Fatalf("volver a subir: %v", err)
	}
}
