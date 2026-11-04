//go:build integration

package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

const (
	personaDePrueba = "0192f3c4-0000-7000-8000-0000000000aa"
	recurrenteAjeno = "0192f3c4-0000-7000-8000-0000000000cc"
)

// El servicio ya da el 404 de lo ajeno antes de decidir; el repositorio sigue sin guardar nada de una repetición que
// no es de la persona o ya no existe (cada INSERT lee la repetición con `persona_id`), y no deja a medias lo anterior.
func TestDecidirUnaRepeticionAjenaDaNoEncontradoYNoGuardaNada(t *testing.T) {
	pool := pgtest.Nueva(t)
	repo := pg.NuevoMovimientos(pool)
	dia := time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	confirmar := []registro.Confirmacion{{RecurrenteID: recurrenteAjeno, Fecha: dia, Tipo: "gasto", Monto: 100, CategoriaID: 4, Medio: "efectivo"}}
	omitir := []registro.Omision{{RecurrenteID: recurrenteAjeno, Fecha: dia}}
	if _, err := repo.Decidir(context.Background(), personaDePrueba, confirmar, nil, ahora); !errors.Is(err, registro.ErrNoEncontrado) {
		t.Errorf("confirmar: %v", err)
	}
	if _, err := repo.Decidir(context.Background(), personaDePrueba, nil, omitir, ahora); !errors.Is(err, registro.ErrNoEncontrado) {
		t.Errorf("omitir: %v", err)
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM movimiento) + (SELECT count(*) FROM ocurrencia_omitida)`).Scan(&n); err != nil || n != 0 {
		t.Errorf("no queda nada guardado: %d %v", n, err)
	}
	if lista, err := repo.Recurrentes(context.Background(), personaDePrueba); err != nil || len(lista) != 0 {
		t.Errorf("Recurrentes de quien no tiene: %v %v", lista, err)
	}
}

// Con la base caída, o sin una tabla que la lectura necesita, Recurrentes y Decidir fallan con un error de infraestructura:
// nunca con uno de negocio (404 o 409).
func TestRecurrentesYDecidirConLaBaseCaidaOIncompletaFallan(t *testing.T) {
	ctx := context.Background()
	dia := time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	confirmar := []registro.Confirmacion{{RecurrenteID: recurrenteAjeno, Fecha: dia, Tipo: "gasto", Monto: 100, CategoriaID: 4, Medio: "efectivo"}}
	omitir := []registro.Omision{{RecurrenteID: recurrenteAjeno, Fecha: dia}}
	esDeNegocio := func(err error) bool {
		return errors.Is(err, registro.ErrNoEncontrado) || errors.Is(err, registro.ErrFechaNoPendiente)
	}

	caida := pgtest.Nueva(t)
	caida.Close()
	repo := pg.NuevoMovimientos(caida)
	_, errRecurrentes := repo.Recurrentes(ctx, personaDePrueba)
	_, errConfirmar := repo.Decidir(ctx, personaDePrueba, confirmar, nil, ahora)
	_, errOmitir := repo.Decidir(ctx, personaDePrueba, nil, omitir, ahora)
	for nombre, err := range map[string]error{"Recurrentes": errRecurrentes, "Decidir confirmar": errConfirmar, "Decidir omitir": errOmitir} {
		if err == nil || esDeNegocio(err) {
			t.Errorf("%s con la base caída: %v", nombre, err)
		}
	}

	// Sin nada que decidir no hay qué bloquear ni guardar.
	if ids, err := pg.NuevoMovimientos(pgtest.Nueva(t)).Decidir(ctx, personaDePrueba, nil, nil, ahora); err != nil || len(ids) != 0 {
		t.Errorf("Decidir vacío: %v %v", ids, err)
	}

	// Cada tabla de la lectura de Recurrentes que falte rompe la lectura, no la deja a medias.
	for _, tabla := range []string{"ocurrencia_omitida", "movimiento_recurrente"} {
		incompleta := pgtest.Nueva(t)
		if _, err := incompleta.Exec(ctx, `DROP TABLE `+tabla+` CASCADE`); err != nil {
			t.Fatal(err)
		}
		if _, err := pg.NuevoMovimientos(incompleta).Recurrentes(ctx, personaDePrueba); err == nil || esDeNegocio(err) {
			t.Errorf("Recurrentes sin %s: %v", tabla, err)
		}
		if tabla == "movimiento_recurrente" {
			if _, err := pg.NuevoMovimientos(incompleta).Decidir(ctx, personaDePrueba, confirmar, nil, ahora); err == nil || esDeNegocio(err) {
				t.Errorf("Decidir sin %s: %v", tabla, err)
			}
		}
	}
	incompleta := pgtest.Nueva(t)
	if _, err := incompleta.Exec(ctx, `DROP TABLE movimiento CASCADE`); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.NuevoMovimientos(incompleta).Recurrentes(ctx, personaDePrueba); err == nil || esDeNegocio(err) {
		t.Errorf("Recurrentes sin movimiento: %v", err)
	}

	// Una tabla de la escritura que falta es un fallo de infraestructura, no «no pendiente» ni «no encontrado». La repetición
	// existe y es de la persona: si no, el bloqueo inicial ya respondería «no encontrado».
	for tabla, decidir := range map[string]func(*pg.Movimientos, string) error{
		"movimiento": func(r *pg.Movimientos, id string) error {
			c := confirmar[0]
			c.RecurrenteID = id
			_, err := r.Decidir(ctx, personaDePrueba, []registro.Confirmacion{c}, nil, ahora)
			return err
		},
		"ocurrencia_omitida": func(r *pg.Movimientos, id string) error {
			_, err := r.Decidir(ctx, personaDePrueba, nil, []registro.Omision{{RecurrenteID: id, Fecha: dia}}, ahora)
			return err
		},
	} {
		sinTabla := pgtest.Nueva(t)
		tx, err := sinTabla.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var id string
		if _, err := tx.Exec(ctx, `INSERT INTO persona (id, nombre, etapa) VALUES ($1::uuid, 'Laura', 'adulta')`, personaDePrueba); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, correo) VALUES ($1::uuid, 'laura@ejemplo.test')`, personaDePrueba); err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio)
			VALUES ($1::uuid, 'gasto', 4, 'mensual', 100, 'efectivo', '2026-10-01') RETURNING id::text`, personaDePrueba).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := sinTabla.Exec(ctx, `DROP TABLE `+tabla+` CASCADE`); err != nil {
			t.Fatal(err)
		}
		if err := decidir(pg.NuevoMovimientos(sinTabla), id); err == nil || esDeNegocio(err) {
			t.Errorf("Decidir sin %s: %v", tabla, err)
		}
	}
}
