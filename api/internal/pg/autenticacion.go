package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/internal/autenticacion"
)

// Autenticacion implementa autenticacion.Repositorio.
type Autenticacion struct{ pool *pgxpool.Pool }

// NuevoAutenticacion crea el repositorio sobre un pool.
func NuevoAutenticacion(pool *pgxpool.Pool) *Autenticacion { return &Autenticacion{pool: pool} }

// CredencialPorCorreo busca la credencial por el correo del perfil de adulto. La búsqueda usa el índice único del correo.
func (r *Autenticacion) CredencialPorCorreo(ctx context.Context, correo string) (autenticacion.Credencial, error) {
	var c autenticacion.Credencial
	err := r.pool.QueryRow(ctx,
		`SELECT c.persona_id::text, c.hash, pa.correo_verificado
		 FROM perfil_adulto pa JOIN credencial c ON c.persona_id = pa.persona_id
		 WHERE pa.correo = lower(btrim($1))`, correo).Scan(&c.Persona, &c.Hash, &c.Verificada)
	if errors.Is(err, pgx.ErrNoRows) {
		return autenticacion.Credencial{}, autenticacion.ErrNoExiste
	}
	if err != nil {
		return autenticacion.Credencial{}, fmt.Errorf("buscar la credencial: %w", err)
	}
	return c, nil
}

// IniciarSesion guarda la sesión nueva (con el límite de 5 por persona) y mueve el ingreso en la misma transacción:
// `ingreso_anterior = ultimo_ingreso` y `ultimo_ingreso = ahora` (D-134). En el UPDATE, la parte derecha de cada
// asignación ve la fila como estaba, así que en el primer ingreso `ingreso_anterior` queda nulo. La fila queda
// bloqueada hasta el commit: dos inicios simultáneos de la misma cuenta se turnan y el segundo ve el ingreso del primero.
func (r *Autenticacion) IniciarSesion(ctx context.Context, persona string, huella []byte, ahora time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	res, err := tx.Exec(ctx,
		`UPDATE credencial SET ingreso_anterior = ultimo_ingreso, ultimo_ingreso = $2 WHERE persona_id = $1::uuid`, persona, ahora)
	if err != nil {
		return fmt.Errorf("registrar el ingreso: %w", err)
	}
	if res.RowsAffected() != 1 {
		return errors.New("registrar el ingreso: la cuenta no tiene credencial")
	}
	if err := insertarSesion(ctx, tx, persona, huella, ahora); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// CerrarSesion borra la fila de la sesión: revocar es borrar (E13 §5.3).
func (r *Autenticacion) CerrarSesion(ctx context.Context, huella []byte) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM sesion WHERE hash_token = $1`, huella); err != nil {
		return fmt.Errorf("cerrar la sesión: %w", err)
	}
	return nil
}

// IngresoAnterior lee `credencial.ingreso_anterior`: nulo en el primer ingreso.
func (r *Autenticacion) IngresoAnterior(ctx context.Context, persona string) (*time.Time, error) {
	var anterior *time.Time
	err := r.pool.QueryRow(ctx, `SELECT ingreso_anterior FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&anterior)
	if err != nil {
		return nil, fmt.Errorf("leer el ingreso anterior: %w", err)
	}
	return anterior, nil
}
