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

// Con la base caída, o sin una tabla que la lectura necesita, listar, leer, corregir y borrar fallan con un error de
// infraestructura: nunca con «no encontrado», que es una respuesta de negocio (404).
func TestMovimientosConsultarYCambiarConLaBaseCaidaFallan(t *testing.T) {
	const persona, id = "0192f3c4-0000-7000-8000-0000000000aa", "0192f3c4-0000-7000-8000-000000000001"
	ctx := context.Background()
	uno := 1
	correccion := registro.Correccion{Tipo: "gasto", Monto: 100, CategoriaID: &uno, Medio: "efectivo"}

	caida := pgtest.Nueva(t)
	caida.Close()
	repo := pg.NuevoMovimientos(caida)
	errores := map[string]error{}
	_, errores["Listar"] = repo.Listar(ctx, persona, ahora, nil)
	_, errores["Obtener"] = repo.Obtener(ctx, persona, id)
	errores["Corregir con categoría"] = repo.Corregir(ctx, persona, id, correccion)
	correccion.CategoriaID = nil
	errores["Corregir sin categoría"] = repo.Corregir(ctx, persona, id, correccion)
	errores["Borrar"] = repo.Borrar(ctx, persona, id)
	for nombre, err := range errores {
		if err == nil || errors.Is(err, registro.ErrNoEncontrado) || errors.Is(err, registro.ErrCategoriaInvalida) {
			t.Errorf("%s con la base caída: %v", nombre, err)
		}
	}

	incompleta := pgtest.Nueva(t)
	if _, err := incompleta.Exec(ctx, `DROP TABLE ocultamiento_categoria`); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.NuevoMovimientos(incompleta).Listar(ctx, persona, ahora, nil); err == nil {
		t.Error("Listar sin la tabla de ocultamientos debe fallar")
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
