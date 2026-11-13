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

// Cuentas es lo que el ejecutor necesita de CuentaServicio para la purga.
type Cuentas interface {
	BorrarCuentasSinConfirmar(ctx context.Context, ahora time.Time) (int, error)
}

// Limpieza es lo que el ejecutor necesita para borrar lo vencido.
type Limpieza interface {
	LimpiarSesionesYEnlaces(ctx context.Context, ahora time.Time) (sesiones, enlaces int, err error)
}

// Avisos es lo que el ejecutor necesita para mandar el aviso antes de la purga (ítem 294, D-203). Es la única tarea que
// espera a un servidor de correo, y por eso va al final y con su propio tiempo total, que pone el servicio.
type Avisos interface {
	AvisarAntesDeLaPurga(ctx context.Context, ahora time.Time) (int, error)
}

// Ejecutor corre las tareas programadas.
type Ejecutor struct {
	cuentas  Cuentas
	limpieza Limpieza
	avisos   Avisos
	reloj    reloj.Reloj
	log      *slog.Logger
}

// NuevoEjecutor arma el ejecutor con los servicios que llama.
func NuevoEjecutor(c Cuentas, l Limpieza, a Avisos, r reloj.Reloj, log *slog.Logger) *Ejecutor {
	return &Ejecutor{cuentas: c, limpieza: l, avisos: a, reloj: r, log: log}
}

// Ejecutar corre las tareas, una tras otra y siempre en este orden: **la purga** de las cuentas sin confirmar o sin
// autorizar, **la limpieza** de sesiones y enlaces vencidos y, al final, **los avisos** antes de la purga. La limpieza
// nunca espera al correo: los avisos van al final porque son lo único que depende de un servidor de correo que puede no
// contestar (ítem 294, L14). Cada tarea corre aunque una anterior falle, y Ejecutar devuelve cuántas terminaron bien; el
// error junta los de las que fallaron. Una tarea que entra en pánico cuenta como fallida (su error lo dice y queda una
// línea ERROR en el registro) y no salta las demás. Se puede repetir sin efectos de más: el trabajo programado corre cada
// 15 minutos (CU-43, CU-52).
func (e *Ejecutor) Ejecutar(ctx context.Context) (int, error) {
	ahora := e.reloj.Ahora()
	var errs []error
	ejecutadas := 0
	for _, t := range []struct {
		nombre string
		hacer  func() error
	}{
		{"borrar cuentas sin confirmar", func() error {
			n, err := e.cuentas.BorrarCuentasSinConfirmar(ctx, ahora)
			if err == nil {
				e.log.InfoContext(ctx, "tareas: cuentas sin confirmar borradas", "cantidad", n)
			}
			return err
		}},
		{"limpiar sesiones y enlaces", func() error {
			s, l, err := e.limpieza.LimpiarSesionesYEnlaces(ctx, ahora)
			if err == nil {
				e.log.InfoContext(ctx, "tareas: sesiones y enlaces vencidos borrados", "sesiones", s, "enlaces", l)
			}
			return err
		}},
		{"avisar antes de la purga", func() error {
			n, err := e.avisos.AvisarAntesDeLaPurga(ctx, ahora)
			if err == nil {
				e.log.InfoContext(ctx, "tareas: avisos antes de la purga enviados", "cantidad", n)
			}
			return err
		}},
	} {
		if err := e.correr(ctx, t.nombre, t.hacer); err != nil {
			errs = append(errs, err)
		} else {
			ejecutadas++
		}
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
