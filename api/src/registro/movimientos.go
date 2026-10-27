package registro

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strconv"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
)

// Aporte es el tipo de un movimiento ligado a una meta en vez de a una categoría (RN-013); con `sentido` `salida` es un
// retiro. Se lista y se ve en el detalle; corregirlo y borrarlo es de las metas (D-170), y crearlo también.
const Aporte = "aporte"

const formatoDePeriodo = "2006-01"

// Códigos de error de campo de la lista y de la corrección (422 `datos_invalidos`).
const (
	PeriodoInvalido = "periodo_invalido"
	FechaNoEditable = "fecha_no_editable" // la fecha de un recurrente no se cambia (D-168)
	TipoNoEditable  = "tipo_no_editable"  // la fecha de un recurrente conserva su tipo
)

// ErrNoEncontrado lo devuelve el repositorio cuando el movimiento no existe o no es de la persona: el API no distingue
// los dos casos, para no revelar que existe.
var ErrNoEncontrado = errors.New("movimiento inexistente o de otra persona")

// ErrNoEditable lo devuelve el servicio al corregir o borrar un aporte o un retiro de una meta (D-170): el API los
// rechaza hasta la historia de metas, que resuelve la contradicción entre E14-PMH (D-084, punto 5) y E14-PRR PN-02.
var ErrNoEditable = errors.New("un aporte o un retiro de una meta no se corrige ni se borra todavía")

// esDeMeta dice si el movimiento es un aporte o un retiro de una meta.
func esDeMeta(m Movimiento) bool { return m.Tipo == Aporte || m.Meta != nil }

var idDeMovimiento = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Movimiento es un movimiento de la persona tal como lo muestran PN-01 y PN-02. Las fechas van como AAAA-MM-DD.
type Movimiento struct {
	ID            string        `json:"id"`
	Tipo          string        `json:"tipo"`
	MontoCentavos int64         `json:"monto_centavos"`
	Fecha         string        `json:"fecha"`
	CategoriaID   *int          `json:"categoria_id"` // null en un aporte
	Medio         string        `json:"medio"`
	Descripcion   *string       `json:"descripcion"`
	Compartido    bool          `json:"compartido"` // `hogar_id` no nulo: la marca «Compartido con el hogar» (NM-05, SEG-002)
	Meta          *MetaDeAporte `json:"meta"`       // solo en un aporte
	Sentido       *string       `json:"sentido"`    // `entrada` o `salida` (un retiro), solo en un aporte
	Recurrente    *DeRecurrente `json:"recurrente"` // solo si es una fecha confirmada de una repetición
}

// MetaDeAporte es la meta a la que va un aporte: la fila de PN-01 muestra su nombre en lugar de la categoría.
type MetaDeAporte struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
}

// DeRecurrente dice de qué repetición viene un movimiento y a cuál de sus fechas corresponde.
type DeRecurrente struct {
	RecurrenteID    string `json:"recurrente_id"`
	FechaProgramada string `json:"fecha_programada"`
	Periodicidad    string `json:"periodicidad"`
	// VuelveAPendiente: al borrar el movimiento, su fecha vuelve a «Por confirmar» (D-169, E15 5.2). La hoja de borrar
	// de PN-02 muestra «Esta fecha volverá a quedar por confirmar.» solo si es true.
	VuelveAPendiente bool `json:"vuelve_a_pendiente"`
}

// CategoriaDelPeriodo es una categoría con movimientos en el periodo, para los chips y «Ver todas» de PN-01. Incluye las
// ocultas: un movimiento conserva su categoría aunque se oculte (RN-011).
type CategoriaDelPeriodo struct {
	CategoriaID int  `json:"categoria_id"`
	Movimientos int  `json:"movimientos"`
	Oculta      bool `json:"oculta"`
}

// Resumen es la línea 5 de PN-01. `TotalCentavos` es la suma exacta de la lista y solo se entrega con una categoría
// elegida (sin ella mezclaría gastos, ingresos y aportes).
type Resumen struct {
	Movimientos   int      `json:"movimientos"`
	TotalCentavos *big.Int `json:"total_centavos"`
}

// Listado es la respuesta de `GET /api/v1/movimientos`.
type Listado struct {
	PeriodoActual string                `json:"periodo_actual"` // el mes de hoy en Colombia, AAAA-MM
	Periodo       string                `json:"periodo"`
	CategoriaID   *int                  `json:"categoria_id"`
	Resumen       Resumen               `json:"resumen"`
	Meses         []string              `json:"meses"`      // los que tienen movimientos, del más reciente al más antiguo («Otro mes»)
	Categorias    []CategoriaDelPeriodo `json:"categorias"` // de más a menos movimientos del periodo, sin importar el filtro
	Movimientos   []Movimiento          `json:"movimientos"`
}

// SolicitudDeCorreccion es el cuerpo de `PUT /api/v1/movimientos/{id}`: los campos de «Corregir» (E14-PRR PN-02).
type SolicitudDeCorreccion struct {
	Tipo          string          `json:"tipo"`
	MontoCentavos json.RawMessage `json:"monto_centavos"`
	Fecha         *string         `json:"fecha"` // en una fecha de un recurrente se omite (D-168)
	CategoriaID   *int            `json:"categoria_id"`
	Medio         string          `json:"medio"`
	Descripcion   *string         `json:"descripcion"`
}

// Correccion es lo que el repositorio guarda. Un `Fecha` nulo deja la fecha como está.
type Correccion struct {
	Tipo        string
	Monto       int64 // centavos
	Fecha       *time.Time
	CategoriaID *int // nulo en un aporte
	Medio       string
	Descripcion *string
}

// Listar entrega los movimientos de la persona en `periodo` (AAAA-MM; vacío es el mes de hoy en Colombia), con el
// filtro de `categoria` si se da, del más reciente al más antiguo, y lo que los filtros de PN-01 necesitan. ErrValidacion
// con `periodo` y `categoria`.
func (s *Servicio) Listar(ctx context.Context, persona, periodo, categoria string) (Listado, error) {
	hoy := fechas.HoyEnColombia(s.reloj.Ahora())
	actual := hoy.Format(formatoDePeriodo)
	campos := map[string]string{}
	if periodo == "" {
		periodo = actual
	}
	mes, err := time.Parse(formatoDePeriodo, periodo)
	if err != nil || mes.Year() < anioMinimo {
		campos["periodo"] = PeriodoInvalido
	}
	var id *int
	if categoria != "" {
		if n, err := strconv.Atoi(categoria); err != nil || n < 1 || n > idMaximoDeCategoria {
			campos["categoria"] = CategoriaInvalida
		} else {
			id = &n
		}
	}
	if len(campos) > 0 {
		return Listado{}, &ErrValidacion{Campos: campos}
	}
	l, err := s.repo.Listar(ctx, persona, mes, id)
	if err != nil {
		return Listado{}, err
	}
	l.PeriodoActual, l.Periodo, l.CategoriaID = actual, periodo, id
	l.Meses, l.Categorias, l.Movimientos = noNulo(l.Meses), noNulo(l.Categorias), noNulo(l.Movimientos)
	l.Resumen.Movimientos = len(l.Movimientos)
	if id != nil {
		total := new(big.Int)
		for _, m := range l.Movimientos {
			total.Add(total, big.NewInt(m.MontoCentavos))
		}
		l.Resumen.TotalCentavos = total
	}
	return l, nil
}

// noNulo hace que una lista vacía sea `[]` y no `null` en el JSON.
func noNulo[T any](lista []T) []T {
	if lista == nil {
		return []T{}
	}
	return lista
}

// Obtener es el detalle de un movimiento de la persona (PN-02). ErrNoEncontrado si no existe o es de otra persona.
func (s *Servicio) Obtener(ctx context.Context, persona, id string) (Movimiento, error) {
	if !idDeMovimiento.MatchString(id) {
		return Movimiento{}, ErrNoEncontrado
	}
	return s.repo.Obtener(ctx, persona, id)
}

// Corregir reemplaza monto, fecha, categoría, medio y descripción de un movimiento de la persona, con las mismas
// validaciones que el POST (CU-08). **D-168:** en una fecha confirmada de una repetición la fecha no cambia y el cambio
// es solo de esa fila: la repetición no se toca. Un aporte o un retiro de una meta no se corrige: ErrNoEditable (D-170),
// después del 404 de lo ajeno. La descripción omitida se borra: es un reemplazo.
func (s *Servicio) Corregir(ctx context.Context, persona, id string, sol SolicitudDeCorreccion) (Movimiento, error) {
	actual, err := s.Obtener(ctx, persona, id)
	if err != nil {
		return Movimiento{}, err
	}
	if esDeMeta(actual) {
		return Movimiento{}, ErrNoEditable
	}
	g, campos, err := validarCorreccion(sol, actual)
	if err != nil {
		return Movimiento{}, err
	}
	if len(campos) > 0 {
		return Movimiento{}, &ErrValidacion{Campos: campos}
	}
	c := Correccion{Tipo: g.Tipo, Monto: g.Monto, Medio: g.Medio, Descripcion: g.Descripcion, CategoriaID: &g.CategoriaID}
	if actual.Recurrente == nil {
		c.Fecha = &g.Fecha
	}
	switch err := s.repo.Corregir(ctx, persona, id, c); {
	case errors.Is(err, ErrCategoriaInvalida):
		return Movimiento{}, &ErrValidacion{Campos: map[string]string{"categoria_id": CategoriaInvalida}}
	case err != nil:
		return Movimiento{}, err
	}
	return s.repo.Obtener(ctx, persona, id)
}

// Borrar quita un movimiento de la persona. Si era una fecha confirmada de una repetición, esa fecha vuelve a quedar
// pendiente (D-168, D-091): no se omite, no se crea ninguna `ocurrencia_omitida` y E15 5.2 la vuelve a calcular. La
// restricción única (recurrente, fecha programada) permite confirmarla otra vez. Un aporte o un retiro de una meta no se
// borra: ErrNoEditable (D-170), después del 404 de lo ajeno.
func (s *Servicio) Borrar(ctx context.Context, persona, id string) error {
	actual, err := s.Obtener(ctx, persona, id)
	if err != nil {
		return err
	}
	if esDeMeta(actual) {
		return ErrNoEditable
	}
	return s.repo.Borrar(ctx, persona, id)
}

// validarCorreccion aplica a la corrección las reglas del POST con `validar` y suma las propias de lo que se corrige.
// Una fecha omitida en un recurrente vale como la actual (D-168).
func validarCorreccion(sol SolicitudDeCorreccion, actual Movimiento) (Guardado, map[string]string, error) {
	fija := actual.Recurrente != nil
	prueba := Solicitud{Tipo: sol.Tipo, MontoCentavos: sol.MontoCentavos, CategoriaID: sol.CategoriaID, Medio: sol.Medio, Descripcion: sol.Descripcion}
	if sol.Fecha != nil {
		prueba.Fecha = *sol.Fecha
	} else if fija {
		prueba.Fecha = actual.Fecha
	}
	campos := map[string]string{}
	g, err := validar(prueba, time.Time{})
	if invalido := (*ErrValidacion)(nil); errors.As(err, &invalido) {
		campos = invalido.Campos
	} else if err != nil {
		return Guardado{}, nil, err
	}
	if sol.Tipo != "" && sol.Tipo != actual.Tipo && fija {
		campos["tipo"] = TipoNoEditable
	}
	if fija && sol.Fecha != nil && *sol.Fecha != actual.Fecha {
		campos["fecha"] = FechaNoEditable
	}
	return g, campos, nil
}
