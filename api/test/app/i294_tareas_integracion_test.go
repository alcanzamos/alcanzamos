//go:build integration

package app_test

import (
	"context"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// S1/S2: exercise the production task compositor, not a separately wired service.
func TestI294TareasEnviaYRegistraElAviso(t *testing.T) {
	pool := pgtest.Nueva(t)
	ctx := context.Background()
	t.Setenv("BASE_DE_DATOS_URL", pool.Config().ConnString())
	t.Setenv("CORREO_SMTP", correotest.ServidorGuionado(t, "220 prueba", map[string]string{"QUIT": "221 fin"}))
	t.Setenv("CORREO_REMITENTE", "no-responder@ejemplo.test")
	t.Setenv("CORREO_PRIVACIDAD", "privacidad@ejemplo.test")
	t.Setenv("URL_PUBLICA", "https://app.ejemplo.test")
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Laura', 'adulta', now() - interval '6 days') RETURNING id::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, 'laura@ejemplo.test', true)`, id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if codigo, salida := ejecutar("tareas"); codigo != 0 {
		t.Fatalf("codigo %d: %s", codigo, salida)
	}
	var aviso *time.Time
	if err := pool.QueryRow(ctx, `SELECT aviso_de_purga_en FROM perfil_adulto WHERE persona_id = $1::uuid`, id).Scan(&aviso); err != nil || aviso == nil {
		t.Fatalf("el aviso debe salir y quedar registrado: %v, %v", aviso, err)
	}
}
