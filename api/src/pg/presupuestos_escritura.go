package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// Poner inserta el presupuesto propio (`persona_id` de la persona y `hogar_id` nulo, L3 de la US-77) o, si la categoría ya
// tiene uno en el periodo, le cambia el monto: `uq_presupuesto_persona_periodo_categoria` de E13 hace que dos «Guardar» a
// la vez dejen una sola fila. Solo inserta si la persona tiene perfil de adulta (la llave de E13 apunta a `perfil_adulto`)
// y si la categoría es de gasto y la persona la ve (regla `visible`), salvo que ya tenga presupuesto en el periodo (una
// oculta con presupuesto se sigue corrigiendo, RN-011). Si no inserta, averigua por qué.
func (p *Presupuestos) Poner(ctx context.Context, persona string, categoria int, periodo time.Time, monto int64) (presupuesto.Guardado, bool, error) {
	g := presupuesto.Guardado{CategoriaID: categoria, Periodo: periodo, Monto: monto}
	var creado bool
	err := p.pool.QueryRow(ctx,
		`INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado)
		 SELECT a.persona_id, c.id, $3, $4
		 FROM perfil_adulto a JOIN persona p ON p.id = a.persona_id JOIN categoria c ON c.id = $2 AND c.tipo = 'gasto'
		 WHERE a.persona_id = $1::uuid AND p.etapa = 'adulta'
		   AND ((`+visible+`)
		        OR EXISTS (SELECT 1 FROM presupuesto x WHERE x.persona_id = p.id AND x.periodo = $3 AND x.categoria_id = c.id))
		 ON CONFLICT ON CONSTRAINT uq_presupuesto_persona_periodo_categoria DO UPDATE SET monto_asignado = EXCLUDED.monto_asignado
		 RETURNING id::text, xmax = 0`,
		persona, categoria, periodo, monto).Scan(&g.ID, &creado)
	if errors.Is(err, pgx.ErrNoRows) {
		return presupuesto.Guardado{}, false, p.porQueNoSePuso(ctx, persona)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" && pgErr.ConstraintName == "fk_presupuesto_persona_id" {
		return presupuesto.Guardado{}, false, registro.ErrSinCuenta // la cuenta se borró mientras se guardaba
	}
	if err != nil {
		return presupuesto.Guardado{}, false, fmt.Errorf("guardar el presupuesto: %w", err)
	}
	return g, creado, nil
}

// porQueNoSePuso distingue, cuando Poner no insertó nada, una cuenta que ya no existe, una persona que no es adulta y una
// categoría que no vale.
func (p *Presupuestos) porQueNoSePuso(ctx context.Context, persona string) error {
	var adulta bool
	err := p.pool.QueryRow(ctx, `SELECT p.etapa = 'adulta' AND EXISTS (SELECT 1 FROM perfil_adulto a WHERE a.persona_id = p.id)
		FROM persona p WHERE p.id = $1::uuid`, persona).Scan(&adulta)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return registro.ErrSinCuenta
	case err != nil:
		return fmt.Errorf("revisar la persona: %w", err)
	case !adulta:
		return presupuesto.ErrSoloAdultos
	}
	return registro.ErrCategoriaInvalida
}

// Obtener lee un presupuesto de la persona; el de otra persona es ErrNoEncontrado, igual que el que no existe.
func (p *Presupuestos) Obtener(ctx context.Context, persona, id string) (presupuesto.Guardado, error) {
	var g presupuesto.Guardado
	err := p.pool.QueryRow(ctx, `SELECT id::text, categoria_id, periodo, monto_asignado FROM presupuesto WHERE id = $1::uuid AND persona_id = $2::uuid`,
		id, persona).Scan(&g.ID, &g.CategoriaID, &g.Periodo, &g.Monto)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, presupuesto.ErrNoEncontrado
	}
	if err != nil {
		return g, fmt.Errorf("leer el presupuesto: %w", err)
	}
	return g, nil
}

// Corregir cambia el monto de la fila de la persona solo si sigue siendo del periodo que el servicio comprobó.
func (p *Presupuestos) Corregir(ctx context.Context, persona, id string, periodo time.Time, monto int64) error {
	etiqueta, err := p.pool.Exec(ctx, `UPDATE presupuesto SET monto_asignado = $4 WHERE id = $1::uuid AND persona_id = $2::uuid AND periodo = $3`,
		id, persona, periodo, monto)
	if err != nil {
		return fmt.Errorf("corregir el presupuesto: %w", err)
	}
	if etiqueta.RowsAffected() == 0 {
		return presupuesto.ErrNoEncontrado
	}
	return nil
}

// Quitar borra la fila de la persona solo si sigue siendo del periodo que el servicio comprobó. No toca `movimiento`: lo
// gastado no cambia.
func (p *Presupuestos) Quitar(ctx context.Context, persona, id string, periodo time.Time) error {
	etiqueta, err := p.pool.Exec(ctx, `DELETE FROM presupuesto WHERE id = $1::uuid AND persona_id = $2::uuid AND periodo = $3`, id, persona, periodo)
	if err != nil {
		return fmt.Errorf("quitar el presupuesto: %w", err)
	}
	if etiqueta.RowsAffected() == 0 {
		return presupuesto.ErrNoEncontrado
	}
	return nil
}

// DejarEnCero guarda la marca «en cero» de la persona en el periodo (`presupuesto_en_cero`, 0004) si el periodo sigue en
// cero: la suma de sus ingresos registrados y la de lo asignado, las mismas de la lectura, son cero. Si ya la tiene, no
// cambia nada (ON CONFLICT DO NOTHING): es idempotente. No bloquea: si a la vez llega un ingreso o un presupuesto, la marca
// puede quedar, y no importa, porque la lectura solo la muestra mientras el mes siga en cero. La llave de 0004 apunta a
// `perfil_adulto` y se borra con la cuenta.
func (p *Presupuestos) DejarEnCero(ctx context.Context, persona string, periodo time.Time) error {
	var adulta, enCero bool
	err := p.pool.QueryRow(ctx,
		`SELECT p.etapa = 'adulta' AND EXISTS (SELECT 1 FROM perfil_adulto a WHERE a.persona_id = p.id),
		        (SELECT coalesce(sum(m.monto), 0) FROM movimiento m WHERE m.persona_id = p.id AND m.tipo = 'ingreso' AND m.fecha >= $2 AND m.fecha < $3) = 0
		    AND (SELECT coalesce(sum(x.monto_asignado), 0) FROM presupuesto x WHERE x.persona_id = p.id AND x.periodo = $2) = 0
		 FROM persona p WHERE p.id = $1::uuid`, persona, periodo, periodo.AddDate(0, 1, 0)).Scan(&adulta, &enCero)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return registro.ErrSinCuenta
	case err != nil:
		return fmt.Errorf("revisar el periodo: %w", err)
	case !adulta:
		return presupuesto.ErrSoloAdultos
	case !enCero:
		return presupuesto.ErrPeriodoConIngresoOPresupuesto
	}
	_, err = p.pool.Exec(ctx, `INSERT INTO presupuesto_en_cero (persona_id, periodo) VALUES ($1::uuid, $2) ON CONFLICT ON CONSTRAINT pk_presupuesto_en_cero DO NOTHING`,
		persona, periodo)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" && pgErr.ConstraintName == "fk_presupuesto_en_cero_persona_id" {
		return registro.ErrSinCuenta // la cuenta se borró mientras tanto
	}
	if err != nil {
		return fmt.Errorf("dejar el presupuesto en cero: %w", err)
	}
	return nil
}
