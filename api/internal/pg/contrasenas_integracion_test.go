//go:build integration

// Pruebas de integración de la recuperación del acceso y del cambio de contraseña contra PostgreSQL (PR 8 de la
// US-49). Solo datos sintéticos.
package pg

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
)

const claveNueva = "otra frase larga y rara 2027"

// cuentaLista crea una cuenta verificada y autorizada, y devuelve su persona.
func (e *entornoDeAcceso) cuentaLista(t *testing.T, correo string) string {
	t.Helper()
	e.crear(t, correo)
	persona := personaDe(t, e.entorno, correo)
	verificar(t, e.pool, persona)
	otorgar(t, e.pool, persona, persona, "cuenta_y_acceso")
	otorgar(t, e.pool, persona, persona, "funciones_financieras")
	return persona
}

func (e *entornoDeAcceso) estado(token string) int {
	return e.llamar("GET", "/api/v1/cuentas/estado", "", token).Code
}

func (e *entornoDeAcceso) pedirEnlace(t *testing.T, correo string) {
	t.Helper()
	rr := e.llamar("POST", "/api/v1/recuperacion", `{"correo":"`+correo+`"}`, "")
	e.svc.Esperar()
	e.aut.Esperar()
	if rr.Code != 202 {
		t.Fatalf("pedir el enlace: %d %s", rr.Code, rr.Body)
	}
}

func (e *entornoDeAcceso) ultimoEnlaceDeRecuperacion(t *testing.T) string {
	t.Helper()
	env := e.correo.Enviados()
	if len(env) == 0 || !env[len(env)-1].Recuperacion {
		t.Fatalf("el último correo no es de recuperación: %+v", env)
	}
	return env[len(env)-1].Token
}

func (e *entornoDeAcceso) fijar(token, clave string) (int, string) {
	rr := e.llamar("POST", "/api/v1/recuperacion/contrasena", `{"token":"`+token+`","contrasena":"`+clave+`"}`, "")
	return rr.Code, strings.TrimSpace(rr.Body.String())
}

func (e *entornoDeAcceso) entrarCon(correo, clave string) int {
	return e.llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+clave+`"}`, "").Code
}

// RF-036: el enlace de 1 hora y un solo uso fija la contraseña nueva y borra TODAS las sesiones de la persona, en una
// transacción; no inicia sesión.
func TestRecuperarElAccesoCierraTodasLasSesiones(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	persona := e.cuentaLista(t, "laura@ejemplo.test")
	a, b, c := e.entrar(t, "laura@ejemplo.test"), e.entrar(t, "laura@ejemplo.test"), e.entrar(t, "laura@ejemplo.test")
	for _, tok := range []string{a, b, c} {
		if e.estado(tok) != 200 {
			t.Fatal("las tres sesiones sirven antes de recuperar")
		}
	}

	e.pedirEnlace(t, "laura@ejemplo.test")
	enlace := e.ultimoEnlaceDeRecuperacion(t)
	var proposito string
	var vence time.Time
	if err := e.pool.QueryRow(context.Background(),
		`SELECT proposito, vence_en FROM enlace_un_uso WHERE hash_token = $1`, huella(t, enlace)).Scan(&proposito, &vence); err != nil || proposito != "recuperacion" || !vence.Equal(ahora.Add(time.Hour)) {
		t.Fatalf("enlace guardado: %q vence %v (%v)", proposito, vence, err)
	}

	rr := e.llamar("POST", "/api/v1/recuperacion/contrasena", `{"token":"`+enlace+`","contrasena":"`+claveNueva+`"}`, "")
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"contrasena_cambiada"}` || len(rr.Result().Cookies()) != 0 {
		t.Fatalf("fijar: %d %s %v", rr.Code, rr.Body, rr.Header())
	}
	for _, tok := range []string{a, b, c} {
		if e.estado(tok) != 401 {
			t.Error("recuperar cierra todas las sesiones, la actual y las demás")
		}
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n != 0 {
		t.Errorf("quedan %d sesiones", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE hash_token = $1 AND usado_en IS NOT NULL`, huella(t, enlace)); n != 1 {
		t.Error("el enlace queda usado")
	}
	if code, body := e.fijar(enlace, "una frase distinta de las anteriores 99"); code != 400 || body != `{"error":"enlace_invalido"}` {
		t.Errorf("un solo uso: %d %s", code, body)
	}
	if e.entrarCon("laura@ejemplo.test", contrasenaDePrueba) != 401 {
		t.Error("la contraseña vieja ya no sirve")
	}
	if e.entrarCon("laura@ejemplo.test", claveNueva) != 200 {
		t.Error("la nueva sí")
	}
}

func TestElEnlaceDeRecuperacionVenceALaHora(t *testing.T) {
	for nombre, avance := range map[string]time.Duration{"justo antes": time.Hour - time.Second, "a la hora": time.Hour} {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntornoDeAcceso(t)
			e.cuentaLista(t, "laura@ejemplo.test")
			e.pedirEnlace(t, "laura@ejemplo.test")
			enlace := e.ultimoEnlaceDeRecuperacion(t)
			e.reloj.T = ahora.Add(avance)
			code, _ := e.fijar(enlace, claveNueva)
			if (avance < time.Hour) != (code == 200) {
				t.Errorf("tras %v: %d", avance, code)
			}
		})
	}
}

func TestPedirOtroEnlaceDeRecuperacionInvalidaLosPendientes(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.cuentaLista(t, "laura@ejemplo.test")
	e.pedirEnlace(t, "laura@ejemplo.test")
	viejo := e.ultimoEnlaceDeRecuperacion(t)
	e.pedirEnlace(t, "laura@ejemplo.test")
	nuevo := e.ultimoEnlaceDeRecuperacion(t)
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE proposito = 'recuperacion' AND usado_en IS NULL`); n != 1 {
		t.Errorf("debe quedar un solo enlace pendiente: %d", n)
	}
	if code, _ := e.fijar(viejo, claveNueva); code != 400 {
		t.Errorf("el anterior ya no sirve: %d", code)
	}
	if code, _ := e.fijar(nuevo, claveNueva); code != 200 {
		t.Errorf("el nuevo sí: %d", code)
	}
}

// Una cuenta sin verificar no recibe enlace (se crea de nuevo, D-141) y una sin cuenta tampoco, con la misma respuesta.
func TestRecuperacionSoloParaCuentasVerificadas(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "pedro@ejemplo.test") // sin verificar
	e.cuentaLista(t, "laura@ejemplo.test")
	antes := len(e.correo.Enviados())
	var vistas []string
	for _, correo := range []string{"pedro@ejemplo.test", "nadie@ejemplo.test", "laura@ejemplo.test"} {
		rr := e.llamar("POST", "/api/v1/recuperacion", `{"correo":"`+correo+`"}`, "")
		e.aut.Esperar()
		vistas = append(vistas, rr.Result().Status+"|"+rr.Body.String())
	}
	if vistas[0] != vistas[1] || vistas[1] != vistas[2] {
		t.Errorf("respuestas distintas: %q", vistas)
	}
	if env := e.correo.Enviados()[antes:]; len(env) != 1 || env[0].Destino != "laura@ejemplo.test" || !env[0].Recuperacion {
		t.Errorf("solo la cuenta verificada recibe el enlace: %+v", env)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE proposito = 'recuperacion'`); n != 1 {
		t.Errorf("enlaces de recuperación guardados: %d", n)
	}
}

// El enlace de verificación no sirve para recuperar la contraseña, ni al revés.
func TestLosEnlacesNoSeIntercambian(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	verificacion := e.correo.Enviados()[0].Token
	if code, body := e.fijar(verificacion, claveNueva); code != 400 || body != `{"error":"enlace_invalido"}` {
		t.Errorf("verificación como recuperación: %d %s", code, body)
	}
	verificar(t, e.pool, personaDe(t, e.entorno, "laura@ejemplo.test"))
	e.pedirEnlace(t, "laura@ejemplo.test")
	recuperacion := e.ultimoEnlaceDeRecuperacion(t)
	if rr := e.llamar("POST", "/api/v1/cuentas/verificacion", `{"token":"`+recuperacion+`"}`, ""); rr.Code != 400 {
		t.Errorf("recuperación como verificación: %d", rr.Code)
	}
}

func TestDosUsosSimultaneosDelEnlaceSoloPasaUno(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.cuentaLista(t, "laura@ejemplo.test")
	e.pedirEnlace(t, "laura@ejemplo.test")
	huellaDelEnlace := huella(t, e.ultimoEnlaceDeRecuperacion(t))
	repo := NuevoAutenticacion(e.pool)
	var ok, invalido int
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := repo.FijarContrasenaConEnlace(context.Background(), huellaDelEnlace, "$argon2id$v=19$m=8,t=1,p=1$prueba$h"+string(rune('a'+i)), ahora)
			mu.Lock()
			defer mu.Unlock()
			switch err {
			case nil:
				ok++
			case cuenta.ErrEnlaceInvalido:
				invalido++
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ok != 1 || invalido != 7 {
		t.Errorf("pasaron %d y se rechazaron %d", ok, invalido)
	}
}

// PN-62: la política se aplica con el correo de la cuenta y el enlace no se gasta.
func TestFijarContrasenaConLaPoliticaNoGastaElEnlace(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.cuentaLista(t, "laura@ejemplo.test")
	e.pedirEnlace(t, "laura@ejemplo.test")
	enlace := e.ultimoEnlaceDeRecuperacion(t)
	if code, body := e.fijar(enlace, "mi clave es laura@ejemplo.test ok"); code != 422 || !strings.Contains(body, `"contrasena":"contrasena_personal"`) {
		t.Errorf("con el correo de la cuenta: %d %s", code, body)
	}
	if e.entrarCon("laura@ejemplo.test", contrasenaDePrueba) != 200 {
		t.Error("la contraseña no cambió")
	}
	if code, _ := e.fijar(enlace, claveNueva); code != 200 {
		t.Errorf("el enlace seguía vigente: %d", code)
	}
}

// RF-065, D-090: tres sesiones, el cambio desde una; las otras dos reciben 401 y la actual sigue.
func TestCambiarLaContrasenaCierraLasOtrasSesionesYConservaLaActual(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	persona := e.cuentaLista(t, "laura@ejemplo.test")
	a, b, c := e.entrar(t, "laura@ejemplo.test"), e.entrar(t, "laura@ejemplo.test"), e.entrar(t, "laura@ejemplo.test")
	// Además de las tres, la de la creación de la cuenta: cuatro sesiones; tras el cambio solo queda la actual.
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n != 4 {
		t.Fatalf("sesiones antes: %d", n)
	}

	rr := e.llamar("POST", "/api/v1/cuenta/contrasena",
		`{"contrasena_actual":"`+contrasenaDePrueba+`","contrasena_nueva":"`+claveNueva+`"}`, b)
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"contrasena_cambiada"}` {
		t.Fatalf("cambiar: %d %s", rr.Code, rr.Body)
	}
	if e.estado(a) != 401 || e.estado(c) != 401 {
		t.Error("las otras sesiones ya no sirven")
	}
	if e.estado(b) != 200 {
		t.Error("la sesión desde la que se cambió sigue abierta")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n != 1 {
		t.Errorf("solo debe quedar la actual: %d", n)
	}
	if e.entrarCon("laura@ejemplo.test", contrasenaDePrueba) != 401 || e.entrarCon("laura@ejemplo.test", claveNueva) != 200 {
		t.Error("la contraseña vieja ya no sirve y la nueva sí")
	}
}

func TestCambiarLaContrasenaConLaActualIncorrectaNoCambiaNada(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	persona := e.cuentaLista(t, "laura@ejemplo.test")
	a, b := e.entrar(t, "laura@ejemplo.test"), e.entrar(t, "laura@ejemplo.test")
	var hashAntes string
	if err := e.pool.QueryRow(context.Background(), `SELECT hash FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&hashAntes); err != nil {
		t.Fatal(err)
	}
	rr := e.llamar("POST", "/api/v1/cuenta/contrasena", `{"contrasena_actual":"no es esa contraseña","contrasena_nueva":"`+claveNueva+`"}`, a)
	if rr.Code != 400 || strings.TrimSpace(rr.Body.String()) != `{"error":"contrasena_actual_incorrecta"}` {
		t.Fatalf("%d %s", rr.Code, rr.Body)
	}
	var hashDespues string
	_ = e.pool.QueryRow(context.Background(), `SELECT hash FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&hashDespues)
	if hashAntes != hashDespues || e.estado(b) != 200 {
		t.Error("no cambia el hash ni se cierran sesiones")
	}
	// Cuenta en el mismo límite del inicio de sesión: cuatro fallos más y el sexto intento se frena.
	for range 4 {
		e.llamar("POST", "/api/v1/cuenta/contrasena", `{"contrasena_actual":"no es esa contraseña","contrasena_nueva":"`+claveNueva+`"}`, a)
	}
	if rr := e.llamar("POST", "/api/v1/cuenta/contrasena", `{"contrasena_actual":"`+contrasenaDePrueba+`","contrasena_nueva":"`+claveNueva+`"}`, a); rr.Code != 429 {
		t.Errorf("sexto intento: %d", rr.Code)
	}
	if e.entrarCon("laura@ejemplo.test", contrasenaDePrueba) != 429 {
		t.Error("el inicio de sesión comparte el contador por cuenta")
	}
}

// PN-73 solo para quien tiene la cuenta autorizada: la limitada y la de mentira no llegan.
func TestCambiarLaContrasenaPideLaCuentaAutorizada(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	limitada := e.crear(t, "pedro@ejemplo.test").Token
	body := `{"contrasena_actual":"` + contrasenaDePrueba + `","contrasena_nueva":"` + claveNueva + `"}`
	if rr := e.llamar("POST", "/api/v1/cuenta/contrasena", body, limitada); rr.Code != 403 {
		t.Errorf("limitada: %d", rr.Code)
	}
	if rr := e.llamar("POST", "/api/v1/cuenta/contrasena", body, ""); rr.Code != 401 {
		t.Errorf("sin sesión: %d", rr.Code)
	}
	persona := personaDe(t, e.entorno, "pedro@ejemplo.test")
	verificar(t, e.pool, persona)
	if rr := e.llamar("POST", "/api/v1/cuenta/contrasena", body, limitada); rr.Code != 403 || !strings.Contains(rr.Body.String(), "autorizacion_pendiente") {
		t.Errorf("verificada sin autorizar: %d %s", rr.Code, rr.Body)
	}
}
