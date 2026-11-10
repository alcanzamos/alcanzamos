// Package presupuesto tiene los casos de uso del presupuesto del periodo (US-77, E12 §5.4 `PresupuestoServicio`): PN-06,
// el presupuesto por categorías a partir del ingreso registrado (RF-007, RF-040); PN-07, el mismo con un ingreso bajo o
// nulo (RF-008); y PN-08, los ingresos del periodo de varias fuentes, con los esperados y por confirmar de la US-60
// (RF-009, RF-006). Como el registro, el API no manda textos: entrega ids, claves del catálogo, montos en centavos y
// códigos, y cada app pone el texto de E14-PPA. Las sumas son exactas, con enteros grandes (RNF-002).
package presupuesto

import (
	"context"
	"errors"
	"math/big"
	"slices"
	"strings"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
)

// Modos de la tarjeta de resumen: cuál de las dos pantallas muestra la app (D-094, P-3).
const (
	ModoNormal      = "normal"       // PN-06: hay ingreso registrado y lo asignado no lo supera
	ModoIngresoBajo = "ingreso_bajo" // PN-07: lo asignado supera el ingreso registrado
	ModoIngresoNulo = "ingreso_nulo" // PN-07: el ingreso registrado es cero
)

// Estados de una categoría con presupuesto (E14-PPA 4.1, «Estado de una categoría con presupuesto»).
const (
	EstadoQuedan    = "quedan"     // «Quedan $X por gastar.»
	EstadoUsadoTodo = "usado_todo" // «Ya usaste todo lo presupuestado.»
	EstadoSuperado  = "superado"   // «Gastado $X de $Y presupuestados.»
)

// Marcas de una fecha de ingreso en PN-08 (D-091, D-093).
const (
	MarcaRegistrado   = "registrado"    // un movimiento de ingreso del periodo
	MarcaEsperado     = "esperado"      // una fecha pendiente de una repetición que todavía no llega
	MarcaPorConfirmar = "por_confirmar" // una fecha pendiente que ya llegó (la de «Por confirmar» de la US-60)
)

// ErrSoloAdultos es el 403 `solo_personas_adultas`: solo una persona adulta presupuesta (E12 §6, RF-007). La base lo
// asegura también: `presupuesto.persona_id` apunta a `perfil_adulto`.
var ErrSoloAdultos = errors.New("solo una persona adulta presupuesta")

// CategoriaDelCatalogo es una categoría de E09 con lo que la persona hizo con ella. `Nombre` es la clave del catálogo.
type CategoriaDelCatalogo struct {
	ID     int
	Nombre string
	Tipo   string
	Oculta bool // la persona la ocultó (RN-011)
}

// Guardado es un presupuesto de la persona: el monto asignado a una categoría de gasto en un periodo.
type Guardado struct {
	ID          string
	CategoriaID int
	Periodo     time.Time // primer día del mes
	Monto       int64     // centavos
}

// IngresoRegistrado es un movimiento de ingreso del periodo.
type IngresoRegistrado struct {
	MovimientoID string
	CategoriaID  int
	Monto        int64 // centavos
	Fecha        time.Time
	Medio        string
	Descripcion  *string
}

// DatosDelPresupuesto es lo que el repositorio lee para PN-06 y PN-07, en una sola lectura consistente.
type DatosDelPresupuesto struct {
	Adulta       bool
	Categorias   []CategoriaDelCatalogo // todo el catálogo
	Presupuestos []Guardado             // los del periodo
	Gastado      map[int]*big.Int       // por categoría, la suma exacta de los gastos del periodo
	Ingresos     []IngresoRegistrado    // los del periodo
	Recurrentes  []registro.Recurrente  // todas las de la persona, para lo que llega después
}

// DatosDeIngresos es lo que el repositorio lee para PN-08, en una sola lectura consistente.
type DatosDeIngresos struct {
	Categorias  []CategoriaDelCatalogo
	Ingresos    []IngresoRegistrado // los del periodo, por fecha y en el orden en que se registraron
	Recurrentes []registro.Recurrente
	Meses       []string // AAAA-MM con ingresos registrados, del más reciente al más antiguo
}

// Repositorio es la persistencia que el servicio necesita (E12 `PresupuestoRepo`; la implementa src/pg). Toda lectura es
// de lo propio (`persona_id`) y devuelve registro.ErrSinCuenta si la persona ya no existe.
type Repositorio interface {
	// Presupuesto lee lo del periodo que empieza en `mes`.
	Presupuesto(ctx context.Context, persona string, mes time.Time) (DatosDelPresupuesto, error)
	// Ingresos lee los ingresos del periodo que empieza en `mes`.
	Ingresos(ctx context.Context, persona string, mes time.Time) (DatosDeIngresos, error)
	Escritura
}

// Servicio son los casos de uso del presupuesto.
type Servicio struct {
	repo  Repositorio
	reloj reloj.Reloj
}

// NuevoServicio arma el servicio.
func NuevoServicio(repo Repositorio, r reloj.Reloj) *Servicio { return &Servicio{repo: repo, reloj: r} }

// Vista es la respuesta de `GET /api/v1/presupuestos` (PN-06 y PN-07).
type Vista struct {
	PeriodoActual string             `json:"periodo_actual"` // el mes de hoy en Colombia, AAAA-MM
	Periodo       string             `json:"periodo"`
	Editable      bool               `json:"editable"` // el periodo es el mes en curso: se pone, corrige y quita (D-094)
	Resumen       Resumen            `json:"resumen"`
	LlegaDespues  []IngresoPendiente `json:"llega_despues"` // las fechas de ingreso pendientes del periodo, por fecha
	Categorias    []FilaDeCategoria  `json:"categorias"`
}

// Resumen es la tarjeta «Tu presupuesto este mes». `SinAsignarCentavos` solo viene en el modo normal y
// `AsignadoSuperaPorCentavos` solo con ingreso bajo: el API da los hechos y la app los dice sin signo menos (RNF-017).
type Resumen struct {
	Modo                      string   `json:"modo"`
	IngresoRegistradoCentavos *big.Int `json:"ingreso_registrado_centavos"`
	AsignadoCentavos          *big.Int `json:"asignado_centavos"`
	SinAsignarCentavos        *big.Int `json:"sin_asignar_centavos"`
	AsignadoSuperaPorCentavos *big.Int `json:"asignado_supera_por_centavos"`
	// LlegaDespuesCentavos es lo esperado y lo por confirmar del periodo: no cuenta en «Sin asignar» (D-094, P-1).
	LlegaDespuesCentavos *big.Int `json:"llega_despues_centavos"`
}

// IngresoPendiente es una fecha pendiente de una repetición de ingreso en el periodo (E15 5.2): esperada si todavía no
// llega y por confirmar si ya llegó. Se confirma o se omite con las rutas de la US-60, con `recurrente_id` y `fecha`.
type IngresoPendiente struct {
	RecurrenteID  string `json:"recurrente_id"`
	Fecha         string `json:"fecha"`
	CategoriaID   int    `json:"categoria_id"`
	MontoCentavos int64  `json:"monto_centavos"` // el habitual
	Marca         string `json:"marca"`
}

// FilaDeCategoria es una fila de «Por categoría». Sin presupuesto, `presupuesto`, `estado` y `quedan_centavos` son null.
type FilaDeCategoria struct {
	CategoriaID     int                  `json:"categoria_id"`
	Nombre          string               `json:"nombre"`
	Oculta          bool                 `json:"oculta"`
	Presupuesto     *PresupuestoDeLaFila `json:"presupuesto"`
	GastadoCentavos *big.Int             `json:"gastado_centavos"`
	Estado          *string              `json:"estado"`
	QuedanCentavos  *big.Int             `json:"quedan_centavos"` // solo en `quedan`
}

// PresupuestoDeLaFila es el presupuesto de una categoría; `id` es el de «Corregir» y «Quitar».
type PresupuestoDeLaFila struct {
	ID            string `json:"id"`
	MontoCentavos int64  `json:"monto_centavos"`
}

// Ver arma PN-06 o PN-07 del `periodo` (AAAA-MM; vacío es el mes de hoy en Colombia). ErrValidacion con `periodo`;
// ErrSoloAdultos con una persona menor.
func (s *Servicio) Ver(ctx context.Context, persona, periodo string) (Vista, error) {
	hoy := fechas.HoyEnColombia(s.reloj.Ahora())
	mes, codigo := registro.LeerPeriodo(periodo, hoy)
	if codigo != "" {
		return Vista{}, &registro.ErrValidacion{Campos: map[string]string{"periodo": codigo}}
	}
	d, err := s.repo.Presupuesto(ctx, persona, mes)
	if err != nil {
		return Vista{}, err
	}
	if !d.Adulta {
		return Vista{}, ErrSoloAdultos
	}
	llegaDespues, err := pendientesDelMes(d.Recurrentes, mes, hoy)
	if err != nil {
		return Vista{}, err
	}
	actual := hoy.Format(registro.FormatoDePeriodo)
	v := Vista{PeriodoActual: actual, Periodo: mes.Format(registro.FormatoDePeriodo), LlegaDespues: llegaDespues}
	v.Editable = v.Periodo == actual
	v.Resumen = resumir(d, llegaDespues)
	v.Categorias, err = filas(d)
	return v, err
}

// resumir hace las cuentas de la tarjeta de resumen. «Sin asignar» es el ingreso registrado menos lo asignado (RF-007);
// lo esperado y lo por confirmar van aparte (D-094, P-1). PN-07 se muestra cuando el ingreso registrado es cero o menor
// que lo asignado (D-094, P-3); con ingreso nulo no hay diferencia que mostrar (E14-PPA 4.2).
func resumir(d DatosDelPresupuesto, llegaDespues []IngresoPendiente) Resumen {
	ingreso, asignado, despues := new(big.Int), new(big.Int), new(big.Int)
	for _, i := range d.Ingresos {
		ingreso.Add(ingreso, big.NewInt(i.Monto))
	}
	for _, p := range d.Presupuestos {
		asignado.Add(asignado, big.NewInt(p.Monto))
	}
	for _, p := range llegaDespues {
		despues.Add(despues, big.NewInt(p.MontoCentavos))
	}
	r := Resumen{IngresoRegistradoCentavos: ingreso, AsignadoCentavos: asignado, LlegaDespuesCentavos: despues}
	switch {
	case ingreso.Sign() == 0:
		r.Modo = ModoIngresoNulo
	case asignado.Cmp(ingreso) > 0:
		r.Modo, r.AsignadoSuperaPorCentavos = ModoIngresoBajo, new(big.Int).Sub(asignado, ingreso)
	default:
		r.Modo, r.SinAsignarCentavos = ModoNormal, new(big.Int).Sub(ingreso, asignado)
	}
	return r
}

// filas arma «Por categoría»: las categorías con presupuesto en el periodo, también las ocultas (RN-011, CU-55 2c), y las
// demás categorías de gasto con gasto en el periodo que la persona no ocultó. Primero las que tienen presupuesto y después
// las demás; cada grupo de mayor a menor gasto y, si empatan, por nombre (E14-PPA 4.1, PN-06 fila 4; L6 (6) de la US-77).
// El nombre del catálogo se compara con la intercalación del español de Unicode (CLDR, `collate` de golang.org/x/text,
// la versión fijada en go.mod) y no con la de la base, que depende de cómo se creó: las tildes y las mayúsculas no
// alteran el orden de las letras, la «ñ» va entre la «n» y la «o» y, con las mismas letras, sin tilde va antes. Dos
// nombres iguales quedan por id, para que el orden sea siempre el mismo. Un aporte no tiene categoría y no aparece
// (RN-013).
func filas(d DatosDelPresupuesto) ([]FilaDeCategoria, error) {
	catalogo := make(map[int]CategoriaDelCatalogo, len(d.Categorias))
	for _, c := range d.Categorias {
		catalogo[c.ID] = c
	}
	porCategoria := map[int]*FilaDeCategoria{}
	nueva := func(id int) (*FilaDeCategoria, error) {
		c, existe := catalogo[id]
		if !existe || c.Tipo != registro.Gasto {
			return nil, errors.New("una categoría del periodo no es de gasto o no está en el catálogo")
		}
		gastado := new(big.Int)
		if g := d.Gastado[id]; g != nil {
			gastado.Set(g)
		}
		f := &FilaDeCategoria{CategoriaID: id, Nombre: c.Nombre, Oculta: c.Oculta, GastadoCentavos: gastado}
		porCategoria[id] = f
		return f, nil
	}
	for _, p := range d.Presupuestos {
		f, err := nueva(p.CategoriaID)
		if err != nil {
			return nil, err
		}
		f.Presupuesto = &PresupuestoDeLaFila{ID: p.ID, MontoCentavos: p.Monto}
		monto := big.NewInt(p.Monto)
		estado := EstadoUsadoTodo
		switch f.GastadoCentavos.Cmp(monto) {
		case -1:
			estado, f.QuedanCentavos = EstadoQuedan, new(big.Int).Sub(monto, f.GastadoCentavos)
		case 1:
			estado = EstadoSuperado
		}
		f.Estado = &estado
	}
	for id := range d.Gastado {
		if _, ya := porCategoria[id]; ya || catalogo[id].Oculta {
			continue
		}
		if _, err := nueva(id); err != nil {
			return nil, err
		}
	}
	lista := make([]FilaDeCategoria, 0, len(porCategoria))
	for _, f := range porCategoria {
		lista = append(lista, *f)
	}
	porNombre := collate.New(language.Spanish) // uno por llamada: un Collator no se comparte entre goroutines
	slices.SortFunc(lista, func(a, b FilaDeCategoria) int {
		if (a.Presupuesto == nil) != (b.Presupuesto == nil) {
			if a.Presupuesto != nil {
				return -1
			}
			return 1
		}
		if c := b.GastadoCentavos.Cmp(a.GastadoCentavos); c != 0 {
			return c
		}
		if c := porNombre.CompareString(a.Nombre, b.Nombre); c != 0 {
			return c
		}
		return a.CategoriaID - b.CategoriaID
	})
	return lista, nil
}

// pendientesDelMes son las fechas de ingreso de las repeticiones que siguen pendientes en el mes: las de E15 5.2
// (`fechas.Pendientes`, la misma regla de «Por confirmar» de la US-60, sin las confirmadas, las omitidas, las anteriores
// a la creación de la repetición ni las de `detenido_en` en adelante). Las que ya llegaron (f ≤ hoy) son por confirmar;
// las demás, esperadas. Por fecha y, con la misma fecha, por repetición.
func pendientesDelMes(recurrentes []registro.Recurrente, mes, hoy time.Time) ([]IngresoPendiente, error) {
	lista := []IngresoPendiente{}
	for _, r := range recurrentes {
		if r.Tipo != registro.Ingreso {
			continue
		}
		del, err := fechas.Pendientes(r.Periodicidad, r.Inicio, mes, r.Confirmadas, r.Omitidas, r.CreadoEl, r.DetenidoEn)
		if err != nil {
			return nil, err
		}
		for _, f := range del {
			marca := MarcaEsperado
			if !f.After(hoy) {
				marca = MarcaPorConfirmar
			}
			lista = append(lista, IngresoPendiente{RecurrenteID: r.ID, Fecha: f.Format(time.DateOnly), CategoriaID: r.CategoriaID, MontoCentavos: r.Monto, Marca: marca})
		}
	}
	slices.SortFunc(lista, func(a, b IngresoPendiente) int {
		if c := strings.Compare(a.Fecha, b.Fecha); c != 0 {
			return c
		}
		return strings.Compare(a.RecurrenteID, b.RecurrenteID)
	})
	return lista, nil
}
