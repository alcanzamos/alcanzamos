package registro

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/interpretacion"
)

// Resultados de interpretar un texto (`resultado` de la respuesta). Solo `propuesta` y `monto_ambiguo` traen un
// movimiento propuesto; con los demás el cliente muestra el texto que E14-PPN 3.1 da para cada estado.
const (
	ResultadoPropuesta     = "propuesta"      // tipo, monto, categoría y fecha para llenar el formulario
	ResultadoMontoAmbiguo  = "monto_ambiguo"  // como la propuesta, sin monto: «¿Quisiste decir $12.500 o $12,50?» (D-084 (8))
	ResultadoRecomendacion = "recomendacion"  // pedido de una recomendación financiera: no se da (RF-021, RE-001)
	ResultadoPregunta      = "pregunta"       // una pregunta, no un registro (RF-044)
	ResultadoNoEntendido   = "no_entendido"   // un registro sin monto: «No pudimos entender el texto.» (CU-03 2c)
	ResultadoTiempoAgotado = "tiempo_agotado" // pasó el límite de 200 ms (D-084 (2)): la persona sigue con el formulario (RF-002)
)

// Códigos de error del campo `texto` (422 `datos_invalidos`).
const (
	TextoRequerido = "texto_requerido"
	TextoLargo     = "texto_largo" // más de 280 caracteres (D-084 (2))
)

// ErrSinInterpretador lo devuelve InterpretarTexto si el servicio se armó sin interpretador (ConInterpretador).
var ErrSinInterpretador = errors.New("el servicio no tiene un interpretador")

// SolicitudDeInterpretacion es el cuerpo de `POST /api/v1/movimientos/interpretacion`.
type SolicitudDeInterpretacion struct {
	Texto string `json:"texto"`
}

// CategoriaPropuesta es la categoría que se sugiere: una que la persona ve (RN-011, RF-005).
type CategoriaPropuesta struct {
	ID     int    `json:"id"`
	Nombre string `json:"nombre"`
}

// Propuesta es el movimiento que el sistema entendió del texto. No se guarda: la persona lo revisa en «Revisa y
// confirma» y, si lo confirma, el cliente lo guarda con `POST /api/v1/movimientos` (RN-001).
type Propuesta struct {
	Tipo              string              `json:"tipo"`
	MontoCentavos     *int64              `json:"monto_centavos"`     // null si el monto es ambiguo
	Categoria         *CategoriaPropuesta `json:"categoria"`          // null si la persona no ve la sugerida o hay varios montos
	Fecha             string              `json:"fecha"`              // AAAA-MM-DD
	VariosMovimientos bool                `json:"varios_movimientos"` // solo se propone el primero, sin categoría (D-077, D-196)
}

// LecturasDelMonto son las dos lecturas de un monto ambiguo, ya escritas como las pide la pregunta de E14.
type LecturasDelMonto struct {
	ConPuntoDeMiles string `json:"con_punto_de_miles"`
	ConComaDecimal  string `json:"con_coma_decimal"`
}

// Interpretada es la respuesta de la interpretación. Sin propuesta (recomendación, pregunta, no entendido, tiempo
// agotado) solo lleva `resultado`.
type Interpretada struct {
	Resultado string `json:"resultado"`
	*Propuesta
	Lecturas *LecturasDelMonto `json:"lecturas_del_monto,omitempty"`
}

// ConInterpretador dice con qué se interpreta el texto (el motor de reglas, o el falso en las pruebas: IAR-003).
func (s *Servicio) ConInterpretador(i interpretacion.Interpretador) *Servicio {
	s.interpretador = i
	return s
}

// InterpretarTexto interpreta lo que la persona escribió en el cuadro «Escribe el gasto o el ingreso» (CU-03). No guarda
// nada ni registra el texto (RN-001). La fecha de referencia es el hoy de Colombia. La categoría solo se propone si la
// persona la ve y el texto trae un solo monto; si no, va vacía y ella elige. ErrValidacion con `texto` si está vacío o pasa de 280 caracteres, sin llamar
// al interpretador; ErrSinInterpretador si no hay uno; cualquier otro error del interpretador o del catálogo.
func (s *Servicio) InterpretarTexto(ctx context.Context, persona, texto string) (Interpretada, error) {
	if strings.TrimSpace(texto) == "" {
		return Interpretada{}, errorDeTexto(TextoRequerido)
	}
	if utf8.RuneCountInString(texto) > interpretacion.MaxCaracteres {
		return Interpretada{}, errorDeTexto(TextoLargo)
	}
	if s.interpretador == nil {
		return Interpretada{}, ErrSinInterpretador
	}
	hoy := fechas.HoyEnColombia(s.reloj.Ahora())
	hecho, err := s.interpretador.Interpretar(ctx, interpretacion.Entrada{Texto: texto, FechaReferencia: hoy})
	switch {
	case errors.Is(err, interpretacion.ErrTiempoAgotado):
		return Interpretada{Resultado: ResultadoTiempoAgotado}, nil
	case errors.Is(err, interpretacion.ErrTextoVacio):
		return Interpretada{}, errorDeTexto(TextoRequerido)
	case errors.Is(err, interpretacion.ErrTextoLargo):
		return Interpretada{}, errorDeTexto(TextoLargo)
	case err != nil:
		return Interpretada{}, err
	}
	switch hecho.Intencion {
	case interpretacion.Recomendacion:
		return Interpretada{Resultado: ResultadoRecomendacion}, nil
	case interpretacion.Pregunta:
		return Interpretada{Resultado: ResultadoPregunta}, nil
	case interpretacion.Registro:
	default:
		return Interpretada{Resultado: ResultadoNoEntendido}, nil
	}

	lecturas, ambiguo := interpretacion.MontoAmbiguo(texto)
	if hecho.Monto == nil && !ambiguo {
		return Interpretada{Resultado: ResultadoNoEntendido}, nil
	}
	fecha := hoy
	if hecho.Fecha != nil {
		fecha = *hecho.Fecha
	}
	propuesta := &Propuesta{
		Tipo:              string(hecho.Tipo),
		MontoCentavos:     hecho.Monto,
		Fecha:             fecha.Format(formatoDeFecha),
		VariosMovimientos: interpretacion.DetectorDeVariosMovimientos{}.HayVarios(texto),
	}
	// D-196, paso 1 (provisional hasta la US-68): con más de un monto el motor puede dar la categoría de otro movimiento
	// que el del monto y la fecha («mercado 45 mil ayer y 12 mil de pasajes» daba «Transporte»). La categoría va vacía.
	if hecho.Categoria != "" && !propuesta.VariosMovimientos {
		if propuesta.Categoria, err = s.categoriaVisible(ctx, persona, hecho.Categoria, propuesta.Tipo); err != nil {
			return Interpretada{}, err
		}
	}
	if ambiguo {
		propuesta.MontoCentavos = nil
		return Interpretada{Resultado: ResultadoMontoAmbiguo, Propuesta: propuesta,
			Lecturas: &LecturasDelMonto{ConPuntoDeMiles: lecturas.ConPuntoDeMiles, ConComaDecimal: lecturas.ConComaDecimal}}, nil
	}
	return Interpretada{Resultado: ResultadoPropuesta, Propuesta: propuesta}, nil
}

func errorDeTexto(codigo string) error {
	return &ErrValidacion{Campos: map[string]string{"texto": codigo}}
}

// categoriaVisible busca, entre las categorías que la persona ve (no apta para un menor u oculta por ella quedan fuera,
// RN-011), la de ese nombre y tipo. Nil si no la ve: nunca se sugiere una oculta ni se cambia por otra.
func (s *Servicio) categoriaVisible(ctx context.Context, persona, nombre, tipo string) (*CategoriaPropuesta, error) {
	lista, err := s.repo.Categorias(ctx, persona)
	if err != nil {
		return nil, err
	}
	for _, c := range lista {
		if c.Nombre == nombre && c.Tipo == tipo {
			return &CategoriaPropuesta{ID: c.ID, Nombre: c.Nombre}, nil
		}
	}
	return nil, nil
}
