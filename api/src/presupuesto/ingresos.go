package presupuesto

import (
	"context"
	"errors"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// Ingresos es la respuesta de `GET /api/v1/ingresos` (PN-08).
type Ingresos struct {
	PeriodoActual string          `json:"periodo_actual"` // el mes de hoy en Colombia, AAAA-MM
	Periodo       string          `json:"periodo"`
	Meses         []string        `json:"meses"` // con ingresos registrados, del más reciente al más antiguo («Otro mes»)
	Total         TotalDeIngresos `json:"total"`
	Fuentes       []Fuente        `json:"fuentes"` // de mayor a menor total y, si empatan, por id
}

// TotalDeIngresos es la tarjeta «Entran este mes». `EntranCentavos` es el «ingresos del mes» de la simulación:
// registrado más esperado (E14-PPN 9.3). Lo esperado incluye lo por confirmar: lo pendiente no es registrado aunque su
// fecha ya haya llegado (D-091, E15 5.5).
type TotalDeIngresos struct {
	EntranCentavos     *big.Int `json:"entran_centavos"`
	RegistradoCentavos *big.Int `json:"registrado_centavos"`
	EsperadoCentavos   *big.Int `json:"esperado_centavos"`
	// PorConfirmar es cuántas fechas del periodo están por confirmar: con dos o más, «Confirmar todos» (D-093).
	PorConfirmar int `json:"por_confirmar"`
}

// Fuente es una categoría de ingreso con sus fechas del periodo (RF-009).
type Fuente struct {
	CategoriaID   int             `json:"categoria_id"`
	Nombre        string          `json:"nombre"`
	Oculta        bool            `json:"oculta"`
	TotalCentavos *big.Int        `json:"total_centavos"`
	Ingresos      []FilaDeIngreso `json:"ingresos"` // por fecha; con la misma fecha, primero lo registrado
}

// FilaDeIngreso es una fecha de una fuente. Lo registrado trae `movimiento_id`; lo esperado y lo por confirmar traen
// `recurrente_id`, el de las rutas de confirmar y omitir de la US-60, con el monto habitual y el medio de la repetición.
type FilaDeIngreso struct {
	Fecha         string  `json:"fecha"`
	Marca         string  `json:"marca"`
	MontoCentavos int64   `json:"monto_centavos"`
	Medio         string  `json:"medio"`
	Descripcion   *string `json:"descripcion"`
	MovimientoID  *string `json:"movimiento_id"`
	RecurrenteID  *string `json:"recurrente_id"`
}

// VerIngresos arma PN-08 del `periodo` (AAAA-MM; vacío es el mes de hoy en Colombia): los ingresos registrados y las
// fechas pendientes de las repeticiones de ingreso, por fuente. ErrValidacion con `periodo`.
func (s *Servicio) VerIngresos(ctx context.Context, persona, periodo string) (Ingresos, error) {
	hoy := fechas.HoyEnColombia(s.reloj.Ahora())
	mes, codigo := registro.LeerPeriodo(periodo, hoy)
	if codigo != "" {
		return Ingresos{}, &registro.ErrValidacion{Campos: map[string]string{"periodo": codigo}}
	}
	d, err := s.repo.Ingresos(ctx, persona, mes)
	if err != nil {
		return Ingresos{}, err
	}
	pendientes, err := pendientesDelMes(d.Recurrentes, mes, hoy)
	if err != nil {
		return Ingresos{}, err
	}
	medios := make(map[string]string, len(d.Recurrentes))
	for _, r := range d.Recurrentes {
		medios[r.ID] = r.Medio
	}
	total := TotalDeIngresos{RegistradoCentavos: new(big.Int), EsperadoCentavos: new(big.Int)}
	porFuente := map[int][]FilaDeIngreso{}
	for _, i := range d.Ingresos {
		id := i.MovimientoID
		porFuente[i.CategoriaID] = append(porFuente[i.CategoriaID], FilaDeIngreso{Fecha: i.Fecha.Format(time.DateOnly), Marca: MarcaRegistrado,
			MontoCentavos: i.Monto, Medio: i.Medio, Descripcion: i.Descripcion, MovimientoID: &id})
		total.RegistradoCentavos.Add(total.RegistradoCentavos, big.NewInt(i.Monto))
	}
	for _, p := range pendientes {
		id := p.RecurrenteID
		porFuente[p.CategoriaID] = append(porFuente[p.CategoriaID], FilaDeIngreso{Fecha: p.Fecha, Marca: p.Marca, MontoCentavos: p.MontoCentavos,
			Medio: medios[id], RecurrenteID: &id})
		total.EsperadoCentavos.Add(total.EsperadoCentavos, big.NewInt(p.MontoCentavos))
		if p.Marca == MarcaPorConfirmar {
			total.PorConfirmar++
		}
	}
	total.EntranCentavos = new(big.Int).Add(total.RegistradoCentavos, total.EsperadoCentavos)

	fuentes, err := agrupar(d.Categorias, porFuente)
	if err != nil {
		return Ingresos{}, err
	}
	meses := d.Meses
	if meses == nil {
		meses = []string{}
	}
	return Ingresos{PeriodoActual: hoy.Format(registro.FormatoDePeriodo), Periodo: mes.Format(registro.FormatoDePeriodo), Meses: meses,
		Total: total, Fuentes: fuentes}, nil
}

// agrupar arma una fuente por categoría de ingreso, con su total exacto, y las ordena.
func agrupar(categorias []CategoriaDelCatalogo, porFuente map[int][]FilaDeIngreso) ([]Fuente, error) {
	catalogo := make(map[int]CategoriaDelCatalogo, len(categorias))
	for _, c := range categorias {
		catalogo[c.ID] = c
	}
	fuentes := make([]Fuente, 0, len(porFuente))
	for id, filas := range porFuente {
		c, existe := catalogo[id]
		if !existe || c.Tipo != registro.Ingreso {
			return nil, errors.New("una fuente del periodo no es una categoría de ingreso del catálogo")
		}
		total := new(big.Int)
		for _, f := range filas {
			total.Add(total, big.NewInt(f.MontoCentavos))
		}
		// Estable: las filas llegan con lo registrado primero (en el orden en que se registró) y después lo pendiente (por
		// fecha y repetición), así que con la misma fecha lo registrado queda primero.
		slices.SortStableFunc(filas, func(a, b FilaDeIngreso) int { return strings.Compare(a.Fecha, b.Fecha) })
		fuentes = append(fuentes, Fuente{CategoriaID: id, Nombre: c.Nombre, Oculta: c.Oculta, TotalCentavos: total, Ingresos: filas})
	}
	slices.SortFunc(fuentes, func(a, b Fuente) int {
		if c := b.TotalCentavos.Cmp(a.TotalCentavos); c != 0 {
			return c
		}
		return a.CategoriaID - b.CategoriaID
	})
	return fuentes, nil
}
