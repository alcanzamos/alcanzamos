//go:build integration

// Pruebas de integración del borrado de la cuenta (US-53, RF-032, RN-006, RN-007) contra PostgreSQL. Solo datos
// sintéticos.
package pg_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/fechas"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/registro"
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
	for _, f := range []string{"cuenta_y_acceso", "funciones_financieras", "transmision_a_encargados"} {
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
	ejecutar(t, pool, `INSERT INTO presupuesto_en_cero (persona_id, periodo) VALUES ($1::uuid, '2026-09-01')`, persona)
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
	// La marca «en cero» (0004) se va con la cuenta, por el CASCADE del perfil de adulta; la de la otra persona queda.
	if n := contar(t, e.pool, `SELECT count(*) FROM presupuesto_en_cero WHERE persona_id = $1::uuid`, laura); n != 0 {
		t.Errorf("marcas «en cero» que quedan: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM presupuesto_en_cero WHERE persona_id = $1::uuid`, otra); n != 1 {
		t.Errorf("marcas «en cero» de la otra persona: %d", n)
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
	otorgarEn(t, e.pool, laura, laura, "transmision_a_encargados", ahora.Add(-48*time.Hour))
	otorgarEn(t, e.pool, laura, laura, "avisos", ahora.Add(-72*time.Hour))
	ejecutar(t, e.pool, `UPDATE autorizacion SET retirada_en = $2 WHERE titular_id = $1::uuid AND finalidad = 'avisos'`, laura, ahora.Add(-24*time.Hour))
	otra := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	otorgar(t, e.pool, otra, otra, "cuenta_y_acceso")

	if err := borrar(e.pool, laura, false); err != nil {
		t.Fatal(err)
	}

	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid`, laura); n != 4 {
		t.Fatalf("la prueba de las 4 autorizaciones se conserva: %d", n)
	}
	if n := contar(t, e.pool, `SELECT count(*) FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NOT NULL AND conservar_hasta = $2::date`, laura, conservarHasta); n != 4 {
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

// ---- Ventana determinista (sin dormir ni repetir hasta que salga) ----
//
// Un disparador detiene el `UPDATE autorizacion` (el borrado ya leyó, bloqueó y borró sus datos, y solo falta borrar la persona) hasta que
// la prueba suelta un candado de aviso. En ese hueco la prueba mete la escritura de otra conexión y luego suelta.

const candadoDeLaVentana = 53053

type ventana struct {
	t       *testing.T
	pool    *pgxpool.Pool
	candado *pgxpool.Conn
}

// poolGrande da conexiones de sobra: el borrado, el que escribe, el que mira y el que sostiene el candado.
func poolGrande(t *testing.T, base *pgxpool.Pool) *pgxpool.Pool {
	t.Helper()
	cfg := base.Config()
	cfg.MaxConns = 16
	p, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p
}

func abrirVentana(t *testing.T, pool *pgxpool.Pool) *ventana {
	t.Helper()
	return abrirVentanaEn(t, pool, "BEFORE UPDATE", "autorizacion")
}

// abrirVentanaEn detiene, en `evento` sobre `tabla`, a quien llegue a esa sentencia mientras la prueba tiene el candado.
func abrirVentanaEn(t *testing.T, pool *pgxpool.Pool, evento, tabla string) *ventana {
	t.Helper()
	ctx := context.Background()
	ejecutar(t, pool, `CREATE FUNCTION en_la_ventana() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN PERFORM pg_advisory_lock_shared(53053); PERFORM pg_advisory_unlock_shared(53053); RETURN NULL; END $$`)
	c, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Exec(ctx, `SELECT pg_advisory_lock($1)`, candadoDeLaVentana); err != nil {
		t.Fatal(err)
	}
	ejecutar(t, pool, `CREATE TRIGGER en_la_ventana `+evento+` ON `+tabla+` FOR EACH STATEMENT EXECUTE FUNCTION en_la_ventana()`)
	return &ventana{t: t, pool: pool, candado: c}
}

// soltar abre la ventana: los borrados detenidos siguen.
func (v *ventana) soltar() {
	v.t.Helper()
	if _, err := v.candado.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, candadoDeLaVentana); err != nil {
		v.t.Fatal(err)
	}
	v.candado.Release()
}

// esperar vuelve cuando hay al menos `esperando` conexiones detenidas en un candado (la del borrado en la ventana y, si
// la hay, la que escribe y quedó esperando al borrado) o, antes, cuando `hecho` se cierra (la escritura ya terminó: no
// la detuvo nada). Mira la base en un ciclo; no duerme.
func (v *ventana) esperar(esperando int, hecho <-chan struct{}) {
	v.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-hecho:
			return
		default:
		}
		var n int
		if err := v.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&n); err != nil {
			v.t.Fatal(err)
		}
		if n >= esperando {
			return
		}
		runtime.Gosched()
	}
	v.t.Fatal("la ventana no se llenó en 30 s")
}

// enSegundoPlano corre f y avisa al terminar.
func enSegundoPlano(f func() error) (<-chan struct{}, func() error) {
	hecho := make(chan struct{})
	var err error
	go func() { defer close(hecho); err = f() }()
	return hecho, func() error { <-hecho; return err }
}

func admitido(err error, validos ...error) bool {
	if err == nil {
		return true
	}
	for _, v := range validos {
		if errors.Is(err, v) {
			return true
		}
	}
	return false
}

func sinMenoresHuerfanos(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if n := contar(t, pool, `SELECT count(*) FROM persona p WHERE p.etapa = 'menor' AND NOT EXISTS (SELECT 1 FROM tutoria t WHERE t.menor_id = p.id)`); n != 0 {
		t.Errorf("menores que se quedaron sin tutor: %d", n)
	}
}

// R1 · Dos tutores de la misma menor borran a la vez: la segunda cuenta que se borra ve a la menor a cargo solo de ella,
// que su pantalla no mostró (ErrMenoresCambiaron). Nunca queda una menor sin tutor.
func TestDosTutoresDeLaMismaMenorQueBorranAlMismoTiempoNoLaDejanSinTutor(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	camilo := adulta(t, pool, "Camilo", "camilo@ejemplo.test")
	sofia := menor(t, pool, "Sofía", "sofia.p", laura, camilo)
	v := abrirVentana(t, pool)
	hechoL, esperaL := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	hechoC, esperaC := enSegundoPlano(func() error { return borrar(pool, camilo, false) })
	_, _ = hechoL, hechoC
	v.esperar(2, nil)
	v.soltar()
	for _, err := range []error{esperaL(), esperaC()} {
		if !admitido(err, cuenta.ErrMenoresCambiaron) {
			t.Errorf("error inesperado: %v", err)
		}
	}
	sinMenoresHuerfanos(t, pool)
	if contar(t, pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, sofia) != 1 {
		t.Error("Sofía sigue: nadie la avisó ni la confirmó")
	}
}

// R2 · La administradora y otra miembro del mismo hogar borran a la vez: las dos terminan y el hogar se cierra al final.
func TestLaAdministradoraYOtraMiembroQueBorranAlMismoTiempoTerminanLasDos(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	camilo := adulta(t, pool, "Camilo", "camilo@ejemplo.test")
	hogar := hogarDe(t, pool, "Nuestro hogar", laura, laura, camilo)
	datos(t, pool, laura, hogar)
	datos(t, pool, camilo, hogar)
	antes := interbloqueos(t, e.pool)
	// Laura llega a pasar el papel (UPDATE hogar) con el hogar bloqueado; Camilo llega después y espera.
	v := abrirVentanaEn(t, pool, "BEFORE UPDATE", "hogar")
	_, esperaL := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(1, nil)
	_, esperaC := enSegundoPlano(func() error { return borrar(pool, camilo, false) })
	v.esperar(2, nil)
	v.soltar()
	if err := esperaL(); err != nil {
		t.Errorf("Laura: %v", err)
	}
	if err := esperaC(); err != nil {
		t.Errorf("Camilo: %v", err)
	}
	quedaSoloLaPrueba(t, pool, laura)
	quedaSoloLaPrueba(t, pool, camilo)
	if contar(t, pool, `SELECT count(*) FROM hogar`) != 0 {
		t.Error("el hogar se cierra con la última persona adulta")
	}
	if n := interbloqueosDespues(t, e.pool, pool, antes); n != 0 {
		t.Errorf("interbloqueos entre dos personas de un mismo hogar: %d (cada uno se absorbe con un reintento de ~1 s)", n)
	}
}

// interbloqueos lee cuántos interbloqueos ha detectado la base de la prueba.
func interbloqueos(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	return contar(t, pool, `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`)
}

// interbloqueosDespues cuenta los nuevos desde `antes`. Las estadísticas de cada conexión se envían al cerrarla, así que
// se cierra el pool que hizo el trabajo antes de leer: sin esperar ni adivinar un plazo.
func interbloqueosDespues(t *testing.T, lector, trabajo *pgxpool.Pool, antes int) int {
	t.Helper()
	trabajo.Close()
	return interbloqueos(t, lector) - antes
}

// R4 · Mientras Laura borra con [Mateo], otra tutoría de Camilo a Mateo se confirma: no se borra a Mateo ni a la
// tutoría de Camilo sin avisarle (ErrMenoresCambiaron), o la tutoría nueva espera y falla porque Mateo ya no está.
func TestUnaTutoriaNuevaMientrasLauraBorraNoBorraAMateoSinAvisar(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	camilo := adulta(t, pool, "Camilo", "camilo@ejemplo.test")
	mateo := menor(t, pool, "Mateo", "mateo.p", laura)
	v := abrirVentana(t, pool)
	_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, true, mateo) })
	v.esperar(1, nil)
	hecho, esperaT := enSegundoPlano(func() error {
		_, err := pool.Exec(context.Background(), `INSERT INTO tutoria (tutor_id, menor_id, declaro_escuchar_al_menor, declaro_representacion, autorizacion_expresa, version_declaracion, inicio)
			VALUES ($1::uuid, $2::uuid, true, true, true, '1.0', $3)`, camilo, mateo, ahora)
		return err
	})
	v.esperar(2, hecho)
	v.soltar()
	errB, errT := esperaB(), esperaT()
	if !admitido(errB, cuenta.ErrMenoresCambiaron) {
		t.Errorf("borrado: %v", errB)
	}
	if errT == nil && (contar(t, pool, `SELECT count(*) FROM persona WHERE id = $1::uuid`, mateo) != 1 ||
		contar(t, pool, `SELECT count(*) FROM tutoria WHERE tutor_id = $1::uuid AND menor_id = $2::uuid`, camilo, mateo) != 1) {
		t.Error("la tutoría de Camilo se confirmó y el borrado se llevó a Mateo y a esa tutoría")
	}
	if errB == nil && errT == nil {
		t.Error("las dos no pueden salir bien")
	}
}

// R3 y R5 · Escrituras de otras conexiones durante el borrado: el borrado las espera o las ve, termina con la cuenta
// borrada y sin un error de la base. Lo que escribió la persona o el menor antes de la ventana se borra con ellos.
func TestUnaEscrituraConcurrenteNoHaceFallarElBorrado(t *testing.T) {
	casos := []struct {
		nombre  string
		escribe func(laura, mateo string) (string, []any)
	}{
		{"un menor guarda un movimiento (R3)", func(_, mateo string) (string, []any) {
			return `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id) VALUES ($1::uuid, 'gasto', 100, '2026-11-02', 'efectivo', 1)`, []any{mateo}
		}},
		{"la misma persona guarda un movimiento", func(laura, _ string) (string, []any) {
			return `INSERT INTO movimiento (persona_id, tipo, monto, fecha, medio, categoria_id) VALUES ($1::uuid, 'gasto', 100, '2026-11-02', 'efectivo', 1)`, []any{laura}
		}},
		{"la persona guarda su presupuesto (R5)", func(laura, _ string) (string, []any) {
			return `INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 2, '2026-12-01', 1000)`, []any{laura}
		}},
		{"la persona guarda una deuda propia (R5)", func(laura, _ string) (string, []any) {
			return `INSERT INTO deuda (persona_id, nombre, monto, cuotas, inicio, vence, origen, titular) VALUES ($1::uuid, 'Nueva', 1000, 1, '2026-10-01', '2026-12-01', 'informal', 'propia')`, []any{laura}
		}},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			pool := poolGrande(t, e.pool)
			laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
			mateo := menor(t, pool, "Mateo", "mateo.p", laura)
			v := abrirVentana(t, pool)
			_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, true, mateo) })
			v.esperar(1, nil)
			sql, args := c.escribe(laura, mateo)
			hecho, esperaW := enSegundoPlano(func() error { _, err := pool.Exec(context.Background(), sql, args...); return err })
			v.esperar(2, hecho)
			v.soltar()
			if err := esperaB(); err != nil {
				t.Fatalf("el borrado falló: %v", err)
			}
			_ = esperaW() // si esperó, ya no hay a quién escribirle y falla por la llave: es lo correcto
			quedaSoloLaPrueba(t, pool, laura)
			quedaSoloLaPrueba(t, pool, mateo)
			if contar(t, pool, `SELECT count(*) FROM movimiento WHERE persona_id IS NULL AND hogar_id IS NULL`) != 0 {
				t.Error("quedó una fila sin dueño")
			}
		})
	}
}

// Inicio de sesión de la persona que se está borrando: el borrado termina y el inicio de sesión responde «no hay
// cuenta» (autenticacion.ErrNoExiste, que el servicio vuelve un 401 como a cualquier cuenta que no existe), nunca un 500.
func TestUnInicioDeSesionMientrasSeBorraLaCuentaNoEsUnError(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	v := abrirVentana(t, pool)
	_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(1, nil)
	hecho, esperaL := enSegundoPlano(func() error {
		return pg.NuevoAutenticacion(pool).IniciarSesion(context.Background(), laura, []byte("huella-de-prueba-de-32-bytes...."), ahora, nil)
	})
	v.esperar(2, hecho)
	v.soltar()
	if err := esperaB(); err != nil {
		t.Fatal(err)
	}
	if err := esperaL(); !errors.Is(err, autenticacion.ErrNoExiste) {
		t.Errorf("inicio de sesión: %v", err)
	}
	if contar(t, pool, `SELECT count(*) FROM sesion`) != 0 {
		t.Error("no queda ninguna sesión")
	}
}

// Otro pedido borró la cuenta justo antes: el borrado, que esperaba el candado, encuentra la cuenta ya borrada y
// responde ErrNoExiste. Se sincroniza con la base (la espera del candado), sin dormir.
func TestUnBorradoQueEsperabaElCandadoDeOtroQueBorroLaCuentaDaErrNoExiste(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	ctx := context.Background()
	otro, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := otro.Exec(ctx, `DELETE FROM persona WHERE id = $1::uuid`, laura); err != nil {
		t.Fatal(err)
	}
	v := &ventana{t: t, pool: pool}
	_, espera := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(1, nil)
	if err := otro.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := espera(); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Fatalf("error: %v", err)
	}
}

// ---- Recuperar la contraseña, cambiarla y registrar mientras se borra la cuenta ----

// Elegir la contraseña con el enlace (PN-62) mientras la cuenta se borra: toma la credencial antes de consumir el enlace
// (el mismo orden que el borrado, que llega al enlace por la cascada) y, al despertar, el enlace ya no existe: el mismo
// `ErrEnlaceInvalido` de un enlace que no sirve. Sin interbloqueo y sin un 500.
func TestElegirLaContrasenaConElEnlaceMientrasSeBorraLaCuentaDaEnlaceInvalido(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	huella := []byte("enlace-de-recuperacion-32-bytes!")
	ejecutar(t, pool, `INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en) VALUES ($1, $2::uuid, 'recuperacion', $3, $4)`, huella, laura, ahora, ahora.Add(time.Hour))
	antes := interbloqueos(t, e.pool)
	v := abrirVentana(t, pool)
	_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(1, nil)
	hecho, esperaF := enSegundoPlano(func() error {
		return pg.NuevoAutenticacion(pool).FijarContrasenaConEnlace(context.Background(), huella, "$argon2id$v=19$m=8,t=1,p=1$prueba$nueva", ahora)
	})
	v.esperar(2, hecho)
	v.soltar()
	if err := esperaB(); err != nil {
		t.Errorf("borrado: %v", err)
	}
	if err := esperaF(); !errors.Is(err, cuenta.ErrEnlaceInvalido) {
		t.Errorf("elegir la contraseña: %v", err)
	}
	if n := interbloqueosDespues(t, e.pool, pool, antes); n != 0 {
		t.Errorf("interbloqueos: %d", n)
	}
	quedaSoloLaPrueba(t, e.pool, laura)
}

// Pedir un enlace de recuperación (PN-61) mientras la cuenta se borra: mismo orden de candados; sin interbloqueo.
func TestPedirUnEnlaceMientrasSeBorraLaCuentaNoHaceInterbloqueo(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	antes := interbloqueos(t, e.pool)
	// El pedido llega al borrado de los enlaces pendientes con el perfil ya bloqueado y espera ahí; el borrado llega después.
	v := abrirVentanaEn(t, pool, "BEFORE DELETE", "enlace_un_uso")
	hechoP, esperaP := enSegundoPlano(func() error {
		_, err := pg.NuevoAutenticacion(pool).NuevoEnlaceDeRecuperacion(context.Background(), "laura@ejemplo.test", []byte("enlace-de-recuperacion-32-bytes!"), ahora, ahora.Add(time.Hour))
		return err
	})
	v.esperar(1, hechoP)
	_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(2, nil)
	v.soltar()
	if err := esperaP(); err != nil {
		t.Errorf("pedir el enlace: %v", err)
	}
	if err := esperaB(); err != nil {
		t.Errorf("borrado: %v", err)
	}
	if n := interbloqueosDespues(t, e.pool, pool, antes); n != 0 {
		t.Errorf("interbloqueos: %d", n)
	}
	quedaSoloLaPrueba(t, e.pool, laura)
}

// Cambiar la contraseña con la sesión (PN-73) mientras la cuenta se borra: la cuenta ya no existe, `ErrNoExiste` (el
// servicio y la ruta lo vuelven un 401), no un error de la base.
func TestCambiarLaContrasenaMientrasSeBorraLaCuentaDaErrNoExiste(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	v := abrirVentana(t, pool)
	_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(1, nil)
	hecho, esperaC := enSegundoPlano(func() error {
		return pg.NuevoAutenticacion(pool).CambiarContrasena(context.Background(), laura, "$argon2id$v=19$m=8,t=1,p=1$prueba$nueva", []byte("sesion-que-se-conserva-32-bytes!"))
	})
	v.esperar(2, hecho)
	v.soltar()
	if err := esperaB(); err != nil {
		t.Errorf("borrado: %v", err)
	}
	if err := esperaC(); !errors.Is(err, autenticacion.ErrNoExiste) {
		t.Errorf("cambiar la contraseña: %v", err)
	}
	// Y con la cuenta ya borrada antes de empezar.
	if _, err := pg.NuevoAutenticacion(pool).CredencialDe(context.Background(), laura); !errors.Is(err, autenticacion.ErrNoExiste) {
		t.Errorf("credencial de una cuenta borrada: %v", err)
	}
}

// Registrar un movimiento (POST) mientras la cuenta se borra: la llave de `persona` lo rechaza y eso es `ErrSinCuenta`
// (la cuenta ya no existe), no un fallo de la base.
func TestRegistrarMientrasSeBorraLaCuentaDaErrSinCuenta(t *testing.T) {
	for nombre, repite := range map[string]fechas.Periodicidad{"un movimiento": "", "con una repetición": "mensual"} {
		t.Run(nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			pool := poolGrande(t, e.pool)
			laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
			v := abrirVentana(t, pool)
			_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, false) })
			v.esperar(1, nil)
			hecho, esperaG := enSegundoPlano(func() error {
				_, err := pg.NuevoMovimientos(pool).Guardar(context.Background(),
					registro.Guardado{Persona: laura, Tipo: "gasto", Monto: 100, Fecha: ahora, CategoriaID: 1, Medio: "efectivo", Periodicidad: repite, ConMovimiento: true}, ahora)
				return err
			})
			v.esperar(2, hecho)
			v.soltar()
			if err := esperaB(); err != nil {
				t.Errorf("borrado: %v", err)
			}
			if err := esperaG(); !errors.Is(err, registro.ErrSinCuenta) {
				t.Errorf("guardar: %v", err)
			}
			quedaSoloLaPrueba(t, e.pool, laura)
		})
	}
}

// Solo se reintenta lo que se sabe que causa una escritura concurrente: un CHECK de «persona o hogar» o la llave del
// administrador. Cualquier otro error de integridad se intenta una sola vez y sale tal cual (el API lo vuelve un 500
// con su línea de registro), y lo conocido se intenta 3 veces y es «ocupado».
func TestSoloSeReintentanLasRestriccionesConocidas(t *testing.T) {
	casos := []struct {
		nombre, restriccion string
		intentos            int
		ocupado             bool
	}{
		{"la de un movimiento sin dueño", "ck_movimiento_persona_o_hogar", 3, true},
		{"la llave del administrador", "fk_hogar_administrador_id", 3, true},
		{"otra de integridad", "ck_persona_nombre", 1, false},
		{"otra llave", "fk_cualquiera", 1, false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			e := nuevoEntorno(t)
			laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
			codigo := "23514"
			if strings.HasPrefix(c.restriccion, "fk_") {
				codigo = "23503"
			}
			ejecutar(t, e.pool, `CREATE SEQUENCE intentos`)
			ejecutar(t, e.pool, `CREATE FUNCTION choque() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('intentos'); RAISE EXCEPTION 'choque' USING ERRCODE = '`+codigo+`', CONSTRAINT = '`+c.restriccion+`'; END $$`)
			ejecutar(t, e.pool, `CREATE TRIGGER choque BEFORE DELETE ON persona FOR EACH ROW EXECUTE FUNCTION choque()`)

			err := borrar(e.pool, laura, false)

			if got := errors.Is(err, cuenta.ErrOcupada); got != c.ocupado {
				t.Errorf("ocupado = %v: %v", got, err)
			}
			if err == nil || errors.Is(err, cuenta.ErrNoExiste) {
				t.Errorf("error: %v", err)
			}
			if n := contar(t, e.pool, `SELECT last_value FROM intentos`); n != c.intentos {
				t.Errorf("intentos %d, se esperaban %d", n, c.intentos)
			}
			if !c.ocupado && !strings.Contains(err.Error(), c.restriccion) {
				t.Errorf("el error conserva la restricción para el registro: %v", err)
			}
		})
	}
}

// Pedir un enlace cuando la cuenta se borra mientras el pedido espera sus candados: al despertar la cuenta ya no existe y
// responde como a una cuenta sin enlace (false, sin error); nada se guarda.
func TestPedirUnEnlaceDeUnaCuentaQueSeBorroMientrasEsperabaNoGuardaNada(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	v := abrirVentana(t, pool)
	_, esperaB := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(1, nil)
	var guardo bool
	hecho, esperaP := enSegundoPlano(func() error {
		var err error
		guardo, err = pg.NuevoAutenticacion(pool).NuevoEnlaceDeRecuperacion(context.Background(), "laura@ejemplo.test", []byte("enlace-de-recuperacion-32-bytes!"), ahora, ahora.Add(time.Hour))
		return err
	})
	v.esperar(2, hecho)
	v.soltar()
	if err := esperaB(); err != nil {
		t.Errorf("borrado: %v", err)
	}
	if err := esperaP(); err != nil || guardo {
		t.Errorf("pedir el enlace: guardó=%v, error=%v", guardo, err)
	}
	if contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso`) != 0 {
		t.Error("no queda ningún enlace")
	}
}

// La persona cambia de hogar mientras el borrado espera el candado del hogar que había leído: el borrado se da cuenta,
// repite con el hogar de ahora y termina; el otro hogar queda intacto.
func TestUnCambioDeHogarMientrasSeEsperaElCandadoRepiteElBorrado(t *testing.T) {
	e := nuevoEntorno(t)
	pool := poolGrande(t, e.pool)
	ctx := context.Background()
	camilo := adulta(t, pool, "Camilo", "camilo@ejemplo.test")
	laura := adulta(t, pool, "Laura", "laura@ejemplo.test")
	ana := adulta(t, pool, "Ana", "ana@ejemplo.test")
	viejo := hogarDe(t, pool, "Viejo", camilo, camilo, laura)
	nuevo := hogarDe(t, pool, "Nuevo", ana, ana)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM hogar WHERE id = $1::uuid FOR UPDATE`, viejo); err != nil {
		t.Fatal(err)
	}
	v := &ventana{t: t, pool: pool}
	_, espera := enSegundoPlano(func() error { return borrar(pool, laura, false) })
	v.esperar(1, nil)
	if _, err := tx.Exec(ctx, `UPDATE miembro_hogar SET hogar_id = $2::uuid WHERE persona_id = $1::uuid`, laura, nuevo); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := espera(); err != nil {
		t.Fatalf("borrado: %v", err)
	}
	quedaSoloLaPrueba(t, pool, laura)
	if contar(t, pool, `SELECT count(*) FROM hogar WHERE id = ANY($1::uuid[])`, []string{viejo, nuevo}) != 2 {
		t.Error("los dos hogares siguen: en ambos queda otra persona adulta")
	}
}

// Entradas que la base rechaza: el error sale tal cual (no se confunde con «no existe») y no queda nada a medias.
func TestLaBaseRechazaUnEnlaceOUnaContrasenaMalFormados(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	repo := pg.NuevoAutenticacion(e.pool)
	ctx := context.Background()
	if _, err := repo.NuevoEnlaceDeRecuperacion(ctx, "laura@ejemplo.test", []byte("corto"), ahora, ahora.Add(time.Hour)); err == nil || errors.Is(err, autenticacion.ErrNoExiste) {
		t.Errorf("enlace con una huella que no es de 32 bytes: %v", err)
	}
	huella := []byte("enlace-de-recuperacion-32-bytes!")
	ejecutar(t, e.pool, `INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en) VALUES ($1, $2::uuid, 'recuperacion', $3, $4)`, huella, laura, ahora, ahora.Add(time.Hour))
	if err := repo.FijarContrasenaConEnlace(ctx, huella, "no es argon2id", ahora); err == nil || errors.Is(err, cuenta.ErrEnlaceInvalido) {
		t.Errorf("contraseña mal formada: %v", err)
	}
	if contar(t, e.pool, `SELECT count(*) FROM enlace_un_uso WHERE usado_en IS NOT NULL`) != 0 {
		t.Error("el enlace no se gasta si la contraseña no se pudo guardar")
	}
	if err := repo.CambiarContrasena(ctx, laura, "no es argon2id", nil); err == nil || errors.Is(err, autenticacion.ErrNoExiste) {
		t.Errorf("cambiar con una contraseña mal formada: %v", err)
	}
}

// «Descargar mis datos», presupuestos.csv (D-180 con la US-77; L6 (5)): los presupuestos propios de la persona (sin
// hogar) con el nombre de la categoría y los meses que dejó en cero (categoría vacía, monto 0), por periodo y, en cada mes,
// la marca primero y las categorías en el orden del catálogo. Nada de otra persona ni lo compartido con el hogar; sin ids.
// Una cuenta que ya no existe es ErrNoExiste.
func TestPresupuestosDeLaDescarga(t *testing.T) {
	e := nuevoEntorno(t)
	laura := adulta(t, e.pool, "Laura", "laura@ejemplo.test")
	ana := adulta(t, e.pool, "Ana", "ana@ejemplo.test")
	hogar := hogarDe(t, e.pool, "Nuestro hogar", laura, laura, ana)
	for _, q := range []string{
		`INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 8, '2026-11-01', 4000005), ($1::uuid, 1, '2026-11-01', 30000000), ($1::uuid, 12, '2026-10-01', 100)`,
		`INSERT INTO presupuesto_en_cero (persona_id, periodo) VALUES ($1::uuid, '2026-09-01'), ($1::uuid, '2026-11-01')`,
	} {
		ejecutar(t, e.pool, q, laura)
	}
	ejecutar(t, e.pool, `INSERT INTO presupuesto (persona_id, hogar_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, $2::uuid, 5, '2026-11-01', 777)`, laura, hogar)
	ejecutar(t, e.pool, `INSERT INTO presupuesto (persona_id, categoria_id, periodo, monto_asignado) VALUES ($1::uuid, 3, '2026-11-01', 999)`, ana)
	ejecutar(t, e.pool, `INSERT INTO presupuesto_en_cero (persona_id, periodo) VALUES ($1::uuid, '2026-08-01')`, ana)

	got, err := pg.NuevoBorrado(e.pool).PresupuestosDe(context.Background(), laura)
	if err != nil {
		t.Fatal(err)
	}
	quiere := []cuenta.PresupuestoExportado{
		{Periodo: "2026-09"},
		{Periodo: "2026-10", Categoria: "Educación", MontoCentavos: 100},
		{Periodo: "2026-11"},
		{Periodo: "2026-11", Categoria: "Alimentación", MontoCentavos: 30000000},
		{Periodo: "2026-11", Categoria: "Transporte", MontoCentavos: 4000005},
	}
	if !reflect.DeepEqual(got, quiere) {
		t.Errorf("%+v\nse esperaba\n%+v", got, quiere)
	}
	if _, err := pg.NuevoBorrado(e.pool).PresupuestosDe(context.Background(), "0192f3c4-0000-7000-8000-0000000000ff"); !errors.Is(err, cuenta.ErrNoExiste) {
		t.Errorf("cuenta que no existe: %v", err)
	}
}
