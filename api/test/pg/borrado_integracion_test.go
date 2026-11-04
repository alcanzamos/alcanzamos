//go:build integration

// Pruebas de integración del borrado de la cuenta (US-53, RF-032, RN-006, RN-007) contra PostgreSQL. Solo datos
// sintéticos.
package pg_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
)

var conservarHasta = ahora.AddDate(cuenta.AniosDeLaPruebaDeAutorizacion, 0, 0)

func ejecutar(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
}

func texto(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
	return s
}

// enTransaccion corre lo que sigue en una transacción: la persona y su perfil se crean juntos (restricción diferida).
func enTransaccion(t *testing.T, pool *pgxpool.Pool, f func(tx pgx.Tx)) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	f(tx)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func dentro(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
}

// adulta crea una persona adulta con correo verificado, credencial y dos sesiones; devuelve su id.
func adulta(t *testing.T, pool *pgxpool.Pool, nombre, correo string) string {
	t.Helper()
	var id string
	enTransaccion(t, pool, func(tx pgx.Tx) {
		if err := tx.QueryRow(context.Background(), `INSERT INTO persona (nombre, etapa, creada_en) VALUES ($1, 'adulta', $2) RETURNING id::text`, nombre, ahora).Scan(&id); err != nil {
			t.Fatal(err)
		}
		dentro(t, tx, `INSERT INTO perfil_adulto (persona_id, correo, correo_verificado) VALUES ($1::uuid, $2, true)`, id, correo)
		dentro(t, tx, `INSERT INTO credencial (persona_id, hash, es_temporal) VALUES ($1::uuid, $2, false)`, id, "$argon2id$v=19$m=8,t=1,p=1$prueba$"+correo)
	})
	for range 2 {
		ejecutar(t, pool, `INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en)
			VALUES (decode(md5(random()::text) || md5(random()::text), 'hex'), $1::uuid, $2, $2, $3)`, id, ahora, ahora.Add(24*time.Hour))
	}
	return id
}

func menor(t *testing.T, pool *pgxpool.Pool, nombre, usuario string, tutores ...string) string {
	t.Helper()
	var id string
	enTransaccion(t, pool, func(tx pgx.Tx) {
		if err := tx.QueryRow(context.Background(), `INSERT INTO persona (nombre, etapa, creada_en) VALUES ($1, 'menor', $2) RETURNING id::text`, nombre, ahora).Scan(&id); err != nil {
			t.Fatal(err)
		}
		dentro(t, tx, `INSERT INTO perfil_menor (persona_id, nombre_de_usuario) VALUES ($1::uuid, $2)`, id, usuario)
		dentro(t, tx, `INSERT INTO credencial (persona_id, hash) VALUES ($1::uuid, '$argon2id$v=19$m=8,t=1,p=1$prueba$menor')`, id)
		dentro(t, tx, `INSERT INTO nacimiento_menor (persona_id, valor_cifrado, version_clave) VALUES ($1::uuid, decode(repeat('ab', 38), 'hex'), 1)`, id)
	})
	ejecutar(t, pool, `INSERT INTO comparticion_categoria (menor_id, categoria_id) VALUES ($1::uuid, 1)`, id)
	ejecutar(t, pool, `INSERT INTO ocultamiento_categoria (persona_id, categoria_id, origen) VALUES ($1::uuid, 7, 'regla_de_menores')`, id)
	ejecutar(t, pool, `INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en)
		VALUES (decode(md5(random()::text) || md5(random()::text), 'hex'), $1::uuid, $2, $2, $3)`, id, ahora, ahora.Add(24*time.Hour))
	propios(t, pool, id, true)
	for _, tutor := range tutores {
		ejecutar(t, pool, `INSERT INTO tutoria (tutor_id, menor_id, declaro_escuchar_al_menor, declaro_representacion, autorizacion_expresa, version_declaracion, inicio)
			VALUES ($1::uuid, $2::uuid, true, true, true, '1.0', $3)`, tutor, id, ahora)
	}
	if len(tutores) > 0 {
		otorgarEn(t, pool, id, tutores[0], "cuenta_del_menor", ahora.Add(-48*time.Hour))
	}
	return id
}

// hogarDe crea un hogar con su administrador y sus miembros, en el orden dado: cada uno ingresó una hora después del anterior.
func hogarDe(t *testing.T, pool *pgxpool.Pool, nombre, administrador string, miembros ...string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO hogar (nombre, creado_en, administrador_id) VALUES ($1, $2, $3::uuid) RETURNING id::text`, nombre, ahora, administrador).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for i, m := range miembros {
		if _, err := tx.Exec(ctx, `INSERT INTO miembro_hogar (persona_id, hogar_id, desde) VALUES ($1::uuid, $2::uuid, $3)`, m, id, ahora.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return id
}

// datos llena de datos propios a una persona adulta, de todas las tablas que los guardan. Con `hogar` no vacío, suma
// una fila compartida con el hogar en cada tabla que lo permite.
func datos(t *testing.T, pool *pgxpool.Pool, persona, hogar string) {
	t.Helper()
	propios(t, pool, persona, false)
	adultas(t, pool, persona)
	for _, f := range []string{"cuenta_y_acceso", "funciones_financieras"} {
		otorgarEn(t, pool, persona, persona, f, ahora.Add(-48*time.Hour))
	}
	if hogar != "" {
		compartidos(t, pool, persona, hogar)
	}
}

// propios guarda lo que tienen una persona adulta y un menor.
func propios(t *testing.T, pool *pgxpool.Pool, persona string, esMenor bool) {
	t.Helper()
	ejecutar(t, pool, `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 1000, '2026-11-02', 'efectivo', $2, 1)`, persona, "mercado de "+persona)
	rec := texto(t, pool, `INSERT INTO movimiento_recurrente (persona_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio) VALUES ($1::uuid, 'gasto', 10, 'mensual', 19900, 'efectivo', '2026-09-05') RETURNING id::text`, persona)
	ejecutar(t, pool, `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id, recurrente_id, fecha_programada) VALUES ($1::uuid, 'gasto', 19900, '2026-10-05', 'efectivo', 10, $2::uuid, '2026-10-05')`, persona, rec)
	ejecutar(t, pool, `INSERT INTO ocurrencia_omitida (recurrente_id, fecha_programada) VALUES ($1::uuid, '2026-11-05')`, rec)
	meta := texto(t, pool, `INSERT INTO meta (persona_id, nombre, monto_objetivo) VALUES ($1::uuid, $2, 650000) RETURNING id::text`, persona, "Arriendo "+persona)
	ejecutar(t, pool, `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, meta_id, sentido) VALUES ($1::uuid, 'aporte', 5000, '2026-11-02', 'efectivo', $2::uuid, 'entrada')`, persona, meta)
	if !esMenor { // solo una persona adulta tiene recordatorios de meta
		ejecutar(t, pool, `INSERT INTO recordatorio_meta (persona_id, meta_id, frecuencia) VALUES ($1::uuid, $2::uuid, 'mensual')`, persona, meta)
	}
	ejecutar(t, pool, `INSERT INTO aviso (persona_id, tipo, texto, fecha, meta_id) VALUES ($1::uuid, 'recordatorio_de_meta', 'Tu meta', '2026-11-02', $2::uuid)`, persona, meta)
	ejecutar(t, pool, `INSERT INTO respuesta_suscripcion (persona_id, categoria_id, clave_grupo, respuesta) VALUES ($1::uuid, 10, 'musica|19900', 'es_suscripcion')`, persona)
	ejecutar(t, pool, `INSERT INTO token_dispositivo (persona_id, dispositivo_id, token) VALUES ($1::uuid, 'telefono', $2)`, persona, "token-"+persona)
	ejecutar(t, pool, `INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, vence_en) VALUES (decode(md5(random()::text) || md5(random()::text), 'hex'), $1::uuid, 'recuperacion', now() + interval '1 hour')`, persona)
	ejecutar(t, pool, `INSERT INTO ocultamiento_categoria (persona_id, categoria_id) VALUES ($1::uuid, 3) ON CONFLICT DO NOTHING`, persona)
	if esMenor {
		ejecutar(t, pool, `INSERT INTO comparticion_movimiento (movimiento_id, menor_id) SELECT id, persona_id FROM movimiento WHERE persona_id = $1::uuid AND tipo = 'gasto' LIMIT 1`, persona)
	}
}

// adultas guarda lo que solo tiene una persona adulta: un menor no tiene perfil de adulto.
func adultas(t *testing.T, pool *pgxpool.Pool, persona string) {
	t.Helper()
	ejecutar(t, pool, `INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 1, '2026-11-01', 400000)`, persona)
	deuda := texto(t, pool, `INSERT INTO deuda (persona_id, nombre, monto, cuotas, inicio, vence, origen, titular) VALUES ($1::uuid, 'Préstamo', 100000, 2, '2026-10-01', '2026-12-01', 'informal', 'propia') RETURNING id::text`, persona)
	ejecutar(t, pool, `INSERT INTO persona_comprometida (deuda_id, papel, nombre_o_relacion) VALUES ($1::uuid, 'fiador', 'Tío Pedro')`, deuda)
	tarjeta := texto(t, pool, `INSERT INTO tarjeta_credito (persona_id, nombre) VALUES ($1::uuid, 'Visa') RETURNING id::text`, persona)
	ejecutar(t, pool, `INSERT INTO extracto_tarjeta (tarjeta_id, periodo, pago_minimo, intereses_y_cargos) VALUES ($1::uuid, '2026-10-01', 10, 1)`, tarjeta)
	ejecutar(t, pool, `INSERT INTO valoracion_mensual (persona_id, periodo, categoria_id, valoracion) VALUES ($1::uuid, '2026-10-01', 1, 'mas')`, persona)
}

// compartidos suma una fila compartida con el hogar, a nombre de la persona, en cada tabla que lo permite.
func compartidos(t *testing.T, pool *pgxpool.Pool, persona, hogar string) {
	t.Helper()
	ejecutar(t, pool, `INSERT INTO movimiento (persona_id, hogar_id, tipo, monto, fecha, medio, categoria_id) VALUES ($1::uuid, $2::uuid, 'gasto', 80000, '2026-11-01', 'transferencia', 4)`, persona, hogar)
	ejecutar(t, pool, `INSERT INTO movimiento_recurrente (persona_id, hogar_id, tipo, categoria_id, periodicidad, monto_habitual, medio, inicio) VALUES ($1::uuid, $2::uuid, 'gasto', 5, 'mensual', 90000, 'transferencia', '2026-09-05')`, persona, hogar)
	ejecutar(t, pool, `INSERT INTO meta (persona_id, hogar_id, nombre, monto_objetivo) VALUES ($1::uuid, $2::uuid, $3, 2000000)`, persona, hogar, "Vacaciones "+persona)
	ejecutar(t, pool, `INSERT INTO presupuesto (persona_id, hogar_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2::uuid, 5, '2026-11-01', 300000)`, persona, hogar)
	ejecutar(t, pool, `INSERT INTO deuda (persona_id, hogar_id, nombre, monto, cuotas, inicio, vence, origen, titular) VALUES ($1::uuid, $2::uuid, 'Del hogar', 500000, 5, '2026-10-01', '2027-03-01', 'formal', 'propia')`, persona, hogar)
}

// tablasDelEsquema son todas las tablas de la base, para fotografiarla entera.
func tablasDelEsquema(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	filas, err := pool.Query(context.Background(), `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)
	if err != nil {
		t.Fatal(err)
	}
	defer filas.Close()
	var tablas []string
	for filas.Next() {
		var n string
		if err := filas.Scan(&n); err != nil {
			t.Fatal(err)
		}
		tablas = append(tablas, n)
	}
	return tablas
}

// fotografia es el contenido de cada tabla (un resumen de todas sus filas), para comprobar que algo no cambió.
func fotografia(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	f := map[string]string{}
	for _, tabla := range tablasDelEsquema(t, pool) {
		f[tabla] = texto(t, pool, fmt.Sprintf(`SELECT count(*) || ':' || COALESCE(md5(string_agg(x::text, '|' ORDER BY x::text)), '') FROM %s x`, tabla))
	}
	return f
}

// columnasUuid son todas las columnas uuid de todas las tablas: donde puede aparecer el id de una persona.
func columnasUuid(t *testing.T, pool *pgxpool.Pool) [][2]string {
	t.Helper()
	filas, err := pool.Query(context.Background(),
		`SELECT table_name, column_name FROM information_schema.columns
		 WHERE table_schema = 'public' AND data_type = 'uuid' ORDER BY table_name, column_name`)
	if err != nil {
		t.Fatal(err)
	}
	defer filas.Close()
	var cols [][2]string
	for filas.Next() {
		var c [2]string
		if err := filas.Scan(&c[0], &c[1]); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	return cols
}

// filasDe son todas las filas de la base que nombran a la persona en alguna columna uuid, como «tabla.columna: fila».
func filasDe(t *testing.T, pool *pgxpool.Pool, persona string) []string {
	t.Helper()
	var salida []string
	for _, c := range columnasUuid(t, pool) {
		filas, err := pool.Query(context.Background(), fmt.Sprintf(`SELECT x::text FROM %s x WHERE %s = $1::uuid`, c[0], c[1]), persona)
		if err != nil {
			t.Fatal(err)
		}
		for filas.Next() {
			var fila string
			if err := filas.Scan(&fila); err != nil {
				t.Fatal(err)
			}
			salida = append(salida, c[0]+"."+c[1]+": "+fila)
		}
		filas.Close()
	}
	sort.Strings(salida)
	return salida
}

// sinPapel quita de las filas la del hogar que nombra a la persona como administradora.
func sinPapel(filas []string) []string {
	var salida []string
	for _, f := range filas {
		if !strings.HasPrefix(f, "hogar.administrador_id:") {
			salida = append(salida, f)
		}
	}
	return salida
}

// quedaSoloLaPrueba falla si de la persona queda algo fuera de `autorizacion`, la prueba mínima que se conserva (E13).
func quedaSoloLaPrueba(t *testing.T, pool *pgxpool.Pool, persona string) {
	t.Helper()
	for _, fila := range filasDe(t, pool, persona) {
		if !strings.HasPrefix(fila, "autorizacion.") {
			t.Errorf("queda algo de la persona borrada: %s", fila)
		}
	}
}

// borrar borra como la pantalla: con los ids de los menores que mostró y, si confirma, con la casilla marcada.
func borrar(pool *pgxpool.Pool, persona string, confirma bool, vistos ...string) error {
	return pg.NuevoBorrado(pool).BorrarCuenta(context.Background(), persona, vistos, confirma, ahora, conservarHasta)
}

func TestBorrarSinHogarNoDejaNadaDeLaPersonaYNoTocaAOtra(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	datos(t, e.pool, laura, "")
	otra := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	datos(t, e.pool, otra, "")
	antesDeOtra := filasDe(t, e.pool, otra)
	if len(antesDeOtra) < 20 {
		t.Fatalf("la siembra de prueba es demasiado corta: %d filas", len(antesDeOtra))
	}
	if n := len(filasDe(t, e.pool, laura)); n != len(antesDeOtra) {
		t.Fatalf("las dos personas deben tener lo mismo: %d y %d", n, len(antesDeOtra))
	}

	if err := borrar(e.pool, laura, false); err != nil {
		t.Fatal(err)
	}

	quedaSoloLaPrueba(t, e.pool, laura)
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, laura); n != 0 {
		t.Errorf("sesiones que siguen valiendo: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, laura); n != 0 {
		t.Error("la persona sigue")
	}
	if despues := filasDe(t, e.pool, otra); !reflect.DeepEqual(antesDeOtra, despues) {
		t.Errorf("las filas de otra persona cambiaron:\nantes   %v\ndespués %v", antesDeOtra, despues)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = $1::uuid`, otra); n != 2 {
		t.Errorf("las sesiones de otra persona: %d", n)
	}
}

// E13 §7 y E11-EIP decisión 9: queda la prueba mínima de la autorización, retirada al borrar y por 3 años.
func TestBorrarConservaSoloLaPruebaMinimaDeLaAutorizacion(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	otorgarEn(t, e.pool, laura, laura, "cuenta_y_acceso", ahora.Add(-48*time.Hour))
	otorgarEn(t, e.pool, laura, laura, "funciones_financieras", ahora.Add(-48*time.Hour))
	otorgarEn(t, e.pool, laura, laura, "avisos", ahora.Add(-72*time.Hour))
	ejecutar(t, e.pool, `UPDATE autorizacion SET retirada_en = $2 WHERE titular_id = $1::uuid AND finalidad = 'avisos'`, laura, ahora.Add(-24*time.Hour))
	otra := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	otorgar(t, e.pool, otra, otra, "cuenta_y_acceso")

	if err := borrar(e.pool, laura, false); err != nil {
		t.Fatal(err)
	}

	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid`, laura); n != 3 {
		t.Fatalf("la prueba de las 3 autorizaciones se conserva: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NOT NULL AND conservar_hasta = $2::date`, laura, conservarHasta); n != 3 {
		t.Errorf("todas quedan retiradas y con el plazo de 3 años: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = 'avisos' AND retirada_en = $2`, laura, ahora.Add(-24*time.Hour)); n != 1 {
		t.Error("la que ya estaba retirada conserva su instante de retiro")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL AND conservar_hasta IS NULL`, otra); n != 1 {
		t.Error("la autorización de otra persona no cambia")
	}
}

// RN-006 y RN-007: con otra persona adulta en el hogar, el papel pasa a la más antigua, lo compartido sigue sin el
// nombre de quien se va, y lo propio se borra.
func TestBorrarSiendoAdministradoraConOtraAdultaPasaElPapelYDejaLoCompartidoSinNombre(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	camilo := adulta(t, e.pool, "Camilo", "camilo@ejemplo.test")
	ana := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	hogar := hogarDe(t, e.pool, "Nuestro hogar", laura, laura, camilo, ana)
	datos(t, e.pool, laura, hogar)
	datos(t, e.pool, camilo, hogar)
	// Mateo tiene otro tutor: se queda.
	mateo := menor(t, e.pool, "Mateo", "mateo.p", laura, camilo)
	ejecutar(t, e.pool, `INSERT INTO miembro_hogar (persona_id, hogar_id) VALUES ($1::uuid, $2::uuid)`, mateo, hogar)
	antesDeCamilo := sinPapel(filasDe(t, e.pool, camilo))
	antesDeMateo := filasDe(t, e.pool, mateo)
	ejecutar(t, e.pool, `INSERT INTO invitacion (hogar_id, codigo_hash, estado, vence, aceptada_por) VALUES ($1::uuid, decode(repeat('01', 32), 'hex'), 'usada', '2026-11-30', $2::uuid)`, hogar, laura)
	ejecutar(t, e.pool, `INSERT INTO propuesta_transferencia (tipo, vence, proponente_id, destinataria_id, hogar_id) VALUES ('administrador_del_hogar', '2026-11-17', $1::uuid, $2::uuid, $3::uuid)`, laura, ana, hogar)
	compartidosAntes := contar(t, e.pool, `SELECT count(*) FROM movimiento WHERE hogar_id = $1::uuid`, hogar)

	if err := borrar(e.pool, laura, false); err != nil {
		t.Fatal(err)
	}

	quedaSoloLaPrueba(t, e.pool, laura)
	if admin := texto(t, e.pool, `SELECT administrador_id::text FROM hogar WHERE id = $1::uuid`, hogar); admin != camilo {
		t.Errorf("el papel pasa a la persona adulta con más antigüedad (Camilo): %s", admin)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM movimiento WHERE hogar_id = $1::uuid`, hogar); n != compartidosAntes {
		t.Errorf("lo compartido sigue en el hogar: %d de %d movimientos", n, compartidosAntes)
	}
	for _, tabla := range []string{"movimiento", "movimiento_recurrente", "meta", "presupuesto", "deuda"} {
		var sinNombre, conNombre int
		sinNombre = contar(t, e.pool, fmt.Sprintf(`SELECT count(*) FROM %s WHERE hogar_id = $1::uuid AND persona_id IS NULL`, tabla), hogar)
		conNombre = contar(t, e.pool, fmt.Sprintf(`SELECT count(*) FROM %s WHERE hogar_id = $1::uuid AND persona_id = $2::uuid`, tabla), hogar, camilo)
		if sinNombre != 1 || conNombre != 1 {
			t.Errorf("%s: lo compartido de Laura queda sin nombre (%d) y lo de Camilo con el suyo (%d)", tabla, sinNombre, conNombre)
		}
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM propuesta_transferencia`); n != 0 {
		t.Error("la propuesta de administrador pendiente se cancela")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM invitacion WHERE hogar_id = $1::uuid AND aceptada_por IS NULL`, hogar); n != 1 {
		t.Error("la invitación que ella aceptó ya no dice quién")
	}
	// Lo único nuevo que nombra a Camilo es el papel de administrador.
	if despues := sinPapel(filasDe(t, e.pool, camilo)); !reflect.DeepEqual(antesDeCamilo, despues) {
		t.Errorf("las filas de Camilo cambiaron:\n%v\n%v", antesDeCamilo, despues)
	}
	if despues := filasDe(t, e.pool, mateo); len(despues) != len(antesDeMateo)-1 { // menos su tutoría con Laura
		t.Errorf("Mateo tiene otro tutor y se queda: antes %d, después %d", len(antesDeMateo), len(despues))
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM tutoria WHERE menor_id = $1::uuid`, mateo); n != 1 {
		t.Error("a Mateo le queda su otro tutor")
	}
}

func TestBorrarSinSerAdministradoraNoCambiaElPapel(t *testing.T) {
	e := nuevoEntorno(t)
	camilo := adulta(t, e.pool, "Camilo", "camilo@ejemplo.test")
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	hogar := hogarDe(t, e.pool, "Nuestro hogar", camilo, camilo, laura)
	datos(t, e.pool, laura, hogar)

	if err := borrar(e.pool, laura, false); err != nil {
		t.Fatal(err)
	}

	quedaSoloLaPrueba(t, e.pool, laura)
	if admin := texto(t, e.pool, `SELECT administrador_id::text FROM hogar WHERE id = $1::uuid`, hogar); admin != camilo {
		t.Errorf("el administrador es el mismo: %s", admin)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM miembro_hogar WHERE hogar_id = $1::uuid`, hogar); n != 1 {
		t.Errorf("queda Camilo: %d miembros", n)
	}
}

// RN-006: la única adulta cierra el hogar, lo compartido pasa a ser suyo y se borra con ella, y se borran los menores
// que dependían solo de ella, con sus datos.
func TestBorrarSiendoLaUnicaAdultaCierraElHogarYBorraLosMenoresQueDependenDeEla(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	hogar := hogarDe(t, e.pool, "Nuestro hogar", laura, laura)
	datos(t, e.pool, laura, hogar)
	mateo := menor(t, e.pool, "Mateo", "mateo.p", laura)
	ejecutar(t, e.pool, `INSERT INTO miembro_hogar (persona_id, hogar_id) VALUES ($1::uuid, $2::uuid)`, mateo, hogar)
	// Un dato compartido que quedó sin nombre cuando otra adulta borró su cuenta antes: el hogar se cierra con él.
	ejecutar(t, e.pool, `INSERT INTO movimiento (hogar_id, tipo, monto, fecha, medio, categoria_id) VALUES ($1::uuid, 'gasto', 25000, '2026-10-01', 'efectivo', 5)`, hogar)
	ejecutar(t, e.pool, `INSERT INTO invitacion (hogar_id, codigo_hash, vence) VALUES ($1::uuid, decode(repeat('02', 32), 'hex'), '2026-11-30')`, hogar)
	// Otro hogar y otra adulta, aparte.
	ana := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	otroHogar := hogarDe(t, e.pool, "Otro hogar", ana, ana)
	datos(t, e.pool, ana, otroHogar)
	antesDeAna := filasDe(t, e.pool, ana)
	antesDelOtroHogar := filasDe(t, e.pool, otroHogar)

	if err := borrar(e.pool, laura, true, mateo); err != nil {
		t.Fatal(err)
	}

	quedaSoloLaPrueba(t, e.pool, laura)
	quedaSoloLaPrueba(t, e.pool, mateo)
	quedaSoloLaPrueba(t, e.pool, hogar)
	for _, tabla := range []string{"movimiento", "movimiento_recurrente", "meta", "presupuesto", "deuda"} {
		if n := contar(t, e.pool, fmt.Sprintf(`SELECT count(*) FROM %s WHERE hogar_id = $1::uuid`, tabla), hogar); n != 0 {
			t.Errorf("%s: lo compartido de un hogar cerrado se borra: %d", tabla, n)
		}
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM movimiento WHERE persona_id IS NULL AND hogar_id IS NULL`); n != 0 {
		t.Errorf("filas sin dueño: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM persona WHERE id = ANY($1::uuid[])`, []string{laura, mateo}); n != 0 {
		t.Error("las cuentas de Laura y de Mateo se borran")
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM sesion WHERE persona_id = ANY($1::uuid[])`, []string{laura, mateo}); n != 0 {
		t.Errorf("sesiones que siguen valiendo: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NOT NULL AND conservar_hasta IS NOT NULL`, mateo); n != 1 {
		t.Errorf("la prueba de la autorización del menor se conserva: %d", n)
	}
	if despues := filasDe(t, e.pool, ana); !reflect.DeepEqual(antesDeAna, despues) {
		t.Errorf("las filas de Ana cambiaron:\n%v\n%v", antesDeAna, despues)
	}
	if despues := filasDe(t, e.pool, otroHogar); !reflect.DeepEqual(antesDelOtroHogar, despues) {
		t.Errorf("las filas del otro hogar cambiaron:\n%v\n%v", antesDelOtroHogar, despues)
	}
}

// RN-006: con menores que dependen solo de ella y sin confirmar, no se borra nada.
func TestBorrarConMenoresSinConfirmarNoCambiaNada(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	hogar := hogarDe(t, e.pool, "Nuestro hogar", laura, laura)
	datos(t, e.pool, laura, hogar)
	mateo := menor(t, e.pool, "Mateo", "mateo.p", laura)
	antes := fotografia(t, e.pool)

	err := borrar(e.pool, laura, false, mateo)

	if !errors.Is(err, cuenta.ErrFaltaConfirmarMenores) {
		t.Fatalf("error: %v", err)
	}
	if despues := fotografia(t, e.pool); !reflect.DeepEqual(antes, despues) {
		t.Errorf("la base cambió:\n%v\n%v", antes, despues)
	}
}

// Una falla a mitad del borrado deja todo como estaba: aquí la falla la pone un disparador que rechaza borrar la
// persona, justo al final, cuando ya se borró casi todo lo demás.
func TestUnaFallaAMitadDelBorradoDejaTodoIntacto(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	camilo := adulta(t, e.pool, "Camilo", "camilo@ejemplo.test")
	hogar := hogarDe(t, e.pool, "Nuestro hogar", laura, laura, camilo)
	datos(t, e.pool, laura, hogar)
	mateo := menor(t, e.pool, "Mateo", "mateo.p", laura)
	ejecutar(t, e.pool, `CREATE FUNCTION falla_al_borrar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla de prueba'; END $$`)
	ejecutar(t, e.pool, `CREATE TRIGGER falla BEFORE DELETE ON persona FOR EACH ROW EXECUTE FUNCTION falla_al_borrar()`)
	antes := fotografia(t, e.pool)

	err := borrar(e.pool, laura, true, mateo)

	if err == nil || !strings.Contains(err.Error(), "falla de prueba") {
		t.Fatalf("se esperaba la falla del disparador: %v", err)
	}
	if despues := fotografia(t, e.pool); !reflect.DeepEqual(antes, despues) {
		t.Errorf("la base cambió:\n%v\n%v", antes, despues)
	}
}

// Cada paso del borrado puede fallar, y en cada uno no queda nada a medias: el disparador de cada caso rechaza justo
// ese paso, cuando los anteriores ya se hicieron dentro de la transacción.
func TestUnaFallaEnCualquierPasoDelBorradoDejaTodoIntacto(t *testing.T) {
	casos := []struct {
		nombre, sentencia string
		conOtraAdulta     bool
	}{
		{"pasar el papel de administrador", "BEFORE UPDATE ON hogar", true},
		{"borrar los datos propios", "BEFORE DELETE ON movimiento", true},
		{"cerrar el hogar", "BEFORE DELETE ON hogar", false},
		{"conservar la prueba de las autorizaciones", "BEFORE UPDATE ON autorizacion", true},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
			miembros := []string{laura}
			if c.conOtraAdulta {
				miembros = append(miembros, adulta(t, e.pool, "Camilo", "camilo@ejemplo.test"))
			}
			hogar := hogarDe(t, e.pool, "Nuestro hogar", laura, miembros...)
			datos(t, e.pool, laura, hogar)
			ejecutar(t, e.pool, `CREATE FUNCTION falla_al_borrar() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla de prueba'; END $$`)
			ejecutar(t, e.pool, `CREATE TRIGGER falla `+c.sentencia+` FOR EACH STATEMENT EXECUTE FUNCTION falla_al_borrar()`)
			antes := fotografia(t, e.pool)

			err := borrar(e.pool, laura, true)

			if err == nil || !strings.Contains(err.Error(), "falla de prueba") {
				t.Fatalf("se esperaba la falla del disparador: %v", err)
			}
			if despues := fotografia(t, e.pool); !reflect.DeepEqual(antes, despues) {
				t.Errorf("la base cambió:\n%v\n%v", antes, despues)
			}
		})
	}
}

func TestBorrarUnaCuentaQueYaNoExisteDaErrNoExiste(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	if err := borrar(e.pool, laura, false); err != nil {
		t.Fatal(err)
	}
	antes := fotografia(t, e.pool)

	if err := borrar(e.pool, laura, false); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Fatalf("la segunda vez: %v", err)
	}
	if despues := fotografia(t, e.pool); !reflect.DeepEqual(antes, despues) {
		t.Error("la segunda vez no cambia nada")
	}
}

func TestUnaCuentaDeMenorNoSeBorraPorAqui(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	mateo := menor(t, e.pool, "Mateo", "mateo.p", laura)
	antes := fotografia(t, e.pool)

	if err := borrar(e.pool, mateo, true); !errors.Is(err, cuenta.ErrCuentaDeMenor) {
		t.Fatalf("error: %v", err)
	}
	if despues := fotografia(t, e.pool); !reflect.DeepEqual(antes, despues) {
		t.Error("no cambia nada")
	}
}

func TestResumenDeLaCuentaSinHogarNiMenores(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	r, err := pg.NuevoBorrado(e.pool).Resumen(context.Background(), laura)
	if err != nil || r.Hogar != nil || len(r.Menores) != 0 {
		t.Fatalf("%+v %v", r, err)
	}
	if _, err := pg.NuevoBorrado(e.pool).Resumen(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff"); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Errorf("sin cuenta: %v", err)
	}
}

func TestResumenDelHogarYDeLosMenores(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	camilo := adulta(t, e.pool, "Camilo", "camilo@ejemplo.test")
	ana := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	hogarDe(t, e.pool, "Nuestro hogar", laura, laura, camilo, ana)
	menor(t, e.pool, "Mateo", "mateo.p", laura)
	menor(t, e.pool, "Sofía", "sofia.p", laura)
	menor(t, e.pool, "Tomás", "tomas.p", laura, camilo) // tiene otro tutor: no depende solo de Laura
	repo := pg.NuevoBorrado(e.pool)

	r, err := repo.Resumen(context.Background(), laura)
	if err != nil {
		t.Fatal(err)
	}
	if r.Hogar == nil || r.Hogar.Nombre == nil || *r.Hogar.Nombre != "Nuestro hogar" || !r.Hogar.EsAdministradora || r.Hogar.UnicaAdulta || r.Hogar.NuevoAdministrador != "Camilo" {
		t.Errorf("hogar %+v", r.Hogar)
	}
	if len(r.Menores) != 2 || r.Menores[0].Nombre != "Mateo" || r.Menores[1].Nombre != "Sofía" {
		t.Errorf("menores %v", r.Menores)
	}

	ejecutar(t, e.pool, `DELETE FROM miembro_hogar WHERE persona_id = ANY($1::uuid[])`, []string{camilo, ana})
	ejecutar(t, e.pool, `UPDATE hogar SET administrador_id = $1::uuid`, laura)
	if r, _ = repo.Resumen(context.Background(), laura); r.Hogar == nil || !r.Hogar.UnicaAdulta || r.Hogar.NuevoAdministrador != "" {
		t.Errorf("única adulta: %+v", r.Hogar)
	}

	// Sin ser administradora, con otra persona adulta: no pasa ningún papel.
	ejecutar(t, e.pool, `INSERT INTO miembro_hogar (persona_id, hogar_id, desde) SELECT $1::uuid, id, $2 FROM hogar`, camilo, ahora.Add(-time.Hour))
	ejecutar(t, e.pool, `UPDATE hogar SET administrador_id = $1::uuid`, camilo)
	if r, _ = repo.Resumen(context.Background(), laura); r.Hogar == nil || r.Hogar.EsAdministradora || r.Hogar.UnicaAdulta || r.Hogar.NuevoAdministrador != "" {
		t.Errorf("miembro sin el papel: %+v", r.Hogar)
	}
}

func TestLaCredencialParaConfirmarConLaContrasena(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	repo := pg.NuevoBorrado(e.pool)
	c, err := repo.CredencialDe(context.Background(), laura)
	if err != nil || c.Correo != "laura@ejemplo.test" || c.Hash != "$argon2id$v=19$m=8,t=1,p=1$prueba$laura@ejemplo.test" {
		t.Fatalf("%+v %v", c, err)
	}
	if _, err := repo.CredencialDe(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff"); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Errorf("sin cuenta: %v", err)
	}
}

// RN-006: cada menor se avisa y se confirma. Si entre que la pantalla leyó el resumen y el borrado cambian los menores
// que dependen solo de la persona, no se borra nada: confirmar a Mateo no confirma a Sofía.
func TestBorrarConMenoresQueCambiaronNoBorraNada(t *testing.T) {
	casos := []struct {
		nombre string
		vistos func(mateo, sofia string) []string
	}{
		{"se sumó un menor (el otro tutor se fue)", func(mateo, _ string) []string { return []string{mateo} }},
		{"se mostraron menos de los que hay", func(string, string) []string { return nil }},
		{"se mostró uno que ya no depende solo de ella", func(mateo, sofia string) []string {
			return []string{mateo, sofia, "0192f3c4-0000-7000-8000-0000000000ff"}
		}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
			camilo := adulta(t, e.pool, "Camilo", "camilo@ejemplo.test")
			hogarDe(t, e.pool, "Nuestro hogar", laura, laura, camilo)
			mateo := menor(t, e.pool, "Mateo", "mateo.p", laura)
			sofia := menor(t, e.pool, "Sofía", "sofia.p", laura, camilo)
			// La pantalla de Laura mostró solo a Mateo; luego Camilo borra su cuenta y Sofía queda a cargo solo de Laura.
			if err := borrar(e.pool, camilo, false); err != nil {
				t.Fatal(err)
			}
			antes := fotografia(t, e.pool)

			err := borrar(e.pool, laura, true, c.vistos(mateo, sofia)...)

			if !errors.Is(err, cuenta.ErrMenoresCambiaron) {
				t.Fatalf("error: %v", err)
			}
			if despues := fotografia(t, e.pool); !reflect.DeepEqual(antes, despues) {
				t.Error("no se debe borrar nada, y menos a Sofía, a quien nadie avisó")
			}
			// Con los dos a la vista, sí.
			if err := borrar(e.pool, laura, true, mateo, sofia); err != nil {
				t.Fatal(err)
			}
			quedaSoloLaPrueba(t, e.pool, sofia)
		})
	}
}

// Dos pedidos a la vez de la misma cuenta: uno borra y el otro encuentra la cuenta ya borrada. Nunca un error de
// serialización ni un punto medio.
func TestDosBorradosAlMismoTiempoUnoBorraYElOtroDaErrNoExiste(t *testing.T) {
	e := nuevoEntorno(t)
	for i := range 20 {
		laura := adulta(t, e.pool, "Laura", fmt.Sprintf("laura%d@ejemplo.test", i))
		datos(t, e.pool, laura, "")
		resultados := make([]error, 2)
		var espera sync.WaitGroup
		inicio := make(chan struct{})
		for k := range resultados {
			espera.Add(1)
			go func() {
				defer espera.Done()
				<-inicio
				resultados[k] = borrar(e.pool, laura, false)
			}()
		}
		close(inicio)
		espera.Wait()
		bien, ausentes := 0, 0
		for _, err := range resultados {
			switch {
			case err == nil:
				bien++
			case errors.Is(err, cuenta.ErrNoExiste):
				ausentes++
			default:
				t.Errorf("vuelta %d: %v", i, err)
			}
		}
		if bien != 1 || ausentes != 1 {
			t.Errorf("vuelta %d: %d borrados y %d «no existe»: %v", i, bien, ausentes, resultados)
		}
		quedaSoloLaPrueba(t, e.pool, laura)
	}
}

// La misma persona sigue escribiendo mientras se borra su cuenta: el borrado espera a los pedidos en curso, ve lo que
// escribieron y termina; los que llegan después ya no tienen a quién escribirle.
func TestBorrarMientrasLaMismaPersonaRegistraMovimientos(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	for i := range 4 {
		laura := adulta(t, e.pool, "Laura", fmt.Sprintf("laura%d@ejemplo.test", i))
		datos(t, e.pool, laura, "")
		parar := make(chan struct{})
		var escritores sync.WaitGroup
		var guardados atomic.Int32
		for range 2 { // el pool tiene pocas conexiones: dos escritores dejan una libre para el borrado
			escritores.Add(1)
			go func() {
				defer escritores.Done()
				for {
					select {
					case <-parar:
						return
					default:
					}
					if _, err := e.pool.Exec(ctx, `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id) VALUES ($1::uuid, 'gasto', 100, '2026-11-02', 'efectivo', 1)`, laura); err == nil {
						guardados.Add(1)
					}
					time.Sleep(time.Millisecond)
				}
			}()
		}
		for guardados.Load() < 10 {
			time.Sleep(time.Millisecond)
		}
		err := borrar(e.pool, laura, false)
		close(parar)
		escritores.Wait()
		if err != nil {
			t.Fatalf("vuelta %d: %v", i, err)
		}
		quedaSoloLaPrueba(t, e.pool, laura)
	}
}

// Un inicio de sesión a la vez con el borrado (toma la credencial y luego la persona) no deja el borrado en un
// interbloqueo: al terminar, la cuenta está borrada.
func TestBorrarMientrasOtroDispositivoEntra(t *testing.T) {
	e := nuevoEntorno(t)
	ctx := context.Background()
	autenticaciones := pg.NuevoAutenticacion(e.pool)
	for i := range 8 {
		laura := adulta(t, e.pool, "Laura", fmt.Sprintf("laura%d@ejemplo.test", i))
		parar := make(chan struct{})
		var entradas sync.WaitGroup
		for k := range 3 {
			entradas.Add(1)
			go func() {
				defer entradas.Done()
				for n := 0; ; n++ {
					select {
					case <-parar:
						return
					default:
					}
					huella := []byte(fmt.Sprintf("huella-%02d-%02d-%06d-relleno-32-by", i, k, n))[:32]
					_ = autenticaciones.IniciarSesion(ctx, laura, huella, ahora, nil)
				}
			}()
		}
		time.Sleep(20 * time.Millisecond)
		err := borrar(e.pool, laura, false)
		close(parar)
		entradas.Wait()
		if err != nil {
			t.Fatalf("vuelta %d: %v", i, err)
		}
		quedaSoloLaPrueba(t, e.pool, laura)
	}
}

// Si la base aborta la transacción una y otra vez (aquí, un disparador que simula el choque), se reintenta un número
// acotado de veces y después ErrOcupada: la cuenta sigue y no se borró nada; nunca un error que se confunda con éxito.
func TestUnChoqueQueNoSeVaDaErrOcupadaYNoBorraNada(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	datos(t, e.pool, laura, "")
	ejecutar(t, e.pool, `CREATE FUNCTION choque() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'choque' USING ERRCODE = '40001'; END $$`)
	ejecutar(t, e.pool, `CREATE TRIGGER choque BEFORE DELETE ON persona FOR EACH ROW EXECUTE FUNCTION choque()`)
	antes := fotografia(t, e.pool)

	err := borrar(e.pool, laura, false)

	if !errors.Is(err, cuenta.ErrOcupada) || errors.Is(err, cuenta.ErrNoExiste) {
		t.Fatalf("error: %v", err)
	}
	if despues := fotografia(t, e.pool); !reflect.DeepEqual(antes, despues) {
		t.Error("la base cambió")
	}
}

// Tras los reintentos, si la cuenta ya no está (otro pedido la borró), es lo mismo que llegar tarde: ErrNoExiste.
func TestUnChoqueQueDejaLaCuentaBorradaDaErrNoExiste(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	// El disparador falla con 40001 en cada intento y, al fallar, otra conexión borra la cuenta por fuera.
	ejecutar(t, e.pool, `CREATE FUNCTION choque() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'choque' USING ERRCODE = '40001'; END $$`)
	ejecutar(t, e.pool, `CREATE TRIGGER choque BEFORE DELETE ON persona FOR EACH ROW EXECUTE FUNCTION choque()`)
	hecho := make(chan error, 1)
	go func() {
		// Otro pedido borra la cuenta cuando el disparador ya no estorba: se quita y se borra a mano.
		time.Sleep(50 * time.Millisecond)
		_, err := e.pool.Exec(context.Background(), `DROP TRIGGER choque ON persona`)
		if err == nil {
			_, err = e.pool.Exec(context.Background(), `DELETE FROM persona WHERE id = $1::uuid`, laura)
		}
		hecho <- err
	}()
	var err error
	for range 200 { // hasta que la otra conexión borre la cuenta
		if err = borrar(e.pool, laura, false); !errors.Is(err, cuenta.ErrOcupada) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if e := <-hecho; e != nil {
		t.Fatal(e)
	}
	if !errors.Is(err, cuenta.ErrNoExiste) {
		t.Fatalf("error: %v", err)
	}
}

// «Descargar mis datos» con un hogar de varias personas: solo lo que la persona registró; nada de las demás ni de los
// terceros que anotaron (SC-E21-20 riesgo 3, E18).
func TestLaDescargaTraeSoloLoPropioEnUnHogarDeVariasPersonas(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	camilo := adulta(t, e.pool, "Camilo", "camilo@ejemplo.test")
	ana := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	hogar := hogarDe(t, e.pool, "Nuestro hogar", laura, laura, camilo, ana)
	mateo := menor(t, e.pool, "Mateo", "mateo.p", laura)
	datos(t, e.pool, laura, hogar)
	datos(t, e.pool, camilo, hogar)
	datos(t, e.pool, ana, hogar)
	ejecutar(t, e.pool, `UPDATE movimiento SET descripcion = 'secreto de ' || p.nombre FROM persona p WHERE p.id = movimiento.persona_id AND p.id <> $1::uuid`, laura)
	ejecutar(t, e.pool, `UPDATE movimiento SET descripcion = 'mercado de Laura' WHERE persona_id = $1::uuid AND hogar_id IS NULL AND tipo = 'gasto' AND recurrente_id IS NULL`, laura)
	// Una fila compartida sin dueño (de alguien que ya borró su cuenta) y un aporte a una meta ajena.
	ejecutar(t, e.pool, `INSERT INTO movimiento (hogar_id, tipo, monto, fecha, medio, descripcion, categoria_id) VALUES ($1::uuid, 'gasto', 1, '2026-10-01', 'efectivo', 'huérfano', 5)`, hogar)
	repo := pg.NuevoBorrado(e.pool)

	filas, err := repo.MovimientosDe(context.Background(), laura)
	if err != nil {
		t.Fatal(err)
	}
	var propios int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM movimiento WHERE persona_id = $1::uuid`, laura).Scan(&propios); err != nil {
		t.Fatal(err)
	}
	if propios < 4 || len(filas) != propios {
		t.Fatalf("filas %d, movimientos de Laura %d", len(filas), propios)
	}
	zip, err := cuenta.ArmarZIP(filas)
	if err != nil {
		t.Fatal(err)
	}
	if len(zip) == 0 {
		t.Fatal("ZIP vacío")
	}
	var conMercado, compartidos int
	for _, f := range filas {
		if strings.Contains(f.Descripcion, "secreto") || strings.Contains(f.Descripcion, "huérfano") {
			t.Errorf("fila ajena: %+v", f)
		}
		if f.Descripcion == "mercado de Laura" {
			conMercado++
		}
		if f.Compartido {
			compartidos++
		}
		if f.Meta != "" && !strings.HasPrefix(f.Meta, "Arriendo "+laura) {
			t.Errorf("meta ajena: %+v", f)
		}
	}
	if conMercado != 1 || compartidos != 1 {
		t.Errorf("mercado %d, compartidos %d", conMercado, compartidos)
	}
	// Lo que sí lleva: nombre de la categoría y de su propia meta, sin ningún id.
	hayAporte := false
	for _, f := range filas {
		if f.Tipo == "aporte" {
			hayAporte = f.Meta == "Arriendo "+laura && f.Sentido == "entrada" && f.MontoCentavos == 5000
		}
		if f.Tipo == "gasto" && f.Categoria == "" {
			t.Errorf("sin categoría: %+v", f)
		}
	}
	if !hayAporte {
		t.Error("el aporte a su propia meta")
	}
	// (El nombre de las metas de prueba lleva el id de Laura: es texto suyo, no una columna de id.)
	for _, id := range []string{camilo, ana, mateo, hogar} {
		if strings.Contains(fmt.Sprintf("%+v", filas), id) {
			t.Errorf("la descarga lleva un id: %s", id)
		}
	}
	// Un menor y una persona sin movimientos: vacío; una cuenta que no existe: ErrNoExiste.
	if f, err := repo.MovimientosDe(context.Background(), mateo); err != nil || len(f) == 0 {
		t.Errorf("las filas de Mateo: %d %v", len(f), err)
	}
	sola := adulta(t, e.pool, "Sola", "sola@ejemplo.test")
	if f, err := repo.MovimientosDe(context.Background(), sola); err != nil || len(f) != 0 {
		t.Errorf("sin movimientos: %v %v", f, err)
	}
	if _, err := repo.MovimientosDe(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff"); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Errorf("sin cuenta: %v", err)
	}
}
