package cuenta

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
)

const personaDePrueba = "0192f3c4-0000-7000-8000-000000000001"

var limitada = seguridad.Sujeto{Persona: personaDePrueba}

func TestVerificarCorreoDelServicio(t *testing.T) {
	e := nuevoEntorno()
	token, huella := seguridad.NuevoTokenOpaco()
	persona, err := e.svc.VerificarCorreo(context.Background(), token)
	if err != nil || persona != personaDePrueba || !bytes.Equal(e.repo.huellaVerif, huella) {
		t.Fatalf("persona %q, error %v, huella %x", persona, err, e.repo.huellaVerif)
	}
	for nombre, malo := range map[string]string{"vacío": "", "mal formado": "x", "con relleno": token + "="} {
		e.repo.huellaVerif = nil
		if _, err := e.svc.VerificarCorreo(context.Background(), malo); !errors.Is(err, ErrEnlaceInvalido) || e.repo.huellaVerif != nil {
			t.Errorf("%s: se esperaba ErrEnlaceInvalido sin tocar el repositorio: %v", nombre, err)
		}
	}
	e.repo.errVerif = ErrEnlaceInvalido
	if _, err := e.svc.VerificarCorreo(context.Background(), token); !errors.Is(err, ErrEnlaceInvalido) {
		t.Errorf("enlace vencido o usado: %v", err)
	}
}

func TestReenviarVerificacion(t *testing.T) {
	e := nuevoEntorno()
	e.repo.correoDe = "laura@ejemplo.test"
	if err := e.svc.ReenviarVerificacion(context.Background(), limitada, personaDePrueba, "o1"); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	enviados := e.correo.Enviados()
	if len(e.repo.enlaces) != 1 || e.repo.enlaces[0].persona != personaDePrueba || len(enviados) != 1 || enviados[0].Destino != "laura@ejemplo.test" || enviados[0].Aviso {
		t.Fatalf("enlaces %+v, correos %+v", e.repo.enlaces, enviados)
	}
	if h, _ := seguridad.HuellaDeToken(enviados[0].Token); !bytes.Equal(h, e.repo.enlaces[0].huella) {
		t.Error("el enlace guardado no es el del correo")
	}
	// Dentro de la espera corta: frenado y sin tocar nada.
	if err := e.svc.ReenviarVerificacion(context.Background(), limitada, personaDePrueba, "o1"); !errors.Is(err, ErrDemasiadosIntentos) {
		t.Fatalf("espera corta: %v", err)
	}
	if len(e.repo.enlaces) != 1 {
		t.Error("un reenvío frenado no cambia el enlace")
	}
	// Ya verificada.
	e.reloj.T = ahoraDePrueba.Add(time.Minute)
	e.repo.errEnlace = ErrYaVerificado
	if err := e.svc.ReenviarVerificacion(context.Background(), limitada, personaDePrueba, "o1"); !errors.Is(err, ErrYaVerificado) {
		t.Fatalf("ya verificada: %v", err)
	}
}

func TestReenviarDeLaSesionDeMentiraNoHaceNadaPeroCuentaLosLimites(t *testing.T) {
	e := nuevoEntorno()
	senuelo := seguridad.Sujeto{Senuelo: true}
	if err := e.svc.ReenviarVerificacion(context.Background(), senuelo, "senuelo:abc", "o1"); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	if len(e.repo.enlaces) != 0 || len(e.correo.Enviados()) != 0 {
		t.Fatalf("la sesión de mentira no toca el repositorio ni escribe a nadie: %+v %+v", e.repo.enlaces, e.correo.Enviados())
	}
	if err := e.svc.ReenviarVerificacion(context.Background(), senuelo, "senuelo:abc", "o1"); !errors.Is(err, ErrDemasiadosIntentos) {
		t.Fatalf("la espera corta aplica igual: %v", err)
	}
}

func TestLosReenviosDeLaHoraYElCuartoCorreoAUnaDireccion(t *testing.T) {
	e := nuevoEntorno()
	e.repo.correoDe = "laura@ejemplo.test"
	pasos := []struct {
		avance time.Duration
		quiere error
	}{{0, nil}, {31 * time.Second, nil}, {62 * time.Second, nil}, {93 * time.Second, ErrDemasiadosIntentos}, {time.Hour, nil}}
	for i, p := range pasos {
		e.reloj.T = ahoraDePrueba.Add(p.avance)
		if err := e.svc.ReenviarVerificacion(context.Background(), limitada, personaDePrueba, "o1"); !errors.Is(err, p.quiere) {
			t.Fatalf("paso %d: %v, se esperaba %v", i, err, p.quiere)
		}
	}
	e.svc.Esperar()
	if n := len(e.correo.Enviados()); n != 4 {
		t.Fatalf("salieron %d correos, se esperaban 4 (3 en la primera hora y 1 después)", n)
	}
}

func TestElLimiteDeCorreosPorDireccionNoCambiaLaRespuestaDelReenvio(t *testing.T) {
	e := nuevoEntorno()
	e.repo.correoDe = "laura@ejemplo.test"
	// Se gastan los 3 correos de la hora a esa dirección desde otro lado (verificación, aviso...).
	for range CorreosPorHoraEsperados {
		e.limitador.PermitirCorreo("laura@ejemplo.test")
	}
	if err := e.svc.ReenviarVerificacion(context.Background(), limitada, personaDePrueba, "o1"); err != nil {
		t.Fatalf("la respuesta es la misma aunque no salga el correo: %v", err)
	}
	e.svc.Esperar()
	if len(e.repo.enlaces) != 1 || len(e.correo.Enviados()) != 0 {
		t.Fatalf("el enlace se renueva pero el correo no sale: %+v %+v", e.repo.enlaces, e.correo.Enviados())
	}
}

func TestCambiarCorreoSinVerificar(t *testing.T) {
	e := nuevoEntorno()
	if err := e.svc.CambiarCorreoSinVerificar(context.Background(), limitada, personaDePrueba, "o1", "  Nuevo@Ejemplo.TEST "); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	enviados := e.correo.Enviados()
	if len(e.repo.cambios) != 1 || e.repo.cambios[0].nuevo != "nuevo@ejemplo.test" || e.repo.cambios[0].persona != personaDePrueba ||
		len(enviados) != 1 || enviados[0].Destino != "nuevo@ejemplo.test" || enviados[0].Aviso {
		t.Fatalf("cambios %+v, correos %+v", e.repo.cambios, enviados)
	}
	if h, _ := seguridad.HuellaDeToken(enviados[0].Token); !bytes.Equal(h, e.repo.cambios[0].huella) {
		t.Error("el enlace guardado no es el del correo")
	}
}

func TestCambiarCorreoValidaElCorreoNuevo(t *testing.T) {
	for nombre, c := range map[string]struct{ correo, codigo string }{
		"vacío": {" ", CorreoVacio}, "sin dominio": {"laura@", CorreoInvalido}, "con nombre": {"Laura <l@ejemplo.test>", CorreoInvalido},
	} {
		for _, sujeto := range []seguridad.Sujeto{limitada, {Senuelo: true}} {
			e := nuevoEntorno()
			err := e.svc.CambiarCorreoSinVerificar(context.Background(), sujeto, "cuenta", "o1", c.correo)
			var inv *ErrValidacion
			if !errors.As(err, &inv) || inv.Campos["correo"] != c.codigo || len(e.repo.cambios) != 0 {
				t.Errorf("%s (señuelo=%v): %v", nombre, sujeto.Senuelo, err)
			}
		}
	}
}

// D-141 aplicado al cambio de correo: con el correo de una cuenta verificada el dueño recibe el aviso y a quien pide el
// cambio no le llega nada distinto.
func TestCambiarCorreoAlDeUnaCuentaVerificadaAvisaAlDueno(t *testing.T) {
	e := nuevoEntorno()
	e.repo.verificadas = map[string]bool{"dueno@ejemplo.test": true}
	if err := e.svc.CambiarCorreoSinVerificar(context.Background(), limitada, personaDePrueba, "o1", "dueno@ejemplo.test"); err != nil {
		t.Fatalf("la respuesta no revela nada: %v", err)
	}
	e.svc.Esperar()
	enviados := e.correo.Enviados()
	if len(enviados) != 1 || !enviados[0].Aviso || enviados[0].Destino != "dueno@ejemplo.test" || enviados[0].Token != "" {
		t.Fatalf("debe llegar solo el aviso al dueño: %+v", enviados)
	}
}

func TestCambiarCorreoYaVerificadaYFallos(t *testing.T) {
	e := nuevoEntorno()
	e.repo.errCambio = ErrYaVerificado
	if err := e.svc.CambiarCorreoSinVerificar(context.Background(), limitada, personaDePrueba, "o1", "nuevo@ejemplo.test"); !errors.Is(err, ErrYaVerificado) {
		t.Fatalf("ya verificada: %v", err)
	}
	e.svc.Esperar()
	if len(e.correo.Enviados()) != 0 {
		t.Error("un cambio rechazado no manda correo")
	}
	e.reloj.T = ahoraDePrueba.Add(time.Minute)
	e.repo.errCambio = errors.New("bd caída")
	if err := e.svc.CambiarCorreoSinVerificar(context.Background(), limitada, personaDePrueba, "o1", "nuevo@ejemplo.test"); err == nil {
		t.Fatal("un fallo sale como fallo")
	}
}

func TestBorrarCuentasSinConfirmarUsaLaReglaDeFinalidades(t *testing.T) {
	e := nuevoEntorno()
	n, err := e.svc.BorrarCuentasSinConfirmar(context.Background(), ahoraDePrueba)
	if err != nil || n != 3 {
		t.Fatalf("borradas %d, %v", n, err)
	}
	if !e.repo.hasta.Equal(ahoraDePrueba.Add(-7*24*time.Hour)) || e.repo.conservar.Format("2006-01-02") != "2029-10-22" {
		t.Errorf("plazos: %v %v", e.repo.hasta, e.repo.conservar)
	}
	if strings.Join(e.repo.necesarias, ",") != "cuenta_y_acceso,funciones_financieras" {
		t.Errorf("las necesarias salen de ReglaDeFinalidades para un adulto: %v", e.repo.necesarias)
	}
}

// --- Las tres acciones de PN-59 y la verificación, por HTTP, con la sesión limitada real y con la de mentira. ---

func llamar(h http.Handler, metodo, ruta, origen, token, cuerpo string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = origen + ":4321"
	if token != "" {
		r.AddCookie(sesion.Cookie(token))
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, r)
	return rr
}

func TestVerificacionPorHTTP(t *testing.T) {
	e := nuevoEntorno()
	h := apiDePrueba(t, e)
	enlace, _ := seguridad.NuevoTokenOpaco()
	conSesion := e.sesionReal(seguridad.Sujeto{Persona: personaDePrueba})
	otraCuenta := e.sesionReal(seguridad.Sujeto{Persona: "0192f3c4-0000-7000-8000-0000000000bb"})
	senuelo := e.senuelos.Crear()
	cuerpo := `{"token":"` + enlace + `"}`
	casos := []struct {
		nombre string
		token  string // de la sesión de la petición
		cuerpo string
		errVer error
		codigo int
		quiere string
	}{
		{"sin sesión (otro dispositivo)", "", cuerpo, nil, 200, `{"con_sesion":false,"estado":"verificado"}`},
		{"con la sesión de la cuenta", conSesion, cuerpo, nil, 200, `{"con_sesion":true,"estado":"verificado"}`},
		{"con la sesión de otra cuenta", otraCuenta, cuerpo, nil, 200, `{"con_sesion":false,"estado":"verificado"}`},
		{"con una sesión de mentira", senuelo, cuerpo, nil, 200, `{"con_sesion":false,"estado":"verificado"}`},
		{"con un token de sesión que no existe", enlace, cuerpo, nil, 200, `{"con_sesion":false,"estado":"verificado"}`},
		{"enlace que ya no sirve", "", cuerpo, ErrEnlaceInvalido, 400, `{"error":"enlace_invalido"}`},
		{"token mal formado", "", `{"token":"x"}`, nil, 400, `{"error":"enlace_invalido"}`},
		{"sin token", "", `{}`, nil, 400, `{"error":"enlace_invalido"}`},
		{"campo desconocido", "", `{"token":"` + enlace + `","otro":1}`, nil, 400, `{"error":"solicitud_invalida"}`},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e.repo.errVerif = c.errVer
			rr := llamar(h, http.MethodPost, "/api/v1/cuentas/verificacion", "203.0.113.7", c.token, c.cuerpo)
			if rr.Code != c.codigo || strings.TrimSpace(rr.Body.String()) != c.quiere {
				t.Fatalf("%d %s, se esperaba %d %s", rr.Code, rr.Body, c.codigo, c.quiere)
			}
		})
	}
}

// accion es una petición de PN-59 que se repite con la sesión limitada real y con la de mentira.
type accion struct {
	metodo, ruta, cuerpo string
	avance               time.Duration // cuánto se adelanta el reloj antes
}

// guion recorre las acciones de PN-59, incluidos los frenos por espera corta, por hora y por origen, y las
// validaciones. La sesión de mentira debe responder en cada paso lo mismo que la limitada real (SEG-013, D-141 (3)).
var guion = []accion{
	{"GET", "/api/v1/cuentas/estado", "", 0},
	{"POST", "/api/v1/cuentas/verificacion/reenvio", "", 0},
	{"POST", "/api/v1/cuentas/verificacion/reenvio", "", 5 * time.Second},                   // espera corta
	{"GET", "/api/v1/cuentas/estado", "", 0},                                                // «Ya lo confirmé» sigue contestando
	{"POST", "/api/v1/cuentas/verificacion/reenvio", "", 40 * time.Second},                  // pasó la espera corta
	{"POST", "/api/v1/cuentas/correo", `{"correo":"nuevo@ejemplo.test"}`, 0},                // tercero de la hora (se cuenta como reenvío)
	{"POST", "/api/v1/cuentas/correo", `{"correo":"otro@ejemplo.test"}`, 40 * time.Second},  // cuarto: 429 por hora
	{"POST", "/api/v1/cuentas/correo", `{"correo":""}`, 0},                                  // frenado antes de validar
	{"POST", "/api/v1/cuentas/correo", `{"correo":"x"}`, time.Hour},                         // pasó la hora: ahora sí valida
	{"POST", "/api/v1/cuentas/correo", `{"correo":"dueno@ejemplo.test"}`, 40 * time.Second}, // el de una cuenta verificada
	{"POST", "/api/v1/cuentas/correo", `{"correo":"nuevo@ejemplo.test","extra":1}`, 40 * time.Second},
	{"POST", "/api/v1/cuentas/correo", `{"correo":`, 0},
	{"POST", "/api/v1/cuentas/verificacion/reenvio", "", 0},
	{"GET", "/api/v1/cuentas/estado", "", 0},
}

type transcripcion struct {
	Codigo    int
	Cabeceras string
	Cuerpo    string
}

func ejecutarGuion(t *testing.T, e *entorno, token string) []transcripcion {
	t.Helper()
	h := apiDePrueba(t, e)
	var sal []transcripcion
	for _, a := range guion {
		e.reloj.T = e.reloj.T.Add(a.avance)
		rr := llamar(h, a.metodo, a.ruta, "203.0.113.7", token, a.cuerpo)
		var nombres []string
		for k := range rr.Header() {
			nombres = append(nombres, k)
		}
		sort.Strings(nombres)
		sal = append(sal, transcripcion{rr.Code, strings.Join(nombres, ","), strings.TrimSpace(rr.Body.String())})
	}
	e.svc.Esperar()
	return sal
}

// SEG-013 y SEG-010: con la sesión de mentira, cada acción de PN-59 (revisar el estado, reenviar, cambiar el correo)
// responde igual que con la sesión limitada de una cuenta real: mismo estado, mismas cabeceras y mismo cuerpo, también
// en los frenos y las validaciones.
func TestLasAccionesDePN59RespondenIgualConLaSesionDeMentira(t *testing.T) {
	real := nuevoEntorno()
	real.repo.correoDe = "laura@ejemplo.test"
	real.repo.verificadas = map[string]bool{"dueno@ejemplo.test": true}
	deLaCuenta := ejecutarGuion(t, real, real.sesionReal(limitada))

	falsa := nuevoEntorno()
	falsa.repo.correoDe = "laura@ejemplo.test"
	falsa.repo.verificadas = map[string]bool{"dueno@ejemplo.test": true}
	deMentira := ejecutarGuion(t, falsa, falsa.senuelos.Crear())

	if len(deLaCuenta) != len(guion) {
		t.Fatalf("faltan respuestas: %d", len(deLaCuenta))
	}
	for i := range guion {
		if deLaCuenta[i] != deMentira[i] {
			t.Errorf("paso %d (%s %s %s): con la cuenta %+v, con la sesión de mentira %+v", i, guion[i].metodo, guion[i].ruta, guion[i].cuerpo, deLaCuenta[i], deMentira[i])
		}
	}
	// El guion no es trivial: pasa por éxitos, el 429 y las validaciones.
	vistos := map[int]bool{}
	for _, r := range deLaCuenta {
		vistos[r.Codigo] = true
	}
	for _, c := range []int{200, 202, 400, 422, 429} {
		if !vistos[c] {
			t.Errorf("el guion no cubre el estado %d: %v", c, vistos)
		}
	}
	// La de mentira no tocó nada; la real sí.
	if len(falsa.repo.enlaces) != 0 || len(falsa.repo.cambios) != 0 || len(falsa.correo.Enviados()) != 0 {
		t.Errorf("la sesión de mentira no toca el repositorio ni manda correos: %+v %+v %+v", falsa.repo.enlaces, falsa.repo.cambios, falsa.correo.Enviados())
	}
	if len(real.repo.enlaces) == 0 || len(real.repo.cambios) == 0 || len(real.correo.Enviados()) == 0 {
		t.Error("la sesión real sí actúa")
	}
	// Con la cuenta verificada del correo nuevo, el aviso llegó al dueño y no a quien pidió el cambio.
	avisos := 0
	for _, env := range real.correo.Enviados() {
		if env.Aviso && env.Destino == "dueno@ejemplo.test" {
			avisos++
		}
	}
	if avisos != 1 {
		t.Errorf("el dueño debía recibir 1 aviso: %+v", real.correo.Enviados())
	}
}

func TestLosFrenosDePN59PorOrigenSonLosMismosParaLasDosSesiones(t *testing.T) {
	for nombre, preparar := range map[string]func(e *entorno) string{
		"limitada real": func(e *entorno) string { return e.sesionReal(limitada) },
		"de mentira":    func(e *entorno) string { return e.senuelos.Crear() },
	} {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntorno()
			e.repo.correoDe = "laura@ejemplo.test"
			h := apiDePrueba(t, e)
			// 20 pedidos del origen, de otras cuentas, llenan su cupo de la hora.
			for i := range 20 {
				e.limitador.PermitirReenvio("otra-"+string(rune('a'+i)), "203.0.113.7")
			}
			rr := llamar(h, http.MethodPost, "/api/v1/cuentas/verificacion/reenvio", "203.0.113.7", preparar(e), "")
			if rr.Code != 429 || strings.TrimSpace(rr.Body.String()) != `{"error":"demasiados_intentos"}` {
				t.Fatalf("%d %s", rr.Code, rr.Body)
			}
		})
	}
}

func TestReenviarDeUnaCuentaYaVerificadaDa409(t *testing.T) {
	e := nuevoEntorno()
	e.repo.errEnlace = ErrYaVerificado
	h := apiDePrueba(t, e)
	token := e.sesionReal(seguridad.Sujeto{Persona: personaDePrueba, Verificada: true})
	if rr := llamar(h, http.MethodGet, "/api/v1/cuentas/estado", "203.0.113.7", token, ""); strings.TrimSpace(rr.Body.String()) != `{"verificada":true}` {
		t.Fatalf("estado: %d %s", rr.Code, rr.Body)
	}
	rr := llamar(h, http.MethodPost, "/api/v1/cuentas/verificacion/reenvio", "203.0.113.7", token, "")
	if rr.Code != 409 || strings.TrimSpace(rr.Body.String()) != `{"error":"ya_verificada"}` {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
}

func TestLasAccionesDePN59ExigenSesion(t *testing.T) {
	h := apiDePrueba(t, nuevoEntorno())
	for _, a := range guion[:2] {
		if rr := llamar(h, a.metodo, a.ruta, "203.0.113.7", "", a.cuerpo); rr.Code != 401 {
			t.Errorf("%s %s sin sesión: %d", a.metodo, a.ruta, rr.Code)
		}
	}
}
