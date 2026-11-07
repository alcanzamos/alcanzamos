// Package interpretacion convierte un texto escrito en español en una interpretación (monto, tipo, fecha, categoría e
// intención) con reglas y sin IA (opción D, D-075). Define el puerto `Interpretador` de ADR-005 §5.1 y E12 §5.2 y sus
// dos implementaciones: `InterpretadorPorReglas`, que aplica `reglas.json` (versión D-1.0) con expresiones regulares RE2,
// e `InterpretadorFalso`, con respuestas fijas (IAR-003).
//
// El paquete no guarda nada ni registra el texto (RN-001, RNF-005): no importa registro, disco, red ni base de datos, y
// ningún error lleva el texto. La interpretación es transitoria: nunca se guarda.
package interpretacion

import (
	"context"
	"errors"
	"time"
)

// Los límites del contrato (D-084 (2), E12 §6.2).
const (
	// MaxCaracteres es el largo máximo del texto, en caracteres (no en bytes).
	MaxCaracteres = 280
	// PresupuestoDeTiempo es el tiempo máximo para interpretar un texto, contado con el contexto.
	PresupuestoDeTiempo = 200 * time.Millisecond
)

// Errores del contrato (E12 §6.2). Ante cualquiera, la persona sigue con el formulario (RF-002).
var (
	ErrTextoVacio    = errors.New("el texto está vacío")
	ErrTextoLargo    = errors.New("el texto pasa el límite de 280 caracteres")
	ErrTiempoAgotado = errors.New("se agotó el tiempo para interpretar el texto")
)

// Intencion es lo que la persona quiere hacer con el texto (RF-021, RF-044).
type Intencion string

// Las tres intenciones de las reglas D-1.0.
const (
	Registro      Intencion = "registro"
	Pregunta      Intencion = "pregunta"
	Recomendacion Intencion = "recomendacion" // pedido de recomendación financiera
)

// Tipo es el tipo de movimiento (apéndice B de la ERS).
type Tipo string

// Los dos tipos de movimiento. Un texto que no es un registro no tiene tipo (la cadena vacía).
const (
	Gasto   Tipo = "gasto"
	Ingreso Tipo = "ingreso"
)

// Entrada es lo que recibe el `Interpretador`: el texto y la fecha de referencia, que es la de hoy de la persona
// (`Reloj.Hoy`) y es un dato de entrada, no está en las reglas. De la fecha solo cuenta el día.
type Entrada struct {
	Texto           string
	FechaReferencia time.Time
}

// Interpretacion es lo que entiende el motor. Es transitoria: nunca se guarda (RN-001).
//
// Solo un texto con intención «registro» trae tipo, fecha y categoría. El monto es nil si el texto no trae uno, o si no
// cabe en centavos. La categoría es el nombre del catálogo; `RegistroServicio` la resuelve.
type Interpretacion struct {
	Monto         *int64     // en centavos (D-082); las reglas dan pesos enteros y se multiplican por 100
	Tipo          Tipo       // vacío si no es un registro
	Fecha         *time.Time // el día en UTC; nil si no es un registro
	Categoria     string     // vacía si no es un registro
	Intencion     Intencion
	ReglasVersion string // por ejemplo «D-1.0»
}

// Interpretador es el puerto de ADR-005 §5.1: convierte un texto en una interpretación. No guarda nada y no registra el
// texto (RN-001). Devuelve ErrTextoVacio, ErrTextoLargo o ErrTiempoAgotado.
type Interpretador interface {
	Interpretar(ctx context.Context, entrada Entrada) (Interpretacion, error)
}

// InterpretadorFalso es la segunda implementación del puerto, con respuestas fijas (E12 §5.2, IAR-003): devuelve siempre
// `Respuesta` y `Err`, sin leer el texto, ni las reglas, ni el contexto.
type InterpretadorFalso struct {
	Respuesta Interpretacion
	Err       error
}

// Interpretar devuelve la respuesta fija; si hay un error fijo, devuelve ese y una interpretación vacía.
func (f InterpretadorFalso) Interpretar(context.Context, Entrada) (Interpretacion, error) {
	if f.Err != nil {
		return Interpretacion{}, f.Err
	}
	return f.Respuesta, nil
}
