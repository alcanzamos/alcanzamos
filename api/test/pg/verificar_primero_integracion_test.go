//go:build integration

// Pruebas de integración de crear una cuenta verificando primero (US-61, D-172, D-174, D-192) con el enrutador, el
// servicio y la base reales: SEG-012 (pre-hijacking), la sesión que no existe hasta guardar la contraseña (PN-74) y las
// tres condiciones del enlace. Solo datos sintéticos.
package pg_test

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

const (
	respuestaDeCrear      = `{"estado":"verificacion_pendiente"}`
	respuestaEnlaceMuerto = `{"error":"enlace_invalido"}`
)

// crearPorAPI es PN-58 por HTTP: pide la verificación del correo, con un origen distinto cada vez para que los límites no
// estorben, y espera a que termine el trabajo en segundo plano.
func (e *entornoDeAcceso) crearPorAPI(t *testing.T, correo string, encabezados ...string) *httptest.ResponseRecorder {
	t.Helper()
	e.pedidos++
	rr := e.llamarDesde(fmt.Sprintf("198.51.100.%d:1", e.pedidos), "POST", "/api/v1/cuentas", `{"correo":"`+correo+`","mayor_de_edad":true}`, "", encabezados...)
	e.svc.Esperar()
	return rr
}

// reenviarPorAPI es «Reenviar el correo» de PN-59 por HTTP.
func (e *entornoDeAcceso) reenviarPorAPI(t *testing.T, correo string) *httptest.ResponseRecorder {
	t.Helper()
	e.pedidos++
	rr := e.llamarDesde(fmt.Sprintf("198.51.100.%d:1", e.pedidos), "POST", "/api/v1/cuentas/verificacion/reenvio", `{"correo":"`+correo+`"}`, "")
	e.svc.Esperar()
	return rr
}

// completarPorAPI es PN-74 por HTTP.
func (e *entornoDeAcceso) completarPorAPI(token, clave, nombre string, encabezados ...string) *httptest.ResponseRecorder {
	return e.llamar("POST", "/api/v1/cuentas/verificacion", `{"token":"`+token+`","contrasena":"`+clave+`","nombre":"`+nombre+`"}`, "", encabezados...)
}

// ultimoEnlace es el token del último correo de verificación que salió.
func (e *entornoDeAcceso) ultimoEnlace(t *testing.T) string {
	t.Helper()
	enviados := e.correo.Enviados()
	for i := len(enviados) - 1; i >= 0; i-- {
		if enviados[i].Token != "" && !enviados[i].Recuperacion {
			return enviados[i].Token
		}
	}
	t.Fatal("no salió ningún correo de verificación")
	return ""
}

func (e *entornoDeAcceso) contarSesiones(t *testing.T) int {
	t.Helper()
	return contar(t, e.pool, `SELECT count(*) FROM sesion`)
}

// comprobarRechazo exige el estado y el cuerpo exactos de un rechazo, sin `Set-Cookie`, y que la base quede igual.
func comprobarRechazo(t *testing.T, rr *httptest.ResponseRecorder, codigo int, cuerpo string, antes, despues string) {
	t.Helper()
	if rr.Code != codigo || strings.TrimSpace(rr.Body.String()) != cuerpo {
		t.Errorf("respuesta %d %s, se esperaba %d %s", rr.Code, rr.Body, codigo, cuerpo)
	}
	if v := rr.Header().Values("Set-Cookie"); len(v) != 0 {
		t.Errorf("un rechazo no pone cookie: %v", v)
	}
	if antes != despues {
		t.Errorf("un rechazo no cambia nada en la base:\nantes   %s\ndespués %s", antes, despues)
	}
}

// D-172 (1) y (3): crear la cuenta nunca da sesión ni `Set-Cookie`, y no hay sesión hasta que PN-74 guarda la contraseña.
// Antes de eso no se entra con ninguna contraseña, ni con la que la persona piensa elegir, y un enlace con la contraseña
// rechazada tampoco la da.
func TestNoHaySesionHastaGuardarLaContrasena(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	for _, android := range []bool{false, true} {
		correo := fmt.Sprintf("laura%v@ejemplo.test", android)
		var cabeceras []string
		if android {
			cabeceras = []string{"X-Alcanzamos-Cliente", "android"}
		}
		rr := e.crearPorAPI(t, correo, cabeceras...)
		if rr.Code != 202 || strings.TrimSpace(rr.Body.String()) != respuestaDeCrear || len(rr.Header().Values("Set-Cookie")) != 0 {
			t.Fatalf("crear (android %v): %d %s %v", android, rr.Code, rr.Body, rr.Header())
		}
		if e.contarSesiones(t) != 0 {
			t.Fatalf("crear la cuenta no abre ninguna sesión (android %v)", android)
		}
	}
	token := e.ultimoEnlace(t)

	// Sin contraseña no se entra: ni con la que va a elegir.
	antes := e.instantanea(t)
	rr := e.llamar("POST", "/api/v1/sesiones", `{"identificador":"lauratrue@ejemplo.test","contrasena":"`+contrasenaDePrueba+`"}`, "")
	comprobarRechazo(t, rr, 401, `{"error":"credenciales_invalidas"}`, antes, e.instantanea(t))
	if c := e.estado(""); c != 401 {
		t.Errorf("sin sesión: %d", c)
	}

	// El enlace con la contraseña rechazada no da sesión, ni cambia nada.
	antes = e.instantanea(t)
	rr = e.completarPorAPI(token, "corta", "Laura")
	comprobarRechazo(t, rr, 422, `{"campos":{"contrasena":"contrasena_corta"},"error":"validacion"}`, antes, e.instantanea(t))
	rr = e.completarPorAPI(token, "la clave de lauratrue es larga y rara", "Laura")
	comprobarRechazo(t, rr, 422, `{"campos":{"contrasena":"contrasena_personal"},"error":"validacion"}`, antes, e.instantanea(t))
	rr = e.completarPorAPI(token, contrasenaDePrueba, "")
	comprobarRechazo(t, rr, 422, `{"campos":{"nombre":"nombre_vacio"},"error":"validacion"}`, antes, e.instantanea(t))
	if e.contarSesiones(t) != 0 {
		t.Fatal("ningún rechazo abre sesión")
	}

	// Solo al guardar la contraseña empieza la sesión, con la cuenta ya verificada.
	rr = e.completarPorAPI(token, contrasenaDePrueba, "Laura")
	cs := rr.Result().Cookies()
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"activa"}` || len(cs) != 1 {
		t.Fatalf("completar: %d %s %v", rr.Code, rr.Body, rr.Header())
	}
	if e.contarSesiones(t) != 1 || e.estado(cs[0].Value) != 200 {
		t.Errorf("la sesión debe existir y servir: %d sesiones", e.contarSesiones(t))
	}
	if contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE correo = 'lauratrue@ejemplo.test' AND correo_verificado`) != 1 {
		t.Error("el correo queda verificado")
	}
	if e.entrarCon("lauratrue@ejemplo.test", contrasenaDePrueba) != 200 {
		t.Error("con la contraseña elegida ya se entra")
	}
}

// SEG-012 (D-172 (3), pre-hijacking): quien crea una cuenta con el correo de otra persona nunca recibe una sesión ni
// puede fijar la contraseña, y no le quita nada a la dueña: ni antes ni después de que verifique. La cuenta pendiente
// no se borra ni se recrea, y la contraseña la fija solo quien abre el enlace del buzón.
func TestPrehijackingElQueCreaConElCorreoAjenoNuncaEntraNiBloqueaALaDuena(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	const duena = "duena@ejemplo.test"
	const contrasenaDelAtacante = "contraseña del atacante muy larga"

	// El atacante crea la cuenta con el correo ajeno, incluso mandando una contraseña: se rechaza el campo.
	e.pedidos++
	rr := e.llamarDesde("203.0.113.66:1", "POST", "/api/v1/cuentas",
		`{"correo":"`+duena+`","mayor_de_edad":true,"contrasena":"`+contrasenaDelAtacante+`","nombre":"Atacante"}`, "")
	comprobarRechazo(t, rr, 400, `{"error":"solicitud_invalida"}`, "", "")
	if contar(t, e.pool, `SELECT count(*) FROM persona`) != 0 {
		t.Fatal("una solicitud con contraseña no crea nada")
	}
	rr = e.crearPorAPI(t, duena)
	if rr.Code != 202 || len(rr.Header().Values("Set-Cookie")) != 0 || e.contarSesiones(t) != 0 {
		t.Fatalf("el atacante no recibe sesión: %d %v", rr.Code, rr.Header())
	}
	persona := personaDe(t, e.entorno, duena)
	enlaceDelAtacante := e.ultimoEnlace(t) // llega al buzón de la dueña, no al del atacante

	// El atacante no tiene contraseña con que entrar, ni la suya.
	antes := e.instantanea(t)
	rr = e.llamar("POST", "/api/v1/sesiones", `{"identificador":"`+duena+`","contrasena":"`+contrasenaDelAtacante+`"}`, "")
	comprobarRechazo(t, rr, 401, `{"error":"credenciales_invalidas"}`, antes, e.instantanea(t))
	if contar(t, e.pool, `SELECT count(*) FROM credencial`) != 0 {
		t.Error("nadie fijó una contraseña")
	}

	// La dueña pide su propio correo (crear o reenviar): no la bloquea la cuenta pendiente del atacante.
	e.reloj.T = e.reloj.T.Add(time.Minute)
	if rr := e.crearPorAPI(t, duena); rr.Code != 202 {
		t.Fatalf("la dueña crea: %d %s", rr.Code, rr.Body)
	}
	if personaDe(t, e.entorno, duena) != persona || contar(t, e.pool, `SELECT count(*) FROM persona`) != 1 {
		t.Fatal("la cuenta pendiente no se borra ni se recrea")
	}
	enlaceDeLaDuena := e.ultimoEnlace(t)
	// El del atacante dejó de servir y el de la dueña sirve.
	antes = e.instantanea(t)
	comprobarRechazo(t, e.completarPorAPI(enlaceDelAtacante, contrasenaDelAtacante, "Atacante"), 400, respuestaEnlaceMuerto, antes, e.instantanea(t))
	rr = e.completarPorAPI(enlaceDeLaDuena, contrasenaDePrueba, "Laura")
	if rr.Code != 200 || len(rr.Result().Cookies()) != 1 {
		t.Fatalf("la dueña completa su cuenta: %d %s", rr.Code, rr.Body)
	}

	// Después de verificar, el atacante tampoco entra con la suya, y crear de nuevo no cambia la cuenta ni da sesión.
	if e.entrarCon(duena, contrasenaDelAtacante) != 401 {
		t.Error("el atacante no entra con su contraseña")
	}
	antes = e.instantanea(t)
	e.reloj.T = e.reloj.T.Add(time.Minute)
	enviados := len(e.correo.Enviados())
	rr = e.crearPorAPI(t, duena)
	if rr.Code != 202 || len(rr.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("crear con el correo de una cuenta verificada: %d %v", rr.Code, rr.Header())
	}
	if e.instantanea(t) != antes {
		t.Error("crear con el correo de una cuenta verificada no cambia nada en la base")
	}
	if env := e.correo.Enviados()[enviados:]; len(env) != 1 || !env[0].Aviso || env[0].Destino != duena {
		t.Errorf("la dueña recibe el aviso: %+v", env)
	}
	if e.entrarCon(duena, contrasenaDePrueba) != 200 {
		t.Error("la dueña sigue entrando con su contraseña")
	}
}

// D-192 (a): el enlace sirve una sola vez. El segundo uso es el error específico, sin sesión ni cambios, y la contraseña
// que ya se guardó sigue siendo la primera.
func TestElEnlaceSirveUnaSolaVez(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crearPorAPI(t, "laura@ejemplo.test")
	token := e.ultimoEnlace(t)
	if rr := e.completarPorAPI(token, contrasenaDePrueba, "Laura"); rr.Code != 200 {
		t.Fatalf("primer uso: %d %s", rr.Code, rr.Body)
	}
	antes := e.instantanea(t)
	rr := e.completarPorAPI(token, "otra frase larga y rara 2027", "Otra")
	comprobarRechazo(t, rr, 400, respuestaEnlaceMuerto, antes, e.instantanea(t))
	if e.entrarCon("laura@ejemplo.test", "otra frase larga y rara 2027") != 401 || e.entrarCon("laura@ejemplo.test", contrasenaDePrueba) != 200 {
		t.Error("la contraseña es la del primer uso")
	}
}

// D-192 (b): pedir un enlace nuevo invalida el anterior, ya sea creando de nuevo (PN-58) o con «Reenviar» (PN-59). El
// anterior da el error específico, sin sesión ni cambios; el nuevo sirve.
func TestPedirUnEnlaceNuevoInvalidaElAnterior(t *testing.T) {
	pedidos := map[string]func(*testing.T, *entornoDeAcceso){
		"creando de nuevo": func(t *testing.T, e *entornoDeAcceso) { e.crearPorAPI(t, "laura@ejemplo.test") },
		"con Reenviar el correo": func(t *testing.T, e *entornoDeAcceso) {
			if rr := e.reenviarPorAPI(t, "laura@ejemplo.test"); rr.Code != 202 {
				t.Fatalf("reenviar: %d %s", rr.Code, rr.Body)
			}
		},
	}
	for nombre, pedirOtro := range pedidos {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntornoDeAcceso(t)
			e.crearPorAPI(t, "laura@ejemplo.test")
			anterior := e.ultimoEnlace(t)
			e.reloj.T = e.reloj.T.Add(time.Minute) // fuera de la espera corta del reenvío
			pedirOtro(t, e)
			nuevo := e.ultimoEnlace(t)
			if nuevo == anterior {
				t.Fatal("debía salir un enlace nuevo")
			}
			antes := e.instantanea(t)
			comprobarRechazo(t, e.completarPorAPI(anterior, contrasenaDePrueba, "Laura"), 400, respuestaEnlaceMuerto, antes, e.instantanea(t))
			if rr := e.completarPorAPI(nuevo, contrasenaDePrueba, "Laura"); rr.Code != 200 || len(rr.Result().Cookies()) != 1 {
				t.Fatalf("el nuevo sirve: %d %s", rr.Code, rr.Body)
			}
		})
	}
}

// D-192 (c): el enlace sirve 24 horas. A las 24 horas exactas ya no sirve: el error específico, sin sesión ni cambios.
// Un segundo antes todavía sirve.
func TestUnEnlaceVencidoNoSirve(t *testing.T) {
	t.Run("a las 24 horas", func(t *testing.T) {
		e := nuevoEntornoDeAcceso(t)
		e.crearPorAPI(t, "laura@ejemplo.test")
		token := e.ultimoEnlace(t)
		e.reloj.T = e.reloj.T.Add(24 * time.Hour)
		antes := e.instantanea(t)
		comprobarRechazo(t, e.completarPorAPI(token, contrasenaDePrueba, "Laura"), 400, respuestaEnlaceMuerto, antes, e.instantanea(t))
		if e.contarSesiones(t) != 0 {
			t.Error("un enlace vencido no da sesión")
		}
	})
	t.Run("un segundo antes", func(t *testing.T) {
		e := nuevoEntornoDeAcceso(t)
		e.crearPorAPI(t, "laura@ejemplo.test")
		token := e.ultimoEnlace(t)
		e.reloj.T = e.reloj.T.Add(24*time.Hour - time.Second)
		if rr := e.completarPorAPI(token, contrasenaDePrueba, "Laura"); rr.Code != 200 {
			t.Fatalf("a 23 h 59 min 59 s todavía sirve: %d %s", rr.Code, rr.Body)
		}
	})
	t.Run("pedir otro enlace después de vencer", func(t *testing.T) {
		e := nuevoEntornoDeAcceso(t)
		e.crearPorAPI(t, "laura@ejemplo.test")
		e.reloj.T = e.reloj.T.Add(25 * time.Hour)
		e.crearPorAPI(t, "laura@ejemplo.test") // «Pedir otro enlace» lleva a PN-58
		if rr := e.completarPorAPI(e.ultimoEnlace(t), contrasenaDePrueba, "Laura"); rr.Code != 200 {
			t.Fatalf("el enlace nuevo sirve: %d %s", rr.Code, rr.Body)
		}
	})
}

// D-135: la tarea que borra las cuentas sin confirmar a los 7 días sigue funcionando con las cuentas pendientes del flujo
// nuevo (sin credencial ni sesión): se llevan su enlace y su perfil, y no queda rastro.
func TestLaTareaBorraLaCuentaPendienteALosSieteDias(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	e.pendiente(t, "siete@ejemplo.test")
	e.pendiente(t, "seis@ejemplo.test")
	for correo, dias := range map[string]int{"siete@ejemplo.test": 7, "seis@ejemplo.test": 6} {
		if _, err := e.pool.Exec(t.Context(), `UPDATE persona SET creada_en = $1 WHERE id = $2::uuid`,
			ahora.Add(-time.Duration(dias)*24*time.Hour), personaDe(t, e.entorno, correo)); err != nil {
			t.Fatal(err)
		}
	}
	n, err := e.svc.BorrarCuentasSinConfirmar(t.Context(), ahora)
	if err != nil || n != 1 {
		t.Fatalf("borradas %d (%v), se esperaba 1", n, err)
	}
	if contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE correo = 'siete@ejemplo.test'`) != 0 ||
		contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE correo = 'seis@ejemplo.test'`) != 1 {
		t.Error("se borra la de 7 días y se queda la de 6")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso`); n != 1 {
		t.Errorf("enlaces: %d, se esperaba el de la cuenta que se queda", n)
	}
}

// B1 (L6): «Reenviar el correo» no crea cuentas (se saltaría `mayor_de_edad`): con un correo sin cuenta responde 202 con el
// mismo cuerpo que con cuenta, no guarda ninguna fila y no manda ningún enlace.
func TestReenviarConUnCorreoSinCuentaNoCreaNada(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	antes := e.instantanea(t)
	rr := e.reenviarPorAPI(t, "nadie@ejemplo.test")
	if rr.Code != 202 || strings.TrimSpace(rr.Body.String()) != respuestaDeCrear || len(rr.Header().Values("Set-Cookie")) != 0 {
		t.Fatalf("respuesta: %d %s %v", rr.Code, rr.Body, rr.Header())
	}
	if contar(t, e.pool, `SELECT count(*) FROM persona`) != 0 || e.instantanea(t) != antes {
		t.Error("el reenvío no debe crear ninguna fila")
	}
	if len(e.correo.Enviados()) != 0 {
		t.Errorf("no debe salir ningún correo: %+v", e.correo.Enviados())
	}
	// Con cuenta pendiente sí manda un enlace nuevo, y con cuenta verificada, el aviso.
	e.crearPorAPI(t, "laura@ejemplo.test")
	viejo := e.ultimoEnlace(t)
	e.reloj.T = e.reloj.T.Add(time.Minute)
	if rr := e.reenviarPorAPI(t, "laura@ejemplo.test"); rr.Code != 202 || e.ultimoEnlace(t) == viejo {
		t.Errorf("con cuenta pendiente debe salir un enlace nuevo: %d", rr.Code)
	}
}

// A1 (L6): el cuarto pedido de la hora no revoca el enlace vigente (el límite se mira antes de tocar la base).
func TestElCuartoPedidoNoDejaSinEnlaceQueSirva(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	for range 3 {
		e.reloj.T = e.reloj.T.Add(time.Minute)
		e.crearPorAPI(t, "laura@ejemplo.test")
	}
	vigente := e.ultimoEnlace(t)
	e.reloj.T = e.reloj.T.Add(time.Minute)
	antes := e.instantanea(t)
	e.crearPorAPI(t, "laura@ejemplo.test")
	if e.instantanea(t) != antes {
		t.Error("el cuarto pedido no debe tocar la base")
	}
	if rr := e.completarPorAPI(vigente, contrasenaDePrueba, "Laura"); rr.Code != 200 {
		t.Errorf("el último enlace enviado debe servir: %d %s", rr.Code, rr.Body)
	}
}

// A3 (L6): completar la cuenta borra las sesiones previas de la persona, en la misma transacción.
func TestCompletarLaCuentaBorraLasSesionesPrevias(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crearPorAPI(t, "laura@ejemplo.test")
	token := e.ultimoEnlace(t)
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	previa, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(t.Context(), persona, h, ahora); err != nil {
		t.Fatal(err)
	}
	if e.estado(previa) != 200 && e.estado(previa) != 403 {
		t.Fatalf("la sesión sembrada debía existir")
	}
	rr := e.completarPorAPI(token, contrasenaDePrueba, "Laura")
	if rr.Code != 200 {
		t.Fatalf("completar: %d %s", rr.Code, rr.Body)
	}
	if c := e.estado(previa); c != 401 {
		t.Errorf("la sesión previa debe dar 401: %d", c)
	}
	if n := e.contarSesiones(t); n != 1 {
		t.Errorf("solo queda la sesión nueva: %d", n)
	}
}

// Carrera: 8 usos simultáneos del mismo enlace dan exactamente un 200 y siete `enlace_invalido`, con una credencial y una
// sesión.
func TestOchoUsosSimultaneosDelMismoEnlaceSoloPasaUno(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crearPorAPI(t, "laura@ejemplo.test")
	token := e.ultimoEnlace(t)
	var wg sync.WaitGroup
	var mu sync.Mutex
	codigos := map[int]int{}
	for range 8 {
		wg.Go(func() {
			rr := e.completarPorAPI(token, contrasenaDePrueba, "Laura")
			mu.Lock()
			defer mu.Unlock()
			codigos[rr.Code]++
			if rr.Code == 400 && strings.TrimSpace(rr.Body.String()) != respuestaEnlaceMuerto {
				t.Errorf("cuerpo: %s", rr.Body)
			}
		})
	}
	wg.Wait()
	if codigos[200] != 1 || codigos[400] != 7 {
		t.Errorf("códigos: %v", codigos)
	}
	if contar(t, e.pool, `SELECT count(*) FROM credencial`) != 1 || e.contarSesiones(t) != 1 {
		t.Errorf("credenciales %d, sesiones %d", contar(t, e.pool, `SELECT count(*) FROM credencial`), e.contarSesiones(t))
	}
}
