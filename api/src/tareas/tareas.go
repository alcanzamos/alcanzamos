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
// junta los de las que fallaron. Una tarea que entra en pánico cuenta como fallida (su error lo dice y queda una línea
// ERROR en el registro) y no salta las demás: la limpieza de sesiones y enlaces corre aunque la purga o el aviso fallen.
// Se puede repetir sin efectos de más: el trabajo programado corre cada 15 minutos (CU-43, CU-52).
func (e *Ejecutor) Ejecutar(ctx context.Context) (int, error) {
	ahora := e.reloj.Ahora()
	var errs []error
	ejecutadas := 0

	if err := e.correr(ctx, "borrar cuentas sin confirmar", func() error {
		n, err := e.cuentas.BorrarCuentasSinConfirmar(ctx, ahora)
		if err == nil {
			e.log.InfoContext(ctx, "tareas: cuentas sin confirmar borradas", "cantidad", n)
		}
		return err
	}); err != nil {
		errs = append(errs, err)
	} else {
		ejecutadas++
	}

	if err := e.correr(ctx, "limpiar sesiones y enlaces", func() error {
		s, l, err := e.limpieza.LimpiarSesionesYEnlaces(ctx, ahora)
		if err == nil {
			e.log.InfoContext(ctx, "tareas: sesiones y enlaces vencidos borrados", "sesiones", s, "enlaces", l)
		}
		return err
	}); err != nil {
		errs = append(errs, err)
	} else {
		ejecutadas++
	}
	return ejecutadas, errors.Join(errs...)
}

// correr hace una tarea y devuelve su error con el nombre de la tarea. Un pánico se vuelve error (sin la pila: el valor
// del pánico alcanza para ubicarlo y la pila puede llevar datos de la corrida) y se registra como ERROR.
func (e *Ejecutor) correr(ctx context.Context, nombre string, tarea func() error) (err error) {
	defer func() {
		if p := recover(); p != nil {
			e.log.ErrorContext(ctx, "tareas: una tarea entró en pánico", "tarea", nombre, "panico", fmt.Sprint(p))
			err = fmt.Errorf("%s: pánico: %v", nombre, p)
		}
	}()
	if err := tarea(); err != nil {
		return fmt.Errorf("%s: %w", nombre, err)
	}
	return nil
}
