package migraciones

import (
	"io/fs"
	"testing"
)

func TestEmbebeLasDosMigraciones(t *testing.T) {
	nombres, err := fs.Glob(SQL, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	esperado := []string{"0001_esquema_inicial.sql", "0002_catalogo.sql"}
	if len(nombres) != len(esperado) {
		t.Fatalf("migraciones embebidas: %v", nombres)
	}
	for i, n := range esperado {
		if nombres[i] != n {
			t.Fatalf("migración %d: %q, se esperaba %q", i, nombres[i], n)
		}
	}
}
