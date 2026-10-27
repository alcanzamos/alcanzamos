package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// columnasDeMovimiento y desdeMovimiento arman un registro.Movimiento: la meta de un aporte y la repetición de la que
// viene una fecha confirmada se traen con LEFT JOIN, y `compartido` es `hogar_id` no nulo (NM-05).
const (
	columnasDeMovimiento = `m.id::text, m.tipo, m.monto, to_char(m.fecha, 'YYYY-MM-DD'), m.categoria_id, m.medio, m.descripcion,
		m.hogar_id IS NOT NULL, m.meta_id::text, t.nombre, m.sentido,
		m.recurrente_id::text, to_char(m.fecha_programada, 'YYYY-MM-DD'), r.periodicidad`
	desdeMovimiento = `FROM movimiento m
		LEFT JOIN meta t ON t.id = m.meta_id
		LEFT JOIN movimiento_recurrente r ON r.id = m.recurrente_id`
)

func leerMovimiento(f pgx.Row) (registro.Movimiento, error) {
	var (
		m                                    registro.Movimiento
		meta, nombreMeta                     *string
		recurrente, programada, periodicidad *string
	)
	if err := f.Scan(&m.ID, &m.Tipo, &m.MontoCentavos, &m.Fecha, &m.CategoriaID, &m.Medio, &m.Descripcion, &m.Compartido,
		&meta, &nombreMeta, &m.Sentido, &recurrente, &programada, &periodicidad); err != nil {
		return m, err
	}
	if meta != nil && nombreMeta != nil {
		m.Meta = &registro.MetaDeAporte{ID: *meta, Nombre: *nombreMeta}
	}
	if recurrente != nil && programada != nil && periodicidad != nil {
		m.Recurrente = &registro.DeRecurrente{RecurrenteID: *recurrente, FechaProgramada: *programada, Periodicidad: *periodicidad}
	}
	return m, nil
}

// filasDe corre una consulta de la lectura de Listar y junta sus filas; `que` dice qué se leía, para el error.
func filasDe[T any](ctx context.Context, tx pgx.Tx, que string, leer pgx.RowToFunc[T], sql string, args ...any) ([]T, error) {
	filas, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("consultar %s: %w", que, err)
	}
	lista, err := pgx.CollectRows(filas, leer)
	if err != nil {
		return nil, fmt.Errorf("leer %s: %w", que, err)
	}
	return lista, nil
}

// Listar trae, en una lectura consistente, los movimientos propios (`persona_id`) del mes, ordenados por fecha y, con la
// misma fecha, el que se registró después primero (E14-PRR PN-01); los meses con movimientos, sin importar el filtro; y las
// categorías con movimientos en el mes, también las que la persona ocultó (RN-011).
func (m *Movimientos) Listar(ctx context.Context, persona string, mes time.Time, categoria *int) (registro.Listado, error) {
	var l registro.Listado
	tx, err := m.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return l, fmt.Errorf("abrir la lectura: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // solo lectura

	hasta := mes.AddDate(0, 1, 0)
	if l.Movimientos, err = filasDe(ctx, tx, "los movimientos", func(f pgx.CollectableRow) (registro.Movimiento, error) { return leerMovimiento(f) },
		`SELECT `+columnasDeMovimiento+` `+desdeMovimiento+`
		 WHERE m.persona_id = $1::uuid AND m.fecha >= $2 AND m.fecha < $3 AND ($4::smallint IS NULL OR m.categoria_id = $4)
		 ORDER BY m.fecha DESC, m.creado_en DESC, m.id DESC`, persona, mes, hasta, categoria); err != nil {
		return l, err
	}
	if l.Meses, err = filasDe(ctx, tx, "los meses", pgx.RowTo[string],
		`SELECT to_char(fecha, 'YYYY-MM') FROM movimiento WHERE persona_id = $1::uuid GROUP BY 1 ORDER BY 1 DESC`, persona); err != nil {
		return l, err
	}
	l.Categorias, err = filasDe(ctx, tx, "las categorías del periodo", func(f pgx.CollectableRow) (registro.CategoriaDelPeriodo, error) {
		var c registro.CategoriaDelPeriodo
		return c, f.Scan(&c.CategoriaID, &c.Movimientos, &c.Oculta)
	}, `SELECT m.categoria_id, count(*)::int,
		        EXISTS (SELECT 1 FROM ocultamiento_categoria o WHERE o.persona_id = m.persona_id AND o.categoria_id = m.categoria_id)
		 FROM movimiento m
		 WHERE m.persona_id = $1::uuid AND m.fecha >= $2 AND m.fecha < $3 AND m.categoria_id IS NOT NULL
		 GROUP BY m.persona_id, m.categoria_id ORDER BY 2 DESC, 1`, persona, mes, hasta)
	return l, err
}

// Obtener lee un movimiento de la persona; el de otra persona es ErrNoEncontrado, igual que el que no existe.
func (m *Movimientos) Obtener(ctx context.Context, persona, id string) (registro.Movimiento, error) {
	mov, err := leerMovimiento(m.pool.QueryRow(ctx,
		`SELECT `+columnasDeMovimiento+` `+desdeMovimiento+` WHERE m.id = $1::uuid AND m.persona_id = $2::uuid`, id, persona))
	if errors.Is(err, pgx.ErrNoRows) {
		return mov, registro.ErrNoEncontrado
	}
	if err != nil {
		return mov, fmt.Errorf("leer el movimiento: %w", err)
	}
	return mov, nil
}

// Corregir cambia solo los campos de `c` de la fila de la persona: el `tipo` de un aporte y la fecha de una fecha de
// repetición llegan sin cambio (el servicio lo asegura), y no toca `recurrente_id` ni `fecha_programada`. Una categoría
// que la persona no ve (regla `visible`) es ErrCategoriaInvalida, salvo la que la fila ya tiene (un movimiento conserva
// su categoría aunque se oculte, RN-011); la llave (categoría, tipo) de E13 rechaza una del otro tipo.
func (m *Movimientos) Corregir(ctx context.Context, persona, id string, c registro.Correccion) error {
	if c.CategoriaID != nil {
		var puedeUsarla bool
		if err := m.pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM categoria c JOIN persona p ON p.id = $1::uuid WHERE c.id = $3 AND `+visible+`)
			     OR EXISTS (SELECT 1 FROM movimiento WHERE id = $2::uuid AND persona_id = $1::uuid AND categoria_id = $3)`,
			persona, id, *c.CategoriaID).Scan(&puedeUsarla); err != nil {
			return fmt.Errorf("revisar la categoría: %w", err)
		}
		if !puedeUsarla {
			return registro.ErrCategoriaInvalida
		}
	}
	etiqueta, err := m.pool.Exec(ctx,
		`UPDATE movimiento SET tipo = $3, monto = $4, fecha = COALESCE($5, fecha), categoria_id = $6, medio = $7, descripcion = $8
		 WHERE id = $1::uuid AND persona_id = $2::uuid`,
		id, persona, c.Tipo, c.Monto, c.Fecha, c.CategoriaID, c.Medio, c.Descripcion)
	if err != nil {
		return errorDeGuardar("corregir el movimiento", err)
	}
	if etiqueta.RowsAffected() == 0 {
		return registro.ErrNoEncontrado
	}
	return nil
}

// Borrar quita la fila de la persona. No toca `movimiento_recurrente` ni `ocurrencia_omitida`: la fecha programada
// deja de estar confirmada y E15 5.2 la vuelve a ofrecer (D-168).
func (m *Movimientos) Borrar(ctx context.Context, persona, id string) error {
	etiqueta, err := m.pool.Exec(ctx, `DELETE FROM movimiento WHERE id = $1::uuid AND persona_id = $2::uuid`, id, persona)
	if err != nil {
		return fmt.Errorf("borrar el movimiento: %w", err)
	}
	if etiqueta.RowsAffected() == 0 {
		return registro.ErrNoEncontrado
	}
	return nil
}
