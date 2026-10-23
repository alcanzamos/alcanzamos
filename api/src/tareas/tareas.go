// Package tareas es el EjecutorDeTareas de E12: el trabajo programado del comando `api tareas`. Cada tarea es
// idempotente y solo llama a un servicio: no tiene reglas propias (D-026, ADR-002 §5.4).
package tareas

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/reloj"
)

// Cuentas es lo que el ejecutor necesita de CuentaServicio.
type Cuentas interface {
	BorrarCuentasSinConfirmar(ctx context.Context, ahora time.Time) (int, error)
}

// Limpieza es lo que el ejecutor necesita para borrar lo vencido.
type Limpieza interface {
	LimpiarSesionesYEnlaces(ctx context.Context, ahora time.Time) (sesiones, enlaces int, err error)
}

// Ejecutor corre las tareas programadas.
type Ejecutor struct {
	cuentas  Cuentas
	limpieza Limpieza
	reloj    reloj.Reloj
	log      *slog.Logger
}

// NuevoEjecutor arma el ejecutor con los servicios que llama.
func NuevoEjecutor(c Cuentas, l Limpieza, r reloj.Reloj, log *slog.Logger) *Ejecutor {
	return &Ejecutor{cuentas: c, limpieza: l, reloj: r, log: log}
}

// Ejecutar corre todas las tareas, una tras otra, aunque una falle, y devuelve cuántas terminaron bien. El error
// junta los de las que fallaron. Se puede repetir sin efectos de más: el comando corre una vez al día (CU-43, CU-52).
func (e *Ejecutor) Ejecutar(ctx context.Context) (int, error) {
	ahora := e.reloj.Ahora()
	var errs []error
	ejecutadas := 0

	if n, err := e.cuentas.BorrarCuentasSinConfirmar(ctx, ahora); err != nil {
		errs = append(errs, fmt.Errorf("borrar cuentas sin confirmar: %w", err))
	} else {
		ejecutadas++
		e.log.InfoContext(ctx, "tareas: cuentas sin confirmar borradas", "cantidad", n)
	}

	if s, l, err := e.limpieza.LimpiarSesionesYEnlaces(ctx, ahora); err != nil {
		errs = append(errs, fmt.Errorf("limpiar sesiones y enlaces: %w", err))
	} else {
		ejecutadas++
		e.log.InfoContext(ctx, "tareas: sesiones y enlaces vencidos borrados", "sesiones", s, "enlaces", l)
	}
	return ejecutadas, errors.Join(errs...)
}
