package seguridad_test

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

var inicio = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

func nuevoLimitadorDePrueba() (*seguridad.LimitadorDeIntentos, *relojtest.Fijo) {
	r := &relojtest.Fijo{T: inicio}
	return seguridad.NuevoLimitadorDeIntentos(r), r
}

// Cada límite se prueba igual: hasta la cifra pasa, el siguiente se frena, no frena a otro, y a los N minutos pasa de nuevo.
func TestLimitesDeIntentos(t *testing.T) {
	casos := []struct {
		nombre  string
		ventana time.Duration
		limite  int
		// intento hace un intento con la cuenta y el origen dados y dice si pasó.
		intento func(l *seguridad.LimitadorDeIntentos, cuenta, origen string) bool
	}{
		{"ingreso por cuenta", 15 * time.Minute, 5, func(l *seguridad.LimitadorDeIntentos, c, o string) bool {
			ok := l.PermitirIngreso(c, o)
			if ok {
				l.RegistrarFalloDeIngreso(c, o)
			}
			return ok
		}},
		{"recuperación por cuenta", time.Hour, 3, func(l *seguridad.LimitadorDeIntentos, c, o string) bool { return l.PermitirRecuperacion(c, o) }},
		{"correos por destino", time.Hour, 3, func(l *seguridad.LimitadorDeIntentos, c, o string) bool { return l.PermitirCorreo(c) }},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			l, r := nuevoLimitadorDePrueba()
			// Cada intento desde un origen distinto: solo la cuenta (o el destino) acumula.
			for i := range c.limite {
				if !c.intento(l, "laura@ejemplo.test", fmt.Sprintf("origen-%d", i)) {
					t.Fatalf("el intento %d debía pasar", i+1)
				}
			}
			if c.intento(l, "laura@ejemplo.test", "origen-nuevo") {
				t.Fatalf("el intento %d debía frenarse", c.limite+1)
			}
			if !c.intento(l, "otra@ejemplo.test", "origen-nuevo") {
				t.Fatal("otra cuenta no debe verse afectada")
			}
			// Las mayúsculas y los espacios no evitan el límite.
			if c.intento(l, "  LAURA@ejemplo.test ", "origen-otro") {
				t.Fatal("la misma cuenta con otras mayúsculas debe frenarse")
			}
			r.T = inicio.Add(c.ventana - time.Second)
			if c.intento(l, "laura@ejemplo.test", "origen-x") {
				t.Fatal("un segundo antes de vencer sigue frenado")
			}
			r.T = inicio.Add(c.ventana)
			if !c.intento(l, "laura@ejemplo.test", "origen-y") {
				t.Fatal("al cumplirse la ventana debe pasar de nuevo: es una espera, no un bloqueo")
			}
		})
	}
}

func TestLimitesPorOrigen(t *testing.T) {
	casos := []struct {
		nombre  string
		ventana time.Duration
		limite  int
		intento func(l *seguridad.LimitadorDeIntentos, cuenta, origen string) bool
	}{
		{"ingreso por origen", 15 * time.Minute, 20, func(l *seguridad.LimitadorDeIntentos, c, o string) bool {
			ok := l.PermitirIngreso(c, o)
			if ok {
				l.RegistrarFalloDeIngreso(c, o)
			}
			return ok
		}},
		{"recuperación por origen", time.Hour, 20, func(l *seguridad.LimitadorDeIntentos, c, o string) bool { return l.PermitirRecuperacion(c, o) }},
		{"creación por origen", time.Hour, 20, func(l *seguridad.LimitadorDeIntentos, c, o string) bool { return l.PermitirCreacion(o) }},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			l, r := nuevoLimitadorDePrueba()
			for i := range c.limite {
				if !c.intento(l, fmt.Sprintf("cuenta-%d@ejemplo.test", i), "203.0.113.7") {
					t.Fatalf("el intento %d debía pasar", i+1)
				}
			}
			if c.intento(l, "cuenta-nueva@ejemplo.test", "203.0.113.7") {
				t.Fatalf("el intento %d del mismo origen debía frenarse aunque la cuenta sea otra", c.limite+1)
			}
			if !c.intento(l, "cuenta-nueva@ejemplo.test", "203.0.113.8") {
				t.Fatal("otro origen no debe verse afectado")
			}
			r.T = inicio.Add(c.ventana - time.Second)
			if c.intento(l, "cuenta-nueva@ejemplo.test", "203.0.113.7") {
				t.Fatal("un segundo antes de vencer sigue frenado")
			}
			r.T = inicio.Add(c.ventana)
			if !c.intento(l, "cuenta-nueva@ejemplo.test", "203.0.113.7") {
				t.Fatal("al cumplirse la ventana debe pasar de nuevo")
			}
		})
	}
}

// PN-59: el reenvío tiene, además de las cifras de la recuperación, la espera corta de E14.
func TestReenvioConEsperaCortaYLimiteDeLaHora(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	en := func(d time.Duration) bool {
		r.T = inicio.Add(d)
		return l.PermitirReenvio("laura@ejemplo.test", "o")
	}
	if !en(0) {
		t.Fatal("el primero pasa")
	}
	if en(time.Second) || en(seguridad.EsperaCortaDeReenvio-time.Second) {
		t.Fatal("dentro de la espera corta se frena")
	}
	if !en(seguridad.EsperaCortaDeReenvio) {
		t.Fatal("pasada la espera corta pasa (los frenados no la alargan)")
	}
	if !en(2 * seguridad.EsperaCortaDeReenvio) {
		t.Fatal("el tercero de la hora pasa")
	}
	if en(3 * seguridad.EsperaCortaDeReenvio) {
		t.Fatal("el cuarto de la hora se frena aunque haya pasado la espera corta")
	}
	if en(time.Hour - time.Second) {
		t.Fatal("un segundo antes de que venza el primero sigue frenado")
	}
	if !en(time.Hour) {
		t.Fatal("al vencer el primero hay lugar otra vez")
	}
	if !l.PermitirReenvio("otra@ejemplo.test", "o") {
		t.Fatal("otra cuenta no se ve afectada")
	}
}

func TestReenvioPorOrigenYElTokenDeLaSesionDeMentiraCuentaComoCuenta(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for i := range seguridad.EnlacesPorOrigen {
		if !l.PermitirReenvio(fmt.Sprintf("cuenta-%d", i), "203.0.113.7") {
			t.Fatalf("el pedido %d debía pasar", i+1)
		}
	}
	if l.PermitirReenvio("token-de-mentira", "203.0.113.7") {
		t.Fatal("el origen está lleno")
	}
	if !l.PermitirReenvio("token-de-mentira", "203.0.113.8") {
		t.Fatal("desde otro origen pasa, y ya gastó su espera corta")
	}
	if l.PermitirReenvio("token-de-mentira", "203.0.113.9") {
		t.Fatal("su espera corta vale igual que la de una cuenta real")
	}
	r.T = inicio.Add(time.Hour)
	if !l.PermitirReenvio("cuenta-0", "203.0.113.7") {
		t.Fatal("a la hora vuelve a pasar")
	}
}

func TestIngresoFrenadoNiSiquieraConLaContrasenaCorrecta(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for range seguridad.FallosPorCuenta {
		l.RegistrarFalloDeIngreso("laura@ejemplo.test", "o1")
	}
	// PermitirIngreso no cuenta nada: preguntar muchas veces no alarga la espera.
	for range 50 {
		if l.PermitirIngreso("laura@ejemplo.test", "o2") {
			t.Fatal("con 5 fallos, el sexto intento se frena")
		}
	}
	r.T = inicio.Add(seguridad.VentanaDeIngreso)
	if !l.PermitirIngreso("laura@ejemplo.test", "o2") {
		t.Fatal("a los 15 minutos vuelve a dejar entrar")
	}
}

func TestLosFallosVencenUnoAUnoComoVentanaDeslizante(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for i := range seguridad.FallosPorCuenta {
		r.T = inicio.Add(time.Duration(i) * time.Minute)
		l.RegistrarFalloDeIngreso("laura@ejemplo.test", "o")
	}
	r.T = inicio.Add(10 * time.Minute)
	if l.PermitirIngreso("laura@ejemplo.test", "o") {
		t.Fatal("5 fallos en 15 minutos frenan")
	}
	r.T = inicio.Add(15 * time.Minute) // vence el primero, quedan 4
	if !l.PermitirIngreso("laura@ejemplo.test", "o") {
		t.Fatal("al vencer el primer fallo hay lugar otra vez")
	}
}

func TestUnPedidoFrenadoNoCuentaNiAlargaLaEspera(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for range seguridad.EnlacesPorCuenta {
		l.PermitirRecuperacion("laura@ejemplo.test", "o")
	}
	for i := range 100 {
		r.T = inicio.Add(time.Duration(i) * time.Second)
		if l.PermitirRecuperacion("laura@ejemplo.test", "o") {
			t.Fatal("frenado")
		}
	}
	r.T = inicio.Add(time.Hour)
	if !l.PermitirRecuperacion("laura@ejemplo.test", "o") {
		t.Fatal("una hora después del primero vuelve a pasar: los frenados no cuentan")
	}
}

func TestSoloCuentaSiPasanLosDosLimites(t *testing.T) {
	l, _ := nuevoLimitadorDePrueba()
	// Se llena el origen con otras cuentas.
	for i := range seguridad.EnlacesPorOrigen {
		l.PermitirRecuperacion(fmt.Sprintf("c%d", i), "o")
	}
	if l.PermitirRecuperacion("laura", "o") {
		t.Fatal("el origen está lleno")
	}
	// El pedido frenado no gastó nada de la cuenta: desde otro origen todavía tiene sus 3.
	for i := range seguridad.EnlacesPorCuenta {
		if !l.PermitirRecuperacion("laura", fmt.Sprintf("otro-%d", i)) {
			t.Fatalf("el pedido %d de la cuenta debía pasar", i+1)
		}
	}
}

func TestLosContadoresSonIndependientesPorFamilia(t *testing.T) {
	l, _ := nuevoLimitadorDePrueba()
	for range seguridad.EnlacesPorCuenta {
		l.PermitirRecuperacion("laura@ejemplo.test", "o1")
	}
	if !l.PermitirReenvio("laura@ejemplo.test", "o2") || !l.PermitirCorreo("laura@ejemplo.test") {
		t.Fatal("recuperación, reenvío y correos no comparten contador")
	}
	if !l.PermitirIngreso("laura@ejemplo.test", "o3") {
		t.Fatal("el ingreso tampoco")
	}
}

func TestCorreosSumanDesdeVariosOrigenes(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	// Verificación, reenvío y aviso: el que llama pregunta una vez por correo. El cuarto no sale, sea quien sea el origen.
	for i := range seguridad.CorreosPorDestino {
		if !l.PermitirCorreo("dueno@ejemplo.test") {
			t.Fatalf("el correo %d debía salir", i+1)
		}
	}
	if l.PermitirCorreo("dueno@ejemplo.test") {
		t.Fatal("el cuarto correo en una hora no sale")
	}
	r.T = inicio.Add(time.Hour)
	if !l.PermitirCorreo("dueno@ejemplo.test") {
		t.Fatal("a la hora sale de nuevo")
	}
}

// claveRe reconoce las claves del limitador (familia, «c» de cuenta u «o» de origen, y la huella). El limitador no las
// expone: se leen de la representación de su estado con fmt.
var claveRe = regexp.MustCompile(`[a-z_]+\|[co]\|[0-9a-f]{32}`)

func clavesDe(l *seguridad.LimitadorDeIntentos) []string {
	return claveRe.FindAllString(fmt.Sprintf("%+v", l), -1)
}

func TestLaMemoriaEstaAcotada(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for i := range 5000 {
		l.PermitirCreacion(fmt.Sprintf("origen-%d", i))
		l.PermitirCorreo(fmt.Sprintf("a%d@ejemplo.test", i))
		l.RegistrarFalloDeIngreso(fmt.Sprintf("a%d@ejemplo.test", i), fmt.Sprintf("origen-%d", i))
	}
	if len(clavesDe(l)) == 0 {
		t.Fatal("deberían estar contando")
	}
	// Pasada la hora, una sola llamada de cualquier clave barre todo lo vencido, sin que nadie vuelva a tocar esas claves.
	r.T = inicio.Add(seguridad.VentanaPorHora + time.Minute)
	l.PermitirCreacion("otro-origen")
	if n := len(clavesDe(l)); n != 1 {
		t.Fatalf("quedan %d claves, se esperaba 1", n)
	}
}

// Una clave nunca guarda más instantes que su límite: lo que pasa de ahí ya está frenado y no alarga la espera. Si se
// guardara, el aluvión de la mitad de la ventana seguiría contando cuando vence el primer intento.
func TestLosIntentosFrenadosNoAlarganLaEspera(t *testing.T) {
	casos := []struct {
		nombre  string
		ventana time.Duration
		limite  int
		// intento cuenta un intento de la misma cuenta y el mismo origen y dice si pasó (el de ingreso, si puede seguir).
		intento func(l *seguridad.LimitadorDeIntentos) bool
	}{
		{"correos por destino", time.Hour, seguridad.CorreosPorDestino, func(l *seguridad.LimitadorDeIntentos) bool { return l.PermitirCorreo("a@ejemplo.test") }},
		{"creaciones por origen", time.Hour, seguridad.CreacionesPorOrigen, func(l *seguridad.LimitadorDeIntentos) bool { return l.PermitirCreacion("origen") }},
		{"fallos de ingreso", seguridad.VentanaDeIngreso, seguridad.FallosPorCuenta, func(l *seguridad.LimitadorDeIntentos) bool {
			l.RegistrarFalloDeIngreso("a@ejemplo.test", "origen")
			return l.PermitirIngreso("a@ejemplo.test", "origen")
		}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			l, r := nuevoLimitadorDePrueba()
			for range c.limite {
				c.intento(l)
			}
			r.T = inicio.Add(c.ventana / 2)
			for range 1000 {
				c.intento(l)
			}
			r.T = inicio.Add(c.ventana)
			if !c.intento(l) {
				t.Fatal("al vencer los primeros intentos debería poder volver a intentar")
			}
		})
	}
}

func TestLasClavesNoGuardanCorreosNiOrigenesEnClaro(t *testing.T) {
	l, _ := nuevoLimitadorDePrueba()
	l.PermitirCorreo("laura@ejemplo.test")
	l.PermitirCreacion("203.0.113.7")
	if len(clavesDe(l)) != 2 {
		t.Fatalf("se esperaban 2 claves: %+v", l)
	}
	estado := fmt.Sprintf("%+v", l)
	for _, secreto := range []string{"laura", "ejemplo", "203.0.113"} {
		if strings.Contains(estado, secreto) {
			t.Fatalf("el estado lleva %q en claro: %s", secreto, estado)
		}
	}
}

func TestLimitadorConcurrente(t *testing.T) {
	l, _ := nuevoLimitadorDePrueba()
	var wg sync.WaitGroup
	pasaron := make(chan struct{}, 100)
	for range 100 {
		wg.Go(func() {
			if l.PermitirCorreo("laura@ejemplo.test") {
				pasaron <- struct{}{}
			}
		})
	}
	wg.Wait()
	if n := len(pasaron); n != seguridad.CorreosPorDestino {
		t.Fatalf("pasaron %d, se esperaban %d", n, seguridad.CorreosPorDestino)
	}
}
