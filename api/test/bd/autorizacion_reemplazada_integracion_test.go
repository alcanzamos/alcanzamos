//go:build integration

package bd_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// filasDeAutorizacion es lo guardado en `autorizacion`, una fila por línea y sin la columna `reemplazada_en` (la de la 0007),
// para comparar la tabla antes y después de la migración.
func filasDeAutorizacion(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var filas string
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(string_agg((to_jsonb(a) - 'reemplazada_en')::text, E'\n' ORDER BY a.id), '') FROM autorizacion a`).Scan(&filas); err != nil {
		t.Fatal(err)
	}
	return filas
}

func columnaReemplazada(t *testing.T, pool *pgxpool.Pool) (tipo, admiteNulo string) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(max(data_type), ''), COALESCE(max(is_nullable), '') FROM information_schema.columns
		  WHERE table_name = 'autorizacion' AND column_name = 'reemplazada_en'`).Scan(&tipo, &admiteNulo)
	if err != nil {
		t.Fatal(err)
	}
	return tipo, admiteNulo
}

func indiceDeLasVigentes(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var def string
	if err := pool.QueryRow(context.Background(), `SELECT COALESCE(max(indexdef), '') FROM pg_indexes WHERE indexname = 'ix_autorizacion_vigente'`).Scan(&def); err != nil {
		t.Fatal(err)
	}
	return def
}

// 0007 (bug 308, D-210): la columna `autorizacion.reemplazada_en timestamptz NULL` nace vacía y ninguna fila que ya existe
// cambia; el índice único de las vigentes (mismo nombre) pasa a excluir también las reemplazadas, de modo que la versión
// de antes y la nueva de una misma finalidad conviven; bajar la quita sin perder la prueba y se niega si habría dos vigentes.
func TestMigracion0007AgregaLaColumnaReemplazadaYElIndiceDeLasVigentes(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t) // ya aplicó todas las migraciones
	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	if tipo, nulo := columnaReemplazada(t, pool); tipo != "timestamp with time zone" || nulo != "YES" {
		t.Fatalf("tras subir: tipo %q, admite nulo %q; se esperaba timestamptz NULL", tipo, nulo)
	}
	var comentario string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(col_description('autorizacion'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'autorizacion'::regclass AND attname = 'reemplazada_en')), '')`).
		Scan(&comentario); err != nil || comentario == "" {
		t.Fatalf("la columna debe tener comentario (%q, %v)", comentario, err)
	}

	// Sobre la base de la 0006, con datos: una vigente de la 1.1, una retirada y una vigente de la 1.2 de otra persona.
	if r, err := p.Down(ctx); err != nil || r.Source.Path != "0007_autorizacion_reemplazada.sql" {
		t.Fatalf("Down: %+v, %v", r, err)
	}
	if tipo, _ := columnaReemplazada(t, pool); tipo != "" {
		t.Fatalf("tras bajar, la columna no debe existir: %q", tipo)
	}
	if def := indiceDeLasVigentes(t, pool); strings.Contains(def, "reemplazada_en") || !strings.Contains(def, "UNIQUE") {
		t.Fatalf("tras bajar, el índice es el de la 0001: %s", def)
	}
	const laura, mateo = "0192f3c4-0000-7000-8000-00000000000a", "0192f3c4-0000-7000-8000-00000000000b"
	if _, err := pool.Exec(ctx,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en, retirada_en) VALUES
		   ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.1 del 2026-11-12', '2026-11-13T10:00:00Z', NULL),
		   ($1::uuid, $1::uuid, 'avisos', '1.1 del 2026-11-12', '2026-11-13T10:00:00Z', '2026-11-14T10:00:00Z'),
		   ($2::uuid, $2::uuid, 'cuenta_y_acceso', '1.2 del 2026-11-17', '2026-11-18T10:00:00Z', NULL)`, laura, mateo); err != nil {
		t.Fatal(err)
	}
	antes := filasDeAutorizacion(t, pool)
	if antes == "" {
		t.Fatal("no se sembró nada")
	}

	// Subir no cambia ninguna fila y la columna nace vacía.
	if _, err := p.UpByOne(ctx); err != nil {
		t.Fatalf("subir la 0007: %v", err)
	}
	if despues := filasDeAutorizacion(t, pool); despues != antes {
		t.Fatalf("la migración cambió filas:\nantes:   %s\ndespués: %s", antes, despues)
	}
	var reemplazadas int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM autorizacion WHERE reemplazada_en IS NOT NULL`).Scan(&reemplazadas); err != nil || reemplazadas != 0 {
		t.Fatalf("la columna debe nacer vacía: %d (%v)", reemplazadas, err)
	}
	if def := indiceDeLasVigentes(t, pool); !strings.Contains(def, "UNIQUE") || !strings.Contains(def, "titular_id, finalidad") ||
		!strings.Contains(def, "retirada_en IS NULL") || !strings.Contains(def, "reemplazada_en IS NULL") {
		t.Fatalf("índice de las vigentes: %s", def)
	}

	// Dos vigentes de la misma finalidad siguen sin caber; una reemplazada y una vigente, sí. La reemplazada no puede ser
	// anterior a su otorgamiento.
	if _, err := pool.Exec(ctx,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.2 del 2026-11-17', '2026-11-20T10:00:00Z')`, laura); err == nil {
		t.Fatal("dos vigentes de la misma finalidad no caben")
	}
	if _, err := pool.Exec(ctx,
		`UPDATE autorizacion SET reemplazada_en = '2026-11-12T10:00:00Z' WHERE titular_id = $1::uuid AND finalidad = 'cuenta_y_acceso'`, laura); err == nil {
		t.Fatal("reemplazada_en no puede ser anterior a otorgada_en")
	}
	if _, err := pool.Exec(ctx,
		`UPDATE autorizacion SET reemplazada_en = '2026-11-20T10:00:00Z' WHERE titular_id = $1::uuid AND finalidad = 'cuenta_y_acceso'`, laura); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.2 del 2026-11-17', '2026-11-20T10:00:00Z')`, laura); err != nil {
		t.Fatalf("la 1.1 reemplazada y la 1.2 vigente deben convivir: %v", err)
	}

	// Bajar con una reemplazada y una vigente de la misma finalidad se niega y no cambia nada.
	if _, err := p.Down(ctx); err == nil {
		t.Fatal("bajar con una reemplazada y una vigente de la misma finalidad debe fallar")
	}
	if tipo, _ := columnaReemplazada(t, pool); tipo == "" || !strings.Contains(indiceDeLasVigentes(t, pool), "reemplazada_en") {
		t.Fatal("el Down fallido no debe dejar cambios a medias")
	}

	// Sin esa reemplazada (la prueba sintética se borra aquí, no en el producto), baja y vuelve a subir.
	if _, err := pool.Exec(ctx, `DELETE FROM autorizacion WHERE reemplazada_en IS NOT NULL`); err != nil {
		t.Fatal(err)
	}
	if r, err := p.Down(ctx); err != nil || r.Source.Path != "0007_autorizacion_reemplazada.sql" {
		t.Fatalf("Down: %+v, %v", r, err)
	}
	if tipo, _ := columnaReemplazada(t, pool); tipo != "" || strings.Contains(indiceDeLasVigentes(t, pool), "reemplazada_en") {
		t.Fatal("tras bajar, ni la columna ni el índice nuevo deben existir")
	}
	if _, err := p.UpByOne(ctx); err != nil {
		t.Fatalf("volver a subir: %v", err)
	}
	if tipo, nulo := columnaReemplazada(t, pool); tipo != "timestamp with time zone" || nulo != "YES" {
		t.Fatalf("tras volver a subir: %q %q", tipo, nulo)
	}
}
