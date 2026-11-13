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

// Ítem 294, L10: con el servicio real de la cuenta, si el aviso o la purga fallan, la limpieza de sesiones y enlaces corre
// igual y la tarea sigue informando la falla (error, y con él el código de salida 1 de `api tareas`).
func TestSiLaPurgaOElAvisoFallanLaLimpiezaCorreIgual(t *testing.T) {
	falla := errors.New("bd caída")
	casos := map[string]func(*repoFalso){
		"falla el aviso": func(r *repoFalso) {
			r.errAvisar = falla
			r.porAvisar = []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)}}
		},
		"falla la purga": func(r *repoFalso) { r.errBorrar = falla },
	}
	for nombre, preparar := range casos {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntorno()
			preparar(e.repo)
			limpieza := &limpiezaQueCuenta{}
			ejecutor := tareas.NuevoEjecutor(e.svc, limpieza, e.reloj, slog.New(slog.NewJSONHandler(io.Discard, nil)))
			n, err := ejecutor.Ejecutar(context.Background())
			if limpieza.llamadas.Load() != 1 {
				t.Errorf("la limpieza debe correr una vez, corrió %d", limpieza.llamadas.Load())
			}
			if !errors.Is(err, falla) || !strings.Contains(err.Error(), "borrar cuentas sin confirmar") {
				t.Errorf("la tarea debe informar la falla: %v", err)
			}
			if n != 1 {
				t.Errorf("terminó bien solo la limpieza: %d", n)
			}
		})
	}
}
