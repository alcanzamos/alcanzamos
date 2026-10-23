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

func tieneIngresoAnterior(t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM information_schema.columns WHERE table_name = 'credencial' AND column_name = 'ingreso_anterior'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

// 0003 (D-134): la columna existe tras subir y desaparece al bajar solo esa migración, sin tocar el resto.
func TestMigracion0003AgregaYQuitaIngresoAnterior(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t) // ya aplicó las tres migraciones
	if !tieneIngresoAnterior(t, pool) {
		t.Fatal("tras subir, credencial debe tener ingreso_anterior")
	}
	var tipo string
	if err := pool.QueryRow(ctx,
		`SELECT data_type FROM information_schema.columns WHERE table_name = 'credencial' AND column_name = 'ingreso_anterior'`).Scan(&tipo); err != nil || tipo != "timestamp with time zone" {
		t.Fatalf("tipo %q (%v), se esperaba timestamptz", tipo, err)
	}

	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}
	r, err := p.Down(ctx) // revierte solo la última
	if err != nil || r.Source.Path != "0003_ingreso_anterior.sql" {
		t.Fatalf("Down: %+v, %v", r, err)
	}
	if tieneIngresoAnterior(t, pool) {
		t.Fatal("tras bajar, la columna no debe existir")
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM finalidad`).Scan(&n); err != nil || n == 0 {
		t.Fatalf("bajar 0003 no debe tocar el catálogo: %d (%v)", n, err)
	}
	if _, err := p.UpByOne(ctx); err != nil || !tieneIngresoAnterior(t, pool) {
		t.Fatalf("volver a subir: %v", err)
	}
}
