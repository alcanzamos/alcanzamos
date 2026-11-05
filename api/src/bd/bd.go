// Package bd conecta con PostgreSQL (pgx v5, pgxpool) y aplica las migraciones con goose como biblioteca.
package bd

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

// VariableURL es la variable de entorno con la cadena de conexión.
const VariableURL = "BASE_DE_DATOS_URL"

// Conectar abre un pool con la URL de BASE_DE_DATOS_URL y verifica la conexión con un ping. Toda conexión del pool
// fija TimeZone=UTC, también si la URL o el entorno (PGTZ) piden otra zona (E17 3.9, E13 §3.4).
func Conectar(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv(VariableURL)
	if url == "" {
		return nil, errors.New("falta la variable " + VariableURL)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("configurar la conexión: %w", err)
	}
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("configurar la conexión: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("conectar con PostgreSQL: %w", err)
	}
	return pool, nil
}
