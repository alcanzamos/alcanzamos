package autenticacion_test

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

var errAlmacen = errors.New("bd caída: detalle interno que nadie debe ver")

// alFijar arma el pedido de elegir la contraseña con un enlace de recuperación válido; inyectar descompone algo después
// de pedir el enlace, para que el fallo caiga en elegir la contraseña y no en pedirla.
func alFijar(inyectar func(e *entorno)) func(*testing.T, *entorno) *http.Request {
	return func(t *testing.T, e *entorno) *http.Request {
		enlace := enlaceNuevo(t, e)
		inyectar(e)
		return pedido("POST", rutaFijar, `{"token":"`+enlace+`","contrasena":"`+claveNueva+`"}`)(t, e)
	}
}

// Un fallo del almacén o del hash es un 500 `error_interno` sin el texto del error, queda en el registro con su causa y
// no gasta ni guarda nada que no deba (SEG, errores de integración).
func TestUnFalloInternoDaErrorInternoSinDetalle(t *testing.T) {
	token, _ := seguridad.NuevoTokenOpaco()
	autorizada := &seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true}
	casos := []struct {
		nombre   string
		preparar func(e *entorno)
		llamada  func(t *testing.T, e *entorno) *http.Request
		sujeto   *seguridad.Sujeto
		registro string
	}{
		{"iniciar: falla la búsqueda de la cuenta", func(e *entorno) { e.repo.errores = map[string]error{"CredencialPorCorreo": errAlmacen} },
			pedido("POST", rutaSesiones, entrar(correoDePrueba, claveDePrueba)), nil, "no se pudo iniciar la sesión"},
		{"iniciar: falla la verificación del hash", func(e *entorno) { e.hasher.falloVerificar = errAlmacen },
			pedido("POST", rutaSesiones, entrar(correoDePrueba, claveDePrueba)), nil, "no se pudo iniciar la sesión"},
		{"iniciar: falla guardar la sesión", func(e *entorno) { e.repo.errores = map[string]error{"IniciarSesion": errAlmacen} },
			pedido("POST", rutaSesiones, entrar(correoDePrueba, claveDePrueba)), nil, "no se pudo iniciar la sesión"},
		{"cerrar: falla borrar la sesión", func(e *entorno) { e.repo.errores = map[string]error{"CerrarSesion": errAlmacen} },
			pedido("DELETE", "/api/v1/sesiones/actual", "", "Cookie", sesion.NombreDeLaCookie+"="+token), &seguridad.Sujeto{Persona: personaDePrueba}, "no se pudo cerrar la sesión"},
		{"seguridad: falla leer el ingreso anterior", func(e *entorno) { e.repo.errores = map[string]error{"IngresoAnterior": errAlmacen} },
			pedido("GET", "/api/v1/cuenta/seguridad", ""), autorizada, "no se pudo leer el ingreso anterior"},
		{"cambiar: falla leer la cuenta", func(e *entorno) { e.repo.errores = map[string]error{"CredencialDe": errAlmacen} },
			pedido("POST", rutaCambio, cuerpoCambio(claveDePrueba, claveNueva), "Cookie", sesion.NombreDeLaCookie+"="+token), autorizada, "no se pudo cambiar la contraseña"},
		{"cambiar: falla la verificación de la de ahora", func(e *entorno) { e.hasher.falloVerificar = errAlmacen },
			pedido("POST", rutaCambio, cuerpoCambio(claveDePrueba, claveNueva), "Cookie", sesion.NombreDeLaCookie+"="+token), autorizada, "no se pudo cambiar la contraseña"},
		{"cambiar: falla el hash de la nueva", func(e *entorno) { e.hasher.falloHashear = errAlmacen },
			pedido("POST", rutaCambio, cuerpoCambio(claveDePrueba, claveNueva), "Cookie", sesion.NombreDeLaCookie+"="+token), autorizada, "no se pudo cambiar la contraseña"},
		{"cambiar: falla guardar el cambio", func(e *entorno) { e.repo.errores = map[string]error{"CambiarContrasena": errAlmacen} },
			pedido("POST", rutaCambio, cuerpoCambio(claveDePrueba, claveNueva), "Cookie", sesion.NombreDeLaCookie+"="+token), autorizada, "no se pudo cambiar la contraseña"},
		{"cambiar: la sesión actual no trae un token válido", func(e *entorno) {},
			pedido("POST", rutaCambio, cuerpoCambio(claveDePrueba, claveNueva), "Cookie", sesion.NombreDeLaCookie+"=no-es-un-token"), autorizada, "no se pudo cambiar la contraseña"},
		{"fijar: falla el hash de la nueva", nil,
			alFijar(func(e *entorno) { e.hasher.falloHashear = errAlmacen }), nil, "no se pudo fijar la contraseña"},
		{"fijar: falla guardar la contraseña", nil,
			alFijar(func(e *entorno) { e.repo.errores = map[string]error{"FijarContrasenaConEnlace": errAlmacen} }), nil, "no se pudo fijar la contraseña"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			if c.preparar != nil {
				c.preparar(e)
			}
			rr := llamar2(e.api(t, c.sujeto), c.llamada(t, e))
			if rr.Code != 500 || strings.TrimSpace(rr.Body.String()) != `{"error":"error_interno"}` {
				t.Fatalf("%d %s", rr.Code, rr.Body)
			}
			if rr.Header().Get("Set-Cookie") != "" {
				t.Error("un error interno no entrega ni borra la sesión")
			}
			log := e.registro.String()
			if !strings.Contains(log, c.registro) {
				t.Errorf("falta %q en el registro: %s", c.registro, log)
			}
			for _, secreto := range []string{claveDePrueba, claveNueva, "$argon2id$falso$"} {
				if strings.Contains(log+rr.Body.String(), secreto) {
					t.Errorf("el registro o la respuesta llevan %q", secreto)
				}
			}
			if strings.Contains(rr.Body.String(), "detalle interno") {
				t.Error("la respuesta repite el error")
			}
		})
	}
}

// Un cuerpo que no es JSON, con campos de más o con dos documentos es un 400 en cada ruta que lee uno.
func TestLasRutasRechazanCuerposQueNoSonLoQueEsperan(t *testing.T) {
	autorizada := &seguridad.Sujeto{Persona: personaDePrueba, Verificada: true, Autorizada: true}
	for _, ruta := range []string{rutaSesiones, rutaRecuperacion, rutaFijar, rutaCambio} {
		for _, cuerpo := range []string{`{`, `{"otro":1}`, `{}{}`, ``} {
			e := nuevoEntorno(t)
			rr := llamar(e.api(t, autorizada), "POST", ruta, cuerpo, "203.0.113.7")
			if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"solicitud_invalida"}` {
				t.Errorf("%s con %q: %d %s", ruta, cuerpo, rr.Code, rr.Body)
			}
		}
	}
}

// Sin un Hasheador que calcule el hash de relleno el servicio no se arma: iniciaría sesión con un tiempo que delata.
func TestElServicioNoSeArmaSiNoPuedeCalcularElHashDeRelleno(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	e.hasher.falloHashear = errAlmacen
	_, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: e.repo, Hasher: e.hasher, Limitador: e.limitador, Reloj: e.reloj, Correo: e.correo,
		Politica: seguridad.NuevaPoliticaDeContrasena(),
	})
	if err == nil || !errors.Is(err, errAlmacen) || !strings.Contains(err.Error(), "hash de relleno") {
		t.Fatalf("error %v", err)
	}
}

// Sin Log el servicio usa uno que descarta, en vez de fallar al registrar.
func TestElServicioFuncionaSinLog(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	svc, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: e.repo, Hasher: e.hasher, Limitador: e.limitador, Reloj: e.reloj, Correo: e.correo,
		Politica: seguridad.NuevaPoliticaDeContrasena(),
	})
	if err != nil {
		t.Fatal(err)
	}
	e.svc = svc
	e.iniciar(t)
	e.repo.errores = map[string]error{"NuevoEnlaceDeRecuperacion": errAlmacen}
	pedirRecuperacion(e, e.api(t, nil), correoDePrueba, "203.0.113.7") // el trabajador falla y lo registra sin Log: no debe romperse
	if _, err := svc.IniciarSesion(context.Background(), correoDePrueba, "mal", "203.0.113.7"); !errors.Is(err, autenticacion.ErrCredencialesInvalidas) {
		t.Errorf("error %v", err)
	}
}

// Una cuenta sin correo (un menor) cuenta sus intentos por su persona: el mismo límite de D-136, sin mezclarse con otras.
func TestUnaCuentaSinCorreoCuentaSusFallosPorPersona(t *testing.T) {
	const menor = "0192f3c4-0000-7000-8000-000000000004"
	e := nuevoEntorno(t)
	e.repo.cuentas[""] = autenticacion.Credencial{Persona: menor, Hash: prefijoActual + claveDePrueba, Verificada: true}
	sujeto := &seguridad.Sujeto{Persona: menor, Verificada: true, Autorizada: true}
	h := e.api(t, sujeto)
	token, _ := seguridad.NuevoTokenOpaco()
	cambiar := func(actual string) *http.Request {
		return pedido("POST", rutaCambio, cuerpoCambio(actual, claveNueva), "Cookie", sesion.NombreDeLaCookie+"="+token)(t, e)
	}
	for i := range seguridad.FallosPorCuenta {
		if rr := llamar2(h, cambiar("mal")); rr.Code != 400 {
			t.Fatalf("fallo %d: %d %s", i+1, rr.Code, rr.Body)
		}
	}
	if rr := llamar2(h, cambiar(claveDePrueba)); rr.Code != 429 {
		t.Fatalf("tras los fallos: %d %s", rr.Code, rr.Body)
	}
	// La cuenta de otra persona no se ve afectada.
	if c, _ := e.cambiar(t, cuerpoCambio(claveDePrueba, claveNueva), token); c != 200 {
		t.Errorf("otra persona: %d", c)
	}
}

// Si el trabajador no puede guardar el enlace o el correo no sale, lo registra sin la dirección ni el token y sigue
// atendiendo (D-144): la persona lo pide otra vez.
func TestLosFallosDelTrabajadorSeRegistranSinDatosPersonales(t *testing.T) {
	t.Run("no se guarda el enlace", func(t *testing.T) {
		e := nuevoEntorno(t)
		e.repo.errores = map[string]error{"NuevoEnlaceDeRecuperacion": errAlmacen}
		if c, _ := pedirRecuperacion(e, e.api(t, nil), correoDePrueba, "203.0.113.7"); c != 202 {
			t.Fatalf("la respuesta no cambia: %d", c)
		}
		if log := e.registro.String(); !strings.Contains(log, "recuperación: no se pudo guardar el enlace") || strings.Contains(log, correoDePrueba) {
			t.Errorf("registro: %s", log)
		}
		if len(e.correo.Enviados()) != 0 {
			t.Error("sin enlace no sale correo")
		}
	})
	t.Run("no sale el correo", func(t *testing.T) {
		e := nuevoEntorno(t)
		e.correo.Error = errors.New("smtp caído")
		if c, _ := pedirRecuperacion(e, e.api(t, nil), correoDePrueba, "203.0.113.7"); c != 202 {
			t.Fatalf("la respuesta no cambia: %d", c)
		}
		if log := e.registro.String(); !strings.Contains(log, "no se pudo enviar el correo") || strings.Contains(log, correoDePrueba) {
			t.Errorf("registro: %s", log)
		}
	})
}

// registroSeguro es un búfer para el registro de trabajadores que escriben mientras la prueba lee.
type registroSeguro struct {
	mu sync.Mutex
	b  strings.Builder
}

func (r *registroSeguro) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.b.Write(p)
}

func (r *registroSeguro) String() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.b.String()
}

// Al apagar con la cola llena, el trabajo en curso termina y lo que no se alcanzó se descarta con su cuenta en el
// registro (sin colgar a Esperar). Un trabajador atascado y 40 pendientes: al soltarlo, los trabajadores ven el contexto
// cancelado y vacían la cola.
func TestAlApagarSeDescartaLoQueNoSeAlcanzoYSeRegistra(t *testing.T) {
	e := nuevoEntornoSinTrabajadores(t)
	e.repo.compuerta = make(chan struct{})
	registro := &registroSeguro{}
	svc, err := autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: e.repo, Hasher: e.hasher, Limitador: e.limitador, Reloj: e.reloj, Correo: e.correo,
		Politica: seguridad.NuevaPoliticaDeContrasena(), Log: slog.New(slog.NewJSONHandler(registro, nil)),
		TrabajadoresDeRecuperacion: 1, ColaDeRecuperacion: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	e.svc = svc
	h := e.api(t, nil)
	ctx, cancelar := context.WithCancel(context.Background())
	var una sync.Once
	liberar := func() { una.Do(func() { close(e.repo.compuerta) }) }
	t.Cleanup(func() { cancelar(); liberar(); svc.Esperar() })
	svc.Iniciar(ctx)

	pedir(e, h, "c0@ejemplo.test", "10.0.0.1")
	esperarA(t, "el trabajador toma el primero", func() bool { return e.repo.consultasDeRecuperacion.Load() == 1 })
	for i := 1; i <= 40; i++ {
		pedir(e, h, fmt.Sprintf("c%d@ejemplo.test", i), fmt.Sprintf("10.0.0.%d", i+1))
	}
	cancelar()
	liberar()
	svc.Esperar()
	if n := e.repo.consultasDeRecuperacion.Load(); n >= 41 {
		t.Fatalf("se atendieron los 41 pedidos: el apagado no descartó nada")
	}
	// El trabajador registra el descarte justo después de dar por terminados los trabajos: se espera a verlo.
	esperarA(t, "el registro del descarte", func() bool {
		return strings.Contains(registro.String(), "recuperación: trabajos descartados al apagar")
	})
	if rr := pedir(e, h, "c99@ejemplo.test", "10.9.9.9"); rr.codigo != 202 {
		t.Errorf("tras el apagado se responde igual: %d", rr.codigo)
	}
}
