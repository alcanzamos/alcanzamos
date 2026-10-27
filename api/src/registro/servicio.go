// Package registro tiene los casos de uso del registro (US-51 y US-52, E12 `RegistroServicio`): las categorías que una
// persona ve, guardar un gasto o un ingreso en efectivo o por transferencia, con o sin repetición (RF-002, RF-003,
// RF-006, D-164), y consultar, corregir y borrar sus movimientos (RF-039, RF-040, D-168). El API no manda
// textos de interfaz: entrega ids, claves del catálogo y códigos de error, y cada app pone el texto de E14.
package registro

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
)

// Tipos y medios de pago que acepta el formulario. «Tarjeta» no está: llega con las tarjetas en I07 (D-164 (1)).
const (
	Gasto         = "gasto"
	Ingreso       = "ingreso"
	Efectivo      = "efectivo"
	Transferencia = "transferencia"

	// LargoMaximoDeLaDescripcion es el de `ck_movimiento_descripcion` (E13), en caracteres.
	LargoMaximoDeLaDescripcion = 280
	// ProximasQueSeMuestran son las fechas de «Próximas fechas» de PN-03.
	ProximasQueSeMuestran = 3

	formatoDeFecha = "2006-01-02"
	// anioMinimo evita fechas absurdas que el cálculo de fechas no maneja (la resta de días de `time` satura).
	anioMinimo = 1900
	// idMaximoDeCategoria es el tope de `smallint`.
	idMaximoDeCategoria = 1<<15 - 1
)

// Códigos de error de campo (422 `datos_invalidos`). Cada app los asocia con su texto de E14-PPN 3.1 y E14-PRR PN-03.
const (
	TipoRequerido           = "tipo_requerido"
	TipoInvalido            = "tipo_invalido"
	MontoRequerido          = "monto_requerido"
	MontoInvalido           = "monto_invalido" // no es un entero de centavos que quepa en int64
	MontoNoPositivo         = "monto_no_positivo"
	FechaRequerida          = "fecha_requerida"
	FechaInvalida           = "fecha_invalida"
	CategoriaRequerida      = "categoria_requerida"
	CategoriaInvalida       = "categoria_invalida" // no existe, es del otro tipo o la persona no la ve (menor u oculta)
	MedioRequerido          = "medio_requerido"
	MedioInvalido           = "medio_invalido"
	DescripcionLarga        = "descripcion_larga"
	PeriodicidadRequerida   = "periodicidad_requerida"
	PeriodicidadDesconocida = "periodicidad_invalida"
)

// ErrCategoriaInvalida lo devuelve el repositorio cuando la categoría no existe, no es del tipo del movimiento o la
// persona no la ve (la misma regla del catálogo: no apta para un menor, u oculta por ella).
var ErrCategoriaInvalida = errors.New("categoría inexistente, de otro tipo o que la persona no ve")

// ErrValidacion reúne todos los campos inválidos de una solicitud, para mostrarlos a la vez (E14-PPN 3.1).
type ErrValidacion struct{ Campos map[string]string }

func (e *ErrValidacion) Error() string { return "datos inválidos" }

// Categoria es una categoría del catálogo de E09. `Nombre` es la clave del catálogo (ClaveDeCategoria = nombre y
// tipo), no el texto de la pantalla: las apps eligen el texto por `ID`, que no cambia entre ambientes.
type Categoria struct {
	ID      int    `json:"id"`
	Nombre  string `json:"nombre"`
	General bool   `json:"general"` // «Otros gastos» y «Otros ingresos»: nunca se ocultan (RN-011)
	Tipo    string `json:"-"`
}

// Catalogo son las categorías visibles de la persona, por tipo.
type Catalogo struct {
	Gasto   []Categoria `json:"gasto"`
	Ingreso []Categoria `json:"ingreso"`
}

// Solicitud es el cuerpo de `POST /api/v1/movimientos`.
type Solicitud struct {
	Tipo string `json:"tipo"`
	// MontoCentavos se lee crudo: un decimal, un texto o un número fuera de int64 son un 422 del campo, no un 400.
	MontoCentavos json.RawMessage `json:"monto_centavos"`
	Fecha         string          `json:"fecha"`
	CategoriaID   *int            `json:"categoria_id"`
	Medio         string          `json:"medio"`
	Descripcion   *string         `json:"descripcion"`
	Repeticion    *struct {
		Periodicidad string `json:"periodicidad"`
	} `json:"repeticion"`
}

// Guardado es lo que el repositorio guarda en una sola transacción.
type Guardado struct {
	Persona       string
	Tipo          string
	Monto         int64 // centavos
	Fecha         time.Time
	CategoriaID   int
	Medio         string
	Descripcion   *string
	Periodicidad  fechas.Periodicidad // vacía si no se repite; si no, se guarda el recurrente (inicio = Fecha)
	ConMovimiento bool                // guardar el movimiento de Fecha (con la repetición, enlazado como su fecha confirmada)
}

// Creados son los ids de lo guardado; vacío lo que no se creó.
type Creados struct{ MovimientoID, RecurrenteID string }

// Repositorio es la persistencia que el servicio necesita (la implementa src/pg).
type Repositorio interface {
	// Categorias devuelve las categorías que la persona puede usar y no ocultó, por tipo y id.
	Categorias(ctx context.Context, persona string) ([]Categoria, error)
	// Guardar inserta en una transacción lo que dice `g`, con `creado_en = ahora`. ErrCategoriaInvalida si la
	// categoría no existe, es de otro tipo o la persona no la ve (no apta para un menor, u oculta por ella).
	Guardar(ctx context.Context, g Guardado, ahora time.Time) (Creados, error)
	// Listar devuelve los movimientos de la persona del mes de `mes` (con el filtro de categoría si no es nulo) y los
	// datos de los filtros de PN-01: `Resumen`, `Meses`, `Categorias` y `Movimientos`, del más reciente al más antiguo.
	Listar(ctx context.Context, persona string, mes time.Time, categoria *int) (Listado, error)
	// Obtener devuelve un movimiento de la persona. ErrNoEncontrado si no existe o es de otra persona.
	Obtener(ctx context.Context, persona, id string) (Movimiento, error)
	// Corregir reemplaza los campos de un movimiento de la persona. ErrNoEncontrado, o ErrCategoriaInvalida si la
	// categoría no existe, es del otro tipo o la persona no la ve (la que el movimiento ya tiene sí vale, aunque la oculte).
	Corregir(ctx context.Context, persona, id string, c Correccion) error
	// Borrar quita un movimiento de la persona, sin tocar su repetición. ErrNoEncontrado si no existe o es de otra persona.
	Borrar(ctx context.Context, persona, id string) error
}

// Resultado es la respuesta 201. Las fechas van como AAAA-MM-DD.
type Resultado struct {
	MovimientoID *string  `json:"movimiento_id"` // null si solo se guardó la repetición (repetición con fecha futura)
	RecurrenteID *string  `json:"recurrente_id"` // null si no se repite
	Proximas     []string `json:"proximas"`      // hasta tres fechas programadas después de hoy
	Pendientes   []string `json:"pendientes"`    // fechas por confirmar que ya llegaron (E15 5.2)
}

// Servicio son los casos de uso del formulario de registro.
type Servicio struct {
	repo  Repositorio
	reloj reloj.Reloj
}

// NuevoServicio arma el servicio.
func NuevoServicio(repo Repositorio, r reloj.Reloj) *Servicio { return &Servicio{repo: repo, reloj: r} }

// Categorias devuelve las categorías visibles de la persona, por tipo.
func (s *Servicio) Categorias(ctx context.Context, persona string) (Catalogo, error) {
	lista, err := s.repo.Categorias(ctx, persona)
	if err != nil {
		return Catalogo{}, err
	}
	catalogo := Catalogo{Gasto: []Categoria{}, Ingreso: []Categoria{}}
	for _, c := range lista {
		if c.Tipo == Gasto {
			catalogo.Gasto = append(catalogo.Gasto, c)
		} else {
			catalogo.Ingreso = append(catalogo.Ingreso, c)
		}
	}
	return catalogo, nil
}

// Registrar guarda lo que la persona escribió en el formulario (CU-02, CU-06). Sin repetición guarda un movimiento. Con
// repetición (D-164), de una fecha de hoy o pasada guarda la repetición y el movimiento de esa fecha, enlazado como
// su fecha confirmada; de una fecha futura guarda solo la repetición y esa fecha queda pendiente (D-091). Las fechas
// intermedias son historia (E15 5.2): no quedan pendientes. Sin repetición, el movimiento se guarda con su fecha aunque sea
// futura (RF-057). «Hoy» es el de Colombia.
func (s *Servicio) Registrar(ctx context.Context, persona string, sol Solicitud) (Resultado, error) {
	ahora := s.reloj.Ahora()
	hoy := fechas.HoyEnColombia(ahora)
	g, err := validar(sol, hoy)
	if err != nil {
		return Resultado{}, err
	}
	g.Persona = persona
	creados, err := s.repo.Guardar(ctx, g, ahora)
	if errors.Is(err, ErrCategoriaInvalida) {
		return Resultado{}, &ErrValidacion{Campos: map[string]string{"categoria_id": CategoriaInvalida}}
	}
	if err != nil {
		return Resultado{}, err
	}
	res := Resultado{Proximas: []string{}, Pendientes: []string{}}
	if creados.MovimientoID != "" {
		res.MovimientoID = &creados.MovimientoID
	}
	if g.Periodicidad == "" {
		return res, nil
	}
	res.RecurrenteID = &creados.RecurrenteID
	var confirmadas []time.Time
	if g.ConMovimiento {
		confirmadas = []time.Time{g.Fecha}
	}
	pendientes, err := fechas.PorConfirmar(g.Periodicidad, g.Fecha, confirmadas, nil, hoy, hoy, nil)
	if err != nil {
		return Resultado{}, err
	}
	proximas, err := fechas.Proximas(g.Periodicidad, g.Fecha, hoy, ProximasQueSeMuestran)
	if err != nil {
		return Resultado{}, err
	}
	res.Pendientes, res.Proximas = enTexto(pendientes), enTexto(proximas)
	return res, nil
}

// Proximas son las fechas de «Próximas fechas» de PN-03 antes de guardar (D-165): hasta tres, después de hoy en
// Colombia, de una repetición con esa periodicidad que empieza en `inicio`. No toca la base. ErrValidacion con los
// campos `periodicidad` e `inicio` que fallen, a la vez.
func (s *Servicio) Proximas(periodicidad, inicio string) ([]string, error) {
	campos := map[string]string{}
	p, codigo := leerPeriodicidad(periodicidad)
	if codigo != "" {
		campos["periodicidad"] = codigo
	}
	desde, codigo := leerFecha(inicio)
	if codigo != "" {
		campos["inicio"] = codigo
	}
	if len(campos) > 0 {
		return nil, &ErrValidacion{Campos: campos}
	}
	proximas, err := fechas.Proximas(p, desde, fechas.HoyEnColombia(s.reloj.Ahora()), ProximasQueSeMuestran)
	if err != nil {
		return nil, err
	}
	return enTexto(proximas), nil
}

func enTexto(lista []time.Time) []string {
	textos := make([]string, len(lista))
	for i, f := range lista {
		textos[i] = f.Format(formatoDeFecha)
	}
	return textos
}

// validar revisa todos los campos y devuelve ErrValidacion con todos los que fallan.
func validar(sol Solicitud, hoy time.Time) (Guardado, error) {
	campos := map[string]string{}
	g := Guardado{Tipo: sol.Tipo, Medio: sol.Medio}

	switch sol.Tipo {
	case Gasto, Ingreso:
	case "":
		campos["tipo"] = TipoRequerido
	default:
		campos["tipo"] = TipoInvalido
	}

	if monto, codigo := leerMonto(sol.MontoCentavos); codigo != "" {
		campos["monto_centavos"] = codigo
	} else {
		g.Monto = monto
	}

	switch sol.Medio {
	case Efectivo, Transferencia:
	case "":
		campos["medio"] = MedioRequerido
	default: // «tarjeta» también: no se ofrece en esta versión
		campos["medio"] = MedioInvalido
	}

	if sol.CategoriaID == nil {
		campos["categoria_id"] = CategoriaRequerida
	} else if *sol.CategoriaID < 1 || *sol.CategoriaID > idMaximoDeCategoria {
		campos["categoria_id"] = CategoriaInvalida
	} else {
		g.CategoriaID = *sol.CategoriaID
	}

	if sol.Descripcion != nil {
		if d := strings.TrimSpace(*sol.Descripcion); utf8.RuneCountInString(d) > LargoMaximoDeLaDescripcion {
			campos["descripcion"] = DescripcionLarga
		} else if d != "" {
			g.Descripcion = &d
		}
	}

	if sol.Repeticion != nil {
		if p, codigo := leerPeriodicidad(sol.Repeticion.Periodicidad); codigo != "" {
			campos["repeticion"] = codigo
		} else {
			g.Periodicidad = p
		}
	}

	if fecha, codigo := leerFecha(sol.Fecha); codigo != "" {
		campos["fecha"] = codigo
	} else {
		g.Fecha = fecha
		// Sin repetición, el movimiento se guarda con su fecha, también si todavía no llegó (RF-057: «Regalos de Navidad»
		// del 20 de diciembre en E14-PPN 9). Con repetición y una fecha futura solo se guarda la repetición: esa fecha
		// queda pendiente hasta que la persona la confirme (D-091, que es solo de los recurrentes).
		g.ConMovimiento = sol.Repeticion == nil || !fecha.After(hoy)
	}

	if len(campos) > 0 {
		return Guardado{}, &ErrValidacion{Campos: campos}
	}
	return g, nil
}

// leerPeriodicidad valida la periodicidad de una repetición; la comparten el POST y las próximas fechas.
func leerPeriodicidad(texto string) (fechas.Periodicidad, string) {
	switch p := fechas.Periodicidad(texto); {
	case p == "":
		return "", PeriodicidadRequerida
	case !p.Valida():
		return "", PeriodicidadDesconocida
	default:
		return p, ""
	}
}

// leerFecha valida una fecha AAAA-MM-DD, con el año mínimo; la comparten el POST y las próximas fechas.
func leerFecha(texto string) (time.Time, string) {
	fecha, err := time.Parse(formatoDeFecha, texto)
	switch {
	case texto == "":
		return time.Time{}, FechaRequerida
	case err != nil || fecha.Year() < anioMinimo:
		return time.Time{}, FechaInvalida
	}
	return fecha, ""
}

// leerMonto lee los centavos del JSON sin pasar por punto flotante (D-082): solo un entero positivo que quepa en int64.
func leerMonto(crudo json.RawMessage) (int64, string) {
	texto := strings.TrimSpace(string(crudo))
	if texto == "" || texto == "null" {
		return 0, MontoRequerido
	}
	monto, err := strconv.ParseInt(texto, 10, 64)
	switch {
	case err != nil:
		return 0, MontoInvalido
	case monto <= 0:
		return 0, MontoNoPositivo
	}
	return monto, ""
}
