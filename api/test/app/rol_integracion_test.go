//go:build integration

package app_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// nombreDeRolDePrueba da un nombre de rol único para la identidad dada y, al terminar la prueba, le quita sus permisos y lo borra (los
// roles son del clúster).
func nombreDeRolDePrueba(t *testing.T, pool *pgxpool.Pool, aplicacion string) string {
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

// `migrar` con ROLES_DE_APLICACION aplica las migraciones y después crea un rol por identidad con lo justo (E11-INF 2.3 bis y 2.4);
// correrlo otra vez no cambia nada. Fuera de Azure la lista puede traer el object id o no.
func TestMigrarCreaUnRolPorIdentidadConLoJusto(t *testing.T) {
	pool := pgtest.Nueva(t)
	roles := map[string]string{"api": nombreDeRolDePrueba(t, pool, "api"), "tareas": nombreDeRolDePrueba(t, pool, "tareas")}
	t.Setenv("BASE_DE_DATOS_URL", pool.Config().ConnString())
	t.Setenv("ROLES_DE_APLICACION", roles["api"]+"=99999999-8888-7777-6666-555555555555,"+roles["tareas"])

	for vuelta := 1; vuelta <= 2; vuelta++ {
		codigo, salida := ejecutar("migrar")
		if codigo != 0 {
			t.Fatalf("vuelta %d: código %d, registro %s", vuelta, codigo, salida)
		}
		for app, rol := range roles {
			if !strings.Contains(salida, "rol de la aplicación asegurado") || !strings.Contains(salida, rol) {
				t.Fatalf("vuelta %d: falta el rol de %s en el registro: %s", vuelta, app, salida)
			}
		}
	}
	for app, rol := range roles {
		var escribe, ddl, tablaDeControl, escribeCatalogo bool
		err := pool.QueryRow(context.Background(), `SELECT has_table_privilege($1::name, 'persona', 'DELETE'),
			has_schema_privilege($1::name, 'public', 'CREATE'), has_table_privilege($1::name, 'goose_db_version', 'SELECT'),
			has_table_privilege($1::name, 'finalidad', 'INSERT')`, rol).Scan(&escribe, &ddl, &tablaDeControl, &escribeCatalogo)
		if err != nil || !escribe || ddl || tablaDeControl || escribeCatalogo {
			t.Fatalf("%s: escribe %v, crea en el esquema %v, lee la tabla de control %v, escribe el catálogo %v (%v)", app, escribe, ddl, tablaDeControl, escribeCatalogo, err)
		}
	}
}

// Una lista imposible (el del propio migrador, uno reservado, un rol compartido, una variable vieja) hace fallar `migrar` antes de
// aplicar nada: el esquema no queda a medias y no se crea ningún rol.
func TestMigrarConRolesInvalidosFallaAntesDeMigrar(t *testing.T) {
	const bueno = "id-alcanzamos-api-prueba-sin-crear"
	casos := map[string]string{
		"el del migrador": bueno + ",alcanzamos",
		"reservado":       bueno + ",pg_monitor",
		"postgres":        "postgres",
		"inyección":       `a"; DROP TABLE x; --`,
		"rol compartido":  bueno + "," + bueno,
		"entrada vacía":   bueno + ",,otro",
		"object id malo":  bueno + "=no-es-un-guid",
		"misma identidad": bueno + "=99999999-8888-7777-6666-555555555555,otro=99999999-8888-7777-6666-555555555555",
	}
	for nombre, lista := range casos {
		t.Run(nombre, func(t *testing.T) {
			pool := pgtest.NuevaSinMigrar(t)
			t.Setenv("BASE_DE_DATOS_URL", pool.Config().ConnString())
			t.Setenv("PGUSER", "alcanzamos") // el usuario de la URL local, para que el nombre del migrador cuente
			t.Setenv("ROLES_DE_APLICACION", lista)
			comprobarQueNoMigra(t, pool, "ROLES_DE_APLICACION", bueno)
		})
	}
	for _, vieja := range []string{"ROL_API", "ROL_API_OBJECT_ID"} {
		t.Run(vieja, func(t *testing.T) {
			pool := pgtest.NuevaSinMigrar(t)
			t.Setenv("BASE_DE_DATOS_URL", pool.Config().ConnString())
			t.Setenv("ROLES_DE_APLICACION", bueno)
			t.Setenv(vieja, "99999999-8888-7777-6666-555555555555")
			comprobarQueNoMigra(t, pool, vieja, bueno)
		})
	}
}

func comprobarQueNoMigra(t *testing.T, pool *pgxpool.Pool, variable, rol string) {
	t.Helper()
	codigo, salida := ejecutar("migrar")
	if codigo != 1 || !strings.Contains(salida, variable) || strings.Contains(salida, "migraciones aplicadas") {
		t.Fatalf("código %d, se esperaba 1 con un error de %s y sin migrar: %s", codigo, variable, salida)
	}
	var tablas, roles int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'").Scan(&tablas); err != nil || tablas != 0 {
		t.Fatalf("no debía quedar ninguna tabla: %d (%v)", tablas, err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM pg_roles WHERE rolname = $1", rol).Scan(&roles); err != nil || roles != 0 {
		t.Fatalf("no debía crearse el rol %q: %d (%v)", rol, roles, err)
	}
}
