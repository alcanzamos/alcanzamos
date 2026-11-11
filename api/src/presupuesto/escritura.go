package presupuesto

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// Códigos de error de campo propios del presupuesto (422 `datos_invalidos`); los demás son los del registro.
const PeriodoRequerido = "periodo_requerido"

// idMaximoDeCategoria es el tope de `smallint`.
const idMaximoDeCategoria = 1<<15 - 1

// ErrNoEncontrado es el 404 `no_encontrado`: el presupuesto no existe, es de otra persona o es uno compartido con el hogar
// (el mismo código, para no revelar que existe).
var ErrNoEncontrado = errors.New("presupuesto inexistente o de otra persona")

// ErrPeriodoNoEditable es el 409 `periodo_no_editable` de E12: solo se pone, corrige o quita el presupuesto del mes en
// curso, el de hoy en Colombia (D-094, SC-E21-13). Presupuestar otros meses es de E21.
var ErrPeriodoNoEditable = errors.New("solo se cambia el presupuesto del mes en curso")

// ErrPeriodoConIngresoOPresupuesto es el 409 `periodo_con_ingreso_o_presupuesto`: el periodo ya tiene ingreso registrado
// o algo asignado, así que no se deja en cero. «Dejar el presupuesto en cero» solo se ofrece con ingreso nulo y nada
// asignado (E14-PPA 4.2).
var ErrPeriodoConIngresoOPresupuesto = errors.New("el periodo tiene ingreso registrado o algo asignado")

var idDePresupuesto = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Escritura es la persistencia de poner, corregir y quitar. Todo es de lo propio: `persona_id` de la sesión y `hogar_id`
// nulo (el hogar llega en I08 y la tabla ya tiene su campo). Uno compartido con el hogar no se lee, ni se corrige, ni se
// quita, ni cuenta como presupuesto que ya tiene la categoría ni en lo asignado (L14 de la US-77).
type Escritura interface {
	// Poner guarda el presupuesto de la categoría en el periodo, o corrige el que ya tiene (E13: único por persona,
	// periodo y categoría), y dice si lo creó. registro.ErrCategoriaInvalida si la categoría no existe, no es de gasto o
	// la persona la ocultó (salvo que ya tenga presupuesto propio en el periodo, RN-011); ErrSoloAdultos con una persona
	// menor; registro.ErrSinCuenta si la persona ya no existe.
	Poner(ctx context.Context, persona string, categoria int, periodo time.Time, monto int64) (Guardado, bool, error)
	// Obtener lee un presupuesto propio de la persona. ErrNoEncontrado si no existe, es de otra persona o es compartido.
	Obtener(ctx context.Context, persona, id string) (Guardado, error)
	// Corregir cambia el monto del presupuesto propio de la persona si es del periodo dado. ErrNoEncontrado si no.
	Corregir(ctx context.Context, persona, id string, periodo time.Time, monto int64) error
	// Quitar borra el presupuesto propio de la persona si es del periodo dado, sin tocar ningún gasto. ErrNoEncontrado si
	// no.
	Quitar(ctx context.Context, persona, id string, periodo time.Time) error
	// DejarEnCero guarda la marca «en cero» de la persona en el periodo (`presupuesto_en_cero`) si el periodo sigue en
	// cero: la suma de sus ingresos registrados y la de lo asignado son cero (las mismas sumas de la lectura). Si ya la
	// tiene, no cambia nada. ErrPeriodoConIngresoOPresupuesto si no está en cero; ErrSoloAdultos con una persona menor;
	// registro.ErrSinCuenta si la persona ya no existe.
	DejarEnCero(ctx context.Context, persona string, periodo time.Time) error
}

// SolicitudDePresupuesto es el cuerpo de `POST /api/v1/presupuestos` («Poner presupuesto»). El periodo va explícito: un
// formulario abierto el último día del mes no guarda en el mes siguiente sin saberlo.
type SolicitudDePresupuesto struct {
	Periodo     string `json:"periodo"`
	CategoriaID *int   `json:"categoria_id"`
	// MontoCentavos se lee crudo, como en el registro: un decimal o un texto son un 422 del campo, no un 400.
	MontoCentavos json.RawMessage `json:"monto_centavos"`
}

// SolicitudEnCero es el cuerpo de `POST /api/v1/presupuestos/en-cero` («Dejar el presupuesto en cero»). El periodo va
// explícito, como al poner un presupuesto.
type SolicitudEnCero struct {
	Periodo string `json:"periodo"`
}

// SolicitudDeCorreccion es el cuerpo de `PUT /api/v1/presupuestos/{id}` («Corregir»): solo el monto.
type SolicitudDeCorreccion struct {
	MontoCentavos json.RawMessage `json:"monto_centavos"`
}

// Presupuesto es la respuesta de poner y corregir.
type Presupuesto struct {
	ID            string `json:"id"`
	CategoriaID   int    `json:"categoria_id"`
	Periodo       string `json:"periodo"` // AAAA-MM
	MontoCentavos int64  `json:"monto_centavos"`
}

func respuestaDe(g Guardado) Presupuesto {
	return Presupuesto{ID: g.ID, CategoriaID: g.CategoriaID, Periodo: g.Periodo.Format(registro.FormatoDePeriodo), MontoCentavos: g.Monto}
}

// mesEnCurso es el primer día del mes de hoy en Colombia (E12: la fecha de `Reloj` en Bogotá).
func (s *Servicio) mesEnCurso() time.Time {
	hoy := fechas.HoyEnColombia(s.reloj.Ahora())
	return fechas.Dia(hoy.Year(), hoy.Month(), 1)
}

// leerPeriodo lee el `periodo` obligatorio de un cuerpo (AAAA-MM): el primer día del mes, o el código de error del campo.
func leerPeriodo(texto string) (time.Time, string) {
	if texto == "" {
		return time.Time{}, PeriodoRequerido
	}
	return registro.LeerPeriodo(texto, time.Time{})
}

// Presupuestar pone el presupuesto de una categoría de gasto en el mes en curso (CU-09 3, E12 `Presupuestar`), o lo
// corrige si ya tiene uno (3a), y dice si lo creó. Primero la forma: ErrValidacion con todos los campos a la vez; después
// ErrPeriodoNoEditable si el periodo no es el mes en curso; después lo que rechace el repositorio.
func (s *Servicio) Presupuestar(ctx context.Context, persona string, sol SolicitudDePresupuesto) (Presupuesto, bool, error) {
	campos := map[string]string{}
	periodo, codigo := leerPeriodo(sol.Periodo)
	if codigo != "" {
		campos["periodo"] = codigo
	}
	switch {
	case sol.CategoriaID == nil:
		campos["categoria_id"] = registro.CategoriaRequerida
	case *sol.CategoriaID < 1 || *sol.CategoriaID > idMaximoDeCategoria:
		campos["categoria_id"] = registro.CategoriaInvalida
	}
	monto, codigo := registro.LeerMonto(sol.MontoCentavos)
	if codigo != "" {
		campos["monto_centavos"] = codigo
	}
	if len(campos) > 0 {
		return Presupuesto{}, false, &registro.ErrValidacion{Campos: campos}
	}
	if !periodo.Equal(s.mesEnCurso()) {
		return Presupuesto{}, false, ErrPeriodoNoEditable
	}
	g, creado, err := s.repo.Poner(ctx, persona, *sol.CategoriaID, periodo, monto)
	if errors.Is(err, registro.ErrCategoriaInvalida) {
		return Presupuesto{}, false, &registro.ErrValidacion{Campos: map[string]string{"categoria_id": registro.CategoriaInvalida}}
	}
	if err != nil {
		return Presupuesto{}, false, err
	}
	return respuestaDe(g), creado, nil
}

// Corregir cambia el monto de un presupuesto de la persona del mes en curso (CU-09 3a, E12 `Corregir`). ErrValidacion con
// el monto; ErrNoEncontrado si no es suyo; ErrPeriodoNoEditable si es de otro mes.
func (s *Servicio) Corregir(ctx context.Context, persona, id string, sol SolicitudDeCorreccion) (Presupuesto, error) {
	monto, codigo := registro.LeerMonto(sol.MontoCentavos)
	if codigo != "" {
		return Presupuesto{}, &registro.ErrValidacion{Campos: map[string]string{"monto_centavos": codigo}}
	}
	g, err := s.editable(ctx, persona, id)
	if err != nil {
		return Presupuesto{}, err
	}
	if err := s.repo.Corregir(ctx, persona, id, g.Periodo, monto); err != nil {
		return Presupuesto{}, err
	}
	g.Monto = monto
	return respuestaDe(g), nil
}

// Quitar borra un presupuesto de la persona del mes en curso (CU-09 3b, E12 `Quitar`); lo gastado no cambia.
// ErrNoEncontrado si no es suyo; ErrPeriodoNoEditable si es de otro mes.
func (s *Servicio) Quitar(ctx context.Context, persona, id string) error {
	g, err := s.editable(ctx, persona, id)
	if err != nil {
		return err
	}
	return s.repo.Quitar(ctx, persona, id, g.Periodo)
}

// editable lee el presupuesto de la persona y comprueba que es del mes en curso. El repositorio corrige y quita con ese
// mismo periodo en la condición: si el mes cambió o la fila desapareció entre tanto, no toca nada.
func (s *Servicio) editable(ctx context.Context, persona, id string) (Guardado, error) {
	if !idDePresupuesto.MatchString(id) {
		return Guardado{}, ErrNoEncontrado
	}
	g, err := s.repo.Obtener(ctx, persona, id)
	if err != nil {
		return Guardado{}, err
	}
	if !g.Periodo.Equal(s.mesEnCurso()) {
		return Guardado{}, ErrPeriodoNoEditable
	}
	return g, nil
}

// DejarEnCero guarda que la persona dejó el mes en curso con el presupuesto en cero («Dejar el presupuesto en cero», PN-07,
// E14-PPA 4.2, CU-10 2a; L6 (5) de la US-77). Es idempotente. Primero la forma (ErrValidacion con `periodo`), después
// ErrPeriodoNoEditable si no es el mes en curso, después lo que rechace el repositorio (ErrPeriodoConIngresoOPresupuesto,
// ErrSoloAdultos, registro.ErrSinCuenta). La marca queda aunque después llegue un ingreso o se asigne algo: la lectura la
// muestra (`en_cero`) solo mientras el mes siga en cero.
func (s *Servicio) DejarEnCero(ctx context.Context, persona string, sol SolicitudEnCero) error {
	periodo, codigo := leerPeriodo(sol.Periodo)
	if codigo != "" {
		return &registro.ErrValidacion{Campos: map[string]string{"periodo": codigo}}
	}
	if !periodo.Equal(s.mesEnCurso()) {
		return ErrPeriodoNoEditable
	}
	return s.repo.DejarEnCero(ctx, persona, periodo)
}
