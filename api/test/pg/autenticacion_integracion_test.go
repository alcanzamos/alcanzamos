//go:build integration

// Pruebas de integración del inicio y cierre de sesión y del ingreso anterior contra PostgreSQL (PR 7 de la US-49).
// Solo datos sintéticos.
package pg_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

var (
	parametrosVigentes = argon2id.Parametros{MemoriaKiB: 16, Iteraciones: 2, Paralelismo: 1}
	parametrosViejos   = argon2id.Parametros{MemoriaKiB: 8, Iteraciones: 1, Paralelismo: 1}
)

// entornoDeAcceso arma el API real (cuentas, autenticación, enrutador) sobre una base propia, con Argon2id de verdad
// pero de costo mínimo: m=16 KiB, t=2 (`parametrosVigentes`), para que `parametrosViejos` (el mínimo que acepta el
// formato: m=8, t=1) queden por debajo.
type entornoDeAcceso struct {
	*entornoDeCuentas
	aut *autenticacion.Servicio
	api http.Handler
}

// nuevoEntornoDeAcceso arma el API con los trabajadores de la recuperación andando (paran al terminar la prueba).
func nuevoEntornoDeAcceso(t *testing.T) *entornoDeAcceso {
	t.Helper()
	e := nuevoEntornoDeAccesoSinTrabajadores(t)
	e.iniciar(t)
	return e
}

func (e *entornoDeAcceso) iniciar(t *testing.T) {
	t.Helper()
	ctx, cancelar := context.WithCancel(context.Background())
	t.Cleanup(func() { cancelar(); e.aut.Esperar() })
	e.aut.Iniciar(ctx)
}

// nuevoEntornoDeAccesoSinTrabajadores deja los pedidos de recuperación en la cola, para ver qué hace el pedido solo.
func nuevoEntornoDeAccesoSinTrabajadores(t *testing.T) *entornoDeAcceso {
	t.Helper()
	e := &entornoDeAcceso{entornoDeCuentas: nuevoEntornoDeCuentas(t)}
	hasher := argon2id.Nuevo(parametrosVigentes, 4)
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	cuentas := cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: hasher,
		Reloj: e.reloj, Limitador: e.limitador, Senuelos: e.senuelos, Log: log,
	})
	e.svc = cuentas
	var err error
	e.aut, err = autenticacion.NuevoServicio(autenticacion.Dependencias{
		Repo: pg.NuevoAutenticacion(e.pool), Hasher: hasher, Limitador: e.limitador, Reloj: e.reloj,
		Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Log: log,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolutor := sesion.NuevoResolutor(e.sesiones, e.senuelos.Senuelos, e.reloj)
	eventos := seguridad.NuevoRegistro(log)
	enr := servidor.NuevoEnrutador(resolutor, eventos, log)
	cuenta.NuevoHandler(cuentas, resolutor, log).Registrar(enr)
	autenticacion.NuevoHandler(e.aut, eventos, log).Registrar(enr)
	api, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	e.api = servidor.ManejadorConAPI(api)
	return e
}

func (e *entornoDeAcceso) llamar(metodo, ruta, cuerpo, token string, encabezados ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	r.RemoteAddr = "203.0.113.7:1"
	if token != "" {
		r.AddCookie(sesion.Cookie(token))
	}
	for i := 0; i+1 < len(encabezados); i += 2 {
		r.Header.Set(encabezados[i], encabezados[i+1])
	}
	rr := httptest.NewRecorder()
	e.api.ServeHTTP(rr, r)
	return rr
}

// entrar inicia sesión por la API y devuelve el token de la cookie.
func (e *entornoDeAcceso) entrar(t *testing.T, correo string) string {
	t.Helper()
	rr := e.llamar("POST", "/api/v1/sesiones", `{"identificador":"`+correo+`","contrasena":"`+contrasenaDePrueba+`"}`, "")
	cs := rr.Result().Cookies()
	if rr.Code != 200 || len(cs) != 1 {
		t.Fatalf("entrar: %d %s %v", rr.Code, rr.Body, rr.Header())
	}
	return cs[0].Value
}

func ingresos(t *testing.T, e *entornoDeAcceso, persona string) (anterior, ultimo *time.Time) {
	t.Helper()
	if err := e.pool.QueryRow(context.Background(),
		`SELECT ingreso_anterior, ultimo_ingreso FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&anterior, &ultimo); err != nil {
		t.Fatal(err)
	}
	return anterior, ultimo
}

// D-134: al iniciar sesión, en la misma transacción que la sesión, `ingreso_anterior = ultimo_ingreso` y
// `ultimo_ingreso = ahora`. En el primer ingreso `ingreso_anterior` queda nulo.
func TestElIngresoAnteriorSeMueveEnLaMismaTransaccionQueLaSesion(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	verificar(t, e.pool, persona)
	otorgar(t, e.pool, persona, persona, "cuenta_y_acceso")
	otorgar(t, e.pool, persona, persona, "funciones_financieras")

	if a, u := ingresos(t, e, persona); a != nil || u != nil {
		t.Fatalf("antes del primer ingreso: %v %v", a, u)
	}
	t1 := ahora.Add(time.Hour)
	e.reloj.T = t1
	tok1 := e.entrar(t, "laura@ejemplo.test")
	a, u := ingresos(t, e, persona)
	if a != nil || u == nil || !u.Equal(t1) {
		t.Fatalf("primer ingreso: anterior %v, último %v", a, u)
	}
	rr := e.llamar("GET", "/api/v1/cuenta/seguridad", "", tok1)
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"ingreso_anterior":null}` {
		t.Errorf("primer ingreso en PN-71: %d %s", rr.Code, rr.Body)
	}

	t2 := t1.Add(26 * time.Hour)
	e.reloj.T = t2
	tok2 := e.entrar(t, "laura@ejemplo.test")
	a, u = ingresos(t, e, persona)
	if a == nil || !a.Equal(t1) || !u.Equal(t2) {
		t.Fatalf("segundo ingreso: anterior %v, último %v", a, u)
	}
	for _, tok := range []string{tok1, tok2} {
		rr = e.llamar("GET", "/api/v1/cuenta/seguridad", "", tok)
		if want := `{"ingreso_anterior":"` + t1.Format(time.RFC3339) + `"}`; rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != want {
			t.Errorf("PN-71: %d %s, se esperaba %s", rr.Code, rr.Body, want)
		}
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n != 3 {
		t.Errorf("la sesión de la creación y las dos de ahora: %d", n)
	}
}

// Si la sesión no se puede guardar, el ingreso no se mueve: es una sola transacción.
func TestUnInicioFallidoNoMueveElIngreso(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	repo := pg.NuevoAutenticacion(e.pool)
	_, huella := seguridad.NuevoTokenOpaco()
	if err := repo.IniciarSesion(context.Background(), persona, huella, ahora, nil); err != nil {
		t.Fatal(err)
	}
	// La misma huella otra vez choca con la clave primaria de sesion: el UPDATE previo se revierte.
	if err := repo.IniciarSesion(context.Background(), persona, huella, ahora.Add(time.Hour), nil); err == nil {
		t.Fatal("se esperaba el choque de la clave primaria")
	}
	if a, u := ingresos(t, e, persona); a != nil || u == nil || !u.Equal(ahora) {
		t.Errorf("el ingreso no debe moverse: anterior %v, último %v", a, u)
	}
}

func TestIniciarSesionPorLaAPI(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	e.crear(t, "pedro@ejemplo.test")
	verificar(t, e.pool, personaDe(t, e.entorno, "laura@ejemplo.test"))

	rr := e.llamar("POST", "/api/v1/sesiones", `{"identificador":" Laura@Ejemplo.test ","contrasena":"`+contrasenaDePrueba+`"}`, "")
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"activa"}` {
		t.Errorf("verificada: %d %s", rr.Code, rr.Body)
	}
	// Cuenta sin verificar: sesión limitada y estado de PN-59; el router la deja en PN-59 y nada más.
	rr = e.llamar("POST", "/api/v1/sesiones", `{"identificador":"pedro@ejemplo.test","contrasena":"`+contrasenaDePrueba+`"}`, "")
	cs := rr.Result().Cookies()
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"estado":"verificacion_pendiente"}` || len(cs) != 1 {
		t.Fatalf("sin verificar: %d %s", rr.Code, rr.Body)
	}
	if c := e.llamar("GET", "/api/v1/cuentas/estado", "", cs[0].Value); c.Code != 200 || strings.TrimSpace(c.Body.String()) != `{"verificada":false}` {
		t.Errorf("PN-59 con la sesión limitada: %d %s", c.Code, c.Body)
	}
	if c := e.llamar("GET", "/api/v1/cuenta/seguridad", "", cs[0].Value); c.Code != 403 {
		t.Errorf("la limitada no llega a PN-71: %d", c.Code)
	}
	// Android: el token en el cuerpo y sirve como Bearer.
	rr = e.llamar("POST", "/api/v1/sesiones", `{"identificador":"laura@ejemplo.test","contrasena":"`+contrasenaDePrueba+`"}`, "", "X-Alcanzamos-Cliente", "android")
	if rr.Code != 200 || len(rr.Result().Cookies()) != 0 || !strings.Contains(rr.Body.String(), `"token"`) {
		t.Fatalf("Android: %d %s %v", rr.Code, rr.Body, rr.Header())
	}
	// Contraseña mal y cuenta que no existe: el mismo 401.
	for _, ident := range []string{"laura@ejemplo.test", "nadie@ejemplo.test"} {
		rr = e.llamar("POST", "/api/v1/sesiones", `{"identificador":"`+ident+`","contrasena":"otra contraseña larga"}`, "")
		if rr.Code != 401 || strings.TrimSpace(rr.Body.String()) != `{"error":"credenciales_invalidas"}` {
			t.Errorf("%s: %d %s", ident, rr.Code, rr.Body)
		}
	}
}

func TestCerrarSesionBorraLaFila(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	verificar(t, e.pool, persona)
	a, b := e.entrar(t, "laura@ejemplo.test"), e.entrar(t, "laura@ejemplo.test")

	rr := e.llamar("DELETE", "/api/v1/sesiones/actual", "", a)
	if rr.Code != 204 || !strings.Contains(rr.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("cerrar: %d %v", rr.Code, rr.Header())
	}
	if c := e.llamar("GET", "/api/v1/cuentas/estado", "", a); c.Code != 401 {
		t.Errorf("la sesión cerrada ya no sirve: %d", c.Code)
	}
	if c := e.llamar("GET", "/api/v1/cuentas/estado", "", b); c.Code != 200 {
		t.Errorf("la otra sesión sigue: %d", c.Code)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE hash_token = $1`, huella(t, a)); n != 0 {
		t.Errorf("la fila debe borrarse: %d", n)
	}
	// Cerrar dos veces: la segunda ya no tiene sesión.
	if c := e.llamar("DELETE", "/api/v1/sesiones/actual", "", a); c.Code != 401 {
		t.Errorf("segundo cierre: %d", c.Code)
	}
}

// D-141: con la sesión de mentira, cerrar sesión responde igual que con la limitada real.
func TestCerrarSesionDeMentiraRespondeIgualQueLaLimitada(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	verificar(t, e.pool, personaDe(t, e.entorno, "laura@ejemplo.test"))
	senuelo := e.crear(t, "laura@ejemplo.test").Token // correo de cuenta verificada: sesión de mentira
	otra := e.crear(t, "otra@ejemplo.test").Token     // limitada real
	vista := func(token string) string {
		rr := e.llamar("DELETE", "/api/v1/sesiones/actual", "", token)
		return rr.Result().Status + "|" + rr.Header().Get("Set-Cookie") + "|" + rr.Body.String()
	}
	if a, b := vista(otra), vista(senuelo); a != b || !strings.HasPrefix(a, "204") {
		t.Errorf("limitada %q, de mentira %q", a, b)
	}
}

func hashGuardado(t *testing.T, e *entornoDeAcceso, persona string) string {
	t.Helper()
	var hash string
	if err := e.pool.QueryRow(context.Background(), `SELECT hash FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	return hash
}

// D-144 (E12 `NecesitaMejora`): al iniciar sesión con un hash de parámetros menores que los vigentes, el hash se vuelve
// a calcular y se guarda con la sesión; la misma contraseña sigue entrando.
func TestIniciarSesionSubeElHashDeParametrosViejos(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	verificar(t, e.pool, persona)
	viejo, err := argon2id.Nuevo(parametrosViejos, 1).Hashear(context.Background(), contrasenaDePrueba)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE credencial SET hash = $2 WHERE persona_id = $1::uuid`, persona, viejo); err != nil {
		t.Fatal(err)
	}

	e.entrar(t, "laura@ejemplo.test")
	nuevo := hashGuardado(t, e, persona)
	if nuevo == viejo || !strings.HasPrefix(nuevo, "$argon2id$v=19$m=16,t=2,p=1$") {
		t.Fatalf("el hash no se actualizó: %s", nuevo)
	}
	hasher := argon2id.Nuevo(parametrosVigentes, 1)
	if ok, err := hasher.Verificar(context.Background(), contrasenaDePrueba, nuevo); err != nil || !ok {
		t.Fatalf("el hash nuevo no verifica la misma contraseña: %v, %v", ok, err)
	}
	if mejora, err := hasher.NecesitaMejora(nuevo); err != nil || mejora {
		t.Errorf("el hash nuevo sigue necesitando mejora: %v, %v", mejora, err)
	}
	// Entra otra vez con la misma contraseña y ya no lo reescribe.
	e.entrar(t, "laura@ejemplo.test")
	if otro := hashGuardado(t, e, persona); otro != nuevo {
		t.Error("con parámetros vigentes el hash no debe reescribirse")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n != 3 {
		t.Errorf("sesiones: %d", n)
	}
}

func TestIniciarSesionConParametrosVigentesNoReescribeElHash(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	verificar(t, e.pool, persona)
	antes := hashGuardado(t, e, persona)
	e.entrar(t, "laura@ejemplo.test")
	if despues := hashGuardado(t, e, persona); despues != antes {
		t.Errorf("el hash cambió: %s → %s", antes, despues)
	}
}

// Si el hash guardado cambió entre la verificación y el guardado (por ejemplo, otra contraseña), el hash nuevo, calculado
// con la contraseña anterior, no lo pisa; la sesión sí se guarda.
func TestLaMejoraDelHashNoPisaUnHashQueCambio(t *testing.T) {
	e := nuevoEntornoDeAcceso(t)
	e.crear(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	actual := hashGuardado(t, e, persona)
	_, huella := seguridad.NuevoTokenOpaco()
	mejora := &autenticacion.MejoraDeHash{Viejo: "$argon2id$otro", Nuevo: "$argon2id$nuevo"}
	if err := pg.NuevoAutenticacion(e.pool).IniciarSesion(context.Background(), persona, huella, ahora, mejora); err != nil {
		t.Fatal(err)
	}
	if h := hashGuardado(t, e, persona); h != actual {
		t.Errorf("el hash cambió: %s", h)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE hash_token = $1`, huella); n != 1 {
		t.Errorf("la sesión no se guardó: %d", n)
	}
}
