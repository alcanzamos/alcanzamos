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

// nombreDeRolDePrueba da un nombre de rol único y, al terminar la prueba, le quita sus permisos y lo borra (los roles son del clúster).
func nombreDeRolDePrueba(t *testing.T, pool *pgxpool.Pool) string {
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

// `migrar` con ROL_API aplica las migraciones y después crea el rol del API con lo justo (L24 (b)); correrlo otra vez no cambia nada.
func TestMigrarCreaElRolDelAPIConLoJusto(t *testing.T) {
	pool := pgtest.Nueva(t)
	rol := nombreDeRolDePrueba(t, pool)
	t.Setenv("BASE_DE_DATOS_URL", pool.Config().ConnString())
	t.Setenv("ROL_API", rol)

	for vuelta := 1; vuelta <= 2; vuelta++ {
		codigo, salida := ejecutar("migrar")
		if codigo != 0 || !strings.Contains(salida, "rol del API asegurado") || !strings.Contains(salida, rol) {
			t.Fatalf("vuelta %d: código %d, registro %s", vuelta, codigo, salida)
		}
	}
	var escribe, ddl, tablaDeControl bool
	err := pool.QueryRow(context.Background(), `SELECT has_table_privilege($1::name, 'persona', 'DELETE'),
		has_schema_privilege($1::name, 'public', 'CREATE'), has_table_privilege($1::name, 'goose_db_version', 'SELECT')`, rol).Scan(&escribe, &ddl, &tablaDeControl)
	if err != nil || !escribe || ddl || tablaDeControl {
		t.Fatalf("escribe %v, crea en el esquema %v, lee la tabla de control %v (%v)", escribe, ddl, tablaDeControl, err)
	}
}

// Un rol imposible (el del propio migrador, uno reservado) hace fallar `migrar` antes de aplicar nada: el esquema no queda a medias.
func TestMigrarConUnRolInvalidoFallaAntesDeMigrar(t *testing.T) {
	for _, malo := range []string{"postgres", "alcanzamos", "pg_monitor", `a"; DROP TABLE x; --`} {
		t.Run(malo, func(t *testing.T) {
			pool := pgtest.NuevaSinMigrar(t)
			t.Setenv("BASE_DE_DATOS_URL", pool.Config().ConnString())
			t.Setenv("PGUSER", "alcanzamos") // el usuario de la URL local, para que el nombre del migrador cuente
			t.Setenv("ROL_API", malo)
			codigo, salida := ejecutar("migrar")
			if codigo != 1 || !strings.Contains(salida, "ROL_API") || strings.Contains(salida, "migraciones aplicadas") {
				t.Fatalf("código %d, se esperaba 1 con un error de ROL_API y sin migrar: %s", codigo, salida)
			}
			var tablas int
			if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'").Scan(&tablas); err != nil || tablas != 0 {
				t.Fatalf("no debía quedar ninguna tabla: %d (%v)", tablas, err)
			}
		})
	}
}
