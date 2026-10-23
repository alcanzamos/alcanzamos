//go:build integration

// Pruebas de integración: requieren PostgreSQL 18 (infra/local/compose.yaml) y BASE_DE_DATOS_URL. Cada prueba usa su
// propia base temporal (test/pgtest). Solo datos sintéticos.
package pg_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

var ahora = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

type entorno struct {
	pool     *pgxpool.Pool
	sesiones *pg.Sesiones
	reloj    *relojtest.Fijo
}

func nuevoEntorno(t *testing.T) *entorno {
	t.Helper()
	pool := pgtest.Nueva(t)
	return &entorno{pool: pool, sesiones: pg.NuevoSesiones(pool), reloj: &relojtest.Fijo{T: ahora}}
}

// sembrar crea una cuenta de adulto sin verificar directo en la base (la creación por el API llega en el PR 5) y
// devuelve el id de la persona.
func (e *entorno) sembrar(t *testing.T, correo string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var persona string
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Laura', 'adulta', $1) RETURNING id::text`, ahora).Scan(&persona); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO perfil_adulto (persona_id, correo) VALUES ($1::uuid, '` + correo + `')`,
		`INSERT INTO credencial (persona_id, hash, es_temporal) VALUES ($1::uuid, '$argon2id$v=19$m=8,t=1,p=1$prueba$x', false)`,
	} {
		if _, err := tx.Exec(ctx, q, persona); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return persona
}

func contar(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// otorgar inserta una autorización vigente del titular, dada por otorgante, como lo hará PN-64 en la US-50.
func otorgar(t *testing.T, pool *pgxpool.Pool, titular, otorgante, finalidad string) {
	t.Helper()
	otorgarEn(t, pool, titular, otorgante, finalidad, ahora.Add(-time.Hour))
}

func otorgarEn(t *testing.T, pool *pgxpool.Pool, titular, otorgante, finalidad string, en time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 VALUES ($1::uuid, $2::uuid, $3, '1.0 del 2026-10-30', $4)`, titular, otorgante, finalidad, en); err != nil {
		t.Fatal(err)
	}
}

func verificar(t *testing.T, pool *pgxpool.Pool, persona string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE perfil_adulto SET correo_verificado = true WHERE persona_id = $1::uuid`, persona); err != nil {
		t.Fatal(err)
	}
}

// Sesiones (E13 §5.3).

func TestLaSesionGuardaSoloElSHA256Y30Dias(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	persona := e.sembrar(t, "laura@ejemplo.test")
	token, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, persona, h, ahora); err != nil {
		t.Fatal(err)
	}
	var guardada []byte
	var vence time.Time
	if err := e.pool.QueryRow(ctx, `SELECT hash_token, vence_en FROM sesion WHERE hash_token = $1`, h).Scan(&guardada, &vence); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(guardada, h) || len(guardada) != 32 || !vence.Equal(ahora.Add(30*24*time.Hour)) {
		t.Errorf("sesión: %x vence %v", guardada, vence)
	}
	var enBase int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM sesion WHERE position($1::bytea in hash_token) > 0`, []byte(token)).Scan(&enBase); err != nil || enBase != 0 {
		t.Errorf("el token no debe estar en la base: %d %v", enBase, err)
	}
	s, err := e.sesiones.Sujeto(ctx, h, ahora.Add(time.Minute))
	if err != nil || s.Persona != persona || s.Verificada || s.Autorizada {
		t.Fatalf("Sujeto = %+v, %v", s, err)
	}
}

func TestVencimientoDeslizanteConTopeDe90Dias(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	persona := e.sembrar(t, "laura@ejemplo.test")
	_, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, persona, h, ahora); err != nil {
		t.Fatal(err)
	}
	estado := func() (ultimo, vence time.Time) {
		t.Helper()
		if err := e.pool.QueryRow(ctx, `SELECT ultimo_uso_en, vence_en FROM sesion WHERE hash_token = $1`, h).Scan(&ultimo, &vence); err != nil {
			t.Fatal(err)
		}
		return
	}
	dias := func(n int) time.Time { return ahora.Add(time.Duration(n) * 24 * time.Hour) }

	// Dentro de los 5 minutos no se escribe nada.
	if _, err := e.sesiones.Sujeto(ctx, h, ahora.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if ultimo, vence := estado(); !ultimo.Equal(ahora) || !vence.Equal(dias(30)) {
		t.Errorf("a los 5 minutos exactos no se escribe: %v %v", ultimo, vence)
	}
	// Pasados los 5 minutos se escribe y el vencimiento se desliza.
	uso := ahora.Add(5*time.Minute + time.Second)
	if _, err := e.sesiones.Sujeto(ctx, h, uso); err != nil {
		t.Fatal(err)
	}
	if ultimo, vence := estado(); !ultimo.Equal(uso) || !vence.Equal(uso.Add(30*24*time.Hour)) {
		t.Errorf("tras 5 minutos y un segundo se escribe: %v %v", ultimo, vence)
	}
	// Usándola cada 20 días llega al tope: nunca vence más allá de los 90 días desde la creación.
	for _, d := range []int{20, 40, 60, 80} {
		if _, err := e.sesiones.Sujeto(ctx, h, dias(d)); err != nil {
			t.Fatalf("el día %d debía servir: %v", d, err)
		}
	}
	if _, vence := estado(); !vence.Equal(dias(90)) {
		t.Errorf("al día 80 el vencimiento se corta en el tope de 90 días: %v", vence)
	}
	if _, err := e.sesiones.Sujeto(ctx, h, dias(90).Add(-time.Second)); err != nil {
		t.Errorf("un segundo antes del tope sirve: %v", err)
	}
	if _, err := e.sesiones.Sujeto(ctx, h, dias(90)); err != seguridad.ErrSinSesion {
		t.Errorf("a los 90 días ya no sirve: %v", err)
	}
	// Sin uso, a los 30 días vence.
	_, h2 := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, persona, h2, dias(100)); err != nil {
		t.Fatal(err)
	}
	_, h3 := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, persona, h3, dias(100)); err != nil {
		t.Fatal(err)
	}
	if _, err := e.sesiones.Sujeto(ctx, h2, dias(100).Add(30*24*time.Hour-time.Second)); err != nil {
		t.Errorf("un segundo antes de los 30 días sirve: %v", err)
	}
	if _, err := e.sesiones.Sujeto(ctx, h3, dias(130)); err != seguridad.ErrSinSesion {
		t.Errorf("a los 30 días sin uso ya no sirve: %v", err)
	}
}

func TestMaximoCincoSesionesPorPersonaBorraLasMasViejas(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	persona := e.sembrar(t, "laura@ejemplo.test")
	otra := e.sembrar(t, "otra@ejemplo.test")
	_, hOtra := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, otra, hOtra, ahora); err != nil {
		t.Fatal(err)
	}
	hashes := [][]byte{}
	for i := range 6 {
		_, h := seguridad.NuevoTokenOpaco()
		hashes = append(hashes, h)
		if err := e.sesiones.Crear(ctx, persona, h, ahora.Add(time.Duration(i+1)*time.Hour)); err != nil {
			t.Fatal(err)
		}
		if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n > 5 {
			t.Fatalf("la persona tiene %d sesiones", n)
		}
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, persona); n != 5 {
		t.Fatalf("la persona tiene %d sesiones, se esperaban 5", n)
	}
	// Quedan las 5 más recientes: se fue la primera de las 6.
	if contar(t, e.pool, `SELECT count(*) FROM sesion WHERE hash_token = $1`, hashes[0]) != 0 {
		t.Error("la primera debía borrarse")
	}
	for _, h := range hashes[1:] {
		if contar(t, e.pool, `SELECT count(*) FROM sesion WHERE hash_token = $1`, h) != 1 {
			t.Error("las 5 más recientes deben quedar")
		}
	}
	if contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, otra) != 1 {
		t.Error("las sesiones de otra persona no se tocan")
	}
}

func TestTokenNuevoEnCadaSesion(t *testing.T) {
	e := nuevoEntorno(t)
	persona := e.sembrar(t, "laura@ejemplo.test")
	_, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(context.Background(), persona, h, ahora); err != nil {
		t.Fatal(err)
	}
	// Reutilizar un token existente es un error (clave primaria): una sesión nunca hereda el token de otra.
	if err := e.sesiones.Crear(context.Background(), persona, h, ahora); err == nil {
		t.Fatal("crear dos sesiones con el mismo token debe fallar")
	}
}

func TestSujetoSegunElEstadoDeLaCuenta(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	persona := e.sembrar(t, "laura@ejemplo.test")
	_, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, persona, h, ahora); err != nil {
		t.Fatal(err)
	}
	paso := func(descripcion string, verificada, autorizada bool) {
		t.Helper()
		s, err := e.sesiones.Sujeto(ctx, h, ahora.Add(time.Second))
		if err != nil || s.Persona != persona || s.Verificada != verificada || s.Autorizada != autorizada || s.Senuelo {
			t.Fatalf("%s: %+v %v; se esperaba verificada=%v autorizada=%v", descripcion, s, err, verificada, autorizada)
		}
	}
	paso("sin verificar", false, false)
	otorgar(t, e.pool, persona, persona, "cuenta_y_acceso")
	otorgar(t, e.pool, persona, persona, "funciones_financieras")
	paso("con las dos autorizaciones pero sin verificar: son dos hechos distintos", false, true)
	verificar(t, e.pool, persona)
	paso("verificada y con las dos necesarias de adulto", true, true)
	if _, err := e.pool.Exec(ctx, `UPDATE autorizacion SET retirada_en = $1 WHERE titular_id = $2::uuid AND finalidad = 'cuenta_y_acceso'`, ahora, persona); err != nil {
		t.Fatal(err)
	}
	paso("una necesaria retirada: surte efecto al instante", true, false)
}

func TestSujetoRespetaQuienOtorgaYLaFinalidadDeLaEtapa(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	persona := e.sembrar(t, "laura@ejemplo.test")
	otra := e.sembrar(t, "otra@ejemplo.test")
	verificar(t, e.pool, persona)
	_, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, persona, h, ahora); err != nil {
		t.Fatal(err)
	}
	autorizada := func() bool {
		t.Helper()
		s, err := e.sesiones.Sujeto(ctx, h, ahora.Add(time.Second))
		if err != nil {
			t.Fatal(err)
		}
		return s.Autorizada
	}
	otorgar(t, e.pool, persona, persona, "cuenta_y_acceso")
	otorgar(t, e.pool, persona, otra, "funciones_financieras") // la dio otra persona: no vale (D-139)
	if autorizada() {
		t.Fatal("una necesaria de adulto dada por otra persona no cuenta")
	}
	otorgar(t, e.pool, persona, persona, "avisos") // accesoria: no cuenta
	if autorizada() {
		t.Fatal("una accesoria no cuenta")
	}
	if _, err := e.pool.Exec(ctx, `UPDATE autorizacion SET retirada_en = $1 WHERE titular_id = $2::uuid AND finalidad = 'funciones_financieras'`, ahora, persona); err != nil {
		t.Fatal(err)
	}
	otorgarEn(t, e.pool, persona, persona, "funciones_financieras", ahora) // ahora sí, por ella misma
	if !autorizada() {
		t.Fatal("con las dos de adulto dadas por ella misma queda autorizada, sin pedirle cuenta_del_menor")
	}
}

// D-139: el titular menor necesita cuenta_del_menor, otorgada por su tutor. Un menor no tiene correo que verificar, así
// que su Sujeto no llega más allá de sin_verificar hasta que I11 defina su ingreso.
func TestSujetoDeUnMenorExigeLaAutorizacionDeSuTutor(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	tutor := e.sembrar(t, "tutor@ejemplo.test")
	verificar(t, e.pool, tutor)
	otroAdulto := e.sembrar(t, "otro@ejemplo.test")
	// La creación de menores es de I11; aquí se siembra directo, en una transacción por los disparadores diferidos.
	var menor string
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO persona (nombre, etapa, creada_en) VALUES ('Mateo', 'menor', $1) RETURNING id::text`, ahora).Scan(&menor); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO perfil_menor (persona_id, nombre_de_usuario) VALUES ($1::uuid, 'mateo.01')`,
		`INSERT INTO nacimiento_menor (persona_id, valor_cifrado, version_clave) VALUES ($1::uuid, decode(repeat('ab', 38), 'hex'), 1)`,
	} {
		if _, err := tx.Exec(ctx, q, menor); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx,
		`INSERT INTO tutoria (tutor_id, menor_id, declaro_escuchar_al_menor, declaro_representacion, autorizacion_expresa, version_declaracion, inicio)
		 VALUES ($1::uuid, $2::uuid, true, true, true, '1.0', '2026-10-30')`, tutor, menor); err != nil {
		t.Fatal(err)
	}
	_, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, menor, h, ahora); err != nil {
		t.Fatal(err)
	}
	autorizada := func() bool {
		t.Helper()
		s, err := e.sesiones.Sujeto(ctx, h, ahora.Add(time.Second))
		if err != nil || s.Persona != menor || s.Verificada {
			t.Fatalf("Sujeto = %+v, %v", s, err)
		}
		return s.Autorizada
	}
	if autorizada() {
		t.Fatal("sin ninguna autorización no está autorizado")
	}
	otorgar(t, e.pool, menor, otroAdulto, "cuenta_del_menor") // la dio quien no es su tutor
	if autorizada() {
		t.Fatal("la dada por quien no es su tutor no vale")
	}
	if _, err := e.pool.Exec(ctx, `UPDATE autorizacion SET retirada_en = $1 WHERE titular_id = $2::uuid`, ahora, menor); err != nil {
		t.Fatal(err)
	}
	otorgarEn(t, e.pool, menor, menor, "cuenta_del_menor", ahora.Add(time.Second)) // la dio el propio menor
	if autorizada() {
		t.Fatal("la dada por el propio menor no vale")
	}
	if _, err := e.pool.Exec(ctx, `UPDATE autorizacion SET retirada_en = $1 WHERE titular_id = $2::uuid AND retirada_en IS NULL`, ahora.Add(2*time.Second), menor); err != nil {
		t.Fatal(err)
	}
	otorgarEn(t, e.pool, menor, tutor, "cuenta_del_menor", ahora.Add(3*time.Second))
	if !autorizada() {
		t.Fatal("cuenta_del_menor otorgada por su tutor lo deja autorizado, sin pedirle la lista de adulto")
	}
}

// Prueba de punta a punta con la base: el enrutador real con el almacén real y el reconocimiento de la sesión de mentira
// (SEG-010, SEG-013). Una sesión real sin verificar y una de mentira reciben lo mismo en cada ruta; solo la real cambia
// al verificar y autorizar. La de mentira, creada por una instancia, la reconoce otra con la misma clave.
func TestPuntaAPuntaConElEnrutadorYLaBase(t *testing.T) {
	e := nuevoEntorno(t)
	log := slog.New(slog.NewJSONHandler(io.Discard, nil))
	clave := bytes.Repeat([]byte{7}, 32)
	creadora, err := sesion.NuevosSenuelos(clave, e.reloj)
	if err != nil {
		t.Fatal(err)
	}
	reconocedora, err := sesion.NuevosSenuelos(clave, e.reloj) // otra réplica, o el API tras un reinicio
	if err != nil {
		t.Fatal(err)
	}
	enr := servidor.NuevoEnrutador(sesion.NuevoResolutor(e.sesiones, reconocedora, e.reloj), seguridad.NuevoRegistro(log), log)
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
	pedir := func(ruta, token string) (int, string) {
		r := httptest.NewRequest(http.MethodGet, ruta, nil)
		r.AddCookie(sesion.Cookie(token))
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr.Code, strings.TrimSpace(rr.Body.String())
	}
	nueva := func(persona string) string {
		t.Helper()
		token, huella := seguridad.NuevoTokenOpaco()
		if err := e.sesiones.Crear(context.Background(), persona, huella, ahora); err != nil {
			t.Fatal(err)
		}
		return token
	}

	laura := e.sembrar(t, "laura@ejemplo.test")
	real := nueva(laura)
	limitada := nueva(e.sembrar(t, "otra@ejemplo.test"))
	senuelo := creadora.Crear()
	if len(real) != len(senuelo) {
		t.Fatal("los tokens deben tener el mismo largo")
	}

	// La limitada y la de mentira reciben lo mismo en cada ruta (D-138, D-141).
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
	verificar(t, e.pool, laura)
	if c, _ := pedir(rutas[seguridad.SinAutorizacion], real); c != 200 {
		t.Errorf("verificada en sin_autorizacion: %d", c)
	}
	if c, b := pedir(rutas[seguridad.RequiereAutorizacion], real); c != 403 || !strings.Contains(b, "autorizacion_pendiente") {
		t.Errorf("verificada sin autorizar en requiere_autorizacion: %d %s", c, b)
	}
	otorgar(t, e.pool, laura, laura, "cuenta_y_acceso")
	otorgar(t, e.pool, laura, laura, "funciones_financieras")
	if c, _ := pedir(rutas[seguridad.RequiereAutorizacion], real); c != 200 {
		t.Errorf("autorizada en requiere_autorizacion: %d", c)
	}
	if c, _ := pedir(rutas[seguridad.RequiereAutorizacion], senuelo); c != 403 {
		t.Errorf("la sesión de mentira nunca llega a requiere_autorizacion: %d", c)
	}
	// Un token que nadie creó no tiene sesión.
	desconocido, _ := seguridad.NuevoTokenOpaco()
	if c, _ := pedir(rutas[seguridad.SinVerificar], desconocido); c != 401 {
		t.Errorf("token desconocido: %d", c)
	}
	// Pasada la ventana la sesión de mentira deja de existir.
	e.reloj.T = ahora.AddDate(0, 0, sesion.DiasDeVidaDelSenuelo+1)
	if c, _ := pedir(rutas[seguridad.SinVerificar], senuelo); c != 401 {
		t.Errorf("sesión de mentira vencida: %d", c)
	}
}
