//go:build integration

package pg_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// La purga y un otorgamiento a la vez nunca dejan autorizaciones vigentes de una cuenta borrada (`autorizacion` no tiene
// llave a persona): o gana el otorgamiento y la cuenta queda con todo lo otorgado, o gana la purga y no queda cuenta ni
// nada vigente. Complementa a TestPurgaNoBorraTrasOtorgamientoConcurrente, que fija el orden en el que antes fallaba.
func TestLaPurgaYUnOtorgamientoAlMismoTiempoQuedanCoherentes(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	ahora := time.Now().UTC()
	necesarias := cuenta.ReglaDeFinalidades{}.Codigos(cuenta.EtapaAdulta)
	servicio := cuenta.NuevoServicio(cuenta.Dependencias{Repo: pg.NuevoCuentas(pool)})
	otorgante := pg.NuevoAutorizaciones(pool)
	for i := range 20 {
		var id string
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Laura', 'adulta', $1) RETURNING id::text`, ahora.Add(-8*24*time.Hour)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		// El caso 2 con el aviso de hace 3 días: la purga la elige (D-203).
		if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado, aviso_de_purga_en) VALUES ($1::uuid, $2, true, $3)`,
			id, fmt.Sprintf("p%d@ejemplo.test", i), ahora.Add(-3*24*time.Hour)); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = otorgante.Otorgar(ctx, id, necesarias, "1.1 del 2026-11-12", ahora) //nolint:errcheck // ErrSinCuenta si la purga llegó primero
		}()
		go func() {
			defer wg.Done()
			_, _ = servicio.BorrarCuentasSinConfirmar(ctx, ahora) //nolint:errcheck // la ronda mira el resultado en la base
		}()
		wg.Wait()
		var cuentas, vigentes int
		if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM persona WHERE id = $1::uuid), (SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL)`, id).
			Scan(&cuentas, &vigentes); err != nil {
			t.Fatal(err)
		}
		if (cuentas != 1 || vigentes != len(necesarias)) && (cuentas != 0 || vigentes != 0) {
			t.Fatalf("ronda %d: %d cuentas y %d autorizaciones vigentes", i, cuentas, vigentes)
		}
	}
}
