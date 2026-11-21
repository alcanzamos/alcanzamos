//go:build integration

// Pruebas de integración del rol del API: requieren PostgreSQL 18 y BASE_DE_DATOS_URL con un usuario que pueda crear bases y roles
// (el del compose local). Cada prueba usa una base propia y un rol con nombre único, que borra al terminar.
package bd_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/bd"
	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// nuevoRol devuelve un nombre de rol único, y al terminar la prueba le quita sus permisos y lo borra. Los roles son del clúster:
// sin esto quedarían entre pruebas.
func nuevoRol(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	nombre := "api_prueba_" + hex.EncodeToString(b)
	t.Cleanup(func() {
		id := pgx.Identifier{nombre}.Sanitize()
		_, _ = pool.Exec(context.Background(), "DROP OWNED BY "+id)
		_, _ = pool.Exec(context.Background(), "DROP ROLE IF EXISTS "+id)
	})
	return nombre
}

func asegurar(t *testing.T, pool *pgxpool.Pool, nombre string) error {
	t.Helper()
	return bd.RolDeLaAplicacion{Nombre: nombre}.AsegurarCon(context.Background(), pool, bd.CrearRolLocal)
}

// intentar corre sentencias como el rol, cada una en su transacción (que se deshace), y devuelve el código SQLSTATE del error o "".
func intentar(t *testing.T, pool *pgxpool.Pool, rol, sentencia string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE "+pgx.Identifier{rol}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, sentencia)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	if err != nil {
		t.Fatalf("%q: error que no es de PostgreSQL: %v", sentencia, err)
	}
	return ""
}

func tablasDelEsquema(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	filas, err := pool.Query(context.Background(),
		`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	tablas, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return tablas
}

func tienePermiso(t *testing.T, pool *pgxpool.Pool, rol, tabla, permiso string) bool {
	t.Helper()
	var si bool
	if err := pool.QueryRow(context.Background(), "SELECT has_table_privilege($1::name, $2::regclass, $3)", rol, "public."+pgx.Identifier{tabla}.Sanitize(), permiso).Scan(&si); err != nil {
		t.Fatal(err)
	}
	return si
}

// Lo justo: leer y escribir las tablas del API, solo leer el catálogo, nada del control de las migraciones, ninguna administración.
func TestElRolDelAPITieneSoloLoJusto(t *testing.T) {
	pool := pgtest.Nueva(t)
	rol := nuevoRol(t, pool)
	if err := asegurar(t, pool, rol); err != nil {
		t.Fatal(err)
	}

	var login, super, creaBases, creaRoles, replica, saltaRLS bool
	err := pool.QueryRow(context.Background(),
		"SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1", rol).
		Scan(&login, &super, &creaBases, &creaRoles, &replica, &saltaRLS)
	if err != nil {
		t.Fatalf("el rol no existe: %v", err)
	}
	if !login || super || creaBases || creaRoles || replica || saltaRLS {
		t.Errorf("atributos del rol: login %v, superusuario %v, crea bases %v, crea roles %v, replicación %v, salta RLS %v", login, super, creaBases, creaRoles, replica, saltaRLS)
	}
	var miembroDe int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1`, rol).Scan(&miembroDe); err != nil || miembroDe != 0 {
		t.Errorf("el rol no es miembro de ningún otro: %d (%v)", miembroDe, err)
	}

	catalogo := []string{"categoria", "finalidad"}
	tablas := tablasDelEsquema(t, pool)
	if len(tablas) < 30 {
		t.Fatalf("se esperaban las tablas del esquema migrado: %v", tablas)
	}
	for _, tabla := range tablas {
		esperado := map[string]bool{"SELECT": true, "INSERT": true, "UPDATE": true, "DELETE": true, "TRUNCATE": false, "REFERENCES": false, "TRIGGER": false, "SELECT WITH GRANT OPTION": false}
		switch {
		case tabla == "goose_db_version":
			esperado = map[string]bool{"SELECT": false, "INSERT": false, "UPDATE": false, "DELETE": false, "TRUNCATE": false, "REFERENCES": false, "TRIGGER": false, "SELECT WITH GRANT OPTION": false}
		case slices.Contains(catalogo, tabla):
			esperado["INSERT"], esperado["UPDATE"], esperado["DELETE"] = false, false, false
		}
		for permiso, quiere := range esperado {
			if got := tienePermiso(t, pool, rol, tabla, permiso); got != quiere {
				t.Errorf("%s sobre %s: %v, se esperaba %v", permiso, tabla, got, quiere)
			}
		}
	}

	var usaEsquema, creaEnEsquema bool
	if err := pool.QueryRow(context.Background(), "SELECT has_schema_privilege($1::name, 'public', 'USAGE'), has_schema_privilege($1::name, 'public', 'CREATE')", rol).Scan(&usaEsquema, &creaEnEsquema); err != nil {
		t.Fatal(err)
	}
	if !usaEsquema || creaEnEsquema {
		t.Errorf("esquema public: USAGE %v, CREATE %v", usaEsquema, creaEnEsquema)
	}
}

// Lo que el API hace de verdad corre, y todo DDL y toda administración se rechaza con «permiso denegado» (42501). CREATE DATABASE no se
// prueba aquí (no corre dentro de una transacción): rolcreatedb falso se comprueba en la prueba de arriba.
func TestElRolDelAPIEscribeYNoPuedeHacerDDLNiAdministrar(t *testing.T) {
	pool := pgtest.Nueva(t)
	rol := nuevoRol(t, pool)
	if err := asegurar(t, pool, rol); err != nil {
		t.Fatal(err)
	}
	for _, permitida := range []string{
		"SELECT count(*) FROM persona",
		"SELECT count(*) FROM finalidad",
		"DELETE FROM persona",
		"UPDATE persona SET etapa = etapa WHERE false",
		"INSERT INTO sesion SELECT * FROM sesion WHERE false",
	} {
		if codigo := intentar(t, pool, rol, permitida); codigo != "" {
			t.Errorf("%q debía poder: SQLSTATE %s", permitida, codigo)
		}
	}
	for _, prohibida := range []string{
		"CREATE TABLE intrusa (a int)",
		"CREATE TEMP TABLE intrusa (a int)",
		"CREATE SCHEMA intrusa",
		"CREATE FUNCTION intrusa() RETURNS int LANGUAGE sql AS 'SELECT 1'",
		"DROP TABLE persona",
		"ALTER TABLE persona ADD COLUMN intrusa int",
		"ALTER TABLE persona DISABLE TRIGGER ALL",
		"CREATE INDEX intrusa ON persona (etapa)",
		"TRUNCATE persona",
		"CREATE ROLE intrusa",
		"DROP FUNCTION fn_perfiles_coherentes(uuid)",
		"SELECT * FROM goose_db_version",
		"DELETE FROM goose_db_version",
		"INSERT INTO finalidad (codigo, tipo, descripcion) VALUES ('intrusa', 'necesaria', 'x')",
		"UPDATE categoria SET nombre = nombre",
		"DELETE FROM categoria",
	} {
		// CREATE TEMP TABLE lo permite PostgreSQL a todo el que se conecta (TEMPORARY sobre la base es de PUBLIC): se documenta, no se prueba.
		if strings.HasPrefix(prohibida, "CREATE TEMP") {
			continue
		}
		if codigo := intentar(t, pool, rol, prohibida); codigo != "42501" {
			t.Errorf("%q debía fallar con permiso denegado (42501): SQLSTATE %q", prohibida, codigo)
		}
	}
}

// Se puede correr cuantas veces haga falta (cada `migrar` lo vuelve a correr), alcanza las tablas que traigan las migraciones
// nuevas y deja el rol exactamente como se define, aunque alguien le haya dado de más.
func TestAsegurarElRolEsIdempotenteYAlcanzaLasTablasNuevas(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	rol := nuevoRol(t, pool)
	for i := 0; i < 2; i++ {
		if err := asegurar(t, pool, rol); err != nil {
			t.Fatalf("vuelta %d: %v", i+1, err)
		}
	}

	if _, err := pool.Exec(ctx, "CREATE TABLE tabla_de_una_migracion_nueva (id int PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	if tienePermiso(t, pool, rol, "tabla_de_una_migracion_nueva", "SELECT") {
		t.Fatal("una tabla nueva no debe quedar abierta antes de volver a asegurar el rol")
	}
	// Alguien le da de más (TRUNCATE, la tabla de control, escribir el catálogo), o le quita lo que sí necesita.
	for _, sentencia := range []string{
		"GRANT TRUNCATE ON persona TO " + pgx.Identifier{rol}.Sanitize(),
		"GRANT ALL ON goose_db_version TO " + pgx.Identifier{rol}.Sanitize(),
		"GRANT INSERT ON finalidad TO " + pgx.Identifier{rol}.Sanitize(),
		"REVOKE DELETE ON sesion FROM " + pgx.Identifier{rol}.Sanitize(),
		"GRANT CREATE ON SCHEMA public TO " + pgx.Identifier{rol}.Sanitize(),
	} {
		if _, err := pool.Exec(ctx, sentencia); err != nil {
			t.Fatal(err)
		}
	}
	if err := asegurar(t, pool, rol); err != nil {
		t.Fatal(err)
	}
	quiere := map[[2]string]bool{
		{"tabla_de_una_migracion_nueva", "SELECT"}: true, {"tabla_de_una_migracion_nueva", "DELETE"}: true, {"tabla_de_una_migracion_nueva", "TRUNCATE"}: false,
		{"persona", "TRUNCATE"}: false, {"goose_db_version", "SELECT"}: false, {"finalidad", "INSERT"}: false, {"sesion", "DELETE"}: true,
	}
	for k, v := range quiere {
		if got := tienePermiso(t, pool, rol, k[0], k[1]); got != v {
			t.Errorf("%s sobre %s: %v, se esperaba %v", k[1], k[0], got, v)
		}
	}
	var creaEnEsquema bool
	if err := pool.QueryRow(ctx, "SELECT has_schema_privilege($1::name, 'public', 'CREATE')", rol).Scan(&creaEnEsquema); err != nil || creaEnEsquema {
		t.Errorf("CREATE sobre el esquema debía quedar quitado: %v (%v)", creaEnEsquema, err)
	}
}

// Un rol que ya existe con administración (porque alguien lo creó así, o es miembro de uno que la tiene) no se acepta: falla cerrado y
// dice cuál, en vez de dejar al API con más poder del que se prometió.
func TestAsegurarElRolRechazaUnRolConAdministracion(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	for _, atributo := range []string{"SUPERUSER", "CREATEROLE", "CREATEDB", "REPLICATION", "BYPASSRLS"} {
		t.Run(atributo, func(t *testing.T) {
			rol := nuevoRol(t, pool)
			if _, err := pool.Exec(ctx, "CREATE ROLE "+pgx.Identifier{rol}.Sanitize()+" LOGIN "+atributo); err != nil {
				t.Fatal(err)
			}
			err := asegurar(t, pool, rol)
			if err == nil || !strings.Contains(err.Error(), "administración") {
				t.Fatalf("un rol con %s debía rechazarse: %v", atributo, err)
			}
		})
	}
	t.Run("miembro de un administrador", func(t *testing.T) {
		grupo, rol := nuevoRol(t, pool), nuevoRol(t, pool)
		if _, err := pool.Exec(ctx, "CREATE ROLE "+pgx.Identifier{grupo}.Sanitize()+" NOLOGIN CREATEROLE"); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "CREATE ROLE "+pgx.Identifier{rol}.Sanitize()+" LOGIN"); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "GRANT "+pgx.Identifier{grupo}.Sanitize()+" TO "+pgx.Identifier{rol}.Sanitize()); err != nil {
			t.Fatal(err)
		}
		err := asegurar(t, pool, rol)
		if err == nil || !strings.Contains(err.Error(), grupo) {
			t.Fatalf("un miembro de un administrador debía rechazarse nombrando al grupo: %v", err)
		}
	})
}

// El nombre llega a SQL como identificador: nada de lo peligroso crea un rol ni toca el esquema, y el migrador no se toca a sí mismo.
func TestAsegurarElRolRechazaNombresPeligrososSinTocarNada(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	var yo string
	if err := pool.QueryRow(ctx, "SELECT current_user").Scan(&yo); err != nil {
		t.Fatal(err)
	}
	var antes int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM pg_roles").Scan(&antes); err != nil {
		t.Fatal(err)
	}
	for _, nombre := range []string{"", "postgres", "azure_pg_admin", "pg_read_all_data", "public", yo, `x"; DROP TABLE persona; --`, "con espacio", strings.Repeat("a", 64)} {
		if err := asegurar(t, pool, nombre); err == nil {
			t.Errorf("el nombre %q debía rechazarse", nombre)
		}
	}
	var despues, personas int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM pg_roles").Scan(&despues); err != nil || despues != antes {
		t.Errorf("roles antes %d y después %d: no debía crearse ninguno (%v)", antes, despues, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM persona").Scan(&personas); err != nil {
		t.Errorf("la tabla persona debía seguir ahí: %v", err)
	}
	if !tienePermiso(t, pool, yo, "persona", "DELETE") {
		t.Error("el migrador debía conservar sus permisos")
	}
}

// En Azure el rol se crea con la función de Entra de Azure Database for PostgreSQL: pgaadauth_create_principal_with_oid, como servicio y
// sin administración. Aquí la función es una copia mínima que anota cómo la llamaron, porque PostgreSQL local no la trae.
const funcionDeEntraFalsa = `
CREATE TABLE llamadas_a_entra (nombre text, object_id text, tipo text, es_admin boolean, es_mfa boolean);
CREATE FUNCTION pgaadauth_create_principal_with_oid(nombre text, object_id text, tipo text, es_admin boolean, es_mfa boolean)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO llamadas_a_entra VALUES (nombre, object_id, tipo, es_admin, es_mfa);
  EXECUTE format('CREATE ROLE %I LOGIN', nombre);
  RETURN 'Created role for ' || nombre;
END $f$;`

func llamadasAEntra(t *testing.T, pool *pgxpool.Pool) [][5]string {
	t.Helper()
	filas, err := pool.Query(context.Background(), "SELECT nombre, object_id, tipo, es_admin::text, es_mfa::text FROM llamadas_a_entra ORDER BY 1")
	if err != nil {
		t.Fatal(err)
	}
	llamadas, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) ([5]string, error) {
		var l [5]string
		return l, f.Scan(&l[0], &l[1], &l[2], &l[3], &l[4])
	})
	if err != nil {
		t.Fatal(err)
	}
	return llamadas
}

func TestEnAzureElRolSeCreaConLaFuncionDeEntraComoServicioYSinAdministracion(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	if _, err := pool.Exec(ctx, funcionDeEntraFalsa); err != nil {
		t.Fatal(err)
	}
	rol := nuevoRol(t, pool)

	r := bd.RolDeLaAplicacion{Nombre: rol, ObjectID: objectIDDelAPI, EnAzure: true}
	for i := 0; i < 2; i++ { // la segunda vez el rol ya existe: no se vuelve a crear
		if err := r.Asegurar(ctx, pool); err != nil {
			t.Fatalf("vuelta %d: %v", i+1, err)
		}
	}
	llamadas := llamadasAEntra(t, pool)
	if len(llamadas) != 1 || llamadas[0] != [5]string{rol, objectIDDelAPI, "service", "false", "false"} {
		t.Fatalf("se esperaba una sola llamada (nombre, object id, 'service', no administrador, sin MFA): %v", llamadas)
	}
	if !tienePermiso(t, pool, rol, "persona", "DELETE") || tienePermiso(t, pool, rol, "goose_db_version", "SELECT") {
		t.Error("el rol de Entra queda con los mismos permisos justos")
	}
	if codigo := intentar(t, pool, rol, "CREATE TABLE intrusa (a int)"); codigo != "42501" {
		t.Errorf("el rol de Entra tampoco hace DDL: %q", codigo)
	}
}

func TestEnAzureUnObjectIDMalFormadoNoLlamaALaFuncion(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	if _, err := pool.Exec(ctx, funcionDeEntraFalsa); err != nil {
		t.Fatal(err)
	}
	rol := nuevoRol(t, pool)
	err := bd.RolDeLaAplicacion{Nombre: rol, ObjectID: "no-es-un-guid", EnAzure: true}.Asegurar(ctx, pool)
	if err == nil || !strings.Contains(err.Error(), "object id") {
		t.Fatalf("se esperaba un error por el object id: %v", err)
	}
	if llamadas := llamadasAEntra(t, pool); len(llamadas) != 0 {
		t.Errorf("no debía llamarse a la función: %v", llamadas)
	}
}

// Si la función de Entra falla (el migrador no es administrador, o el object id no existe), el error sale sin tocar los permisos.
func TestSiEntraRechazaElRolElMigradorFalla(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	// Sin la función (PostgreSQL local), la llamada falla con «function does not exist».
	rol := nuevoRol(t, pool)
	err := bd.RolDeLaAplicacion{Nombre: rol, ObjectID: objectIDDelAPI, EnAzure: true}.Asegurar(ctx, pool)
	if err == nil || !strings.Contains(err.Error(), "crear el rol") {
		t.Fatalf("se esperaba un error al crear el rol: %v", err)
	}
	var existe bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)", rol).Scan(&existe); err != nil || existe {
		t.Errorf("no debía quedar un rol a medias: %v (%v)", existe, err)
	}
}
