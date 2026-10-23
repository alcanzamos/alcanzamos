package tareas_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/tareas"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

type cuentasFalsas struct {
	err   error
	ahora time.Time
}

func (c *cuentasFalsas) BorrarCuentasSinConfirmar(_ context.Context, ahora time.Time) (int, error) {
	c.ahora = ahora
	return 2, c.err
}

type limpiezaFalsa struct{ err error }

func (l limpiezaFalsa) LimpiarSesionesYEnlaces(context.Context, time.Time) (int, int, error) {
	return 1, 4, l.err
}

func TestEjecutar(t *testing.T) {
	ahora := time.Date(2026, 10, 22, 6, 0, 0, 0, time.UTC)
	falla := errors.New("bd caída")
	casos := []struct {
		nombre     string
		cuentas    error
		limpieza   error
		ejecutadas int
		fallo      bool
	}{
		{"todo bien", nil, nil, 2, false},
		{"falla la primera y sigue la segunda", falla, nil, 1, true},
		{"falla la segunda", nil, falla, 1, true},
		{"fallan las dos", falla, falla, 0, true},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			cuentas := &cuentasFalsas{err: c.cuentas}
			e := tareas.NuevoEjecutor(cuentas, limpiezaFalsa{c.limpieza}, &relojtest.Fijo{T: ahora}, slog.New(slog.NewJSONHandler(io.Discard, nil)))
			n, err := e.Ejecutar(context.Background())
			if n != c.ejecutadas || (err != nil) != c.fallo {
				t.Fatalf("ejecutadas %d, error %v", n, err)
			}
			if !cuentas.ahora.Equal(ahora) {
				t.Error("las tareas usan la hora del Reloj")
			}
		})
	}
}
