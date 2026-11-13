package cuenta_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/tareas"
)

type limpiezaQueCuenta struct{ llamadas atomic.Int32 }

func (l *limpiezaQueCuenta) LimpiarSesionesYEnlaces(context.Context, time.Time) (int, int, error) {
	l.llamadas.Add(1)
	return 0, 0, nil
}

// Ítem 294, L10 y L14: con el servicio real de la cuenta, si la purga o el aviso fallan, la limpieza de sesiones y enlaces
// corre igual y la tarea sigue informando la falla (error, y con él el código de salida 1 de `api tareas`), y la falla de
// la purga tampoco salta los avisos.
func TestSiLaPurgaOElAvisoFallanLaLimpiezaCorreIgual(t *testing.T) {
	falla := errors.New("bd caída")
	casos := map[string]struct {
		preparar func(*repoFalso)
		tarea    string
		avisos   int // correos que salen
	}{
		"falla el aviso": {func(r *repoFalso) { r.errAvisar = falla }, "avisar antes de la purga", 0},
		"falla la purga": {func(r *repoFalso) { r.errBorrar = falla }, "borrar cuentas sin confirmar", 1},
	}
	for nombre, c := range casos {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntorno()
			e.repo.porAvisar = []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)}}
			c.preparar(e.repo)
			limpieza := &limpiezaQueCuenta{}
			ejecutor := tareas.NuevoEjecutor(e.svc, limpieza, e.svc, e.reloj, slog.New(slog.NewJSONHandler(io.Discard, nil)))
			n, err := ejecutor.Ejecutar(context.Background())
			if limpieza.llamadas.Load() != 1 {
				t.Errorf("la limpieza debe correr una vez, corrió %d", limpieza.llamadas.Load())
			}
			if !errors.Is(err, falla) || !strings.Contains(err.Error(), c.tarea) {
				t.Errorf("la tarea debe informar la falla de %q: %v", c.tarea, err)
			}
			if n != 2 {
				t.Errorf("terminaron bien las otras dos: %d", n)
			}
			if len(e.correo.Enviados()) != c.avisos {
				t.Errorf("salieron %d avisos, se esperaban %d", len(e.correo.Enviados()), c.avisos)
			}
		})
	}
}
