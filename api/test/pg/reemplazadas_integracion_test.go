//go:build integration

package pg_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// Bug 308 (D-210): al borrar la cuenta (E13 §7) las autorizaciones se conservan como prueba mínima con `conservar_hasta`.
// Las vigentes quedan retiradas, como siempre. Una **reemplazada** (la 1.1 que la persona cambió por la 1.2) no se retiró: no
// recibe `retirada_en`, conserva su `reemplazada_en` y recibe el mismo `conservar_hasta`; sin él se quedaría sin plazo.

var (
	otorgadaLa11    = ahora.Add(-72 * time.Hour)
	reemplazadaLa11 = ahora.Add(-24 * time.Hour)
	otorgadaLa12    = ahora.Add(-24 * time.Hour)
)

// sembrarReemplazada deja la 1.1 de `cuenta_y_acceso` reemplazada y la 1.2 vigente, como las deja Otorgar.
func sembrarReemplazada(t *testing.T, pool *pgxpool.Pool, persona string) {
	t.Helper()
	ejecutar(t, pool,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en, reemplazada_en)
		 VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.1 del 2026-11-12', $2, $3)`, persona, otorgadaLa11, reemplazadaLa11)
	ejecutar(t, pool,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 VALUES ($1::uuid, $1::uuid, 'cuenta_y_acceso', '1.2 del 2026-11-17', $2)`, persona, otorgadaLa12)
}

type filaConservada struct {
	version                          string
	retirada, reemplazada, conservar *time.Time
}

func filasConservadas(t *testing.T, pool *pgxpool.Pool, persona string) []filaConservada {
	t.Helper()
	filas, err := pool.Query(context.Background(),
		`SELECT version_del_texto, retirada_en, reemplazada_en, conservar_hasta::timestamptz FROM autorizacion WHERE titular_id = $1::uuid ORDER BY otorgada_en`, persona)
	if err != nil {
		t.Fatal(err)
	}
	defer filas.Close()
	var lista []filaConservada
	for filas.Next() {
		var f filaConservada
		if err := filas.Scan(&f.version, &f.retirada, &f.reemplazada, &f.conservar); err != nil {
			t.Fatal(err)
		}
		lista = append(lista, f)
	}
	return lista
}

func igual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

// comprobarConservadas exige: la 1.1 sigue reemplazada y sin retirar, la 1.2 retirada en `retiro`, las dos con `conservar`
// (o ninguna, si es nil).
func comprobarConservadas(t *testing.T, pool *pgxpool.Pool, persona string, retiro, conservar *time.Time) {
	t.Helper()
	filas := filasConservadas(t, pool, persona)
	if len(filas) != 2 {
		t.Fatalf("la prueba de las dos aceptaciones se conserva: %d filas", len(filas))
	}
	anterior, vigente := filas[0], filas[1]
	if anterior.version != "1.1 del 2026-11-12" || vigente.version != "1.2 del 2026-11-17" {
		t.Fatalf("versiones: %q y %q", anterior.version, vigente.version)
	}
	if anterior.retirada != nil {
		t.Errorf("la 1.1 reemplazada no se retira: retirada_en %v", anterior.retirada)
	}
	if anterior.reemplazada == nil || !anterior.reemplazada.Equal(reemplazadaLa11) {
		t.Errorf("la 1.1 conserva su reemplazada_en %v: %v", reemplazadaLa11, anterior.reemplazada)
	}
	if !igual(anterior.conservar, conservar) {
		t.Errorf("conservar_hasta de la 1.1 reemplazada: %v, se esperaba %v", anterior.conservar, conservar)
	}
	if !igual(vigente.retirada, retiro) || vigente.reemplazada != nil || !igual(vigente.conservar, conservar) {
		t.Errorf("la 1.2 vigente: retirada %v (se esperaba %v), reemplazada %v, conservar %v (se esperaba %v)", vigente.retirada, retiro, vigente.reemplazada, vigente.conservar, conservar)
	}
}

func fecha(t time.Time) *time.Time {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return &d
}

// Borrar la cuenta: la vigente queda retirada con su plazo; la reemplazada, sin retirar y con el mismo plazo.
func TestBorrarConservaLaReemplazadaConPlazoYSinRetirarla(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	sembrarReemplazada(t, e.pool, laura)
	if err := borrar(e.pool, laura, false); err != nil {
		t.Fatal(err)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, laura); n != 0 {
		t.Fatal("la persona sigue")
	}
	retiro := ahora
	comprobarConservadas(t, e.pool, laura, &retiro, fecha(conservarHasta))
}

// La purga de la cuenta sin confirmar (D-135) conserva igual: la vigente retirada y con plazo, la reemplazada solo con plazo.
func TestLaPurgaConservaLaReemplazadaConPlazoYSinRetirarla(t *testing.T) {
	ctx := context.Background()
	e := nuevoEntornoDeCuentas(t)
	id := e.semillaEdad(t, "sin-confirmar-7@ejemplo.test", 7, false)
	sembrarReemplazada(t, e.pool, id)
	n, err := e.svc.BorrarCuentasSinConfirmar(ctx, ahora)
	if err != nil || n != 1 {
		t.Fatalf("borradas %d (%v), se esperaba 1", n, err)
	}
	if c := contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, id); c != 0 {
		t.Fatal("la persona sigue")
	}
	retiro := ahora
	comprobarConservadas(t, e.pool, id, &retiro, fecha(ahora.AddDate(3, 0, 0)))
}

// «No autorizo» (Rechazar): una cuenta con una reemplazada ya tiene historia, así que no se borra y no se toca nada: ni
// `retirada_en` ni `conservar_hasta` en ninguna de las dos filas. (El UPDATE de defensa de Rechazar tampoco retiraría la
// reemplazada si algún día se llegara a él: el camino no es alcanzable hoy, porque antes responde ErrYaAutorizada o
// ErrConHistorial; por eso esta prueba pasa también con el código de antes.)
func TestRechazarConUnaReemplazadaNoBorraNiTocaNada(t *testing.T) {
	e := nuevoEntorno(t)
	laura := e.sembrar(t, "laura@ejemplo.test")
	sembrarReemplazada(t, e.pool, laura)
	necesarias := []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"}
	err := pg.NuevoAutorizaciones(e.pool).Rechazar(context.Background(), laura, necesarias, ahora, conservarHasta)
	if !errors.Is(err, autorizacion.ErrConHistorial) {
		t.Fatalf("Rechazar = %v, se esperaba ErrConHistorial", err)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, laura); n != 1 {
		t.Fatal("la persona no se borra")
	}
	comprobarConservadas(t, e.pool, laura, nil, nil)
}

// Limitación de hoy, hasta que exista el flujo del tutor para volver a aceptar (bug 308, D-210): la regla de la versión vale
// en las tres etapas, así que un menor cuyo tutor aceptó las necesarias con la 1.1 queda `sin_autorizacion` con la 1.2, y
// nada en el API le deja al tutor aceptar de nuevo todavía. Cuando ese flujo exista, esta prueba cambia con él.
func TestLimitacionDeHoyElMenorConLaAceptacionDelTutorDeLa11QuedaSinAutorizacion(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	tutor := e.sembrar(t, "tutor@ejemplo.test")
	verificar(t, e.pool, tutor)
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
	ejecutar(t, e.pool,
		`INSERT INTO tutoria (tutor_id, menor_id, declaro_escuchar_al_menor, declaro_representacion, autorizacion_expresa, version_declaracion, inicio)
		 VALUES ($1::uuid, $2::uuid, true, true, true, '1.0', '2026-10-30')`, tutor, menor)
	_, h := seguridad.NuevoTokenOpaco()
	if err := e.sesiones.Crear(ctx, menor, h, ahora); err != nil {
		t.Fatal(err)
	}
	autorizada := func() bool {
		t.Helper()
		s, err := e.sesiones.Sujeto(ctx, h, ahora.Add(time.Second))
		if err != nil || s.Persona != menor {
			t.Fatalf("Sujeto = %+v, %v", s, err)
		}
		return s.Autorizada
	}
	for i, f := range []string{"cuenta_del_menor", "transmision_a_encargados"} {
		ejecutar(t, e.pool,
			`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $2::uuid, $3, '1.1 del 2026-11-12', $4)`,
			menor, tutor, f, ahora.Add(-time.Hour+time.Duration(i)*time.Second))
	}
	if autorizada() {
		t.Fatal("con la 1.2 vigente, lo que el tutor aceptó con la 1.1 no cuenta: el menor queda sin_autorizacion")
	}
	// Con la versión vigente sí cuenta: lo que falta es solo la nueva aceptación del tutor.
	ejecutar(t, e.pool, `UPDATE autorizacion SET reemplazada_en = $1 WHERE titular_id = $2::uuid`, ahora, menor)
	for i, f := range []string{"cuenta_del_menor", "transmision_a_encargados"} {
		ejecutar(t, e.pool,
			`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
			menor, tutor, f, autorizacion.VersionActual.Texto(), ahora.Add(time.Duration(i+1)*time.Second))
	}
	if !autorizada() {
		t.Fatal("con las dos del tutor en la versión vigente queda autorizado")
	}
}
