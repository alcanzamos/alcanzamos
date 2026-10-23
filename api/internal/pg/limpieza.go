package pg

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Limpieza borra lo vencido que ya no sirve (E12 `LimpiarSesionesYEnlaces`, CU-52).
type Limpieza struct{ pool *pgxpool.Pool }

// NuevoLimpieza crea la limpieza sobre un pool.
func NuevoLimpieza(pool *pgxpool.Pool) *Limpieza { return &Limpieza{pool: pool} }

// LimpiarSesionesYEnlaces borra las sesiones y los enlaces de un solo uso con vence_en anterior a ahora (E13 §5.3 y
// §5.4; ix_sesion_vence e ix_enlace_vence). Es idempotente. Devuelve cuántas filas borró de cada tabla.
func (l *Limpieza) LimpiarSesionesYEnlaces(ctx context.Context, ahora time.Time) (sesiones, enlaces int, err error) {
	s, err := l.pool.Exec(ctx, `DELETE FROM sesion WHERE vence_en < $1`, ahora)
	if err != nil {
		return 0, 0, fmt.Errorf("borrar las sesiones vencidas: %w", err)
	}
	e, err := l.pool.Exec(ctx, `DELETE FROM enlace_un_uso WHERE vence_en < $1`, ahora)
	if err != nil {
		return int(s.RowsAffected()), 0, fmt.Errorf("borrar los enlaces vencidos: %w", err)
	}
	return int(s.RowsAffected()), int(e.RowsAffected()), nil
}
