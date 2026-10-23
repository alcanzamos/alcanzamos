//go:build integration

// Pruebas de integración de la verificación del correo, el cambio de correo y las tareas contra PostgreSQL (PR 6 de la
// US-49). Solo datos sintéticos.
package pg

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
)

// Verificación y PN-59.

func TestVerificarCorreo(t *testing.T) {
	ctx := context.Background()
	casos := []struct {
		nombre     string
		avanzar    time.Duration
		repetir    bool // usar el enlace dos veces
		tokenAjeno bool
		verificado bool
		errorEn    int // 0: ninguno; 1: el primer uso; 2: el segundo
	}{
		{"enlace vigente", time.Hour, false, false, true, 0},
		{"justo antes de vencer", 24*time.Hour - time.Second, false, false, true, 0},
		{"vencido", 24*time.Hour + time.Second, false, false, false, 1},
		{"justo al vencer", 24 * time.Hour, false, false, false, 1},
		{"segundo uso", time.Hour, true, false, true, 2},
		{"token que no existe", time.Hour, false, true, false, 1},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntornoDeCuentas(t)
			e.crear(t, "laura@ejemplo.test")
			persona := personaDe(t, e.entorno, "laura@ejemplo.test")
			token := e.correo.Enviados()[0].Token
			if c.tokenAjeno {
				token, _ = seguridad.NuevoTokenOpaco()
			}
			e.reloj.T = ahora.Add(c.avanzar)
			p1, err1 := e.svc.VerificarCorreo(ctx, token)
			var err2 error
			if c.repetir {
				_, err2 = e.svc.VerificarCorreo(ctx, token)
			}
			if (c.errorEn == 1) != errors.Is(err1, cuenta.ErrEnlaceInvalido) || (c.errorEn != 1 && err1 != nil) {
				t.Errorf("primer uso: %v", err1)
			}
			if c.errorEn != 1 && p1 != persona {
				t.Errorf("debe devolver la persona verificada: %q", p1)
			}
			if c.repetir && !errors.Is(err2, cuenta.ErrEnlaceInvalido) {
				t.Errorf("el segundo uso debe fallar: %v", err2)
			}
			if v := contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE correo_verificado`) == 1; v != c.verificado {
				t.Errorf("correo_verificado = %v, se esperaba %v", v, c.verificado)
			}
		})
	}
}

func TestPedirUnEnlaceNuevoInvalidaLosPendientes(t *testing.T) {
	ctx := context.Background()
	e := nuevoEntornoDeCuentas(t)
	e.crear(t, "laura@ejemplo.test")
	viejo := e.correo.Enviados()[0].Token
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")

	e.reloj.T = ahora.Add(time.Minute)
	if err := e.svc.ReenviarVerificacion(ctx, seguridad.Sujeto{Persona: persona}, persona, "o1"); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	enviados := e.correo.Enviados()
	if len(enviados) != 2 || enviados[1].Destino != "laura@ejemplo.test" || enviados[1].Token == viejo {
		t.Fatalf("correos: %+v", enviados)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE usado_en IS NULL`); n != 1 {
		t.Errorf("debe quedar un solo enlace pendiente, hay %d", n)
	}
	if _, err := e.svc.VerificarCorreo(ctx, viejo); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
		t.Errorf("el enlace anterior ya no debe servir: %v", err)
	}
	if _, err := e.svc.VerificarCorreo(ctx, enviados[1].Token); err != nil {
		t.Errorf("el enlace nuevo sí: %v", err)
	}
	e.reloj.T = ahora.Add(10 * time.Minute)
	if err := e.svc.ReenviarVerificacion(ctx, seguridad.Sujeto{Persona: persona}, persona, "o1"); !errors.Is(err, cuenta.ErrYaVerificado) {
		t.Errorf("con el correo ya verificado no se reenvía: %v", err)
	}
}

func correoDe(t *testing.T, pool *pgxpool.Pool, persona string) (string, bool) {
	t.Helper()
	var c string
	var v bool
	if err := pool.QueryRow(context.Background(), `SELECT correo, correo_verificado FROM perfil_adulto WHERE persona_id = $1::uuid`, persona).Scan(&c, &v); err != nil {
		t.Fatal(err)
	}
	return c, v
}

func cambiar(t *testing.T, e *entornoDeCuentas, persona, nuevo string) error {
	t.Helper()
	e.reloj.T = e.reloj.T.Add(time.Minute) // fuera de la espera corta
	err := e.svc.CambiarCorreoSinVerificar(context.Background(), seguridad.Sujeto{Persona: persona}, persona, "o1", nuevo)
	e.svc.Esperar()
	return err
}

func TestCambiarCorreoSinVerificar(t *testing.T) {
	ctx := context.Background()
	t.Run("correo libre: cambia, anula el enlace anterior y manda uno nuevo", func(t *testing.T) {
		e := nuevoEntornoDeCuentas(t)
		e.crear(t, "laura@ejemplo.test")
		persona := personaDe(t, e.entorno, "laura@ejemplo.test")
		viejo := e.correo.Enviados()[0].Token
		if err := cambiar(t, e, persona, " Nuevo@Ejemplo.test "); err != nil {
			t.Fatal(err)
		}
		if c, v := correoDe(t, e.pool, persona); c != "nuevo@ejemplo.test" || v {
			t.Errorf("correo %q verificado %v", c, v)
		}
		enviados := e.correo.Enviados()
		if len(enviados) != 2 || enviados[1].Destino != "nuevo@ejemplo.test" || enviados[1].Aviso {
			t.Fatalf("correos: %+v", enviados)
		}
		if _, err := e.svc.VerificarCorreo(ctx, viejo); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
			t.Errorf("el enlace del correo anterior debe dejar de servir: %v", err)
		}
		if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE usado_en IS NULL`); n != 1 {
			t.Errorf("debe quedar un solo enlace pendiente: %d", n)
		}
		if _, err := e.svc.VerificarCorreo(ctx, enviados[1].Token); err != nil {
			t.Errorf("el enlace nuevo sirve: %v", err)
		}
		if _, v := correoDe(t, e.pool, persona); !v {
			t.Error("al verificar queda el correo nuevo verificado")
		}
	})
	t.Run("el correo de otra cuenta sin verificar: se borra esa y se queda con el correo", func(t *testing.T) {
		e := nuevoEntornoDeCuentas(t)
		e.crear(t, "laura@ejemplo.test")
		e.crear(t, "otra@ejemplo.test")
		persona, otra := personaDe(t, e.entorno, "laura@ejemplo.test"), personaDe(t, e.entorno, "otra@ejemplo.test")
		if err := cambiar(t, e, persona, "OTRA@ejemplo.test"); err != nil {
			t.Fatal(err)
		}
		if c, _ := correoDe(t, e.pool, persona); c != "otra@ejemplo.test" {
			t.Errorf("correo %q", c)
		}
		for tabla, esperado := range map[string]int{"persona": 1, "perfil_adulto": 1, "credencial": 1, "sesion": 1} {
			if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != esperado {
				t.Errorf("%s tiene %d filas, se esperaba %d", tabla, n, esperado)
			}
		}
		if contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, otra) != 0 {
			t.Error("la cuenta pendiente del correo nuevo debía borrarse")
		}
		if enviados := e.correo.Enviados(); len(enviados) != 3 || enviados[2].Aviso || enviados[2].Destino != "otra@ejemplo.test" {
			t.Errorf("la verificación del correo nuevo debía salir: %+v", enviados)
		}
	})
	t.Run("el correo de una cuenta verificada: no cambia nada, avisa al dueño y anula el enlace pendiente", func(t *testing.T) {
		e := nuevoEntornoDeCuentas(t)
		e.crear(t, "laura@ejemplo.test")
		e.crear(t, "dueno@ejemplo.test")
		persona, dueno := personaDe(t, e.entorno, "laura@ejemplo.test"), personaDe(t, e.entorno, "dueno@ejemplo.test")
		verificar(t, e.pool, dueno)
		viejo := e.correo.Enviados()[0].Token
		if err := cambiar(t, e, persona, "dueno@ejemplo.test"); err != nil {
			t.Fatalf("la respuesta no revela nada: %v", err)
		}
		if c, _ := correoDe(t, e.pool, persona); c != "laura@ejemplo.test" {
			t.Errorf("el correo de la cuenta no cambia: %q", c)
		}
		if c, v := correoDe(t, e.pool, dueno); c != "dueno@ejemplo.test" || !v {
			t.Errorf("la cuenta verificada no se toca: %q %v", c, v)
		}
		enviados := e.correo.Enviados()
		if len(enviados) != 3 || !enviados[2].Aviso || enviados[2].Destino != "dueno@ejemplo.test" {
			t.Errorf("el dueño recibe el aviso: %+v", enviados)
		}
		if _, err := e.svc.VerificarCorreo(ctx, viejo); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
			t.Errorf("los enlaces pendientes quedan anulados: %v", err)
		}
	})
	t.Run("el mismo correo: solo renueva el enlace", func(t *testing.T) {
		e := nuevoEntornoDeCuentas(t)
		e.crear(t, "laura@ejemplo.test")
		persona := personaDe(t, e.entorno, "laura@ejemplo.test")
		viejo := e.correo.Enviados()[0].Token
		if err := cambiar(t, e, persona, "LAURA@ejemplo.test"); err != nil {
			t.Fatal(err)
		}
		enviados := e.correo.Enviados()
		if len(enviados) != 2 || enviados[1].Destino != "laura@ejemplo.test" || contar(t, e.pool, `SELECT count(*) FROM persona`) != 1 {
			t.Fatalf("correos %+v", enviados)
		}
		if _, err := e.svc.VerificarCorreo(ctx, viejo); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
			t.Errorf("el enlace anterior ya no sirve: %v", err)
		}
	})
	t.Run("una cuenta ya verificada no cambia de correo", func(t *testing.T) {
		e := nuevoEntornoDeCuentas(t)
		e.crear(t, "laura@ejemplo.test")
		persona := personaDe(t, e.entorno, "laura@ejemplo.test")
		verificar(t, e.pool, persona)
		if err := cambiar(t, e, persona, "nuevo@ejemplo.test"); !errors.Is(err, cuenta.ErrYaVerificado) {
			t.Fatalf("se esperaba ErrYaVerificado: %v", err)
		}
		if c, _ := correoDe(t, e.pool, persona); c != "laura@ejemplo.test" {
			t.Errorf("correo %q", c)
		}
	})
}

// semillaEdad crea una cuenta de la edad dada; si verificada, con el correo confirmado; autorizadas son las finalidades
// otorgadas por la propia persona. Cada cuenta tiene además una sesión.
func (e *entornoDeCuentas) semillaEdad(t *testing.T, correo string, diasDeCreada int, verificada bool, autorizadas ...string) string {
	t.Helper()
	e.crear(t, correo)
	id := personaDe(t, e.entorno, correo)
	if _, err := e.pool.Exec(context.Background(), `UPDATE persona SET creada_en = $1 WHERE id = $2::uuid`, ahora.Add(-time.Duration(diasDeCreada)*24*time.Hour), id); err != nil {
		t.Fatal(err)
	}
	if verificada {
		verificar(t, e.pool, id)
	}
	for _, f := range autorizadas {
		otorgar(t, e.pool, id, id, f)
	}
	return id
}

// DAT-006 (D-135): la tarea con la hora de hoy fija.
func TestBorrarCuentasSinConfirmar(t *testing.T) {
	ctx := context.Background()
	e := nuevoEntornoDeCuentas(t)
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras"}
	e.semillaEdad(t, "sin-confirmar-7@ejemplo.test", 7, false)                           // se borra
	e.semillaEdad(t, "sin-confirmar-6@ejemplo.test", 6, false)                           // se queda: faltan horas
	e.semillaEdad(t, "sin-confirmar-90@ejemplo.test", 90, false)                         // se borra
	e.semillaEdad(t, "confirmada-sin-autorizar-7@ejemplo.test", 7, true)                 // se borra: no autorizó
	e.semillaEdad(t, "confirmada-sin-autorizar-6@ejemplo.test", 6, true)                 // se queda
	e.semillaEdad(t, "autorizada-sin-confirmar-7@ejemplo.test", 7, false, necesarias...) // se borra: no confirmó el correo
	e.semillaEdad(t, "confirmada-y-autorizada-7@ejemplo.test", 7, true, necesarias...)   // nunca
	e.semillaEdad(t, "confirmada-y-autorizada-400@ejemplo.test", 400, true, necesarias...)
	parcial := e.semillaEdad(t, "autorizacion-parcial-7@ejemplo.test", 7, true, "cuenta_y_acceso", "avisos") // se borra: falta funciones_financieras
	// Una confirmada cuya autorización necesaria la dio otra persona no cuenta como autorizada (D-139).
	ajena := e.semillaEdad(t, "autorizada-por-otra-7@ejemplo.test", 7, true, "cuenta_y_acceso")
	otorgar(t, e.pool, ajena, personaDe(t, e.entorno, "confirmada-y-autorizada-7@ejemplo.test"), "funciones_financieras")
	// Una cuenta que pasó de menor a adulta: sin correo, con fecha_de_paso. No es de esta tarea.
	var pasada string
	tx, err := e.pool.Begin(ctx) // el disparador diferido exige persona y perfil en la misma transacción
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Mateo', 'adulta', $1) RETURNING id::text`, ahora.Add(-4000*24*time.Hour)).Scan(&pasada); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO perfil_adulto (persona_id, fecha_de_paso) VALUES ($1::uuid, '2026-10-01')`, pasada); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	enviadosAntes := len(e.correo.Enviados())

	n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora)
	if err != nil || n != 6 {
		t.Fatalf("borradas %d (%v), se esperaban 6", n, err)
	}
	quedan := map[string]bool{}
	filas, err := e.pool.Query(ctx, `SELECT correo FROM perfil_adulto WHERE correo IS NOT NULL`)
	if err != nil {
		t.Fatal(err)
	}
	for filas.Next() {
		var c string
		if err := filas.Scan(&c); err != nil {
			t.Fatal(err)
		}
		quedan[c] = true
	}
	filas.Close()
	for _, c := range []string{"sin-confirmar-6@ejemplo.test", "confirmada-sin-autorizar-6@ejemplo.test", "confirmada-y-autorizada-7@ejemplo.test", "confirmada-y-autorizada-400@ejemplo.test"} {
		if !quedan[c] {
			t.Errorf("%s debía quedarse", c)
		}
	}
	if len(quedan) != 4 {
		t.Errorf("quedan %v", quedan)
	}
	if contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, pasada) != 1 {
		t.Error("la cuenta que pasó de menor a adulta no entra en esta tarea")
	}
	// El CASCADE se lleva lo demás de las cuentas borradas, las sesiones incluidas: quedan las de las 4 que se quedan.
	for tabla, esperado := range map[string]int{"credencial": 4, "enlace_un_uso": 4, "sesion": 4} {
		if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != esperado {
			t.Errorf("%s: %d, se esperaban %d", tabla, n, esperado)
		}
	}
	if len(e.correo.Enviados()) != enviadosAntes {
		t.Error("la tarea no envía ningún correo")
	}
	// La prueba mínima de la autorización parcial queda retirada y con plazo (E13 §7).
	var retirada, conservar time.Time
	if err := e.pool.QueryRow(ctx, `SELECT retirada_en, conservar_hasta FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'cuenta_y_acceso'`, parcial).Scan(&retirada, &conservar); err != nil {
		t.Fatal(err)
	}
	if !retirada.Equal(ahora) || conservar.Format("2006-01-02") != "2029-11-10" {
		t.Errorf("retirada %v, conservar_hasta %v", retirada, conservar)
	}
	// Idempotente: una segunda pasada no encuentra nada.
	if n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora); err != nil || n != 0 {
		t.Errorf("segunda pasada: %d, %v", n, err)
	}
	// Un día después las de 6 días cumplen el plazo; las confirmadas y autorizadas, nunca.
	if n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora.Add(24*time.Hour)); err != nil || n != 2 {
		t.Errorf("un día después: %d, %v; se esperaban 2 (las de 6 días)", n, err)
	}
	if n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora.Add(60*24*time.Hour)); err != nil || n != 0 {
		t.Errorf("a los 60 días las confirmadas y autorizadas siguen: %d, %v", n, err)
	}
	if contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE correo LIKE 'confirmada-y-autorizada%'`) != 2 {
		t.Error("las confirmadas y autorizadas nunca se borran")
	}
}

func TestLimpiarSesionesYEnlaces(t *testing.T) {
	ctx := context.Background()
	e := nuevoEntornoDeCuentas(t)
	id := e.semillaEdad(t, "laura@ejemplo.test", 1, true)
	// La creación dejó una sesión y un enlace vigentes; se parte de una base limpia de ambos.
	if _, err := e.pool.Exec(ctx, `DELETE FROM sesion; DELETE FROM enlace_un_uso`); err != nil {
		t.Fatal(err)
	}
	l := NuevoLimpieza(e.pool)
	sesionDe := func(clave byte, vence time.Time) {
		t.Helper()
		if _, err := e.pool.Exec(ctx,
			`INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en) VALUES ($1, $2::uuid, $3, $3, $4)`,
			bytes.Repeat([]byte{clave}, 32), id, ahora.Add(-48*time.Hour), vence); err != nil {
			t.Fatal(err)
		}
	}
	enlaceDe := func(clave byte, vence time.Time) {
		t.Helper()
		if _, err := e.pool.Exec(ctx,
			`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en) VALUES ($1, $2::uuid, 'recuperacion', $3, $4)`,
			bytes.Repeat([]byte{clave}, 32), id, ahora.Add(-48*time.Hour), vence); err != nil {
			t.Fatal(err)
		}
	}
	sesionDe(1, ahora.Add(-time.Second)) // vencida
	sesionDe(2, ahora)                   // vence justo ahora: todavía no (vence_en < ahora)
	sesionDe(3, ahora.Add(time.Hour))
	enlaceDe(1, ahora.Add(-time.Minute)) // vencido
	enlaceDe(2, ahora.Add(time.Hour))
	s, en, err := l.LimpiarSesionesYEnlaces(ctx, ahora)
	if err != nil || s != 1 || en != 1 {
		t.Fatalf("borradas: %d sesiones, %d enlaces (%v)", s, en, err)
	}
	if contar(t, e.pool, `SELECT count(*) FROM sesion`) != 2 || contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE proposito = 'recuperacion'`) != 1 {
		t.Error("quedaron filas de más o de menos")
	}
	if s, en, err := l.LimpiarSesionesYEnlaces(ctx, ahora); err != nil || s != 0 || en != 0 {
		t.Errorf("segunda pasada: %d, %d, %v", s, en, err)
	}
}

// Prueba de punta a punta con la base: el router real con el almacén real y los señuelos (SEG-010, SEG-013). La sesión
// de la cuenta nueva y la de mentira reciben lo mismo en cada ruta de cada nivel; solo la real cambia al verificar.
func TestPuntaAPuntaConLaCuentaYElEnrutadorYLaBase(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	resolutor := sesion.NuevoResolutor(e.sesiones, e.senuelos.Senuelos, e.reloj)
	enr := servidor.NuevoEnrutador(resolutor, seguridad.NuevoRegistro(log), log)
	cuenta.NuevoHandler(e.svc, resolutor, log).Registrar(enr)
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		servidor.EscribirJSON(w, 200, map[string]string{"estado": "ok"})
	})
	rutas := map[seguridad.NivelDeAcceso]string{
		seguridad.SinVerificar: "/api/v1/prueba/sin-verificar", seguridad.SinAutorizacion: "/api/v1/prueba/sin-autorizacion",
		seguridad.RequiereAutorizacion: "/api/v1/prueba/requiere-autorizacion",
	}
	for nivel, ruta := range rutas {
		enr.Registrar(nivel, "GET "+ruta, ok)
	}
	api, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	h := servidor.ManejadorConAPI(api)

	crear := func(correo string) string {
		t.Helper()
		r := httptest.NewRequest(http.MethodPost, "/api/v1/cuentas",
			strings.NewReader(`{"correo":"`+correo+`","contrasena":"`+contrasenaDePrueba+`","nombre":"Laura","mayor_de_edad":true}`))
		r.RemoteAddr = "203.0.113.7:1"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		e.svc.Esperar()
		cs := rr.Result().Cookies()
		if rr.Code != 202 || len(cs) != 1 {
			t.Fatalf("crear %s: %d %v", correo, rr.Code, rr.Header())
		}
		return cs[0].Value
	}
	pedir := func(ruta, token string) (int, string) {
		r := httptest.NewRequest(http.MethodGet, ruta, nil)
		r.AddCookie(sesion.Cookie(token))
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr.Code, strings.TrimSpace(rr.Body.String())
	}

	real := crear("laura@ejemplo.test")
	verificar(t, e.pool, personaDe(t, e.entorno, "laura@ejemplo.test"))
	// Con el correo de una cuenta verificada, la segunda sesión es de mentira; la de una cuenta nueva, real.
	senuelo := crear("laura@ejemplo.test")
	limitada := crear("otra@ejemplo.test")
	if e.senuelos.creados != 1 {
		t.Fatalf("debía haber una sesión de mentira: %d", e.senuelos.creados)
	}
	if len(real) != len(senuelo) || len(senuelo) != len(limitada) {
		t.Fatal("los tokens deben tener el mismo largo")
	}

	// Las sesiones limitada y de mentira reciben lo mismo en cada ruta (D-138, D-141).
	for nivel, ruta := range rutas {
		c1, b1 := pedir(ruta, limitada)
		c2, b2 := pedir(ruta, senuelo)
		if c1 != c2 || b1 != b2 {
			t.Errorf("%s: la limitada recibe %d %s y la de mentira %d %s", nivel, c1, b1, c2, b2)
		}
	}
	for ruta, esperado := range map[string]int{rutas[seguridad.SinVerificar]: 200, rutas[seguridad.SinAutorizacion]: 403, rutas[seguridad.RequiereAutorizacion]: 403} {
		if c, b := pedir(ruta, senuelo); c != esperado || (esperado == 403 && !strings.Contains(b, "verificacion_pendiente")) {
			t.Errorf("sesión de mentira en %s: %d %s", ruta, c, b)
		}
	}
	// La cuenta verificada (la real de laura) sí llega a sin_autorizacion pero no a requiere_autorizacion.
	if c, _ := pedir(rutas[seguridad.SinAutorizacion], real); c != 200 {
		t.Errorf("verificada en sin_autorizacion: %d", c)
	}
	if c, b := pedir(rutas[seguridad.RequiereAutorizacion], real); c != 403 || !strings.Contains(b, "autorizacion_pendiente") {
		t.Errorf("verificada sin autorizar en requiere_autorizacion: %d %s", c, b)
	}
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	otorgar(t, e.pool, persona, persona, "cuenta_y_acceso")
	otorgar(t, e.pool, persona, persona, "funciones_financieras")
	if c, _ := pedir(rutas[seguridad.RequiereAutorizacion], real); c != 200 {
		t.Errorf("autorizada en requiere_autorizacion: %d", c)
	}
	// La de mentira sigue igual aunque la cuenta de la que imita el correo esté autorizada: no apunta a ella.
	if c, _ := pedir(rutas[seguridad.RequiereAutorizacion], senuelo); c != 403 {
		t.Errorf("la sesión de mentira nunca llega a requiere_autorizacion: %d", c)
	}
	// PN-59: «Ya lo confirmé» responde igual con la sesión limitada real y con la de mentira; la cuenta ya verificada
	// (la sesión «real» de laura) responde que sí.
	llamar := func(metodo, ruta, token, cuerpo string) (int, string) {
		r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
		r.RemoteAddr = "203.0.113.9:1"
		if token != "" {
			r.AddCookie(sesion.Cookie(token))
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr.Code, strings.TrimSpace(rr.Body.String())
	}
	if c, b := llamar("GET", "/api/v1/cuentas/estado", limitada, ""); c != 200 || b != `{"verificada":false}` {
		t.Errorf("estado de la limitada: %d %s", c, b)
	}
	if c, b := llamar("GET", "/api/v1/cuentas/estado", senuelo, ""); c != 200 || b != `{"verificada":false}` {
		t.Errorf("estado de la de mentira: %d %s", c, b)
	}
	if c, b := llamar("GET", "/api/v1/cuentas/estado", real, ""); c != 200 || b != `{"verificada":true}` {
		t.Errorf("estado de la cuenta verificada: %d %s", c, b)
	}
	// Verificar con el enlace de «otra»: sin sesión (otro dispositivo) o con la de esa cuenta.
	enlaceDeOtra := e.correo.Enviados()[len(e.correo.Enviados())-1].Token
	if c, b := llamar("POST", "/api/v1/cuentas/verificacion", "", `{"token":"`+enlaceDeOtra+`"}`); c != 200 || b != `{"con_sesion":false,"estado":"verificado"}` {
		t.Errorf("verificar sin sesión: %d %s", c, b)
	}
	if c, b := llamar("GET", "/api/v1/cuentas/estado", limitada, ""); c != 200 || b != `{"verificada":true}` {
		t.Errorf("la sesión de «otra» ahora es de una cuenta verificada: %d %s", c, b)
	}
	if c, _ := llamar("GET", rutas[seguridad.SinAutorizacion], limitada, ""); c != 200 {
		t.Errorf("y llega a sin_autorizacion: %d", c)
	}
	if c, b := llamar("POST", "/api/v1/cuentas/verificacion", limitada, `{"token":"`+enlaceDeOtra+`"}`); c != 400 || b != `{"error":"enlace_invalido"}` {
		t.Errorf("el enlace ya se usó: %d %s", c, b)
	}
	// Un token que nadie creó no tiene sesión.
	desconocido, _ := seguridad.NuevoTokenOpaco()
	if c, _ := pedir(rutas[seguridad.SinVerificar], desconocido); c != 401 {
		t.Errorf("token desconocido: %d", c)
	}
}

// servidorNuevo arma un servidor de la API sobre la misma base, como al arrancar el proceso: servicio, limitador y
// generador de sesiones de mentira nuevos, y solo la clave en común. Es lo que ve el cliente tras un reinicio o en otra
// réplica (D-143 (2)).
func (e *entornoDeCuentas) servidorNuevo(t *testing.T, clave []byte) (http.Handler, *cuenta.Servicio) {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	senuelos, err := sesion.NuevosSenuelos(clave, e.reloj)
	if err != nil {
		t.Fatal(err)
	}
	svc := cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: seguridad.NuevoLimitadorDeIntentos(e.reloj), Senuelos: senuelos, Log: log,
	})
	resolutor := sesion.NuevoResolutor(e.sesiones, senuelos, e.reloj)
	enr := servidor.NuevoEnrutador(resolutor, seguridad.NuevoRegistro(log), log)
	cuenta.NuevoHandler(svc, resolutor, log).Registrar(enr)
	api, err := enr.Construir()
	if err != nil {
		t.Fatal(err)
	}
	return servidor.ManejadorConAPI(api), svc
}

type respuestaVista struct {
	Codigo    int
	Cabeceras string // nombres, ordenados
	Cuerpo    string
}

// RESTART (D-143 (2)): una sesión de mentira creada por un servidor la reconoce otro, nuevo, con la misma clave, y
// responde en cada acción de PN-59 lo mismo que antes y lo mismo que una sesión limitada real. Con otra clave, no.
func TestLaSesionDeMentiraRespondeIgualTrasUnReinicio(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	clave := bytes.Repeat([]byte{5}, 32)
	antes, svcAntes := e.servidorNuevo(t, clave)

	crear := func(h http.Handler, svc *cuenta.Servicio, correo string) string {
		t.Helper()
		r := httptest.NewRequest(http.MethodPost, "/api/v1/cuentas",
			strings.NewReader(`{"correo":"`+correo+`","contrasena":"`+contrasenaDePrueba+`","nombre":"Laura","mayor_de_edad":true}`))
		r.RemoteAddr = "203.0.113.7:1"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		svc.Esperar()
		cs := rr.Result().Cookies()
		if rr.Code != 202 || len(cs) != 1 {
			t.Fatalf("crear %s: %d %v", correo, rr.Code, rr.Header())
		}
		return cs[0].Value
	}
	guion := func(h http.Handler, token, origen string) []respuestaVista {
		t.Helper()
		pasos := []struct{ metodo, ruta, cuerpo string }{
			{"GET", "/api/v1/cuentas/estado", ""},
			{"POST", "/api/v1/cuentas/verificacion/reenvio", ""},
			{"POST", "/api/v1/cuentas/verificacion/reenvio", ""}, // dentro de la espera corta
			{"POST", "/api/v1/cuentas/correo", `{"correo":"nuevo-` + origen + `@ejemplo.test"}`},
			{"POST", "/api/v1/cuentas/correo", `{"correo":"no es un correo"}`},
			{"GET", "/api/v1/cuentas/estado", ""},
		}
		var vistas []respuestaVista
		for _, p := range pasos {
			r := httptest.NewRequest(p.metodo, p.ruta, strings.NewReader(p.cuerpo))
			r.RemoteAddr = origen + ":4321"
			r.AddCookie(sesion.Cookie(token))
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, r)
			var nombres []string
			for k := range rr.Header() {
				nombres = append(nombres, k)
			}
			sort.Strings(nombres)
			vistas = append(vistas, respuestaVista{rr.Code, strings.Join(nombres, ","), strings.TrimSpace(rr.Body.String())})
		}
		return vistas
	}

	// Cuenta verificada de laura y su sesión de mentira, creada por el servidor «antes»; y una limitada real de otra.
	crear(antes, svcAntes, "laura@ejemplo.test")
	verificar(t, e.pool, personaDe(t, e.entorno, "laura@ejemplo.test"))
	senuelo := crear(antes, svcAntes, "laura@ejemplo.test")
	limitada := crear(antes, svcAntes, "otra@ejemplo.test")

	respuestasAntes := guion(antes, senuelo, "198.51.100.1")
	if respuestasAntes[0].Codigo != 200 || respuestasAntes[0].Cuerpo != `{"verificada":false}` || respuestasAntes[1].Codigo != 202 || respuestasAntes[2].Codigo != 429 {
		t.Fatalf("la sesión de mentira antes del reinicio: %+v", respuestasAntes)
	}

	// «Reinicio»: un servidor nuevo, sin nada en memoria salvo la clave. Y una réplica al mismo tiempo.
	despues, _ := e.servidorNuevo(t, clave)
	replica, _ := e.servidorNuevo(t, clave)
	respuestasDespues := guion(despues, senuelo, "198.51.100.2")
	respuestasReplica := guion(replica, senuelo, "198.51.100.3")
	respuestasReal := guion(despues, limitada, "198.51.100.4")
	for i := range respuestasAntes {
		if respuestasDespues[i] != respuestasAntes[i] || respuestasReplica[i] != respuestasAntes[i] {
			t.Errorf("paso %d: antes %+v, tras el reinicio %+v, en la réplica %+v", i, respuestasAntes[i], respuestasDespues[i], respuestasReplica[i])
		}
	}
	// Salvo el correo nuevo del paso 3, que va en el cuerpo y no en la respuesta, la limitada real responde igual.
	for i := range respuestasAntes {
		if respuestasReal[i] != respuestasDespues[i] {
			t.Errorf("paso %d: la sesión de mentira tras el reinicio %+v, la limitada real %+v", i, respuestasDespues[i], respuestasReal[i])
		}
	}

	// Con otra clave (otro despliegue) el token ya no es de nadie: 401 en una ruta que pide sesión.
	otraClave, _ := e.servidorNuevo(t, bytes.Repeat([]byte{6}, 32))
	r := httptest.NewRequest("GET", "/api/v1/cuentas/estado", nil)
	r.AddCookie(sesion.Cookie(senuelo))
	rr := httptest.NewRecorder()
	otraClave.ServeHTTP(rr, r)
	if rr.Code != 401 {
		t.Errorf("con otra clave se esperaba 401: %d %s", rr.Code, rr.Body)
	}
}
