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

// Conectar abre un pool con la URL de BASE_DE_DATOS_URL y verifica la conexión con un ping.
func Conectar(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv(VariableURL)
	if url == "" {
		return nil, errors.New("falta la variable " + VariableURL)
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("configurar la conexión: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("conectar con PostgreSQL: %w", err)
	}
	return pool, nil
}
