//go:build integration

package pg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// Con la base caída, listar las categorías y guardar fallan con un error de infraestructura, no con uno de negocio.
func TestMovimientosConLaBaseCaidaFallan(t *testing.T) {
	pool := pgtest.Nueva(t)
	pool.Close()
	repo := pg.NuevoMovimientos(pool)
	if _, err := repo.Categorias(context.Background(), "0192f3c4-0000-7000-8000-0000000000aa"); err == nil {
		t.Error("Categorias debe fallar")
	}
	g := registro.Guardado{Persona: "0192f3c4-0000-7000-8000-0000000000aa", Tipo: "gasto", Monto: 100, Fecha: ahora, CategoriaID: 1, Medio: "efectivo", ConMovimiento: true}
	if _, err := repo.Guardar(context.Background(), g, ahora); err == nil || errors.Is(err, registro.ErrCategoriaInvalida) {
		t.Errorf("Guardar con la base caída: %v", err)
	}
}

// Un fallo que no es de la categoría (aquí, la persona no existe) no se confunde con una categoría inválida, y la
// transacción no deja la repetición sin su movimiento.
func TestGuardarDistingueUnaCategoriaInvalidaDeOtroFallo(t *testing.T) {
	pool := pgtest.Nueva(t)
	repo := pg.NuevoMovimientos(pool)
	g := registro.Guardado{Persona: "0192f3c4-0000-7000-8000-0000000000aa", Tipo: "gasto", Monto: 100, Fecha: ahora, CategoriaID: 1, Medio: "efectivo", ConMovimiento: true}
	for _, periodicidad := range []fechas.Periodicidad{"", fechas.Mensual} {
		g.Periodicidad = periodicidad
		if _, err := repo.Guardar(context.Background(), g, ahora); err == nil || errors.Is(err, registro.ErrCategoriaInvalida) {
			t.Errorf("persona inexistente (periodicidad %q): %v", periodicidad, err)
		}
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM movimiento) + (SELECT count(*) FROM movimiento_recurrente)`).Scan(&n); err != nil || n != 0 {
		t.Errorf("no queda nada guardado: %d %v", n, err)
	}
}
