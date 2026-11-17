package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// Recurrentes devuelve las repeticiones de la persona (`persona_id`: las de un hogar no son de nadie en particular, y
// confirmarlas es de quien las registró, E14 4.8), cada una con sus fechas confirmadas (`movimiento.fecha_programada`) y
// omitidas (`ocurrencia_omitida`), leídas en una lectura consistente.
func (m *Movimientos) Recurrentes(ctx context.Context, persona string) ([]registro.Recurrente, error) {
	tx, err := m.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("abrir la lectura: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // solo lectura
	return recurrentesEn(ctx, tx, persona)
}

// recurrentesEn lee las repeticiones de la persona dentro de `tx`: la usan Recurrentes y las lecturas del presupuesto,
// para que lo registrado y lo pendiente salgan de la misma foto de la base.
func recurrentesEn(ctx context.Context, tx pgx.Tx, persona string) ([]registro.Recurrente, error) {
	lista, err := filasDe(ctx, tx, "las repeticiones", func(f pgx.CollectableRow) (registro.Recurrente, error) {
		var (
			r        registro.Recurrente
			creadoEn time.Time
		)
		if err := f.Scan(&r.ID, &r.Tipo, &r.CategoriaID, &r.Medio, &r.Periodicidad, &r.Monto, &r.Inicio, &r.DetenidoEn, &creadoEn); err != nil {
			return r, err
		}
		r.CreadoEl = fechas.HoyEnColombia(creadoEn)
		return r, nil
	}, `SELECT id::text, tipo, categoria_id, medio, periodicidad, monto_habitual, inicio, detenido_en, creado_en
		FROM movimiento_recurrente WHERE persona_id = $1::uuid ORDER BY creado_en, id`, persona)
	if err != nil {
		return nil, err
	}
	indice := make(map[string]int, len(lista))
	for i, r := range lista {
		indice[r.ID] = i
	}
	type fecha struct {
		recurrente string
		dia        time.Time
	}
	leer := func(f pgx.CollectableRow) (fecha, error) {
		var x fecha
		return x, f.Scan(&x.recurrente, &x.dia)
	}
	confirmadas, err := filasDe(ctx, tx, "las fechas confirmadas", leer,
		`SELECT m.recurrente_id::text, m.fecha_programada FROM movimiento m
		 JOIN movimiento_recurrente r ON r.id = m.recurrente_id WHERE r.persona_id = $1::uuid ORDER BY 1, 2`, persona)
	if err != nil {
		return nil, err
	}
	omitidas, err := filasDe(ctx, tx, "las fechas omitidas", leer,
		`SELECT o.recurrente_id::text, o.fecha_programada FROM ocurrencia_omitida o
		 JOIN movimiento_recurrente r ON r.id = o.recurrente_id WHERE r.persona_id = $1::uuid ORDER BY 1, 2`, persona)
	if err != nil {
		return nil, err
	}
	for _, c := range confirmadas {
		lista[indice[c.recurrente]].Confirmadas = append(lista[indice[c.recurrente]].Confirmadas, c.dia)
	}
	for _, o := range omitidas {
		lista[indice[o.recurrente]].Omitidas = append(lista[indice[o.recurrente]].Omitidas, o.dia)
	}
	return lista, nil
}

// Decidir guarda en una transacción los movimientos de las fechas confirmadas y las fechas omitidas. Cada INSERT lee la
// repetición con `persona_id = persona`: una ajena no inserta nada (ErrNoEncontrado). Dos pedidos a la vez de la misma
// fecha: el segundo espera a la restricción única `uq_movimiento_recurrente_programada` (o a la llave primaria de
// `ocurrencia_omitida`) y falla con ErrFechaNoPendiente; una fecha que se confirma y se omite a la vez la rechazan los
// disparadores de E13 (`check_violation` sin restricción), que también son ErrFechaNoPendiente.
func (m *Movimientos) Decidir(ctx context.Context, persona string, confirmar []registro.Confirmacion, omitir []registro.Omision, ahora time.Time) ([]string, error) {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	// Orden global de candados (el mismo del borrado de la cuenta, `bloquearParaBorrar`): primero la persona y después las
	// repeticiones por id. Los INSERT de abajo toman un candado compartido sobre la persona por la llave foránea; si ya se
	// tuvieran bloqueadas las repeticiones, el borrado de la cuenta (que bloquea la persona y luego las repeticiones) y esta
	// operación se esperarían entre sí. Con la persona ya borrada, la cuenta no existe.
	if len(confirmar)+len(omitir) > 0 {
		var existe int
		if err := tx.QueryRow(ctx, `SELECT 1 FROM persona WHERE id = $1::uuid FOR KEY SHARE`, persona).Scan(&existe); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, registro.ErrSinCuenta
			}
			return nil, errorDeDecidir("bloquear la persona", err)
		}
	}
	// Los disparadores de E13 bloquean la fila de la repetición en el orden de las decisiones: dos operaciones que tocan las
	// mismas repeticiones en orden contrario se bloquearían entre sí. Se bloquean todas desde el principio, siempre por id.
	if err := bloquearRepeticiones(ctx, tx, persona, confirmar, omitir); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(confirmar))
	for _, c := range confirmar {
		var id string
		err := tx.QueryRow(ctx,
			`INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, recurrente_id, fecha_programada, creado_en)
			 SELECT r.persona_id, $3, $4, $5, $6, $7, r.id, $5, $8 FROM movimiento_recurrente r WHERE r.id = $1::uuid AND r.persona_id = $2::uuid
			 RETURNING id::text`,
			c.RecurrenteID, persona, c.Tipo, c.Monto, c.Fecha, c.Medio, c.CategoriaID, ahora).Scan(&id)
		if err != nil {
			return nil, errorDeDecidir("confirmar la fecha", err)
		}
		ids = append(ids, id)
	}
	for _, o := range omitir {
		_, err := tx.Exec(ctx,
			`INSERT INTO ocurrencia_omitida (recurrente_id, fecha_programada, omitida_en)
			 SELECT r.id, $3, $4 FROM movimiento_recurrente r WHERE r.id = $1::uuid AND r.persona_id = $2::uuid`,
			o.RecurrenteID, persona, o.Fecha, ahora)
		if err != nil {
			return nil, errorDeDecidir("omitir la fecha", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("confirmar la transacción: %w", err)
	}
	return ids, nil
}

// bloquearRepeticiones toma `FOR UPDATE` de las repeticiones de la persona que intervienen, ordenadas por id. Si falta alguna (no
// existe o es de otra persona) es ErrNoEncontrado.
func bloquearRepeticiones(ctx context.Context, tx pgx.Tx, persona string, confirmar []registro.Confirmacion, omitir []registro.Omision) error {
	vistos := map[string]bool{}
	var ids []string
	for _, c := range confirmar {
		if !vistos[c.RecurrenteID] {
			vistos[c.RecurrenteID] = true
			ids = append(ids, c.RecurrenteID)
		}
	}
	for _, o := range omitir {
		if !vistos[o.RecurrenteID] {
			vistos[o.RecurrenteID] = true
			ids = append(ids, o.RecurrenteID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	bloqueadas, err := filasDe(ctx, tx, "las repeticiones que se bloquean", pgx.RowTo[string],
		`SELECT id::text FROM movimiento_recurrente WHERE id = ANY($1::uuid[]) AND persona_id = $2::uuid ORDER BY id FOR UPDATE`, ids, persona)
	if err != nil {
		return errorDeDecidir("bloquear las repeticiones", err)
	}
	if len(bloqueadas) != len(ids) {
		return registro.ErrNoEncontrado
	}
	return nil
}

// errorDeDecidir traduce lo que la base rechaza: el bloqueo mutuo y el fallo de serialización (reintentables), la fecha
// repetida, los disparadores de exclusión entre confirmada y omitida y la llave de `persona` o de la repetición (la cuenta
// se borró mientras se decidía: ErrSinCuenta, como al guardar un movimiento; con la persona bloqueada al empezar no pasa).
func errorDeDecidir(que string, err error) error {
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == "23503" &&
		(pgErr.ConstraintName == "fk_movimiento_persona_id" || pgErr.ConstraintName == "fk_movimiento_recurrente_id"):
		return registro.ErrSinCuenta
	case errors.As(err, &pgErr) && (pgErr.Code == "40P01" || pgErr.Code == "40001"):
		return registro.ErrConflictoConcurrente
	case errors.As(err, &pgErr) && pgErr.Code == "23505" &&
		(pgErr.ConstraintName == "uq_movimiento_recurrente_programada" || pgErr.ConstraintName == "pk_ocurrencia_omitida"):
		return registro.ErrFechaNoPendiente
	case errors.As(err, &pgErr) && pgErr.Code == "23514" && pgErr.ConstraintName == "":
		return registro.ErrFechaNoPendiente
	}
	return fmt.Errorf("%s: %w", que, err)
}
