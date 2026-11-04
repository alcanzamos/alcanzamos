package registro

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
)

// DecisionesMaximas es el tope de decisiones de una sola operación de «Confirmar todos»: acota el trabajo de una
// transacción. Una persona con más fechas pendientes confirma en tandas.
const DecisionesMaximas = 500

// Códigos de error de campo de las decisiones sobre fechas pendientes (422 `datos_invalidos`).
const (
	RecurrenteRequerido  = "recurrente_requerido"
	RecurrenteInvalido   = "recurrente_invalido" // no es un identificador
	DecisionesRequeridas = "decisiones_requeridas"
	DemasiadasDecisiones = "demasiadas_decisiones"
)

// ErrFechaNoPendiente es el 409 `fecha_no_pendiente`: la fecha ya está confirmada u omitida, todavía no llegó, es
// anterior a la creación de la repetición, no es de su periodicidad, tiene dos decisiones en la misma operación o
// alguien la resolvió a la vez (la restricción única de la base). Es el de E15 5.2.
var ErrFechaNoPendiente = fechas.ErrFechaNoPendiente

// ErrConflictoConcurrente es el 409 `conflicto_concurrente`: la base abortó la operación por un bloqueo mutuo (`40P01`) o
// un fallo de serialización (`40001`) con otra petición. No se guardó nada y la misma petición puede reintentarse. No se
// reintenta dentro del API: el estado que el servicio leyó pudo cambiar y el cliente debe volver a pedir la lista.
var ErrConflictoConcurrente = errors.New("la operación chocó con otra a la vez; no se guardó nada")

// Recurrente es una repetición de la persona con lo que E15 5.2 necesita para saber qué fechas están pendientes.
type Recurrente struct {
	ID           string
	Tipo         string
	CategoriaID  int
	Medio        string
	Periodicidad fechas.Periodicidad
	Monto        int64     // centavos: el habitual
	Inicio       time.Time // primera fecha programada
	CreadoEl     time.Time // el día en que se creó la repetición, en hora de Colombia
	DetenidoEn   *time.Time
	Confirmadas  []time.Time // fechas programadas con movimiento
	Omitidas     []time.Time // fechas «No pasó»
}

// Confirmacion es un movimiento que nace de una fecha pendiente: con su fecha programada (D-094), la categoría, el tipo
// y el medio de la repetición, y el monto habitual o el que la persona escribió.
type Confirmacion struct {
	RecurrenteID string
	Fecha        time.Time
	Tipo         string
	Monto        int64 // centavos
	CategoriaID  int
	Medio        string
}

// Omision es una fecha pendiente que la persona marcó «No pasó» (D-092).
type Omision struct {
	RecurrenteID string
	Fecha        time.Time
}

// PorConfirmar es una fecha pendiente que ya llegó: una fila de «Por confirmar» de PN-01 o de «Confirmar todos». La
// repetición no guarda un nombre: la fila se titula con la categoría, que la app resuelve por `categoria_id`.
type PorConfirmar struct {
	RecurrenteID          string `json:"recurrente_id"`
	Fecha                 string `json:"fecha"`
	Tipo                  string `json:"tipo"`
	CategoriaID           int    `json:"categoria_id"`
	Medio                 string `json:"medio"`
	MontoHabitualCentavos int64  `json:"monto_habitual_centavos"`
	Periodicidad          string `json:"periodicidad"`
}

// ResumenPorConfirmar son las cuentas de «13 por confirmar: 2 ingresos y 11 gastos» (D-093).
type ResumenPorConfirmar struct {
	Total    int `json:"total"`
	Ingresos int `json:"ingresos"`
	Gastos   int `json:"gastos"`
}

// ListaPorConfirmar es la respuesta de `GET /api/v1/repeticiones/pendientes`: de la más antigua a la más reciente y, con
// la misma fecha, primero el ingreso.
type ListaPorConfirmar struct {
	Pendientes []PorConfirmar      `json:"pendientes"`
	Resumen    ResumenPorConfirmar `json:"resumen"`
}

// SolicitudDeConfirmacion es el cuerpo de `POST /api/v1/repeticiones/{id}/confirmacion`.
type SolicitudDeConfirmacion struct {
	Fecha string `json:"fecha"`
	// MontoCentavos se lee crudo (como en el POST de movimientos); omitido o null es el monto habitual.
	MontoCentavos json.RawMessage `json:"monto_centavos"`
}

// SolicitudDeOmision es el cuerpo de `POST /api/v1/repeticiones/{id}/omision`. «No pasó» no lleva monto.
type SolicitudDeOmision struct {
	Fecha string `json:"fecha"`
}

// DecisionDeUnaFecha es una decisión de «Confirmar todos»: confirmar con el monto habitual o con otro, u omitir.
type DecisionDeUnaFecha struct {
	RecurrenteID  string          `json:"recurrente_id"`
	Fecha         string          `json:"fecha"`
	MontoCentavos json.RawMessage `json:"monto_centavos"`
	Omitida       bool            `json:"omitida"`
}

// SolicitudDeDecisiones es el cuerpo de `POST /api/v1/repeticiones/decisiones`: solo las filas marcadas y las «No pasó»;
// lo desmarcado no se manda y sigue pendiente (D-093).
type SolicitudDeDecisiones struct {
	Decisiones []DecisionDeUnaFecha `json:"decisiones"`
}

// FechaOmitida es una fecha que quedó como «No pasó».
type FechaOmitida struct {
	RecurrenteID string `json:"recurrente_id"`
	Fecha        string `json:"fecha"`
}

// ResumenDeDecisiones trae lo que el aviso «Listo, guardamos 12 movimientos y dejamos de contar 1 fecha.» necesita.
type ResumenDeDecisiones struct {
	Guardados        int      `json:"guardados"`
	Omitidas         int      `json:"omitidas"`
	IngresosCentavos *big.Int `json:"ingresos_centavos"`
	GastosCentavos   *big.Int `json:"gastos_centavos"`
}

// ResultadoDeDecisiones es la respuesta de `POST /api/v1/repeticiones/decisiones`.
type ResultadoDeDecisiones struct {
	Movimientos      []Movimiento        `json:"movimientos"`
	Omitidas         []FechaOmitida      `json:"omitidas"`
	SiguenPendientes int                 `json:"siguen_pendientes"` // las que ya llegaron y no entraron
	Resumen          ResumenDeDecisiones `json:"resumen"`
}

// decisionLeida es una decisión ya validada en su forma.
type decisionLeida struct {
	recurrente string
	fecha      time.Time
	monto      *int64
	omitida    bool
}

// PorConfirmar entrega las fechas pendientes que ya llegaron de las repeticiones de la persona (E12
// `PendientesDeConfirmar`, E15 5.2 `FechasPendientes`): sin las confirmadas, sin las omitidas, sin las anteriores a la
// creación de la repetición y sin las de `detenido_en` en adelante. «Hoy» es el de Colombia.
func (s *Servicio) PorConfirmar(ctx context.Context, persona string) (ListaPorConfirmar, error) {
	recurrentes, err := s.repo.Recurrentes(ctx, persona)
	if err != nil {
		return ListaPorConfirmar{}, err
	}
	pendientes, err := pendientesDe(recurrentes, fechas.HoyEnColombia(s.reloj.Ahora()))
	if err != nil {
		return ListaPorConfirmar{}, err
	}
	porID := indexar(recurrentes)
	lista := ListaPorConfirmar{Pendientes: make([]PorConfirmar, 0, len(pendientes))}
	for _, p := range pendientes {
		r := porID[p.Recurrente]
		lista.Pendientes = append(lista.Pendientes, PorConfirmar{RecurrenteID: r.ID, Fecha: p.Fecha.Format(formatoDeFecha), Tipo: r.Tipo,
			CategoriaID: r.CategoriaID, Medio: r.Medio, MontoHabitualCentavos: r.Monto, Periodicidad: string(r.Periodicidad)})
		if p.EsIngreso {
			lista.Resumen.Ingresos++
		} else {
			lista.Resumen.Gastos++
		}
	}
	lista.Resumen.Total = len(pendientes)
	return lista, nil
}

// ConfirmarOcurrencia confirma una fecha pendiente de una repetición de la persona (CU-06): crea el movimiento con la
// fecha programada, no con la de hoy (D-094), y con el monto habitual o el que la persona escribió (solo para esa
// fecha). ErrNoEncontrado si la repetición no es suya o no existe; ErrFechaNoPendiente; ErrValidacion.
func (s *Servicio) ConfirmarOcurrencia(ctx context.Context, persona, id string, sol SolicitudDeConfirmacion) (Movimiento, error) {
	campos := map[string]string{}
	d := leerDecision(DecisionDeUnaFecha{RecurrenteID: id, Fecha: sol.Fecha, MontoCentavos: sol.MontoCentavos}, "", campos, false)
	if len(campos) > 0 {
		return Movimiento{}, &ErrValidacion{Campos: campos}
	}
	r, err := s.decidir(ctx, persona, []decisionLeida{d})
	if err != nil {
		return Movimiento{}, err
	}
	return r.Movimientos[0], nil
}

// OmitirOcurrencia marca «No pasó» una fecha pendiente (D-092, CU-06): guarda la fecha omitida, no crea ningún movimiento
// y la fecha deja de contarse. Los mismos errores que ConfirmarOcurrencia.
func (s *Servicio) OmitirOcurrencia(ctx context.Context, persona, id string, sol SolicitudDeOmision) error {
	campos := map[string]string{}
	d := leerDecision(DecisionDeUnaFecha{RecurrenteID: id, Fecha: sol.Fecha, Omitida: true}, "", campos, false)
	if len(campos) > 0 {
		return &ErrValidacion{Campos: campos}
	}
	_, err := s.decidir(ctx, persona, []decisionLeida{d})
	return err
}

// ConfirmarVarias aplica las decisiones de «Confirmar todos» en una sola operación (E12, E15 5.2, D-093): se guarda todo
// o no se guarda nada. ErrValidacion con los campos inválidos de todas las decisiones, a la vez, con la clave
// `decisiones[i].<campo>`; ErrNoEncontrado si alguna repetición no es de la persona; ErrFechaNoPendiente si una fecha no
// está pendiente o aparece dos veces.
func (s *Servicio) ConfirmarVarias(ctx context.Context, persona string, sol SolicitudDeDecisiones) (ResultadoDeDecisiones, error) {
	switch n := len(sol.Decisiones); {
	case n == 0:
		return ResultadoDeDecisiones{}, &ErrValidacion{Campos: map[string]string{"decisiones": DecisionesRequeridas}}
	case n > DecisionesMaximas:
		return ResultadoDeDecisiones{}, &ErrValidacion{Campos: map[string]string{"decisiones": DemasiadasDecisiones}}
	}
	campos := map[string]string{}
	leidas := make([]decisionLeida, len(sol.Decisiones))
	for i, d := range sol.Decisiones {
		leidas[i] = leerDecision(d, fmt.Sprintf("decisiones[%d].", i), campos, true)
	}
	if len(campos) > 0 {
		return ResultadoDeDecisiones{}, &ErrValidacion{Campos: campos}
	}
	return s.decidir(ctx, persona, leidas)
}

// decidir es lo común de confirmar, omitir y confirmar varias: lee las repeticiones de la persona, aplica E15 5.2 y
// guarda todo en una transacción del repositorio.
func (s *Servicio) decidir(ctx context.Context, persona string, decisiones []decisionLeida) (ResultadoDeDecisiones, error) {
	ahora := s.reloj.Ahora()
	hoy := fechas.HoyEnColombia(ahora)
	recurrentes, err := s.repo.Recurrentes(ctx, persona)
	if err != nil {
		return ResultadoDeDecisiones{}, err
	}
	porID := indexar(recurrentes)
	for _, d := range decisiones {
		if _, es := porID[d.recurrente]; !es { // ajena o inexistente: el mismo 404
			return ResultadoDeDecisiones{}, ErrNoEncontrado
		}
	}
	pendientes, err := pendientesDe(recurrentes, hoy)
	if err != nil {
		return ResultadoDeDecisiones{}, err
	}
	deE15 := make([]fechas.DecisionDeFecha, len(decisiones))
	for i, d := range decisiones {
		deE15[i] = fechas.DecisionDeFecha{Recurrente: d.recurrente, Fecha: d.fecha, Monto: d.monto, Omitida: d.omitida}
	}
	bloque, err := fechas.ConfirmarVarias(pendientes, deE15)
	if err != nil {
		return ResultadoDeDecisiones{}, err
	}
	confirmar := make([]Confirmacion, len(bloque.Confirmadas))
	for i, p := range bloque.Confirmadas {
		r := porID[p.Recurrente]
		confirmar[i] = Confirmacion{RecurrenteID: r.ID, Fecha: fechas.FechaDelMovimiento(p, hoy), Tipo: r.Tipo, Monto: p.Monto, CategoriaID: r.CategoriaID, Medio: r.Medio}
	}
	omitir := make([]Omision, len(bloque.Omitidas))
	for i, p := range bloque.Omitidas {
		omitir[i] = Omision{RecurrenteID: p.Recurrente, Fecha: p.Fecha}
	}
	ids, err := s.repo.Decidir(ctx, persona, confirmar, omitir, ahora)
	if err != nil {
		return ResultadoDeDecisiones{}, err
	}
	if len(ids) != len(confirmar) {
		return ResultadoDeDecisiones{}, errors.New("el repositorio no devolvió un id por movimiento")
	}
	res := ResultadoDeDecisiones{Movimientos: make([]Movimiento, len(confirmar)), Omitidas: make([]FechaOmitida, len(omitir)), SiguenPendientes: len(bloque.Pendientes),
		Resumen: ResumenDeDecisiones{Guardados: len(confirmar), Omitidas: len(omitir), IngresosCentavos: bloque.Ingresos, GastosCentavos: bloque.Gastos}}
	for i, c := range confirmar {
		categoria := c.CategoriaID
		res.Movimientos[i] = Movimiento{ID: ids[i], Tipo: c.Tipo, MontoCentavos: c.Monto, Fecha: c.Fecha.Format(formatoDeFecha), CategoriaID: &categoria, Medio: c.Medio,
			Recurrente: &DeRecurrente{RecurrenteID: c.RecurrenteID, FechaProgramada: c.Fecha.Format(formatoDeFecha), Periodicidad: string(porID[c.RecurrenteID].Periodicidad),
				VuelveAPendiente: fechas.VuelveAPendiente(c.Fecha, porID[c.RecurrenteID].CreadoEl)}}
	}
	for i, o := range omitir {
		res.Omitidas[i] = FechaOmitida{RecurrenteID: o.RecurrenteID, Fecha: o.Fecha.Format(formatoDeFecha)}
	}
	return res, nil
}

func indexar(recurrentes []Recurrente) map[string]Recurrente {
	porID := make(map[string]Recurrente, len(recurrentes))
	for _, r := range recurrentes {
		porID[r.ID] = r
	}
	return porID
}

// pendientesDe son las fechas que ya llegaron (f ≤ hoy) y siguen pendientes de todas las repeticiones, de la más antigua a
// la más reciente y, con la misma fecha, primero el ingreso (E14 4.8).
func pendientesDe(recurrentes []Recurrente, hoy time.Time) ([]fechas.FechaPorConfirmar, error) {
	var pendientes []fechas.FechaPorConfirmar
	for _, r := range recurrentes {
		llegadas, err := fechas.PorConfirmar(r.Periodicidad, r.Inicio, r.Confirmadas, r.Omitidas, r.CreadoEl, hoy, r.DetenidoEn)
		if err != nil {
			return nil, fmt.Errorf("fechas pendientes de la repetición %s: %w", r.ID, err)
		}
		for _, f := range llegadas {
			pendientes = append(pendientes, fechas.FechaPorConfirmar{Recurrente: r.ID, Fecha: f, Monto: r.Monto, EsIngreso: r.Tipo == Ingreso})
		}
	}
	slices.SortFunc(pendientes, func(a, b fechas.FechaPorConfirmar) int {
		if c := a.Fecha.Compare(b.Fecha); c != 0 {
			return c
		}
		if a.EsIngreso != b.EsIngreso {
			if a.EsIngreso {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Recurrente, b.Recurrente)
	})
	return pendientes, nil
}

// leerDecision valida la forma de una decisión (repetición, fecha, monto) y anota en `campos`, con `prefijo`, lo que
// falle. `conRepeticion` es false cuando la repetición viene de la ruta, donde un id mal formado es un 404 (lo resuelve
// decidir) y no un campo.
func leerDecision(d DecisionDeUnaFecha, prefijo string, campos map[string]string, conRepeticion bool) decisionLeida {
	leida := decisionLeida{recurrente: strings.ToLower(d.RecurrenteID), omitida: d.Omitida}
	if conRepeticion {
		switch {
		case d.RecurrenteID == "":
			campos[prefijo+"recurrente_id"] = RecurrenteRequerido
		case !idDeMovimiento.MatchString(d.RecurrenteID):
			campos[prefijo+"recurrente_id"] = RecurrenteInvalido
		}
	}
	if fecha, codigo := leerFecha(d.Fecha); codigo != "" {
		campos[prefijo+"fecha"] = codigo
	} else {
		leida.fecha = fecha
	}
	if texto := strings.TrimSpace(string(d.MontoCentavos)); texto != "" && texto != "null" {
		if monto, codigo := leerMonto(d.MontoCentavos); codigo != "" {
			campos[prefijo+"monto_centavos"] = codigo
		} else if d.Omitida {
			campos[prefijo+"monto_centavos"] = MontoInvalido // «No pasó» no lleva monto
		} else {
			leida.monto = &monto
		}
	}
	return leida
}
