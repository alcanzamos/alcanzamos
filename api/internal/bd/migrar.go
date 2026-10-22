package bd

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/alcanzamos/alcanzamos/api/migraciones"
)

func proveedor(pool *pgxpool.Pool) (*goose.Provider, error) {
	return goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(pool), migraciones.SQL)
}

// Subir aplica todas las migraciones pendientes y devuelve cuántas aplicó.
func Subir(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	p, err := proveedor(pool)
	if err != nil {
		return 0, fmt.Errorf("preparar goose: %w", err)
	}
	res, err := p.Up(ctx)
	if err != nil {
		return len(res), fmt.Errorf("aplicar migraciones: %w", err)
	}
	return len(res), nil
}

// Bajar revierte todas las migraciones, de la última a la primera, y devuelve cuántas revirtió.
func Bajar(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	p, err := proveedor(pool)
	if err != nil {
		return 0, fmt.Errorf("preparar goose: %w", err)
	}
	res, err := p.DownTo(ctx, 0)
	if err != nil {
		return len(res), fmt.Errorf("revertir migraciones: %w", err)
	}
	return len(res), nil
}
