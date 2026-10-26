package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// Movimientos es la persistencia del formulario de registro (E13 `categoria`, `movimiento` y
// `movimiento_recurrente`): implementa registro.Repositorio.
type Movimientos struct{ pool *pgxpool.Pool }

// NuevoMovimientos crea el repositorio sobre un pool.
func NuevoMovimientos(pool *pgxpool.Pool) *Movimientos { return &Movimientos{pool: pool} }

// Categorias devuelve las categorías que la persona no ocultó, por tipo y id. Una persona menor solo ve las aptas para
// menores (`apta_para_menores`); una adulta, todas.
func (m *Movimientos) Categorias(ctx context.Context, persona string) ([]registro.Categoria, error) {
	filas, err := m.pool.Query(ctx,
		`SELECT c.id, c.nombre, c.general, c.tipo
		 FROM categoria c JOIN persona p ON p.id = $1::uuid
		 WHERE (p.etapa = 'adulta' OR c.apta_para_menores)
		   AND NOT EXISTS (SELECT 1 FROM ocultamiento_categoria o WHERE o.persona_id = p.id AND o.categoria_id = c.id)
		 ORDER BY c.tipo, c.id`, persona)
	if err != nil {
		return nil, fmt.Errorf("consultar las categorías: %w", err)
	}
	lista, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (registro.Categoria, error) {
		var c registro.Categoria
		return c, f.Scan(&c.ID, &c.Nombre, &c.General, &c.Tipo)
	})
	if err != nil {
		return nil, fmt.Errorf("leer las categorías: %w", err)
	}
	return lista, nil
}

// Guardar inserta en una transacción la repetición (si la hay) y el movimiento (si hay que guardarlo). El movimiento de
// una repetición queda enlazado a ella con `recurrente_id` y `fecha_programada = fecha`: es su fecha confirmada. La
// llave compuesta (categoría, tipo) de E13 rechaza una categoría de otro tipo.
func (m *Movimientos) Guardar(ctx context.Context, g registro.Guardado, ahora time.Time) (registro.Creados, error) {
	var creados registro.Creados
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return creados, fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	var recurrente *string
	if g.Periodicidad != "" {
		if err := tx.QueryRow(ctx,
			`INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio, creado_en)
			 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
			g.Persona, g.Tipo, g.CategoriaID, string(g.Periodicidad), g.Monto, g.Medio, g.Fecha, ahora).Scan(&creados.RecurrenteID); err != nil {
			return registro.Creados{}, errorDeGuardar("guardar la repetición", err)
		}
		recurrente = &creados.RecurrenteID
	}
	if g.ConMovimiento {
		var programada *time.Time
		if recurrente != nil {
			programada = &g.Fecha
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id, recurrente_id, fecha_programada, creado_en)
			 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10) RETURNING id::text`,
			g.Persona, g.Tipo, g.Monto, g.Fecha, g.Medio, g.Descripcion, g.CategoriaID, recurrente, programada, ahora).Scan(&creados.MovimientoID); err != nil {
			return registro.Creados{}, errorDeGuardar("guardar el movimiento", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return registro.Creados{}, fmt.Errorf("confirmar la transacción: %w", err)
	}
	return creados, nil
}

// errorDeGuardar traduce la violación de la llave (categoría, tipo) a ErrCategoriaInvalida.
func errorDeGuardar(que string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" &&
		(pgErr.ConstraintName == "fk_movimiento_categoria_tipo" || pgErr.ConstraintName == "fk_recurrente_categoria_tipo") {
		return registro.ErrCategoriaInvalida
	}
	return fmt.Errorf("%s: %w", que, err)
}
