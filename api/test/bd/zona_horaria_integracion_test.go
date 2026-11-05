//go:build integration

package bd_test

import (
	"context"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
)

// Toda conexión del pool fija TimeZone=UTC (E17 3.9, E13 §3.4, A-05), aunque el entorno pida otra zona (PGTZ).
func TestLaConexionFijaTimeZoneUTC(t *testing.T) {
	t.Setenv("PGTZ", "America/Bogota")
	ctx := context.Background()
	pool, err := bd.Conectar(ctx)
	if err != nil {
		t.Skip("sin PostgreSQL: ", err)
	}
	defer pool.Close()

	// Dos conexiones a la vez, para que el pool abra más de una.
	for i := range 2 {
		c, err := pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Release()
		var zona string
		if err := c.QueryRow(ctx, "SHOW TimeZone").Scan(&zona); err != nil || zona != "UTC" {
			t.Fatalf("conexión %d: TimeZone %q (%v), se esperaba UTC", i, zona, err)
		}
	}
}
