package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
)

// Autorizaciones es la persistencia de PN-64 (E13 `autorizacion`): implementa autorizacion.Repositorio.
type Autorizaciones struct{ pool *pgxpool.Pool }

// NuevoAutorizaciones crea el repositorio sobre un pool.
func NuevoAutorizaciones(pool *pgxpool.Pool) *Autorizaciones { return &Autorizaciones{pool: pool} }

// Vigentes devuelve las finalidades que la persona se otorgó a sí misma y no ha retirado.
func (a *Autorizaciones) Vigentes(ctx context.Context, persona string) ([]string, error) {
	filas, err := a.pool.Query(ctx,
		`SELECT finalidad FROM autorizacion WHERE titular_id = $1::uuid AND otorgante_id = $1::uuid AND retirada_en IS NULL`, persona)
	if err != nil {
		return nil, fmt.Errorf("consultar las autorizaciones: %w", err)
	}
	codigos, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("leer las autorizaciones: %w", err)
	}
	return codigos, nil
}

// bloquear toma la fila de la persona adulta hasta el final de la transacción: otorgar y rechazar se turnan, y una
// autorización no puede quedar guardada para una cuenta que se acaba de borrar (`autorizacion` no tiene llave a persona).
func bloquear(ctx context.Context, tx pgx.Tx, persona string) error {
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM persona WHERE id = $1::uuid AND etapa = 'adulta' FOR UPDATE`, persona).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return autorizacion.ErrSinCuenta
	}
	if err != nil {
		return fmt.Errorf("bloquear la cuenta: %w", err)
	}
	return nil
}

// Otorgar inserta una fila por finalidad, con titular y otorgante la propia persona. El índice único de las vigentes
// (`ix_autorizacion_vigente`) hace que la que ya estaba otorgada no se repita.
func (a *Autorizaciones) Otorgar(ctx context.Context, persona string, finalidades []string, version string, ahora time.Time) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	if err := bloquear(ctx, tx, persona); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 SELECT $1::uuid, $1::uuid, f, $3, $4 FROM unnest($2::text[]) AS f
		 ON CONFLICT (titular_id, finalidad) WHERE retirada_en IS NULL DO NOTHING`,
		persona, finalidades, version, ahora); err != nil {
		return fmt.Errorf("guardar las autorizaciones: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// Rechazar borra la persona (ON DELETE CASCADE se lleva perfil, credencial, sesiones, enlaces y todo lo que tenga
// llave a ella) si aún no tiene vigentes todas las `necesarias`. Como BorrarSinConfirmar (D-135), no borra las
// autorizaciones que hubiera: quedan retiradas y conservadas hasta `conservarHasta` como prueba mínima (E13 §7).
func (a *Autorizaciones) Rechazar(ctx context.Context, persona string, necesarias []string, ahora, conservarHasta time.Time) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	if err := bloquear(ctx, tx, persona); err != nil {
		return err
	}
	var vigentes int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND otorgante_id = $1::uuid
		   AND retirada_en IS NULL AND finalidad = ANY($2::text[])`, persona, necesarias).Scan(&vigentes); err != nil {
		return fmt.Errorf("contar las autorizaciones: %w", err)
	}
	if vigentes == len(necesarias) {
		return autorizacion.ErrYaAutorizada
	}
	if _, err := tx.Exec(ctx,
		`UPDATE autorizacion SET retirada_en = GREATEST(otorgada_en, $2), conservar_hasta = $3::date
		 WHERE titular_id = $1::uuid AND retirada_en IS NULL`, persona, ahora, conservarHasta); err != nil {
		return fmt.Errorf("retirar las autorizaciones: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM persona WHERE id = $1::uuid`, persona); err != nil {
		return fmt.Errorf("borrar la cuenta: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}
