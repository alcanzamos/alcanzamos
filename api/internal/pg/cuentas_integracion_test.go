//go:build integration

// Pruebas de integración de la creación de cuentas contra PostgreSQL (PR 5 de la US-49). Solo datos sintéticos.
package pg

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/argon2id"
	"github.com/alcanzamos/alcanzamos/api/internal/correo"
	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
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

// senuelosContados es el generador firmado de verdad, que además cuenta cuántas sesiones de mentira creó.
type senuelosContados struct {
	*sesion.Senuelos
	creados int
}

func (s *senuelosContados) Crear() string {
	s.creados++
	return s.Senuelos.Crear()
}

type entornoDeCuentas struct {
	*entorno
	repo      *Cuentas
	correo    *correo.Falso
	hasher    *hasheadorRapido
	limitador *seguridad.LimitadorDeIntentos
	senuelos  *senuelosContados
	svc       *cuenta.Servicio
}

func nuevoEntornoDeCuentas(t *testing.T) *entornoDeCuentas {
	t.Helper()
	base := nuevoEntorno(t)
	firmados, err := sesion.NuevosSenuelos(bytes.Repeat([]byte{5}, 32), base.reloj)
	if err != nil {
		t.Fatal(err)
	}
	e := &entornoDeCuentas{entorno: base, repo: NuevoCuentas(base.pool), correo: &correo.Falso{}, hasher: &hasheadorRapido{},
		senuelos: &senuelosContados{Senuelos: firmados}}
	e.limitador = seguridad.NuevoLimitadorDeIntentos(base.reloj)
	e.svc = cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: base.reloj, Limitador: e.limitador, Senuelos: e.senuelos, Log: slog.New(slog.NewJSONHandler(io.Discard, nil)),
	})
	return e
}

const contrasenaDePrueba = "lluvia café tren azul"

func (e *entornoDeCuentas) crear(t *testing.T, correoDePrueba string) cuenta.SesionNueva {
	t.Helper()
	s, err := e.svc.CrearCuenta(context.Background(), cuenta.SolicitudDeCuenta{
		Correo: correoDePrueba, Contrasena: contrasenaDePrueba, Nombre: "Laura", MayorDeEdad: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()
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

func TestCrearCuentaGuardaTodoEnUnaTransaccion(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	ctx := context.Background()
	e.svc = cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: argon2id.Predeterminado(),
		Reloj: e.reloj, Limitador: e.limitador, Senuelos: e.senuelos, Log: slog.New(slog.NewJSONHandler(io.Discard, nil)),
	})
	s := e.crear(t, "  Laura@Ejemplo.Test ")

	var persona, nombre, etapa, correoGuardado, hash string
	var verificado, temporal bool
	var creada time.Time
	if err := e.pool.QueryRow(ctx,
		`SELECT p.id::text, p.nombre, p.etapa, p.creada_en, pa.correo, pa.correo_verificado, c.hash, c.es_temporal
		 FROM persona p JOIN perfil_adulto pa ON pa.persona_id = p.id JOIN credencial c ON c.persona_id = p.id`).
		Scan(&persona, &nombre, &etapa, &creada, &correoGuardado, &verificado, &hash, &temporal); err != nil {
		t.Fatal(err)
	}
	if nombre != "Laura" || etapa != "adulta" || correoGuardado != "laura@ejemplo.test" || verificado || temporal || !creada.Equal(ahora) {
		t.Errorf("fila inesperada: %q %q %q %v %v %v", nombre, etapa, correoGuardado, verificado, temporal, creada)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") || strings.Contains(hash, "lluvia") {
		t.Errorf("el hash no es Argon2id con los parámetros de OWASP: %q", hash)
	}
	if ok, err := argon2id.Predeterminado().Verificar(ctx, contrasenaDePrueba, hash); err != nil || !ok {
		t.Errorf("el hash no verifica la contraseña: %v %v", ok, err)
	}

	// El enlace: solo el SHA-256 del token que salió por correo, vence a las 24 horas, sin usar.
	enviados := e.correo.Enviados()
	if len(enviados) != 1 || enviados[0].Destino != "laura@ejemplo.test" {
		t.Fatalf("correos: %+v", enviados)
	}
	var enlace []byte
	var vence time.Time
	var usado *time.Time
	if err := e.pool.QueryRow(ctx,
		`SELECT hash_token, vence_en, usado_en FROM enlace_un_uso WHERE persona_id = $1::uuid AND proposito = 'verificacion'`, persona).
		Scan(&enlace, &vence, &usado); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(enlace, huella(t, enviados[0].Token)) || len(enlace) != 32 {
		t.Error("lo guardado no es el SHA-256 del token enviado")
	}
	if !vence.Equal(ahora.Add(24*time.Hour)) || usado != nil {
		t.Errorf("vencimiento %v, usado %v", vence, usado)
	}

	// La sesión limitada: solo el SHA-256, 30 días, de la misma persona.
	var guardada []byte
	var creadaS, ultimo, venceS time.Time
	var exige bool
	if err := e.pool.QueryRow(ctx, `SELECT hash_token, creada_en, ultimo_uso_en, vence_en, exige_nueva_contrasena FROM sesion WHERE persona_id = $1::uuid`, persona).
		Scan(&guardada, &creadaS, &ultimo, &venceS, &exige); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(guardada, huella(t, s.Token)) || !creadaS.Equal(ahora) || !ultimo.Equal(ahora) || !venceS.Equal(ahora.Add(30*24*time.Hour)) || exige {
		t.Errorf("sesión guardada: %x %v %v %v %v", guardada, creadaS, ultimo, venceS, exige)
	}
	if bytes.Contains(guardada, []byte(s.Token)) {
		t.Error("el token no debe estar en la base")
	}
	if contar(t, e.pool, `SELECT count(*) FROM autorizacion`) != 0 {
		t.Error("crear la cuenta no otorga ninguna autorización")
	}
}

// SEG-012 (D-141 (1)): el correo de una cuenta sin verificar se trata como cuenta nueva.
func TestCorreoConCuentaSinVerificarSeBorraYSeRecrea(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	ctx := context.Background()
	primera := e.crear(t, "laura@ejemplo.test")
	enlaceViejo := e.correo.Enviados()[0].Token
	viejaPersona := personaDe(t, e.entorno, "laura@ejemplo.test")

	e.hasher.llamadas = 0
	e.reloj.T = ahora.Add(time.Minute)
	e.svc = cuenta.NuevoServicio(cuenta.Dependencias{
		Repo: e.repo, Correo: e.correo, Politica: seguridad.NuevaPoliticaDeContrasena(), Hasher: e.hasher,
		Reloj: e.reloj, Limitador: e.limitador, Senuelos: e.senuelos, Log: slog.New(slog.NewJSONHandler(io.Discard, nil)),
	})
	segunda, err := e.svc.CrearCuenta(ctx, cuenta.SolicitudDeCuenta{Correo: "LAURA@ejemplo.test", Contrasena: "otra frase distinta y larga", Nombre: "Intrusa", MayorDeEdad: true})
	if err != nil {
		t.Fatal(err)
	}
	e.svc.Esperar()

	if e.hasher.llamadas != 1 {
		t.Errorf("Argon2id corrió %d veces", e.hasher.llamadas)
	}
	for tabla, esperado := range map[string]int{"persona": 1, "perfil_adulto": 1, "credencial": 1, "enlace_un_uso": 1, "sesion": 1} {
		if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != esperado {
			t.Errorf("%s tiene %d filas, se esperaba %d", tabla, n, esperado)
		}
	}
	nuevaPersona := personaDe(t, e.entorno, "laura@ejemplo.test")
	if nuevaPersona == viejaPersona {
		t.Error("debe ser una cuenta nueva, no la anterior")
	}
	var nombre, hash string
	if err := e.pool.QueryRow(ctx, `SELECT p.nombre, c.hash FROM persona p JOIN credencial c ON c.persona_id = p.id`).Scan(&nombre, &hash); err != nil {
		t.Fatal(err)
	}
	if nombre != "Intrusa" || !strings.HasSuffix(hash, "otra frase distinta y larga") {
		t.Errorf("la cuenta debe quedar con los datos de ahora: %q %q", nombre, hash)
	}
	// La sesión anterior murió con la cuenta; la nueva es real.
	if _, err := e.sesiones.Sujeto(ctx, huella(t, primera.Token), e.reloj.T); err == nil {
		t.Error("la sesión de la cuenta anterior debe dejar de servir")
	}
	if s, err := e.sesiones.Sujeto(ctx, huella(t, segunda.Token), e.reloj.T); err != nil || s.Persona != nuevaPersona || s.Verificada {
		t.Errorf("la sesión nueva debe ser la limitada real: %+v %v", s, err)
	}
	if e.senuelos.creados != 0 {
		t.Error("no hay sesión de mentira: la cuenta sin verificar se trata como nueva")
	}
	// El enlace anterior ya no existe en la base y el nuevo sí, con su vencimiento a las 24 horas.
	enviados := e.correo.Enviados()
	if len(enviados) != 2 || enviados[1].Aviso || enviados[1].Token == enlaceViejo {
		t.Fatalf("correos: %+v", enviados)
	}
	if contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE hash_token = $1`, huella(t, enlaceViejo)) != 0 ||
		contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE hash_token = $1 AND vence_en = $2`, huella(t, enviados[1].Token), e.reloj.T.Add(24*time.Hour)) != 1 {
		t.Error("el enlace anterior debe morir y el nuevo vencer a las 24 horas")
	}
}

// D-141 (2): con una cuenta verificada no se borra ni se cambia nada.
func TestCorreoConCuentaVerificadaNoTocaNada(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	ctx := context.Background()
	real := e.crear(t, "laura@ejemplo.test")
	persona := personaDe(t, e.entorno, "laura@ejemplo.test")
	verificar(t, e.pool, persona)

	falsa := e.crear(t, "Laura@Ejemplo.test")
	for tabla, esperado := range map[string]int{"persona": 1, "perfil_adulto": 1, "credencial": 1, "enlace_un_uso": 1, "sesion": 1} {
		if n := contar(t, e.pool, "SELECT count(*) FROM "+tabla); n != esperado {
			t.Errorf("%s tiene %d filas, se esperaba %d", tabla, n, esperado)
		}
	}
	// La sesión de mentira no está en la base ni apunta a ninguna cuenta: el almacén real no la conoce.
	if _, err := e.sesiones.Sujeto(ctx, huella(t, falsa.Token), ahora); err == nil {
		t.Error("la sesión de mentira no debe estar en la base")
	}
	if contar(t, e.pool, `SELECT count(*) FROM sesion WHERE hash_token = $1`, huella(t, falsa.Token)) != 0 {
		t.Error("la sesión de mentira no debe estar en la base")
	}
	if s, err := e.sesiones.Sujeto(ctx, huella(t, real.Token), ahora); err != nil || s.Persona != persona || !s.Verificada {
		t.Errorf("la sesión real sigue y ahora es verificada: %+v %v", s, err)
	}
	enviados := e.correo.Enviados()
	if len(enviados) != 2 || !enviados[1].Aviso || enviados[1].Destino != "laura@ejemplo.test" {
		t.Errorf("correos: %+v", enviados)
	}
}

func TestDosCreacionesSimultaneasDelMismoCorreoDejanUnaCuenta(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	hecho := make(chan error, 8)
	for range 8 {
		go func() {
			_, err := e.svc.CrearCuenta(context.Background(), cuenta.SolicitudDeCuenta{
				Correo: "laura@ejemplo.test", Contrasena: contrasenaDePrueba, Nombre: "Laura", MayorDeEdad: true})
			hecho <- err
		}()
	}
	for range 8 {
		if err := <-hecho; err != nil {
			t.Fatal(err)
		}
	}
	e.svc.Esperar()
	if n := contar(t, e.pool, `SELECT count(*) FROM perfil_adulto WHERE correo = 'laura@ejemplo.test'`); n != 1 {
		t.Fatalf("hay %d cuentas con ese correo", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion`); n != 1 {
		t.Fatalf("hay %d sesiones", n)
	}
}

// La sesión de mentira de una cuenta verificada la reconoce un servidor nuevo con la misma clave, sin base ni memoria
// compartida, y el almacén real nunca la ve (D-143 (2)).
func TestLaSesionDeMentiraDeUnaCuentaVerificadaSobreviveAUnReinicio(t *testing.T) {
	e := nuevoEntornoDeCuentas(t)
	e.crear(t, "laura@ejemplo.test")
	verificar(t, e.pool, personaDe(t, e.entorno, "laura@ejemplo.test"))
	falsa := e.crear(t, "laura@ejemplo.test")

	reiniciado, err := sesion.NuevosSenuelos(bytes.Repeat([]byte{5}, 32), e.reloj)
	if err != nil {
		t.Fatal(err)
	}
	if !reiniciado.Reconoce(falsa.Token) {
		t.Fatal("un servidor nuevo con la misma clave debe reconocer la sesión de mentira")
	}
	otraClave, err := sesion.NuevosSenuelos(bytes.Repeat([]byte{6}, 32), e.reloj)
	if err != nil {
		t.Fatal(err)
	}
	if otraClave.Reconoce(falsa.Token) {
		t.Fatal("con otra clave no se reconoce")
	}
}
