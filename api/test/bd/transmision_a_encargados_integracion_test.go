//go:build integration

package bd_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// 0005 (SC-E21-25, D-202): siembra `transmision_a_encargados` como finalidad necesaria y activa, sin tocar el resto del
// catálogo ni el esquema. Al bajarla, la finalidad se va; con una autorización ya guardada la base se niega (RESTRICT) y
// la prueba de lo que la persona aceptó no se pierde.
func TestMigracion0005SiembraYQuitaLaTransmisionAEncargados(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t) // ya aplicó todas las migraciones
	fila := func() (tipo string, activa bool, total int) {
		t.Helper()
		if err := pool.QueryRow(ctx,
			`SELECT COALESCE(max(tipo), ''), COALESCE(bool_or(activa), false), (SELECT count(*) FROM finalidad) FROM finalidad WHERE codigo = 'transmision_a_encargados'`).
			Scan(&tipo, &activa, &total); err != nil {
			t.Fatal(err)
		}
		return tipo, activa, total
	}
	tipo, activa, total := fila()
	if tipo != "necesaria" || !activa || total != 8 {
		t.Fatalf("tras subir: tipo %q, activa %v, %d finalidades; se esperaba necesaria, activa y 8 en el catálogo", tipo, activa, total)
	}

	p, err := goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
	if err != nil {
		t.Fatal(err)
	}

	// Con una autorización guardada, bajar falla y no cambia nada.
	if _, err := pool.Exec(ctx,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 VALUES (gen_random_uuid(), gen_random_uuid(), 'transmision_a_encargados', '1.1 del 2026-11-12', now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Down(ctx); err == nil {
		t.Fatal("bajar 0005 con autorizaciones guardadas debía fallar: la prueba de lo aceptado no se borra")
	}
	if tipo, _, total := fila(); tipo != "necesaria" || total != 8 {
		t.Fatalf("el Down fallido cambió el catálogo: %q, %d", tipo, total)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM autorizacion WHERE finalidad = 'transmision_a_encargados'`); err != nil {
		t.Fatal(err)
	}

	r, err := p.Down(ctx) // revierte solo la 0005
	if err != nil || r.Source.Path != "0005_transmision_a_encargados.sql" {
		t.Fatalf("Down: %+v, %v", r, err)
	}
	if tipo, _, total := fila(); tipo != "" || total != 7 {
		t.Fatalf("tras bajar: tipo %q, %d finalidades; se esperaba que se fuera sola, quedando las 7 de 0002", tipo, total)
	}
	if _, err := p.UpByOne(ctx); err != nil {
		t.Fatalf("volver a subir: %v", err)
	}
	if tipo, activa, total := fila(); tipo != "necesaria" || !activa || total != 8 {
		t.Fatalf("tras volver a subir: %q %v %d", tipo, activa, total)
	}
}
