package pg

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/presupuesto"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// Presupuestos es la persistencia del presupuesto (E13 `presupuesto`) y de lo que PN-06 a PN-08 leen de los movimientos
// y las repeticiones: implementa presupuesto.Repositorio. Todo es de lo propio (`persona_id`).
type Presupuestos struct{ pool *pgxpool.Pool }

// NuevoPresupuestos crea el repositorio sobre un pool.
func NuevoPresupuestos(pool *pgxpool.Pool) *Presupuestos { return &Presupuestos{pool: pool} }

// leer abre una lectura consistente, comprueba que la persona existe (si no, registro.ErrSinCuenta) y lee el catálogo
// con las categorías que la persona ocultó; después corre `resto` en la misma lectura. Devuelve si la persona es adulta
// (etapa y perfil de adulta: el de la llave de `presupuesto`).
func (p *Presupuestos) leer(ctx context.Context, persona string, resto func(pgx.Tx) error) (bool, []presupuesto.CategoriaDelCatalogo, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return false, nil, fmt.Errorf("abrir la lectura: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // solo lectura

	var adulta bool
	err = tx.QueryRow(ctx, `SELECT p.etapa = 'adulta' AND EXISTS (SELECT 1 FROM perfil_adulto a WHERE a.persona_id = p.id)
		FROM persona p WHERE p.id = $1::uuid`, persona).Scan(&adulta)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, registro.ErrSinCuenta
	}
	if err != nil {
		return false, nil, fmt.Errorf("leer la persona: %w", err)
	}
	categorias, err := filasDe(ctx, tx, "el catálogo", func(f pgx.CollectableRow) (presupuesto.CategoriaDelCatalogo, error) {
		var c presupuesto.CategoriaDelCatalogo
		return c, f.Scan(&c.ID, &c.Nombre, &c.Tipo, &c.Oculta)
	}, `SELECT c.id, c.nombre, c.tipo, EXISTS (SELECT 1 FROM ocultamiento_categoria o WHERE o.persona_id = $1::uuid AND o.categoria_id = c.id)
		FROM categoria c ORDER BY c.id`, persona)
	if err != nil {
		return false, nil, err
	}
	return adulta, categorias, resto(tx)
}

// ingresosDelMes son los movimientos de ingreso de la persona en el mes, por fecha y en el orden en que se registraron.
func ingresosDelMes(ctx context.Context, tx pgx.Tx, persona string, mes time.Time) ([]presupuesto.IngresoRegistrado, error) {
	return filasDe(ctx, tx, "los ingresos", func(f pgx.CollectableRow) (presupuesto.IngresoRegistrado, error) {
		var i presupuesto.IngresoRegistrado
		return i, f.Scan(&i.MovimientoID, &i.CategoriaID, &i.Monto, &i.Fecha, &i.Medio, &i.Descripcion)
	}, `SELECT id::text, categoria_id, monto, fecha, medio, descripcion FROM movimiento
		WHERE persona_id = $1::uuid AND tipo = 'ingreso' AND fecha >= $2 AND fecha < $3
		ORDER BY fecha, creado_en, id`, persona, mes, mes.AddDate(0, 1, 0))
}

// Presupuesto lee, en una lectura consistente, los presupuestos del periodo, lo gastado por categoría (la suma exacta de
// la base: `sum(bigint)` es `numeric`), los ingresos del periodo, la marca «en cero» y las repeticiones. Lo gastado es solo de los movimientos
// de tipo gasto: un aporte o un retiro de una meta no tiene categoría y no cuenta (RN-013).
func (p *Presupuestos) Presupuesto(ctx context.Context, persona string, mes time.Time) (presupuesto.DatosDelPresupuesto, error) {
	var d presupuesto.DatosDelPresupuesto
	adulta, categorias, err := p.leer(ctx, persona, func(tx pgx.Tx) error {
		var err error
		// Solo los propios (`hogar_id` nulo), como la escritura y la descarga: los compartidos con el hogar no se mezclan
		// (L12 (2) de la US-77).
		if d.Presupuestos, err = filasDe(ctx, tx, "los presupuestos", func(f pgx.CollectableRow) (presupuesto.Guardado, error) {
			g := presupuesto.Guardado{Periodo: mes}
			return g, f.Scan(&g.ID, &g.CategoriaID, &g.Monto)
		}, `SELECT id::text, categoria_id, monto_asignado FROM presupuesto WHERE persona_id = $1::uuid AND hogar_id IS NULL AND periodo = $2 ORDER BY categoria_id`,
			persona, mes); err != nil {
			return err
		}
		type suma struct {
			categoria int
			total     string
		}
		sumas, err := filasDe(ctx, tx, "lo gastado", func(f pgx.CollectableRow) (suma, error) {
			var s suma
			return s, f.Scan(&s.categoria, &s.total)
		}, `SELECT categoria_id, sum(monto)::text FROM movimiento
			WHERE persona_id = $1::uuid AND tipo = 'gasto' AND fecha >= $2 AND fecha < $3
			GROUP BY categoria_id ORDER BY categoria_id`, persona, mes, mes.AddDate(0, 1, 0))
		if err != nil {
			return err
		}
		d.Gastado = make(map[int]*big.Int, len(sumas))
		for _, s := range sumas {
			total, ok := new(big.Int).SetString(s.total, 10)
			if !ok {
				return fmt.Errorf("lo gastado de la categoría %d no es un entero: %q", s.categoria, s.total)
			}
			d.Gastado[s.categoria] = total
		}
		if d.Ingresos, err = ingresosDelMes(ctx, tx, persona, mes); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM presupuesto_en_cero WHERE persona_id = $1::uuid AND periodo = $2)`,
			persona, mes).Scan(&d.EnCero); err != nil {
			return fmt.Errorf("leer la marca en cero: %w", err)
		}
		d.Recurrentes, err = recurrentesEn(ctx, tx, persona)
		return err
	})
	if err != nil {
		return presupuesto.DatosDelPresupuesto{}, err
	}
	d.Adulta, d.Categorias = adulta, categorias
	return d, nil
}

// Ingresos lee, en una lectura consistente, los ingresos del periodo, las repeticiones y los meses con ingresos.
func (p *Presupuestos) Ingresos(ctx context.Context, persona string, mes time.Time) (presupuesto.DatosDeIngresos, error) {
	var d presupuesto.DatosDeIngresos
	_, categorias, err := p.leer(ctx, persona, func(tx pgx.Tx) error {
		var err error
		if d.Ingresos, err = ingresosDelMes(ctx, tx, persona, mes); err != nil {
			return err
		}
		if d.Recurrentes, err = recurrentesEn(ctx, tx, persona); err != nil {
			return err
		}
		d.Meses, err = filasDe(ctx, tx, "los meses con ingresos", pgx.RowTo[string],
			`SELECT to_char(fecha, 'YYYY-MM') FROM movimiento WHERE persona_id = $1::uuid AND tipo = 'ingreso' GROUP BY 1 ORDER BY 1 DESC`, persona)
		return err
	})
	if err != nil {
		return presupuesto.DatosDeIngresos{}, err
	}
	d.Categorias = categorias
	return d, nil
}
