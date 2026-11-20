//go:build integration

package pg_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
)

// Bug 308 (D-210), hallazgo del verificador: `Otorgar` pone `reemplazada_en` a las necesarias de una versión anterior y
// después inserta, todo en una transacción. Si la inserción falla (aquí, una finalidad que el catálogo no tiene:
// `fk_autorizacion_finalidad`), no puede quedar ninguna aceptación reemplazada sin su aceptación nueva: la tabla queda
// idéntica, fila por fila y columna por columna. La transacción se deshace entera, así que esta prueba fija el
// comportamiento (pasa desde que se escribió el reemplazo) y avisa si alguien lo saca de la transacción.
func TestOtorgarQueFallaDespuesDeReemplazarNoDejaNadaReemplazado(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	persona := e.sembrar(t, "laura@ejemplo.test")
	repo := pg.NuevoAutorizaciones(e.pool)
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}

	// La persona aceptó las tres con una versión anterior.
	if err := repo.Otorgar(ctx, persona, necesarias, "1.1 del 2026-11-12", ahora); err != nil {
		t.Fatalf("aceptar la versión anterior: %v", err)
	}
	instantanea := func() string {
		t.Helper()
		var filas string
		if err := e.pool.QueryRow(ctx, `SELECT COALESCE(string_agg(to_jsonb(a)::text, E'\n' ORDER BY a.finalidad, a.otorgada_en), '') FROM autorizacion a`).Scan(&filas); err != nil {
			t.Fatal(err)
		}
		return filas
	}
	antes := instantanea()
	if antes == "" {
		t.Fatal("no se guardó la aceptación de antes")
	}

	// Con la versión vigente y una finalidad inexistente, la inserción falla después de haber reemplazado las tres.
	err := repo.Otorgar(ctx, persona, append(necesarias, "finalidad_que_no_existe"), autorizacion.VersionActual.Texto(), ahora.Add(time.Hour))
	if err == nil || !strings.Contains(err.Error(), "fk_autorizacion_finalidad") { // falla en la inserción, después del reemplazo
		t.Fatalf("una finalidad que el catálogo no tiene debe hacer fallar Otorgar al insertar: %v", err)
	}
	if despues := instantanea(); despues != antes {
		t.Fatalf("la tabla cambió tras el fallo:\nantes:\n%s\ndespués:\n%s", antes, despues)
	}
	var reemplazadas int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM autorizacion WHERE reemplazada_en IS NOT NULL`).Scan(&reemplazadas); err != nil || reemplazadas != 0 {
		t.Fatalf("no debe quedar ninguna reemplazada: %d (%v)", reemplazadas, err)
	}
	// Siguen vigentes con su versión anterior: la persona no ganó ni perdió nada.
	aceptadas, err := repo.Vigentes(ctx, persona)
	if err != nil || len(aceptadas) != 3 {
		t.Fatalf("vigentes: %v (%v)", aceptadas, err)
	}
	for _, a := range aceptadas {
		if a.Version != "1.1 del 2026-11-12" {
			t.Errorf("%s: versión %q", a.Codigo, a.Version)
		}
	}
}
