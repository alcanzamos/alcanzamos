package tareas_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/tareas"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

type cuentasFalsas struct {
	err     error
	ahora   time.Time
	cuantas int
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

type cuentasQueEntraEnPanico struct{}

func (cuentasQueEntraEnPanico) BorrarCuentasSinConfirmar(context.Context, time.Time) (int, error) {
	var c *cuentasFalsas
	return c.cuantas, nil // desreferencia un nil, como el servicio sin correo del ítem 294
}

type limpiezaQueCuenta struct {
	llamadas int
	panico   bool
}

func (l *limpiezaQueCuenta) LimpiarSesionesYEnlaces(context.Context, time.Time) (int, int, error) {
	l.llamadas++
	if l.panico {
		var l2 *limpiezaQueCuenta
		l2.llamadas++ // nil pointer
	}
	return 1, 4, nil
}

// Ítem 294, L10: un pánico de una tarea (un nil sin armar, por ejemplo) no tira el proceso ni salta las demás: queda
// como error de esa tarea, con su nombre, y las otras corren.
func TestUnPanicoDeUnaTareaNoSaltaLasDemas(t *testing.T) {
	var registro strings.Builder
	log := slog.New(slog.NewJSONHandler(&registro, nil))
	reloj := &relojtest.Fijo{T: time.Date(2026, 10, 22, 6, 0, 0, 0, time.UTC)}

	limpieza := &limpiezaQueCuenta{}
	n, err := tareas.NuevoEjecutor(cuentasQueEntraEnPanico{}, limpieza, reloj, log).Ejecutar(context.Background())
	if limpieza.llamadas != 1 || n != 1 || err == nil || !strings.Contains(err.Error(), "borrar cuentas sin confirmar") || !strings.Contains(err.Error(), "pánico") {
		t.Fatalf("la limpieza debe correr y el pánico quedar como error: llamadas %d, ejecutadas %d, error %v", limpieza.llamadas, n, err)
	}
	if !strings.Contains(registro.String(), `"level":"ERROR"`) {
		t.Errorf("el pánico debe quedar en el registro como ERROR: %s", registro.String())
	}

	cuentas := &cuentasFalsas{}
	n, err = tareas.NuevoEjecutor(cuentas, &limpiezaQueCuenta{panico: true}, reloj, log).Ejecutar(context.Background())
	if n != 1 || err == nil || !strings.Contains(err.Error(), "limpiar sesiones y enlaces") || !strings.Contains(err.Error(), "pánico") {
		t.Fatalf("el pánico de la limpieza también es un error de esa tarea: ejecutadas %d, error %v", n, err)
	}
}
