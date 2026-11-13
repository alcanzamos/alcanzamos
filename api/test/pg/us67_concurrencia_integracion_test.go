//go:build integration

package pg_test

import (
	"context"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

func TestPurgaNoBorraTrasOtorgamientoConcurrente(t *testing.T) {
	ctx, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	pool := pgtest.Nueva(t)
	ahora := time.Now().UTC()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	var id string
	err = tx.QueryRow(ctx,
		`INSERT INTO persona(nombre, etapa, creada_en)
		 VALUES ('Laura', 'adulta', $1) RETURNING id::text`,
		ahora.Add(-8*24*time.Hour)).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	// Del caso 2 con el aviso de hace 3 días: ya cumplió los 7 días y las 48 horas (D-203), así que la purga la elige.
	_, err = tx.Exec(ctx,
		`INSERT INTO perfil_adulto(persona_id, correo, correo_verificado, aviso_de_purga_en)
		 VALUES ($1::uuid, 'race@ejemplo.test', true, $2)`, id, ahora.Add(-3*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	otorgamiento, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer otorgamiento.Rollback(ctx)
	if _, err := otorgamiento.Exec(ctx,
		`SELECT id FROM persona WHERE id = $1::uuid FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	_, err = otorgamiento.Exec(ctx,
		`INSERT INTO autorizacion
		     (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 SELECT $1::uuid, $1::uuid, codigo, '1.1 del 2026-11-12', $2
		 FROM unnest($3::text[]) AS codigo`,
		id, ahora, cuenta.ReglaDeFinalidades{}.Codigos(cuenta.EtapaAdulta))
	if err != nil {
		t.Fatal(err)
	}

	type resultado struct {
		n   int
		err error
	}
	fin := make(chan resultado, 1)
	go func() {
		s := cuenta.NuevoServicio(cuenta.Dependencias{Repo: pg.NuevoCuentas(pool)})
		n, err := s.BorrarCuentasSinConfirmar(ctx, ahora)
		fin <- resultado{n, err}
	}()

	esperando := false
	for limite := time.Now().Add(3 * time.Second); time.Now().Before(limite); {
		err := pool.QueryRow(ctx,
			`SELECT EXISTS (
			     SELECT 1 FROM pg_stat_activity
			     WHERE datname = current_database()
			       AND wait_event_type = 'Lock'
			       AND query LIKE '%WITH candidatas AS%'
			 )`).Scan(&esperando)
		if err != nil {
			t.Fatal(err)
		}
		if esperando {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !esperando {
		t.Fatal("la purga no llegó al bloqueo")
	}
	if err := otorgamiento.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	r := <-fin
	if r.err != nil {
		t.Fatal(r.err)
	}
	var existentes int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM persona WHERE id = $1::uuid`, id).
		Scan(&existentes); err != nil {
		t.Fatal(err)
	}
	if r.n != 0 || existentes != 1 {
		t.Fatalf("borradas=%d; personas restantes=%d", r.n, existentes)
	}
}
