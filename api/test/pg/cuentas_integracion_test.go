//go:build integration

// Pruebas de integración de pedir la verificación del correo y de completar la cuenta contra PostgreSQL (D-172). Solo
// datos sintéticos.
package pg_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
)

type hasheadorRapido struct {
	mu       sync.Mutex
	llamadas int
}

func (h *hasheadorRapido) Hashear(_ context.Context, c string) (string, error) {
	h.mu.Lock()
	h.llamadas++
	h.mu.Unlock()
	return "$argon2id$v=19$m=8,t=1,p=1$prueba$" + c, nil
}

type entornoDeCuentas struct {
	*entorno
	repo      *pg.Cuentas
	correo    *correotest.Falso
	hasher    *hasheadorRapido
	limitador *seguridad.LimitadorDeIntentos
	svc       *cuenta.Servicio
}

func nuevoEntornoDeCuentas(t *testing.T) *entornoDeCuentas {
	t.Helper()
	base := nuevoEntorno(t)
	e := &entornoDeCuentas{entorno: base, repo: pg.NuevoCuentas(base.pool), correo: &correotest.Falso{}, hasher: &hasheadorRapido{}}
	e.limitador = seguridad.NuevoLimitadorDeIntentos(base.reloj)
	e.svc = servicioDeCuentas(t, cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: base.reloj, Limitador: e.limitador, Log: slog.New(slog.NewJSONHandler(io.Discard, nil)),
	})
	return e
}

const contrasenaDePrueba = "lluvia café tren azul"

// pendiente pide la verificación del correo (PN-58) y devuelve el token del enlace que llegó. Deja una cuenta sin
// verificar, sin credencial y sin sesión.
func (e *entornoDeCuentas) pendiente(t *testing.T, correoDePrueba string) string {
	t.Helper()
	antes := len(e.correo.Enviados())
	if err := e.svc.CrearCuenta(context.Background(), cuenta.SolicitudDeCuenta{Correo: correoDePrueba, MayorDeEdad: true}); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	enviados := e.correo.Enviados()
	if len(enviados) != antes+1 || enviados[antes].Aviso {
		t.Fatalf("debía llegar un enlace de verificación a %s: %+v", correoDePrueba, enviados[antes:])
	}
	return enviados[antes].Token
}

// crear deja una cuenta con el correo verificado y la contraseña de prueba, con la sesión de la persona: pide la
// verificación y completa la cuenta con el enlace, como lo hace la persona (PN-58 y PN-74).
func (e *entornoDeCuentas) crear(t *testing.T, correoDePrueba string) cuenta.SesionNueva {
	t.Helper()
	token := e.pendiente(t, correoDePrueba)
	s, err := e.svc.VerificarYElegirContrasena(context.Background(), token, contrasenaDePrueba, "Laura")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func personaDe(t *testing.T, e *entorno, correo string) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), `SELECT persona_id::text FROM perfil_adulto WHERE correo = $1`, correo).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func huella(t *testing.T, token string) []byte {
	t.Helper()
	h, err := seguridad.HuellaDeToken(token)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// instantanea es todo lo guardado: para cada tabla, cuántas filas tiene y una suma de su contenido. Si un rechazo cambió
// algo, cambia.
func (e *entorno) instantanea(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	filas, err := e.pool.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	var tablas []string
	for filas.Next() {
		var n string
		if err := filas.Scan(&n); err != nil {
			t.Fatal(err)
		}
		tablas = append(tablas, n)
	}
	filas.Close()
	sort.Strings(tablas)
	var salida []string
	for _, tabla := range tablas {
		var n int
		var suma *string
		if err := e.pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*), md5(string_agg(x::text, '|' ORDER BY x::text)) FROM %q x`, tabla)).Scan(&n, &suma); err != nil {
			t.Fatal(err)
		}
		s := ""
		if suma != nil {
			s = *suma
		}
		salida = append(salida, fmt.Sprintf("%s=%d:%s", tabla, n, s))
	}
	return strings.Join(salida, "\n")
}

// Un correo sin cuenta: persona y perfil de adulto sin verificar, con el nombre provisional, el enlace de 24 horas, y
// ni credencial ni sesión (D-172 (1), (2) y (3)).
func TestPedirLaVerificacionGuardaLoMinimoYNingunaSesion(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	token := e.pendiente(t, " Laura@Ejemplo.test ")
	ctx := context.Background()

	var nombre, etapa string
	var verificado bool
	if err := e.pool.QueryRow(ctx,
		`SELECT p.nombre, p.etapa, pa.correo_verificado FROM persona p JOIN perfil_adulto pa ON pa.persona_id = p.id WHERE pa.correo = 'laura@ejemplo.test'`).
		Scan(&nombre, &etapa, &verificado); err != nil {
		t.Fatal(err)
	}
	if nombre != cuenta.NombreProvisional || etapa != "adulta" || verificado {
		t.Errorf("persona: %q %q verificado %v", nombre, etapa, verificado)
	}
	var proposito string
	var creado, vence time.Time
	if err := e.pool.QueryRow(ctx, `SELECT proposito, creado_en, vence_en FROM enlace_un_uso WHERE hash_token = $1 AND usado_en IS NULL`, huella(t, token)).
		Scan(&proposito, &creado, &vence); err != nil || proposito != "verificacion" || vence.Sub(creado) != 24*time.Hour {
		t.Errorf("enlace: %q %v %v (%v)", proposito, creado, vence, err)
	}
	for _, tabla := range []string{"credencial", "sesion"} {
		if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != 0 {
			t.Errorf("%s: %d filas; una cuenta pendiente no tiene contraseña ni sesión", tabla, n)
		}
	}
	if e.hasher.llamadas != 0 {
		t.Error("pedir la verificación no calcula ningún hash")
	}
}

// SEG-012 (pre-hijacking), nivel del repositorio: pedir otra vez el correo de una cuenta sin verificar no la borra ni la
// recrea (misma persona, misma fecha de creación) y solo cambia el enlace: el anterior deja de servir.
func TestPedirOtraVezLaVerificacionNoBorraNiRecreaLaCuenta(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	viejo := e.pendiente(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	var creada time.Time
	if err := e.pool.QueryRow(context.Background(), `SELECT creada_en FROM persona WHERE id = $1::uuid`, persona).Scan(&creada); err != nil {
		t.Fatal(err)
	}

	nuevo := e.pendiente(t, "laura@ejemplo.test")
	if personaDe(t, e.entorno, "laura@ejemplo.test") != persona {
		t.Fatal("la cuenta pendiente se recreó: es otra persona")
	}
	var creadaDespues time.Time
	if err := e.pool.QueryRow(context.Background(), `SELECT creada_en FROM persona WHERE id = $1::uuid`, persona).Scan(&creadaDespues); err != nil || !creadaDespues.Equal(creada) {
		t.Errorf("la fecha de creación cambió: %v → %v (%v)", creada, creadaDespues, err)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM persona`); n != 1 {
		t.Errorf("personas: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE usado_en IS NULL`); n != 1 {
		t.Errorf("debe quedar un solo enlace pendiente: %d", n)
	}
	if _, err := e.svc.VerificarYElegirContrasena(context.Background(), viejo, contrasenaDePrueba, "Laura"); err != cuenta.ErrEnlaceInvalido {
		t.Errorf("el enlace anterior ya no debe servir: %v", err)
	}
	if _, err := e.svc.VerificarYElegirContrasena(context.Background(), nuevo, contrasenaDePrueba, "Laura"); err != nil {
		t.Errorf("el nuevo sí: %v", err)
	}
}

// D-172 (2): con una cuenta verificada no se toca nada en la base y el dueño recibe el aviso.
func TestCorreoConCuentaVerificadaNoTocaNada(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	e.crear(t, "laura@ejemplo.test")
	antes := e.instantanea(t)
	enviados := len(e.correo.Enviados())

	e.reloj.T = e.reloj.T.Add(time.Minute)
	if err := e.svc.CrearCuenta(context.Background(), cuenta.SolicitudDeCuenta{Correo: "laura@ejemplo.test", MayorDeEdad: true}); err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
	if despues := e.instantanea(t); despues != antes {
		t.Errorf("la base cambió:\n%s\n%s", antes, despues)
	}
	if env := e.correo.Enviados()[enviados:]; len(env) != 1 || !env[0].Aviso || env[0].Destino != "laura@ejemplo.test" || env[0].Token != "" {
		t.Errorf("solo el aviso, sin token: %+v", env)
	}
}

// Dos pedidos simultáneos del mismo correo se turnan: queda una sola cuenta con un solo enlace pendiente.
func TestDosPedidosSimultaneosDelMismoCorreoDejanUnaCuenta(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if err := e.svc.CrearCuenta(context.Background(), cuenta.SolicitudDeCuenta{Correo: "laura@ejemplo.test", MayorDeEdad: true}); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	e.svc.Esperar()
	for tabla, esperado := range map[string]int{"persona": 1, "perfil_adulto": 1} {
		if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != esperado {
			t.Errorf("%s: %d, se esperaba %d", tabla, n, esperado)
		}
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE usado_en IS NULL`); n != 1 {
		t.Errorf("enlaces pendientes: %d", n)
	}
}

// PN-74: completar la cuenta guarda el nombre, la credencial, el correo verificado, consume el enlace y crea la sesión,
// todo junto.
func TestCompletarLaCuentaGuardaTodoEnUnaTransaccion(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	token := e.pendiente(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")

	s, err := e.svc.VerificarYElegirContrasena(context.Background(), token, contrasenaDePrueba, " Laura Gómez ")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	var nombre string
	var verificado bool
	if err := e.pool.QueryRow(ctx, `SELECT p.nombre, pa.correo_verificado FROM persona p JOIN perfil_adulto pa ON pa.persona_id = p.id WHERE p.id = $1::uuid`, persona).Scan(&nombre, &verificado); err != nil {
		t.Fatal(err)
	}
	if nombre != "Laura Gómez" || !verificado {
		t.Errorf("nombre %q verificado %v", nombre, verificado)
	}
	var hash string
	var temporal bool
	if err := e.pool.QueryRow(ctx, `SELECT hash, es_temporal FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&hash, &temporal); err != nil || hash != "$argon2id$v=19$m=8,t=1,p=1$prueba$"+contrasenaDePrueba || temporal {
		t.Errorf("credencial: %q temporal %v (%v)", hash, temporal, err)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE hash_token = $1 AND usado_en IS NOT NULL`, huella(t, token)); n != 1 {
		t.Error("el enlace debe quedar usado")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE usado_en IS NULL`); n != 0 {
		t.Errorf("no deben quedar enlaces pendientes: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE hash_token = $1 AND persona_id = $2::uuid`, huella(t, s.Token), persona); n != 1 {
		t.Error("falta la sesión de la persona")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion`); n != 1 {
		t.Errorf("sesiones: %d", n)
	}
	suj, err := e.sesiones.Sujeto(ctx, huella(t, s.Token), e.reloj.T)
	if err != nil || suj.Persona != persona || !suj.Verificada || suj.Autorizada {
		t.Errorf("sujeto de la sesión: %+v (%v)", suj, err)
	}
}

// D-172 (3): una cuenta de antes de este cambio, sin verificar y con contraseña (`sembrar` la deja así), se completa
// igual: la contraseña vieja se reemplaza por la que elige quien abre el enlace.
func TestCompletarUnaCuentaVieja(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	persona := e.sembrar(t, "laura@ejemplo.test")
	token := e.pendiente(t, "laura@ejemplo.test")
	if _, err := e.svc.VerificarYElegirContrasena(context.Background(), token, contrasenaDePrueba, "Laura"); err != nil {
		t.Fatal(err)
	}
	var hash string
	if err := e.pool.QueryRow(context.Background(), `SELECT hash FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&hash); err != nil || strings.HasSuffix(hash, "$x") {
		t.Errorf("el hash debe ser el nuevo: %q (%v)", hash, err)
	}
}
