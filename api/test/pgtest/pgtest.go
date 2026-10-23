//go:build integration

// Package pgtest da a cada prueba de integración una base de PostgreSQL propia y migrada, para que las pruebas de
// paquetes distintos puedan correr a la vez sin pisarse (la prueba de migraciones deja la base sin tablas).
// Necesita BASE_DE_DATOS_URL apuntando al PostgreSQL local de infra/local, con permiso para crear bases. Solo datos sintéticos.
package pgtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
)

// Nueva crea una base temporal, le aplica las migraciones y devuelve su pool. La borra al terminar la prueba.
// Sin BASE_DE_DATOS_URL, o sin PostgreSQL alcanzable, salta la prueba.
func Nueva(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	base := os.Getenv(bd.VariableURL)
	if base == "" {
		t.Skip("sin " + bd.VariableURL)
	}
	admin, err := pgxpool.New(ctx, base)
	if err != nil {
		t.Skip("sin PostgreSQL: ", err)
	}
	if err := admin.Ping(ctx); err != nil {
		admin.Close()
		t.Skip("sin PostgreSQL: ", err)
	}

	sufijo := make([]byte, 6)
	_, _ = rand.Read(sufijo)
	nombre := "prueba_" + hex.EncodeToString(sufijo)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+nombre); err != nil { // el nombre es nuestro: hexadecimal sin entrada externa
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+nombre+" WITH (FORCE)")
		admin.Close()
	})

	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + nombre
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := bd.Subir(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return pool
}
