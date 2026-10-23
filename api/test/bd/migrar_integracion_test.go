//go:build integration

// Prueba de integración: requiere PostgreSQL 18 (infra/local/compose.yaml) y BASE_DE_DATOS_URL.
// Deja la base sin tablas: úsala solo con la base local de pruebas.
package bd_test

import (
	"context"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
)

func TestSubirYBajarMigraciones(t *testing.T) {
	ctx := context.Background()
	pool, err := bd.Conectar(ctx)
	if err != nil {
		t.Skip("sin PostgreSQL: ", err)
	}
	defer pool.Close()

	var version string
	if err := pool.QueryRow(ctx, "SHOW server_version").Scan(&version); err != nil || version[:2] != "18" {
		t.Fatalf("se esperaba PostgreSQL 18, hay %q (%v)", version, err)
	}

	if _, err := bd.Bajar(ctx, pool); err != nil { // parte de un estado limpio
		t.Fatal(err)
	}
	n, err := bd.Subir(ctx, pool)
	if err != nil || n != 3 {
		t.Fatalf("Subir: %d migraciones, error %v", n, err)
	}
	var tablas, finalidades int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'goose_db_version'").Scan(&tablas); err != nil || tablas == 0 {
		t.Fatalf("sin tablas tras Subir: %d (%v)", tablas, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM finalidad").Scan(&finalidades); err != nil || finalidades == 0 {
		t.Fatalf("el catálogo no se sembró: %d (%v)", finalidades, err)
	}
	t.Logf("tras Up: %d tablas, %d finalidades", tablas, finalidades)

	if n, err = bd.Subir(ctx, pool); err != nil || n != 0 {
		t.Fatalf("Subir repetido debe ser no-op: %d, %v", n, err)
	}

	n, err = bd.Bajar(ctx, pool)
	if err != nil || n != 3 {
		t.Fatalf("Bajar: %d migraciones, error %v", n, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'goose_db_version'").Scan(&tablas); err != nil || tablas != 0 {
		t.Fatalf("quedan %d tablas tras Bajar (%v)", tablas, err)
	}
}
