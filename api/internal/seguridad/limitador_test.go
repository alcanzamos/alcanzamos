package seguridad

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
)

var inicio = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

func nuevoLimitadorDePrueba() (*LimitadorDeIntentos, *reloj.Fijo) {
	r := &reloj.Fijo{T: inicio}
	return NuevoLimitadorDeIntentos(r), r
}

// Cada límite se prueba igual: hasta la cifra pasa, el siguiente se frena, no frena a otro, y a los N minutos pasa de nuevo.
func TestLimitesDeIntentos(t *testing.T) {
	casos := []struct {
		nombre  string
		ventana time.Duration
		limite  int
		// intento hace un intento con la cuenta y el origen dados y dice si pasó.
		intento func(l *LimitadorDeIntentos, cuenta, origen string) bool
	}{
		{"ingreso por cuenta", 15 * time.Minute, 5, func(l *LimitadorDeIntentos, c, o string) bool {
			ok := l.PermitirIngreso(c, o)
			if ok {
				l.RegistrarFalloDeIngreso(c, o)
			}
			return ok
		}},
		{"recuperación por cuenta", time.Hour, 3, func(l *LimitadorDeIntentos, c, o string) bool { return l.PermitirRecuperacion(c, o) }},
		{"reenvío por cuenta", time.Hour, 3, func(l *LimitadorDeIntentos, c, o string) bool { return l.PermitirReenvio(c, o) }},
		{"correos por destino", time.Hour, 3, func(l *LimitadorDeIntentos, c, o string) bool { return l.PermitirCorreo(c) }},
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
		intento func(l *LimitadorDeIntentos, cuenta, origen string) bool
	}{
		{"ingreso por origen", 15 * time.Minute, 20, func(l *LimitadorDeIntentos, c, o string) bool {
			ok := l.PermitirIngreso(c, o)
			if ok {
				l.RegistrarFalloDeIngreso(c, o)
			}
			return ok
		}},
		{"recuperación por origen", time.Hour, 20, func(l *LimitadorDeIntentos, c, o string) bool { return l.PermitirRecuperacion(c, o) }},
		{"reenvío por origen", time.Hour, 20, func(l *LimitadorDeIntentos, c, o string) bool { return l.PermitirReenvio(c, o) }},
		{"creación por origen", time.Hour, 20, func(l *LimitadorDeIntentos, c, o string) bool { return l.PermitirCreacion(o) }},
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

func TestIngresoFrenadoNiSiquieraConLaContrasenaCorrecta(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for range FallosPorCuenta {
		l.RegistrarFalloDeIngreso("laura@ejemplo.test", "o1")
	}
	// PermitirIngreso no cuenta nada: preguntar muchas veces no alarga la espera.
	for range 50 {
		if l.PermitirIngreso("laura@ejemplo.test", "o2") {
			t.Fatal("con 5 fallos, el sexto intento se frena")
		}
	}
	r.T = inicio.Add(VentanaDeIngreso)
	if !l.PermitirIngreso("laura@ejemplo.test", "o2") {
		t.Fatal("a los 15 minutos vuelve a dejar entrar")
	}
}

func TestLosFallosVencenUnoAUnoComoVentanaDeslizante(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for i := range FallosPorCuenta {
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
	for range EnlacesPorCuenta {
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
	for i := range EnlacesPorOrigen {
		l.PermitirReenvio(fmt.Sprintf("c%d", i), "o")
	}
	if l.PermitirReenvio("laura", "o") {
		t.Fatal("el origen está lleno")
	}
	// El pedido frenado no gastó nada de la cuenta: desde otro origen todavía tiene sus 3.
	for i := range EnlacesPorCuenta {
		if !l.PermitirReenvio("laura", fmt.Sprintf("otro-%d", i)) {
			t.Fatalf("el pedido %d de la cuenta debía pasar", i+1)
		}
	}
}

func TestLosContadoresSonIndependientesPorFamilia(t *testing.T) {
	l, _ := nuevoLimitadorDePrueba()
	for range EnlacesPorCuenta {
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
	for i := range CorreosPorDestino {
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

func TestLaMemoriaEstaAcotada(t *testing.T) {
	l, r := nuevoLimitadorDePrueba()
	for i := range 5000 {
		l.PermitirCreacion(fmt.Sprintf("origen-%d", i))
		l.PermitirCorreo(fmt.Sprintf("a%d@ejemplo.test", i))
		l.RegistrarFalloDeIngreso(fmt.Sprintf("a%d@ejemplo.test", i), fmt.Sprintf("origen-%d", i))
	}
	if l.claves() == 0 {
		t.Fatal("deberían estar contando")
	}
	// Una clave nunca guarda más instantes que su límite.
	for range 1000 {
		l.PermitirCorreo("a0@ejemplo.test")
		l.PermitirCreacion("origen-0")
		l.RegistrarFalloDeIngreso("a0@ejemplo.test", "origen-0")
	}
	for clave, v := range l.intentos {
		if len(v) > FallosPorOrigen {
			t.Fatalf("la clave %s guarda %d instantes", clave, len(v))
		}
	}
	// Pasada la hora, una sola llamada de cualquier clave barre todo lo vencido, sin que nadie vuelva a tocar esas claves.
	r.T = inicio.Add(VentanaPorHora + intervaloDeBarrido)
	l.PermitirCreacion("otro-origen")
	if n := l.claves(); n != 1 {
		t.Fatalf("quedan %d claves, se esperaba 1", n)
	}
}

func TestLasClavesNoGuardanCorreosNiOrigenesEnClaro(t *testing.T) {
	l, _ := nuevoLimitadorDePrueba()
	l.PermitirCorreo("laura@ejemplo.test")
	l.PermitirCreacion("203.0.113.7")
	for clave := range l.intentos {
		for _, secreto := range []string{"laura", "ejemplo", "203.0.113"} {
			if strings.Contains(clave, secreto) {
				t.Fatalf("la clave %q lleva %q en claro", clave, secreto)
			}
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
	if n := len(pasaron); n != CorreosPorDestino {
		t.Fatalf("pasaron %d, se esperaban %d", n, CorreosPorDestino)
	}
}
