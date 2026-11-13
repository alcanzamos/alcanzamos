package cuenta_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
)

const dia = 24 * time.Hour

// El aviso sale a partir de creada_en + 5 días (120 h): el servicio le pide al repositorio las cuentas creadas hasta
// `ahora − 5 días` (D-203).
func TestElAvisoSaleDesdeElDia5(t *testing.T) {
	e := nuevoEntorno()
	if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	if !e.repo.avisarHasta.Equal(ahoraDePrueba.Add(-5 * dia)) {
		t.Errorf("el aviso se pide para las creadas hasta %v, se esperaba %v", e.repo.avisarHasta, ahoraDePrueba.Add(-5*dia))
	}
}

// S5: {fecha} es el momento real del borrado: lo que llegue más tarde entre creada_en + 7 días y el aviso + 48 horas. El
// aviso que se registra es el de la corrida (el mismo con que se calculó la fecha).
func TestLaFechaDelAvisoEsLaDelBorradoReal(t *testing.T) {
	casos := []struct {
		nombre   string
		creadaEn time.Time
		esperado time.Time
	}{
		{"creada hace 5 días justos: el aviso + 48 h es el 7.º día", ahoraDePrueba.Add(-5 * dia), ahoraDePrueba.Add(48 * time.Hour)},
		{"creada hace 6 días y medio: gana el aviso + 48 h", ahoraDePrueba.Add(-6*dia - 12*time.Hour), ahoraDePrueba.Add(48 * time.Hour)},
		{"creada hace 20 días: gana el aviso + 48 h", ahoraDePrueba.Add(-20 * dia), ahoraDePrueba.Add(48 * time.Hour)},
		{"si creada_en + 7 días fuera después, gana creada_en + 7 días", ahoraDePrueba.Add(-1 * dia), ahoraDePrueba.Add(6 * dia)},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno()
			e.repo.porAvisar = []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: c.creadaEn}}
			if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
				t.Fatal(err)
			}
			enviados := e.correo.Enviados()
			if len(enviados) != 1 || !enviados[0].AvisoDePurga || enviados[0].Destino != "laura@ejemplo.test" || enviados[0].Token != "" {
				t.Fatalf("enviados: %+v", enviados)
			}
			if !enviados[0].BorradoEn.Equal(c.esperado) {
				t.Errorf("el correo dice %v, el borrado real es %v", enviados[0].BorradoEn, c.esperado)
			}
			if en := e.repo.avisadas["p1"]; !en.Equal(ahoraDePrueba) {
				t.Errorf("aviso registrado %v, se esperaba %v", en, ahoraDePrueba)
			}
		})
	}
}

// S2 (2): si el envío falla, no se registra, la tarea no falla y queda un aviso en el registro, sin el correo; la corrida
// siguiente lo reintenta.
func TestSiElEnvioDelAvisoFallaNoSeRegistraYQuedaUnAvisoEnElRegistro(t *testing.T) {
	e := nuevoEntorno()
	e.repo.porAvisar = []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)}}
	e.correo.Error = errors.New("servidor caído")
	if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
		t.Fatalf("un envío fallido no hace fallar la tarea: %v", err)
	}
	if len(e.repo.avisadas) != 0 {
		t.Fatalf("no se debe registrar nada: %v", e.repo.avisadas)
	}
	registro := e.registro.String()
	if !strings.Contains(registro, `"level":"WARN"`) || !strings.Contains(registro, "aviso de purga") || !strings.Contains(registro, "p1") {
		t.Errorf("falta el aviso en el registro, con el id de la cuenta: %s", registro)
	}
	if strings.Contains(registro, "laura") || strings.Contains(registro, "ejemplo.test") {
		t.Errorf("el registro no debe llevar el correo: %s", registro)
	}
	// La corrida siguiente lo reintenta y sale.
	// (el reloj avanza con la corrida: el aviso registra la hora leída antes de enviar, no la del inicio de la corrida)
	e.correo.Error = nil
	e.reloj.T = ahoraDePrueba.Add(15 * time.Minute)
	if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba.Add(15*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if en := e.repo.avisadas["p1"]; !en.Equal(ahoraDePrueba.Add(15 * time.Minute)) {
		t.Errorf("el reintento registra %v", en)
	}
	if n := len(e.correo.Enviados()); n != 1 {
		t.Errorf("salieron %d correos", n)
	}
}

// Una falla de la base al avisar sí es una falla de la tarea.
func TestUnaFallaDeLaBaseAlAvisarEsUnaFallaDeLaTarea(t *testing.T) {
	e := nuevoEntorno()
	e.repo.errAvisar = errors.New("bd caída")
	if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err == nil {
		t.Fatal("se esperaba el error de la base")
	}
}

// S3: la cuenta del caso 2 que se borra porque el aviso no salió en 14 días deja un ERROR con el id de la cuenta, nunca
// con el correo.
func TestLaCuentaBorradaSinAvisoDejaUnErrorConSuIdYSinCorreo(t *testing.T) {
	e := nuevoEntorno()
	e.repo.resultado = cuenta.ResultadoDeLaPurga{Borradas: 3, SinAviso: []string{"id-1", "id-2"}}
	n, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba)
	if err != nil || n != 3 {
		t.Fatalf("borradas %d, %v", n, err)
	}
	registro := e.registro.String()
	if c := strings.Count(registro, `"level":"ERROR"`); c != 2 {
		t.Errorf("%d líneas de error, se esperaban 2: %s", c, registro)
	}
	for _, id := range []string{"id-1", "id-2"} {
		if !strings.Contains(registro, id) {
			t.Errorf("falta el id %s: %s", id, registro)
		}
	}
	if !strings.Contains(registro, "sin aviso") || !strings.Contains(registro, "14 días") {
		t.Errorf("el error debe decir que se borró sin aviso por el límite de 14 días: %s", registro)
	}
	// Sin cuentas borradas por el límite, no hay errores.
	e2 := nuevoEntorno()
	e2.repo.resultado = cuenta.ResultadoDeLaPurga{Borradas: 1}
	if _, err := e2.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(e2.registro.String(), `"level":"ERROR"`) {
		t.Errorf("sin cuentas borradas por el límite no hay error: %s", e2.registro)
	}
}

// correoQueMira es un correo que guarda el contexto con que le piden el aviso, para ver su plazo.
type correoQueMira struct {
	*correotest.Falso
	mu       sync.Mutex
	limite   time.Time
	hayLimit bool
	inicio   time.Time
}

func (c *correoQueMira) EnviarAvisoDePurga(ctx context.Context, destino string, borradoEn time.Time) error {
	c.mu.Lock()
	c.inicio = time.Now()
	c.limite, c.hayLimit = ctx.Deadline()
	c.mu.Unlock()
	return c.Falso.EnviarAvisoDePurga(ctx, destino, borradoEn)
}

// S4: el envío con las filas bloqueadas tiene un tiempo de espera corto. Sin configurar nada, son 10 segundos: más que
// el diálogo de un servidor sano y mucho menos que el plazo de 30 s del adaptador SMTP, para no tener filas bloqueadas
// mientras el servidor de correo no contesta.
func TestElEnvioDelAvisoTieneUnTiempoDeEsperaCorto(t *testing.T) {
	if cuenta.PlazoDeEnvioConFilasBloqueadas != 10*time.Second {
		t.Fatalf("el plazo del envío con las filas bloqueadas es %v, se esperaban 10 s", cuenta.PlazoDeEnvioConFilasBloqueadas)
	}
	e := nuevoEntorno()
	mira := &correoQueMira{Falso: e.correo}
	e.svc = servicioDe(cuenta.Dependencias{
		Repo: e.repo, Correo: mira, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: e.limitador, Log: e.log(),
	})
	e.repo.porAvisar = []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)}}
	if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	if !mira.hayLimit {
		t.Fatal("el envío del aviso debe llevar un plazo")
	}
	if espera := mira.limite.Sub(mira.inicio); espera > cuenta.PlazoDeEnvioConFilasBloqueadas || espera < cuenta.PlazoDeEnvioConFilasBloqueadas-time.Second {
		t.Errorf("plazo del envío: %v", espera)
	}
}

// El plazo se puede acortar (las pruebas con un servidor que no responde) y el contexto que recibe el correo lo lleva.
func TestElPlazoDelEnvioDelAvisoSeConfigura(t *testing.T) {
	e := nuevoEntorno()
	mira := &correoQueMira{Falso: e.correo}
	e.svc = servicioDe(cuenta.Dependencias{
		Repo: e.repo, Correo: mira, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: e.limitador, Log: e.log(), PlazoDeEnvioConFilasBloqueadas: 250 * time.Millisecond,
	})
	e.repo.porAvisar = []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)}}
	if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
		t.Fatal(err)
	}
	if espera := mira.limite.Sub(mira.inicio); !mira.hayLimit || espera > 250*time.Millisecond {
		t.Errorf("plazo del envío: %v", espera)
	}
}

// verificacionesEnviadas son los correos que salieron a una dirección sin contar el aviso de la purga.
func verificacionesEnviadas(e *entorno) int {
	n := 0
	for _, envio := range e.correo.Enviados() {
		if !envio.AvisoDePurga {
			n++
		}
	}
	return n
}

// L5 (el dueño): el límite de 3 correos por hora a una dirección (D-172 (7)) no mira el aviso de la purga: el aviso no
// pasa por el límite y tampoco suma al contador de la dirección (D-203).
func TestElAvisoDePurgaNoCuentaEnElLimiteDeCorreosPorHora(t *testing.T) {
	cuentaPorAvisar := []cuenta.CuentaPorAvisar{{ID: "p1", Correo: "laura@ejemplo.test", CreadaEn: ahoraDePrueba.Add(-6 * dia)}}

	t.Run("con 3 pedidos en la última hora el aviso sale igual", func(t *testing.T) {
		e := nuevoEntorno()
		for range seguridad.CorreosPorDestino {
			e.pedirYEsperar(t)
		}
		e.pedirYEsperar(t) // el cuarto: el límite de la dirección lo detiene
		if n := verificacionesEnviadas(e); n != seguridad.CorreosPorDestino {
			t.Fatalf("antes del aviso salieron %d correos, se esperaban %d: el límite de la dirección está lleno", n, seguridad.CorreosPorDestino)
		}
		e.repo.porAvisar = cuentaPorAvisar
		if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
			t.Fatal(err)
		}
		avisos := 0
		for _, envio := range e.correo.Enviados() {
			if envio.AvisoDePurga && envio.Destino == "laura@ejemplo.test" {
				avisos++
			}
		}
		if avisos != 1 || e.repo.avisadas["p1"].IsZero() {
			t.Fatalf("con el límite de la dirección lleno el aviso debe salir y quedar registrado: %d avisos, registro %v", avisos, e.repo.avisadas)
		}
		if strings.Contains(e.registro.String(), "límite por dirección") && strings.Contains(e.registro.String(), "aviso de purga") {
			t.Errorf("el aviso no pasa por el límite: %s", e.registro)
		}
		// Y el límite sigue lleno: el aviso no lo abrió.
		e.pedirYEsperar(t)
		if n := verificacionesEnviadas(e); n != seguridad.CorreosPorDestino {
			t.Errorf("tras el aviso salieron %d correos de la persona, se esperaban %d: el aviso no reinicia el límite", n, seguridad.CorreosPorDestino)
		}
	})

	t.Run("después del aviso la persona todavía puede pedir 3", func(t *testing.T) {
		e := nuevoEntorno()
		e.repo.porAvisar = cuentaPorAvisar
		if _, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba); err != nil {
			t.Fatal(err)
		}
		if len(e.correo.Enviados()) != 1 || !e.correo.Enviados()[0].AvisoDePurga {
			t.Fatalf("debía salir el aviso: %+v", e.correo.Enviados())
		}
		for range seguridad.CorreosPorDestino {
			e.pedirYEsperar(t)
		}
		if n := verificacionesEnviadas(e); n != seguridad.CorreosPorDestino {
			t.Fatalf("después del aviso la persona pidió %d veces y salieron %d correos: el aviso sumó al contador de la dirección", seguridad.CorreosPorDestino, n)
		}
		e.pedirYEsperar(t) // el cuarto sí queda detenido
		if n := verificacionesEnviadas(e); n != seguridad.CorreosPorDestino {
			t.Errorf("el cuarto pedido de la hora no sale: salieron %d", n)
		}
	})
}
