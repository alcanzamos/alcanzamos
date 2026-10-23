package autenticacion_test

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// respuesta es lo que un cliente puede ver de un pedido: estado, cabeceras y cuerpo.
type respuesta struct {
	codigo    int
	cabeceras http.Header
	cuerpo    string
}

func pedir(e *entorno, h http.Handler, correo, origen string) respuesta {
	rr := llamar(h, "POST", rutaRecuperacion, `{"correo":"`+correo+`"}`, origen)
	return respuesta{rr.Code, rr.Header().Clone(), rr.Body.String()}
}

// correosDeLosTresCasos: cuenta verificada, cuenta sin verificar y correo sin cuenta (D-144).
var correosDeLosTresCasos = []string{correoDePrueba, "sinverificar@ej.test", "nadie@ejemplo.test"}

func comprobarIguales(t *testing.T, vistas map[string]respuesta) {
	t.Helper()
	base := vistas[correoDePrueba]
	if base.codigo != 202 || strings.TrimSpace(base.cuerpo) != `{"estado":"enlace_enviado"}` {
		t.Fatalf("respuesta base: %d %s", base.codigo, base.cuerpo)
	}
	for correo, v := range vistas {
		if !reflect.DeepEqual(v, base) {
			t.Errorf("%s responde distinto: %+v, y la cuenta verificada %+v", correo, v, base)
		}
	}
}

// D-144: el pedido hace lo mismo exista la cuenta o no, esté verificada o no, y no toca la cuenta: sin trabajadores
// andando, la base y el correo no se llaman, y la respuesta ya salió idéntica. Después, un trabajador hace la consulta
// de cada caso y el correo sale solo para la cuenta verificada. Sin medir tiempos de reloj.
func TestElPedidoDeRecuperacionNoTocaLaCuentaYRespondeIgualEnLosTresCasos(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	h := e.api(t, nil)
	vistas := map[string]respuesta{}
	for _, correo := range correosDeLosTresCasos {
		vistas[correo] = pedir(e, h, correo, "203.0.113.7")
	}
	comprobarIguales(t, vistas)
	if n := e.repo.consultasDeRecuperacion.Load(); n != 0 {
		t.Fatalf("el pedido consultó la cuenta %d veces; debe hacerlo el trabajador", n)
	}
	if n := len(e.correo.Enviados()); n != 0 {
		t.Fatalf("el pedido mandó %d correos", n)
	}

	e.iniciar(t)
	e.svc.Esperar()
	if n := e.repo.consultasDeRecuperacion.Load(); int(n) != len(correosDeLosTresCasos) {
		t.Errorf("consultas del trabajador: %d", n)
	}
	if env := e.correo.Enviados(); len(env) != 1 || env[0].Destino != correoDePrueba || !env[0].Recuperacion {
		t.Errorf("solo la cuenta verificada recibe el correo: %+v", env)
	}
	if strings.Contains(e.registro.String(), "@") {
		t.Errorf("el registro lleva un correo: %s", e.registro)
	}
}

// Con los trabajadores andando pero la consulta de la cuenta detenida, el pedido igual responde: no espera a la base
// ni al correo. Si esperara, esta prueba no terminaría.
func TestElPedidoNoEsperaALaConsultaDeLaCuenta(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	e.repo.compuerta = make(chan struct{})
	e.iniciar(t)
	h := e.api(t, nil)
	vistas := map[string]respuesta{}
	for _, correo := range correosDeLosTresCasos {
		vistas[correo] = pedir(e, h, correo, "203.0.113.7")
	}
	comprobarIguales(t, vistas)
	if n := len(e.correo.Enviados()); n != 0 {
		t.Fatalf("salió un correo con la consulta detenida: %d", n)
	}
	close(e.repo.compuerta)
	e.svc.Esperar()
	if env := e.correo.Enviados(); len(env) != 1 || env[0].Destino != correoDePrueba {
		t.Errorf("solo la cuenta verificada recibe el correo: %+v", env)
	}
}

// Los límites cuentan igual con cuenta o sin ella: por correo normalizado, el 4.º pedido de la hora es el mismo 429 y
// ninguno llegó a la base.
func TestLosLimitesDeLaRecuperacionNoDependenDeLaCuenta(t *testing.T) {
	var cuerpos []respuesta
	for _, correo := range correosDeLosTresCasos {
		e := nuevoEntornoSinTrabajadores(t)
		h := e.api(t, nil)
		for i := range 3 {
			if v := pedir(e, h, " "+strings.ToUpper(correo)+" ", "203.0.113."+string(rune('1'+i))); v.codigo != 202 {
				t.Fatalf("%s pedido %d: %d", correo, i+1, v.codigo)
			}
		}
		v := pedir(e, h, correo, "203.0.113.50")
		if v.codigo != 429 {
			t.Fatalf("%s: se esperaba 429, vino %d", correo, v.codigo)
		}
		cuerpos = append(cuerpos, v)
		if n := e.repo.consultasDeRecuperacion.Load(); n != 0 {
			t.Errorf("%s: el pedido consultó la cuenta %d veces", correo, n)
		}
	}
	if !reflect.DeepEqual(cuerpos[0], cuerpos[1]) || !reflect.DeepEqual(cuerpos[1], cuerpos[2]) {
		t.Errorf("el 429 difiere: %+v", cuerpos)
	}
}

// Con la cola llena el trabajo se descarta, se registra sin el correo, y la respuesta es la misma. Pedirlo otra vez, con
// la cola libre, manda el correo.
func TestConLaColaLlenaLaRecuperacionRespondeIgualYSeDescarta(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	svc, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: e.repo, Hasher: e.hasher, Limitador: e.limitador, Reloj: e.reloj, Correo: e.correo,
		Politica: seguridad.NuevaPoliticaDeContrasena(), Log: slog.New(slog.NewJSONHandler(e.registro, nil)),
		ColaDeRecuperacion: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	e.svc = svc
	h := e.api(t, nil)
	llena := pedir(e, h, "nadie@ejemplo.test", "203.0.113.7") // ocupa el único lugar
	descartada := pedir(e, h, correoDePrueba, "203.0.113.7")
	if !reflect.DeepEqual(llena, descartada) {
		t.Errorf("la respuesta con la cola llena difiere: %+v y %+v", descartada, llena)
	}
	if !strings.Contains(e.registro.String(), "recuperación descartada") || strings.Contains(e.registro.String(), "@") {
		t.Errorf("registro: %s", e.registro)
	}
	e.iniciar(t)
	e.svc.Esperar()
	if n := len(e.correo.Enviados()); n != 0 {
		t.Errorf("el pedido descartado no manda correo: %d", n)
	}
	pedirRecuperacion(e, h, correoDePrueba, "203.0.113.8")
	if env := e.correo.Enviados(); len(env) != 1 || env[0].Destino != correoDePrueba {
		t.Errorf("al pedirlo otra vez sale el correo: %+v", env)
	}
}

// Al terminar el contexto, los trabajadores paran, lo que quedaba en la cola se descarta (sin colgar a Esperar) y los
// pedidos siguientes responden igual sin encolar.
func TestLosTrabajadoresParanConElContexto(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	h := e.api(t, nil)
	antes := pedir(e, h, correoDePrueba, "203.0.113.7") // queda en la cola, sin trabajadores
	ctx, cancelar := context.WithCancel(context.Background())
	cancelar()
	e.svc.Iniciar(ctx)
	e.svc.Esperar() // vuelve: el trabajo se procesó o se descartó
	despues := pedir(e, h, correoDePrueba, "203.0.113.8")
	e.svc.Esperar()
	if !reflect.DeepEqual(antes, despues) {
		t.Errorf("respuesta tras el apagado: %+v, antes %+v", despues, antes)
	}
	if n := e.repo.consultasDeRecuperacion.Load(); n > 1 {
		t.Errorf("el pedido posterior al apagado llegó a la base: %d consultas", n)
	}
}

// esperarA espera a que n se cumpla. El plazo de 30 s solo acota el fallo: en una prueba que pasa, no se espera de más.
func esperarA(t *testing.T, descripcion string, n func() bool) {
	t.Helper()
	for range 6000 {
		if n() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("no ocurrió: %s", descripcion)
}

// D-144: la cola de recuperación admite como máximo 100 pendientes; el siguiente se descarta sin esperar. Con los dos
// trabajadores de siempre atascados en la base (una compuerta cerrada), de 110 pedidos distintos solo se atienden los
// 2 que están en curso más los 100 de la cola, y todos reciben la misma respuesta.
func TestLaColaDeRecuperacionTieneUnTopeDeCien(t *testing.T) {
	if autenticacion.LargoDeLaColaDeRecuperacion != 100 {
		t.Fatalf("tope de la cola: %d, se esperaba 100", autenticacion.LargoDeLaColaDeRecuperacion)
	}
	e := nuevoEntornoSinTrabajadores(t)
	e.repo.compuerta = make(chan struct{})
	h := e.api(t, nil)
	e.iniciar(t)
	var una sync.Once
	liberar := func() { una.Do(func() { close(e.repo.compuerta) }) }
	t.Cleanup(liberar) // se ejecuta antes que el cierre de los trabajadores de iniciar
	pedido := func(i int) respuesta {
		return pedir(e, h, fmt.Sprintf("c%d@ejemplo.test", i), fmt.Sprintf("10.0.%d.%d", i/250, i%250+1))
	}

	primera := pedido(0)
	for i := 1; i < autenticacion.TrabajadoresDeRecuperacion; i++ {
		pedido(i)
	}
	esperarA(t, "los trabajadores toman un trabajo cada uno", func() bool {
		return int(e.repo.consultasDeRecuperacion.Load()) == autenticacion.TrabajadoresDeRecuperacion
	})
	for i := autenticacion.TrabajadoresDeRecuperacion; i < 110; i++ {
		if v := pedido(i); !reflect.DeepEqual(v, primera) {
			t.Fatalf("el pedido %d respondió distinto: %+v, se esperaba %+v", i, v, primera)
		}
	}
	liberar()
	e.svc.Esperar()
	if n, quiere := int(e.repo.consultasDeRecuperacion.Load()), autenticacion.TrabajadoresDeRecuperacion+autenticacion.LargoDeLaColaDeRecuperacion; n != quiere {
		t.Fatalf("se atendieron %d pedidos, se esperaban %d (en curso más la cola)", n, quiere)
	}
}

// Con la cola configurada, el tope es el configurado: un trabajador atascado más tres en la cola; el quinto se descarta.
func TestLaColaDeRecuperacionRespetaSuLargoConfigurado(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	e.repo.compuerta = make(chan struct{})
	svc, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: e.repo, Hasher: e.hasher, Limitador: e.limitador, Reloj: e.reloj, Correo: e.correo,
		Politica: seguridad.NuevaPoliticaDeContrasena(), Log: slog.New(slog.NewJSONHandler(e.registro, nil)),
		TrabajadoresDeRecuperacion: 1, ColaDeRecuperacion: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	e.svc = svc
	h := e.api(t, nil)
	e.iniciar(t)
	var una sync.Once
	liberar := func() { una.Do(func() { close(e.repo.compuerta) }) }
	t.Cleanup(liberar)

	pedir(e, h, "c0@ejemplo.test", "10.0.0.1")
	esperarA(t, "el trabajador toma el primero", func() bool { return e.repo.consultasDeRecuperacion.Load() == 1 })
	for i := 1; i <= 4; i++ {
		pedir(e, h, fmt.Sprintf("c%d@ejemplo.test", i), fmt.Sprintf("10.0.0.%d", i+1))
	}
	liberar()
	e.svc.Esperar()
	if n := e.repo.consultasDeRecuperacion.Load(); n != 4 {
		t.Fatalf("se atendieron %d pedidos, se esperaban 4 (uno en curso y tres en la cola)", n)
	}
}
