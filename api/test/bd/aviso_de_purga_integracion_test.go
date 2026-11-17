//go:build integration

package bd_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// columnaDelAviso es el tipo y si admite nulo de `perfil_adulto.aviso_de_purga_en`; vacío si no existe.
func columnaDelAviso(t *testing.T, pool *pgxpool.Pool) (tipo, admiteNulo string) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(max(data_type), ''), COALESCE(max(is_nullable), '') FROM information_schema.columns
		  WHERE table_name = 'perfil_adulto' AND column_name = 'aviso_de_purga_en'`).Scan(&tipo, &admiteNulo)
	if err != nil {
		t.Fatal(err)
	}
	return tipo, admiteNulo
}

// 0006 (ítem 294, D-203): la columna `perfil_adulto.aviso_de_purga_en timestamptz NULL` nace vacía en las cuentas que ya
// existen, tiene su comentario, y bajar solo esa migración la quita sin tocar el resto de `perfil_adulto`.
func TestMigracion0006AgregaYQuitaElAvisoDePurga(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t) // ya aplicó todas las migraciones
	if tipo, nulo := columnaDelAviso(t, pool); tipo != "timestamp with time zone" || nulo != "YES" {
		t.Fatalf("tras subir: tipo %q, admite nulo %q; se esperaba timestamptz NULL", tipo, nulo)
	}
	var comentario string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(col_description('perfil_adulto'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'perfil_adulto'::regclass AND attname = 'aviso_de_purga_en')), '')`).
		Scan(&comentario); err != nil || comentario == "" {
		t.Fatalf("la columna debe tener comentario (%q, %v)", comentario, err)
	}

	// Una cuenta sembrada sin la columna queda con el aviso vacío; con ella, se puede marcar y desmarcar.
	var persona string
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa) VALUES ('Laura', 'adulta') RETURNING id::text`).Scan(&persona); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, 'laura@ejemplo.test', true)`, persona); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var aviso *string
	if err := pool.QueryRow(ctx, `SELECT aviso_de_purga_en::text FROM perfil_adulto WHERE persona_id = $1::uuid`, persona).Scan(&aviso); err != nil || aviso != nil {
		t.Fatalf("una cuenta nueva nace sin aviso: %v (%v)", aviso, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE perfil_adulto SET aviso_de_purga_en = now() WHERE persona_id = $1::uuid`, persona); err != nil {
		t.Fatal(err)
	}

	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	r, err := p.Down(ctx) // revierte solo la 0006
	if err != nil || r.Source.Path != "0006_aviso_de_purga.sql" {
		t.Fatalf("Down: %+v, %v", r, err)
	}
	if tipo, _ := columnaDelAviso(t, pool); tipo != "" {
		t.Fatalf("tras bajar, la columna no debe existir: %q", tipo)
	}
	var cuentas, finalidades int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM perfil_adulto WHERE correo = 'laura@ejemplo.test' AND correo_verificado), (SELECT count(*) FROM finalidad)`).Scan(&cuentas, &finalidades); err != nil || cuentas != 1 || finalidades != 8 {
		t.Fatalf("bajar 0006 no debe tocar el perfil ni el catálogo: %d %d (%v)", cuentas, finalidades, err)
	}
	if _, err := p.UpByOne(ctx); err != nil {
		t.Fatalf("volver a subir: %v", err)
	}
	if tipo, nulo := columnaDelAviso(t, pool); tipo != "timestamp with time zone" || nulo != "YES" {
		t.Fatalf("tras volver a subir: %q %q", tipo, nulo)
	}
	if err := pool.QueryRow(ctx, `SELECT aviso_de_purga_en::text FROM perfil_adulto WHERE persona_id = $1::uuid`, persona).Scan(&aviso); err != nil || aviso != nil {
		t.Fatalf("al volver a subir la columna nace vacía: %v (%v)", aviso, err)
	}
}
