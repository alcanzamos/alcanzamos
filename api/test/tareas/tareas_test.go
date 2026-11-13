package tareas_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/tareas"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

// tareasFalsas implementa las tres tareas del ejecutor: anota el orden en que corren, con qué hora, y falla o entra en
// pánico donde se le pide.
type tareasFalsas struct {
	mu     sync.Mutex
	pasos  []string
	ahoras map[string]time.Time
	err    map[string]error
	panico map[string]bool
	// alIniciarElAviso, si no es nil, corre al empezar la tarea de los avisos (la prueba de que la limpieza no espera al correo).
	alIniciarElAviso func()
}

func (f *tareasFalsas) paso(nombre string, ahora time.Time) error {
	f.mu.Lock()
	f.pasos = append(f.pasos, nombre)
	if f.ahoras == nil {
		f.ahoras = map[string]time.Time{}
	}
	f.ahoras[nombre] = ahora
	f.mu.Unlock()
	if f.panico[nombre] {
		var c *tareasFalsas
		c.pasos = nil // desreferencia un nil, como el servicio sin correo del ítem 294
	}
	return f.err[nombre]
}

func (f *tareasFalsas) BorrarCuentasSinConfirmar(_ context.Context, ahora time.Time) (int, error) {
	return 2, f.paso("purga", ahora)
}

func (f *tareasFalsas) LimpiarSesionesYEnlaces(_ context.Context, ahora time.Time) (int, int, error) {
	return 1, 4, f.paso("limpieza", ahora)
}

func (f *tareasFalsas) AvisarAntesDeLaPurga(_ context.Context, ahora time.Time) (int, error) {
	if f.alIniciarElAviso != nil {
		f.alIniciarElAviso()
	}
	return 3, f.paso("avisos", ahora)
}

func (f *tareasFalsas) corrieron() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.pasos...)
}

func (f *tareasFalsas) ejecutor(reloj *relojtest.Fijo, log *slog.Logger) *tareas.Ejecutor {
	return tareas.NuevoEjecutor(f, f, f, reloj, log)
}

func descartar() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

var ordenEsperado = []string{"purga", "limpieza", "avisos"}

// nombres son los de las tareas en el error y en el registro.
var nombres = map[string]string{
	"purga": "borrar cuentas sin confirmar", "limpieza": "limpiar sesiones y enlaces", "avisos": "avisar antes de la purga",
}

func TestEjecutar(t *testing.T) {
	ahora := time.Date(2026, 10, 22, 6, 0, 0, 0, time.UTC)
	falla := errors.New("bd caída")
	casos := []struct {
		nombre     string
		err        map[string]error
		ejecutadas int
		fallo      bool
	}{
		{"todo bien", nil, 3, false},
		{"falla la purga y siguen las otras dos", map[string]error{"purga": falla}, 2, true},
		{"falla la limpieza y los avisos corren", map[string]error{"limpieza": falla}, 2, true},
		{"fallan los avisos", map[string]error{"avisos": falla}, 2, true},
		{"fallan las tres", map[string]error{"purga": falla, "limpieza": falla, "avisos": falla}, 0, true},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			f := &tareasFalsas{err: c.err}
			n, err := f.ejecutor(&relojtest.Fijo{T: ahora}, descartar()).Ejecutar(context.Background())
			if n != c.ejecutadas || (err != nil) != c.fallo {
				t.Fatalf("ejecutadas %d, error %v", n, err)
			}
			if got := f.corrieron(); strings.Join(got, ",") != strings.Join(ordenEsperado, ",") {
				t.Errorf("cada tarea corre aunque otra falle, en este orden: %v", got)
			}
			for nombre, hora := range f.ahoras {
				if !hora.Equal(ahora) {
					t.Errorf("la tarea %s no usó la hora del Reloj: %v", nombre, hora)
				}
			}
			for tarea := range c.err {
				if !strings.Contains(err.Error(), nombres[tarea]) {
					t.Errorf("el error debe nombrar la tarea %s: %v", tarea, err)
				}
			}
		})
	}
}

// Ítem 294, L14 (4): el orden es la purga, la limpieza de sesiones y enlaces y, al final, los avisos. La limpieza nunca
// espera al correo: cuando el primer envío empieza (y se queda esperando al servidor), la purga y la limpieza ya terminaron.
func TestLaLimpiezaTerminaAntesDeQueEmpieceCualquierEnvio(t *testing.T) {
	f := &tareasFalsas{}
	empezo, soltar := make(chan []string, 1), make(chan struct{})
	f.alIniciarElAviso = func() {
		empezo <- f.corrieron() // lo que ya terminó cuando el correo empieza
		<-soltar                // el correo se queda esperando al servidor
	}
	terminada := make(chan int, 1)
	go func() {
		n, err := f.ejecutor(&relojtest.Fijo{T: time.Date(2026, 10, 22, 6, 0, 0, 0, time.UTC)}, descartar()).Ejecutar(context.Background())
		if err != nil {
			t.Error(err)
		}
		terminada <- n
	}()
	select {
	case antes := <-empezo:
		if strings.Join(antes, ",") != "purga,limpieza" {
			t.Fatalf("al empezar el primer envío debían estar hechas la purga y la limpieza, en ese orden: %v", antes)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("los avisos no empezaron")
	}
	select {
	case <-terminada:
		t.Fatal("el ejecutor terminó con el correo todavía esperando")
	default:
	}
	close(soltar)
	if n := <-terminada; n != 3 {
		t.Errorf("ejecutadas %d", n)
	}
	if got := f.corrieron(); strings.Join(got, ",") != strings.Join(ordenEsperado, ",") {
		t.Errorf("orden %v", got)
	}
}

// Ítem 294, L10 y L14: un pánico de una tarea (un nil sin armar, por ejemplo) no tira el proceso ni salta las demás: queda
// como error de esa tarea, con su nombre y una línea ERROR, y las otras corren.
func TestUnPanicoDeUnaTareaNoSaltaLasDemas(t *testing.T) {
	reloj := &relojtest.Fijo{T: time.Date(2026, 10, 22, 6, 0, 0, 0, time.UTC)}
	for _, tarea := range []string{"purga", "limpieza", "avisos"} {
		t.Run(tarea, func(t *testing.T) {
			var registro strings.Builder
			f := &tareasFalsas{panico: map[string]bool{tarea: true}}
			n, err := f.ejecutor(reloj, slog.New(slog.NewJSONHandler(&registro, nil))).Ejecutar(context.Background())
			if n != 2 || err == nil || !strings.Contains(err.Error(), nombres[tarea]) || !strings.Contains(err.Error(), "pánico") {
				t.Fatalf("el pánico debe quedar como error de la tarea y las otras dos correr: ejecutadas %d, error %v", n, err)
			}
			if got := f.corrieron(); strings.Join(got, ",") != strings.Join(ordenEsperado, ",") {
				t.Errorf("tras el pánico de %s corrieron %v", tarea, got)
			}
			if !strings.Contains(registro.String(), `"level":"ERROR"`) {
				t.Errorf("el pánico debe quedar en el registro como ERROR: %s", registro.String())
			}
		})
	}
}
