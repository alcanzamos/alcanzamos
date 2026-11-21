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

// aplicaciones son las identidades que tienen rol: cada prueba de permisos corre para cada una (E11-INF 2.3 bis y 2.4).
var aplicaciones = []string{"api", "tareas"}

// nuevoRol devuelve un nombre de rol único, y al terminar la prueba le quita sus permisos y lo borra. Los roles son del clúster:
// sin esto quedarían entre pruebas.
func nuevoRol(t *testing.T, pool *pgxpool.Pool) string { return nuevoRolDe(t, pool, "api") }

// nuevoRolDe es nuevoRol con el nombre de la identidad de la aplicación como prefijo.
func nuevoRolDe(t *testing.T, pool *pgxpool.Pool, aplicacion string) string {
	t.Helper()
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	nombre := "id-alcanzamos-" + aplicacion + "-prueba-" + hex.EncodeToString(b)
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

// rolesDeLasAplicaciones crea los nombres de rol de todas las aplicaciones (uno por identidad) y los asegura juntos, como hace `migrar`.
func rolesDeLasAplicaciones(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	roles := map[string]string{}
	var lista []bd.RolDeLaAplicacion
	for _, app := range aplicaciones {
		roles[app] = nuevoRolDe(t, pool, app)
		lista = append(lista, bd.RolDeLaAplicacion{Nombre: roles[app]})
	}
	if err := bd.AsegurarRolesCon(context.Background(), pool, lista, bd.CrearRolLocal); err != nil {
		t.Fatal(err)
	}
	return roles
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
func TestCadaRolDeAplicacionTieneSoloLoJusto(t *testing.T) {
	pool := pgtest.Nueva(t)
	roles := rolesDeLasAplicaciones(t, pool)
	for _, app := range aplicaciones {
		t.Run(app, func(t *testing.T) { comprobarSoloLoJusto(t, pool, roles[app]) })
	}
}

func comprobarSoloLoJusto(t *testing.T, pool *pgxpool.Pool, rol string) {
	t.Helper()

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

// Lo que la aplicación hace de verdad corre, y todo DDL y toda administración se rechaza con «permiso denegado» (42501). CREATE DATABASE no se
// prueba aquí (no corre dentro de una transacción): rolcreatedb falso se comprueba en la prueba de arriba.
func TestCadaRolDeAplicacionEscribeYNoPuedeHacerDDLNiAdministrar(t *testing.T) {
	pool := pgtest.Nueva(t)
	roles := rolesDeLasAplicaciones(t, pool)
	for _, app := range aplicaciones {
		t.Run(app, func(t *testing.T) { comprobarEscribeYNoAdministra(t, pool, roles[app]) })
	}
}

func comprobarEscribeYNoAdministra(t *testing.T, pool *pgxpool.Pool, rol string) {
	t.Helper()
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
// nuevas y deja cada rol exactamente como se define, aunque alguien le haya dado de más o de menos.
func TestAsegurarLosRolesEsIdempotenteYAlcanzaLasTablasNuevas(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	roles := rolesDeLasAplicaciones(t, pool)
	var lista []bd.RolDeLaAplicacion
	for _, app := range aplicaciones {
		lista = append(lista, bd.RolDeLaAplicacion{Nombre: roles[app]})
	}
	if err := bd.AsegurarRolesCon(ctx, pool, lista, bd.CrearRolLocal); err != nil { // la segunda vuelta: los roles ya existen
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, "CREATE TABLE tabla_de_una_migracion_nueva (id int PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	for _, app := range aplicaciones {
		if tienePermiso(t, pool, roles[app], "tabla_de_una_migracion_nueva", "SELECT") {
			t.Fatalf("%s: una tabla nueva no debe quedar abierta antes de volver a asegurar el rol", app)
		}
		// Alguien le da de más (TRUNCATE, la tabla de control, escribir el catálogo), o le quita lo que sí necesita.
		id := pgx.Identifier{roles[app]}.Sanitize()
		for _, sentencia := range []string{
			"GRANT TRUNCATE ON persona TO " + id,
			"GRANT ALL ON goose_db_version TO " + id,
			"GRANT INSERT ON finalidad TO " + id,
			"REVOKE DELETE ON sesion FROM " + id,
			"GRANT CREATE ON SCHEMA public TO " + id,
		} {
			if _, err := pool.Exec(ctx, sentencia); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := bd.AsegurarRolesCon(ctx, pool, lista, bd.CrearRolLocal); err != nil {
		t.Fatal(err)
	}
	for _, app := range aplicaciones {
		rol := roles[app]
		quiere := map[[2]string]bool{
			{"tabla_de_una_migracion_nueva", "SELECT"}: true, {"tabla_de_una_migracion_nueva", "DELETE"}: true, {"tabla_de_una_migracion_nueva", "TRUNCATE"}: false,
			{"persona", "TRUNCATE"}: false, {"goose_db_version", "SELECT"}: false, {"finalidad", "INSERT"}: false, {"sesion", "DELETE"}: true,
		}
		for k, v := range quiere {
			if got := tienePermiso(t, pool, rol, k[0], k[1]); got != v {
				t.Errorf("%s: %s sobre %s: %v, se esperaba %v", app, k[1], k[0], got, v)
			}
		}
		var creaEnEsquema bool
		if err := pool.QueryRow(ctx, "SELECT has_schema_privilege($1::name, 'public', 'CREATE')", rol).Scan(&creaEnEsquema); err != nil || creaEnEsquema {
			t.Errorf("%s: CREATE sobre el esquema debía quedar quitado: %v (%v)", app, creaEnEsquema, err)
		}
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
// sin administración, y se comprueba con pgaadauth_list_principals(false), que devuelve TABLE(rolename name, principalType text, objectId
// text, tenantId text, isMfa integer, isAdmin integer) (https://learn.microsoft.com/en-us/azure/postgresql/security/security-manage-entra-users).
// Aquí las dos funciones son una copia mínima que anota cómo las llamaron y qué roles son de Entra, porque PostgreSQL local no las trae. Las
// columnas llevan comillas y mayúsculas, como las documenta Microsoft; las pruebas de reemplazarListaDeEntra las cambian de orden, de
// mayúsculas o de nombre para comprobar que el código las busca por nombre y no por posición.
const funcionDeEntraFalsa = `
CREATE TABLE llamadas_a_entra (nombre text, object_id text, tipo text, es_admin boolean, es_mfa boolean);
CREATE TABLE principales_de_entra (rolename name, "principalType" text, "objectId" text, "tenantId" text, "isMfa" integer, "isAdmin" integer);
CREATE FUNCTION pgaadauth_create_principal_with_oid(nombre text, object_id text, tipo text, es_admin boolean, es_mfa boolean)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO llamadas_a_entra VALUES (nombre, object_id, tipo, es_admin, es_mfa);
  EXECUTE format('CREATE ROLE %I LOGIN', nombre);
  INSERT INTO principales_de_entra VALUES (nombre, tipo, object_id, '00000000-0000-0000-0000-000000000000', CASE WHEN es_mfa THEN 1 ELSE 0 END, CASE WHEN es_admin THEN 1 ELSE 0 END);
  RETURN 'Created role for ' || nombre;
END $f$;
CREATE FUNCTION pgaadauth_list_principals(isadminvalue boolean)
RETURNS TABLE (rolename name, "principalType" text, "objectId" text, "tenantId" text, "isMfa" integer, "isAdmin" integer)
LANGUAGE sql AS $f$
  SELECT * FROM principales_de_entra WHERE NOT isadminvalue OR "isAdmin" = 1;
$f$;`

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

func TestEnAzureCadaRolSeCreaConLaFuncionDeEntraComoServicioYSinAdministracion(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	if _, err := pool.Exec(ctx, funcionDeEntraFalsa); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{"api": objectIDDelAPI, "tareas": objectIDDeTareas}
	roles := map[string]string{}
	var lista []bd.RolDeLaAplicacion
	for _, app := range aplicaciones {
		roles[app] = nuevoRolDe(t, pool, app)
		lista = append(lista, bd.RolDeLaAplicacion{Nombre: roles[app], ObjectID: ids[app], EnAzure: true})
	}
	for i := 0; i < 2; i++ { // la segunda vez los roles ya existen: no se vuelven a crear
		if err := bd.AsegurarRoles(ctx, pool, lista); err != nil {
			t.Fatalf("vuelta %d: %v", i+1, err)
		}
	}
	llamadas := llamadasAEntra(t, pool)
	if len(llamadas) != len(aplicaciones) {
		t.Fatalf("se esperaba una sola llamada por rol: %v", llamadas)
	}
	for _, app := range aplicaciones {
		quiere := [5]string{roles[app], ids[app], "service", "false", "false"}
		if !slices.Contains(llamadas, quiere) {
			t.Errorf("%s: falta la llamada (nombre, object id, 'service', no administrador, sin MFA) %v en %v", app, quiere, llamadas)
		}
		if !tienePermiso(t, pool, roles[app], "persona", "DELETE") || tienePermiso(t, pool, roles[app], "goose_db_version", "SELECT") {
			t.Errorf("%s: el rol de Entra queda con los mismos permisos justos", app)
		}
		if codigo := intentar(t, pool, roles[app], "CREATE TABLE intrusa (a int)"); codigo != "42501" {
			t.Errorf("%s: el rol de Entra tampoco hace DDL: %q", app, codigo)
		}
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

// La lista se valida entera antes de crear nada: un rol compartido (el mismo nombre dos veces), una identidad con dos roles, un nombre
// peligroso o el del migrador no dejan ningún rol creado, ni siquiera el bueno que va antes.
func TestAsegurarLosRolesRechazaLaListaEnteraSinCrearNada(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	var yo string
	if err := pool.QueryRow(ctx, "SELECT current_user").Scan(&yo); err != nil {
		t.Fatal(err)
	}
	bueno := nuevoRolDe(t, pool, "api")
	compartido := nuevoRolDe(t, pool, "compartido")
	casos := map[string][]bd.RolDeLaAplicacion{
		"nombre repetido":     {{Nombre: bueno}, {Nombre: compartido}, {Nombre: compartido}},
		"otra capitalización": {{Nombre: bueno}, {Nombre: compartido}, {Nombre: strings.ToUpper(compartido)}},
		"misma identidad":     {{Nombre: bueno, ObjectID: objectIDDelAPI}, {Nombre: compartido, ObjectID: objectIDDelAPI}},
		"nombre peligroso":    {{Nombre: bueno}, {Nombre: `x"; DROP TABLE persona; --`}},
		"nombre del migrador": {{Nombre: bueno}, {Nombre: yo}},
		"nombre reservado":    {{Nombre: bueno}, {Nombre: "pg_monitor"}},
	}
	for nombre, lista := range casos {
		var antes, despues int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM pg_roles").Scan(&antes); err != nil {
			t.Fatal(err)
		}
		if err := bd.AsegurarRolesCon(ctx, pool, lista, bd.CrearRolLocal); err == nil {
			t.Errorf("%s: la lista debía rechazarse", nombre)
		}
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM pg_roles").Scan(&despues); err != nil || despues != antes {
			t.Errorf("%s: roles antes %d y después %d: no debía crearse ninguno (%v)", nombre, antes, despues, err)
		}
		if tienePermiso(t, pool, yo, "persona", "DELETE") == false {
			t.Errorf("%s: el migrador debía conservar sus permisos", nombre)
		}
	}
}

// Los permisos de un rol no dependen del otro: quitarle lo suyo a uno no toca al otro, y asegurar uno solo no abre nada al que falta.
func TestLosRolesDeAplicacionNoSeAfectanEntreSi(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	api, tareas := nuevoRolDe(t, pool, "api"), nuevoRolDe(t, pool, "tareas")
	if err := asegurar(t, pool, api); err != nil {
		t.Fatal(err)
	}
	var existe bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)", tareas).Scan(&existe); err != nil || existe {
		t.Fatalf("asegurar un rol no crea el otro: %v (%v)", existe, err)
	}
	if err := asegurar(t, pool, tareas); err != nil {
		t.Fatal(err)
	}
	for _, rol := range []string{api, tareas} {
		var miembro bool
		if err := pool.QueryRow(ctx, "SELECT pg_has_role($1::name, $2::name, 'MEMBER')", rol, map[string]string{api: tareas, tareas: api}[rol]).Scan(&miembro); err != nil || miembro {
			t.Errorf("%s no debe ser miembro del otro rol: %v (%v)", rol, miembro, err)
		}
	}
	if _, err := pool.Exec(ctx, "REVOKE SELECT ON persona FROM "+pgx.Identifier{api}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	if !tienePermiso(t, pool, tareas, "persona", "SELECT") {
		t.Error("quitarle un permiso a un rol no debe tocar al otro")
	}
}

// asegurarEnAzure corre Asegurar con la función de Entra falsa y el object id dado.
func asegurarEnAzure(t *testing.T, pool *pgxpool.Pool, nombre, objectID string) error {
	t.Helper()
	return bd.RolDeLaAplicacion{Nombre: nombre, ObjectID: objectID, EnAzure: true}.Asegurar(context.Background(), pool)
}

// darDeMas deja una marca en el rol: un permiso directo que ninguna ruta de Asegurar conserva (darLoJusto lo quitaría). Si después de un
// rechazo la marca sigue, el rol no se tocó.
func darDeMas(t *testing.T, pool *pgxpool.Pool, rol string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), "GRANT INSERT ON finalidad TO "+pgx.Identifier{rol}.Sanitize()); err != nil {
		t.Fatal(err)
	}
}

func comprobarSinTocar(t *testing.T, pool *pgxpool.Pool, rol string) {
	t.Helper()
	if !tienePermiso(t, pool, rol, "finalidad", "INSERT") {
		t.Errorf("el rol %s se tocó: la marca (INSERT sobre finalidad) ya no está", rol)
	}
	if tienePermiso(t, pool, rol, "persona", "DELETE") {
		t.Errorf("el rol %s se tocó: ahora puede borrar personas", rol)
	}
}

func sql(t *testing.T, pool *pgxpool.Pool, sentencias ...string) {
	t.Helper()
	for _, s := range sentencias {
		if _, err := pool.Exec(context.Background(), s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

// Un rol de aplicación termina con exactamente los permisos mínimos: si es miembro de CUALQUIER otro rol (pg_read_all_data, un grupo
// ordinario con CREATE en el esquema o con TRUNCATE) heredaría de más y darLoJusto no lo puede quitar, así que falla cerrado, nombra al
// grupo y no toca nada del rol. No se quitan membresías en silencio.
func TestAsegurarRechazaUnRolMiembroDeCualquierOtroRolSinTocarlo(t *testing.T) {
	pool := pgtest.Nueva(t)
	casos := map[string]func(t *testing.T) string{ // devuelve el nombre del grupo
		"pg_read_all_data": func(*testing.T) string { return "pg_read_all_data" },
		"grupo con CREATE en el esquema": func(t *testing.T) string {
			g := nuevoRolDe(t, pool, "grupo")
			sql(t, pool, "CREATE ROLE "+pgx.Identifier{g}.Sanitize()+" NOLOGIN", "GRANT CREATE ON SCHEMA public TO "+pgx.Identifier{g}.Sanitize())
			return g
		},
		"grupo con TRUNCATE": func(t *testing.T) string {
			g := nuevoRolDe(t, pool, "grupo")
			sql(t, pool, "CREATE ROLE "+pgx.Identifier{g}.Sanitize()+" NOLOGIN", "GRANT TRUNCATE ON persona TO "+pgx.Identifier{g}.Sanitize())
			return g
		},
		"grupo sin ningún permiso": func(t *testing.T) string {
			g := nuevoRolDe(t, pool, "grupo")
			sql(t, pool, "CREATE ROLE "+pgx.Identifier{g}.Sanitize()+" NOLOGIN")
			return g
		},
	}
	for _, app := range aplicaciones {
		for nombre, preparar := range casos {
			t.Run(app+"/"+nombre, func(t *testing.T) {
				grupo := preparar(t)
				rol := nuevoRolDe(t, pool, app)
				sql(t, pool, "CREATE ROLE "+pgx.Identifier{rol}.Sanitize()+" LOGIN", "GRANT "+pgx.Identifier{grupo}.Sanitize()+" TO "+pgx.Identifier{rol}.Sanitize())
				darDeMas(t, pool, rol)
				err := asegurar(t, pool, rol)
				if err == nil || !strings.Contains(err.Error(), grupo) || !strings.Contains(err.Error(), rol) {
					t.Fatalf("un miembro de %s debía rechazarse nombrando al rol y al grupo: %v", grupo, err)
				}
				comprobarSinTocar(t, pool, rol)
				var miembroDe int
				if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1`, rol).Scan(&miembroDe); err != nil || miembroDe != 1 {
					t.Errorf("la membresía no se quita en silencio: %d (%v)", miembroDe, err)
				}
			})
		}
	}
}

// La lista se revisa entera antes de tocar nada: un rol malo no deja asegurado, ni creado, al bueno que va antes.
func TestAsegurarLosRolesConUnMiembroDeOtroRolNoTocaNiCreaNingunoDeLaLista(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	nuevo, malo := nuevoRolDe(t, pool, "api"), nuevoRolDe(t, pool, "tareas")
	sql(t, pool, "CREATE ROLE "+pgx.Identifier{malo}.Sanitize()+" LOGIN", "GRANT pg_read_all_data TO "+pgx.Identifier{malo}.Sanitize())
	darDeMas(t, pool, malo)
	err := bd.AsegurarRolesCon(ctx, pool, []bd.RolDeLaAplicacion{{Nombre: nuevo}, {Nombre: malo}}, bd.CrearRolLocal)
	if err == nil || !strings.Contains(err.Error(), "pg_read_all_data") {
		t.Fatalf("se esperaba el rechazo nombrando pg_read_all_data: %v", err)
	}
	var existe bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)", nuevo).Scan(&existe); err != nil || existe {
		t.Errorf("el rol bueno no debía crearse: %v (%v)", existe, err)
	}
	comprobarSinTocar(t, pool, malo)
}

// En Azure un rol que ya existe tiene que ser un principal de Entra ligado al object id configurado: con otro object id, o sin ser de
// Entra, falla cerrado y no toca nada del rol (otra identidad con el mismo nombre no puede quedarse con los permisos del API).
func TestEnAzureUnRolExistenteSoloSeAceptaLigadoAlObjectIDConfigurado(t *testing.T) {
	pool := pgtest.Nueva(t)
	sql(t, pool, funcionDeEntraFalsa)
	otroID := "12345678-1234-1234-1234-123456789abc"
	ids := map[string]string{"api": objectIDDelAPI, "tareas": objectIDDeTareas}
	for _, app := range aplicaciones {
		t.Run(app+"/otro object id", func(t *testing.T) {
			rol := nuevoRolDe(t, pool, app)
			sql(t, pool, "SELECT pgaadauth_create_principal_with_oid('"+rol+"', '"+otroID+"', 'service', false, false)")
			darDeMas(t, pool, rol)
			err := asegurarEnAzure(t, pool, rol, ids[app])
			if err == nil || !strings.Contains(err.Error(), rol) || !strings.Contains(err.Error(), "object id") || !strings.Contains(err.Error(), otroID) {
				t.Fatalf("un rol de otro object id debía rechazarse nombrando al rol y al object id: %v", err)
			}
			comprobarSinTocar(t, pool, rol)
		})
		t.Run(app+"/no es de Entra", func(t *testing.T) {
			rol := nuevoRolDe(t, pool, app)
			sql(t, pool, "CREATE ROLE "+pgx.Identifier{rol}.Sanitize()+" LOGIN")
			darDeMas(t, pool, rol)
			err := asegurarEnAzure(t, pool, rol, ids[app])
			if err == nil || !strings.Contains(err.Error(), rol) || !strings.Contains(err.Error(), "Entra") {
				t.Fatalf("un rol que no es de Entra debía rechazarse: %v", err)
			}
			comprobarSinTocar(t, pool, rol)
		})
		t.Run(app+"/mismo object id en otras mayúsculas", func(t *testing.T) {
			rol := nuevoRolDe(t, pool, app)
			sql(t, pool, "SELECT pgaadauth_create_principal_with_oid('"+rol+"', '"+ids[app]+"', 'service', false, false)")
			if err := asegurarEnAzure(t, pool, rol, strings.ToUpper(ids[app])); err != nil {
				t.Fatalf("el mismo object id (sin distinguir mayúsculas) debía aceptarse: %v", err)
			}
			if !tienePermiso(t, pool, rol, "persona", "DELETE") {
				t.Error("el rol aceptado queda con lo justo")
			}
		})
	}
}

// reemplazarListaDeEntra redefine pgaadauth_list_principals con otras columnas (la sección `columnas` es el TABLE(...) y `seleccion` la lista
// de columnas de principales_de_entra que las llena, en el mismo orden): sirve para probar que el código lee por nombre, no por posición.
func reemplazarListaDeEntra(t *testing.T, pool *pgxpool.Pool, columnas, seleccion string) {
	t.Helper()
	sql(t, pool, "DROP FUNCTION pgaadauth_list_principals(boolean)",
		"CREATE FUNCTION pgaadauth_list_principals(isadminvalue boolean) RETURNS TABLE ("+columnas+") LANGUAGE sql AS $f$ "+
			`SELECT `+seleccion+` FROM principales_de_entra WHERE NOT isadminvalue OR "isAdmin" = 1; $f$`)
	pool.Reset() // las conexiones guardan el plan con las columnas de antes ("cached plan must not change result type")
}

// Las columnas de pgaadauth_list_principals se leen por nombre (rolename y objectId), no por posición: con otro orden, o con los nombres
// en minúsculas (como los plegaría PostgreSQL sin comillas), el rol de Entra con su object id se acepta igual. Cada uno para api y tareas.
func TestEnAzureLasColumnasDeLaListaDeEntraSeLeenPorNombre(t *testing.T) {
	pool := pgtest.Nueva(t)
	sql(t, pool, funcionDeEntraFalsa)
	ids := map[string]string{"api": objectIDDelAPI, "tareas": objectIDDeTareas}
	variantes := map[string][2]string{
		"otro orden": {`"tenantId" text, "isAdmin" integer, "objectId" text, "isMfa" integer, "principalType" text, rolename name`,
			`"tenantId", "isAdmin", "objectId", "isMfa", "principalType", rolename`},
		"con el object id primero": {`"objectId" text, rolename name, "principalType" text, "tenantId" text, "isMfa" integer, "isAdmin" integer`,
			`"objectId", rolename, "principalType", "tenantId", "isMfa", "isAdmin"`},
		"en minúsculas": {`rolename name, principaltype text, objectid text, tenantid text, ismfa integer, isadmin integer`,
			`rolename, "principalType", "objectId", "tenantId", "isMfa", "isAdmin"`},
	}
	for nombre, v := range variantes {
		reemplazarListaDeEntra(t, pool, v[0], v[1])
		for _, app := range aplicaciones {
			t.Run(nombre+"/"+app, func(t *testing.T) {
				rol := nuevoRolDe(t, pool, app)
				sql(t, pool, "SELECT pgaadauth_create_principal_with_oid('"+rol+"', '"+ids[app]+"', 'service', false, false)")
				if err := asegurarEnAzure(t, pool, rol, ids[app]); err != nil {
					t.Fatalf("el rol de Entra con su object id debía aceptarse: %v", err)
				}
				if !tienePermiso(t, pool, rol, "persona", "DELETE") {
					t.Error("el rol aceptado queda con lo justo")
				}
				// Y con otro object id sigue rechazado: leer por nombre no relaja la comparación.
				otro := nuevoRolDe(t, pool, app)
				sql(t, pool, "SELECT pgaadauth_create_principal_with_oid('"+otro+"', '12345678-1234-1234-1234-123456789abc', 'service', false, false)")
				if err := asegurarEnAzure(t, pool, otro, ids[app]); err == nil || !strings.Contains(err.Error(), "otro object id") {
					t.Fatalf("otro object id debía rechazarse: %v", err)
				}
			})
		}
	}
}

// Si la función de Entra no devuelve la columna rolename o la objectId (falta, está renombrada, aparece dos veces o no es texto), el rol se rechaza: falla
// cerrado, nombra la columna que falta y la función, y no toca nada del rol. Aunque la función no devuelva filas y el rol exista: sin la
// columna no se puede saber a qué object id está ligado. Cada uno para api y tareas.
func TestEnAzureSinLaColumnaDeLaListaDeEntraFallaCerrado(t *testing.T) {
	pool := pgtest.Nueva(t)
	sql(t, pool, funcionDeEntraFalsa)
	ids := map[string]string{"api": objectIDDelAPI, "tareas": objectIDDeTareas}
	casos := []struct{ nombre, columnas, seleccion, falta string }{
		{"objectId renombrada", `rolename name, "principalType" text, "principalId" text, "tenantId" text`, `rolename, "principalType", "objectId", "tenantId"`, "objectId"},
		{"sin objectId", `rolename name, "principalType" text, "tenantId" text`, `rolename, "principalType", "tenantId"`, "objectId"},
		{"rolename renombrada", `"roleName2" name, "principalType" text, "objectId" text`, `rolename, "principalType", "objectId"`, "rolename"},
		{"sin rolename", `"principalType" text, "objectId" text, "tenantId" text`, `"principalType", "objectId", "tenantId"`, "rolename"},
		{"objectId que no es texto", `rolename name, "principalType" text, "objectId" uuid`, `rolename, "principalType", "objectId"::uuid`, "objectId"},
		{"objectId repetida", `rolename name, "principalType" text, "objectId" text, objectid text`, `rolename, "principalType", "objectId", "objectId"`, "objectId"},
		// Dos columnas rolename que solo difieren en mayúsculas: ambiguas, se rechazan igual que objectId repetida.
		{"rolename repetida", `rolename name, "ROLENAME" name, "principalType" text, "objectId" text`, `rolename, rolename, "principalType", "objectId"`, "rolename"},
	}
	for _, c := range casos {
		reemplazarListaDeEntra(t, pool, c.columnas, c.seleccion)
		for _, app := range aplicaciones {
			t.Run(c.nombre+"/"+app, func(t *testing.T) {
				rol := nuevoRolDe(t, pool, app)
				sql(t, pool, "SELECT pgaadauth_create_principal_with_oid('"+rol+"', '"+ids[app]+"', 'service', false, false)")
				darDeMas(t, pool, rol)
				err := asegurarEnAzure(t, pool, rol, ids[app])
				if err == nil || !strings.Contains(err.Error(), rol) || !strings.Contains(err.Error(), "pgaadauth_list_principals") || !strings.Contains(err.Error(), c.falta) {
					t.Fatalf("sin la columna %s debía fallar cerrado nombrando al rol, la función y la columna: %v", c.falta, err)
				}
				comprobarSinTocar(t, pool, rol)
			})
		}
	}
	t.Run("sin filas", func(t *testing.T) {
		reemplazarListaDeEntra(t, pool, `rolename name, "principalType" text, "principalId" text`, `rolename, "principalType", "objectId"`)
		sql(t, pool, "DELETE FROM principales_de_entra")
		rol := nuevoRolDe(t, pool, "api")
		sql(t, pool, "CREATE ROLE "+pgx.Identifier{rol}.Sanitize()+" LOGIN")
		darDeMas(t, pool, rol)
		err := asegurarEnAzure(t, pool, rol, objectIDDelAPI)
		if err == nil || !strings.Contains(err.Error(), "objectId") {
			t.Fatalf("sin filas y sin la columna también debía nombrar la columna que falta: %v", err)
		}
		comprobarSinTocar(t, pool, rol)
	})
}

// ValidarRoles (solo lectura, lo que corre `migrar` antes de migrar) también falla cerrado sin la columna, y no crea nada.
func TestValidarRolesFallaCerradoSinLaColumnaDeLaListaDeEntra(t *testing.T) {
	pool := pgtest.NuevaSinMigrar(t)
	sql(t, pool, funcionDeEntraFalsa)
	rol := nuevoRolDe(t, pool, "api")
	sql(t, pool, "SELECT pgaadauth_create_principal_with_oid('"+rol+"', '"+objectIDDelAPI+"', 'service', false, false)")
	reemplazarListaDeEntra(t, pool, `rolename name, "principalId" text`, `rolename, "objectId"`)
	err := bd.ValidarRoles(context.Background(), pool, []bd.RolDeLaAplicacion{{Nombre: rol, ObjectID: objectIDDelAPI, EnAzure: true}})
	if err == nil || !strings.Contains(err.Error(), "objectId") || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") {
		t.Fatalf("se esperaba el rechazo nombrando la columna y la variable: %v", err)
	}
}

// ValidarRoles (lo que corre `migrar` antes de migrar) revisa en solo lectura toda la lista, también el object id en Azure, y no crea
// ni toca nada.
func TestValidarRolesRevisaLaListaEnteraEnSoloLectura(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.NuevaSinMigrar(t)
	sql(t, pool, funcionDeEntraFalsa)
	bueno, ajeno := nuevoRolDe(t, pool, "api"), nuevoRolDe(t, pool, "tareas")
	sql(t, pool, "SELECT pgaadauth_create_principal_with_oid('"+ajeno+"', '12345678-1234-1234-1234-123456789abc', 'service', false, false)")
	llamadas := len(llamadasAEntra(t, pool))
	lista := []bd.RolDeLaAplicacion{{Nombre: bueno, ObjectID: objectIDDelAPI, EnAzure: true}, {Nombre: ajeno, ObjectID: objectIDDeTareas, EnAzure: true}}
	if err := bd.ValidarRoles(ctx, pool, lista); err == nil || !strings.Contains(err.Error(), ajeno) || !strings.Contains(err.Error(), "ROLES_DE_APLICACION") {
		t.Fatalf("se esperaba el rechazo del rol de otro object id, nombrando la variable: %v", err)
	}
	if err := bd.ValidarRoles(ctx, pool, lista[:1]); err != nil {
		t.Fatalf("un rol que todavía no existe es válido: %v", err)
	}
	var existe bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)", bueno).Scan(&existe); err != nil || existe {
		t.Errorf("validar no crea roles: %v (%v)", existe, err)
	}
	if n := len(llamadasAEntra(t, pool)); n != llamadas {
		t.Errorf("validar no llama a la función de creación: %d llamadas nuevas", n-llamadas)
	}
}
