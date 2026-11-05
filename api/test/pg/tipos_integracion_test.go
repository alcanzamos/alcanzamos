//go:build integration

package pg_test

import (
	"context"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/test/pgtest"
)

// DAT-005 (RNF-002, E13): pgx escribe y lee `uuid` y `timestamptz` sin cambiar el valor. El `uuid` va y vuelve como
// `[16]byte` y como texto (el tipo que usa el código, con `$1::uuid`); el instante, con un valor fijo y zonas que no son
// UTC, vuelve como el mismo instante y con los microsegundos que PostgreSQL guarda.
func TestDAT_005UuidYTimestamptzDanElMismoValorDeIdaYVuelta(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Nueva(t)
	conexion, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conexion.Release()
	if _, err := conexion.Exec(ctx, `CREATE TEMP TABLE ida_y_vuelta (n int PRIMARY KEY, id uuid NOT NULL, instante timestamptz NOT NULL)`); err != nil {
		t.Fatal(err)
	}

	crudo := [16]byte{0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0x4d, 0xef, 0x80, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde}
	const texto = "01234567-89ab-4def-8012-3456789abcde"
	bogota := time.FixedZone("UTC-5", -5*3600)
	calcuta := time.FixedZone("UTC+5:30", 5*3600+30*60)

	t.Run("uuid como [16]byte", func(t *testing.T) {
		if _, err := conexion.Exec(ctx, `INSERT INTO ida_y_vuelta VALUES (1, $1, now())`, crudo); err != nil {
			t.Fatal(err)
		}
		var leido [16]byte
		var comoTexto string
		if err := conexion.QueryRow(ctx, `SELECT id, id::text FROM ida_y_vuelta WHERE n = 1`).Scan(&leido, &comoTexto); err != nil {
			t.Fatal(err)
		}
		if leido != crudo || comoTexto != texto {
			t.Errorf("volvió %x y %q, se esperaba %x y %q", leido, comoTexto, crudo, texto)
		}
	})

	t.Run("uuid como texto con ::uuid", func(t *testing.T) {
		if _, err := conexion.Exec(ctx, `INSERT INTO ida_y_vuelta VALUES (2, $1::uuid, now())`, texto); err != nil {
			t.Fatal(err)
		}
		var leido string
		var bytes [16]byte
		if err := conexion.QueryRow(ctx, `SELECT id::text, id FROM ida_y_vuelta WHERE n = 2`).Scan(&leido, &bytes); err != nil {
			t.Fatal(err)
		}
		if leido != texto || bytes != crudo {
			t.Errorf("volvió %q y %x", leido, bytes)
		}
	})

	for i, c := range []struct {
		nombre   string
		instante time.Time
	}{
		{"timestamptz en UTC-5", time.Date(2026, time.November, 5, 23, 59, 59, 123456000, bogota)},
		{"timestamptz en UTC+5:30", time.Date(2026, time.March, 1, 0, 0, 0, 1000, calcuta)},
		{"timestamptz cruzando de día por la zona", time.Date(2026, time.December, 31, 22, 30, 0, 0, bogota)},
	} {
		t.Run(c.nombre, func(t *testing.T) {
			n := 10 + i
			if _, err := conexion.Exec(ctx, `INSERT INTO ida_y_vuelta VALUES ($1, $2::uuid, $3)`, n, texto, c.instante); err != nil {
				t.Fatal(err)
			}
			var leido time.Time
			var epoca string
			if err := conexion.QueryRow(ctx, `SELECT instante, to_char(instante AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') FROM ida_y_vuelta WHERE n = $1`, n).Scan(&leido, &epoca); err != nil {
				t.Fatal(err)
			}
			if !leido.Equal(c.instante) {
				t.Errorf("volvió %v, se esperaba el instante %v", leido, c.instante)
			}
			if esperado := c.instante.UTC().Format("2006-01-02T15:04:05.000000"); epoca != esperado {
				t.Errorf("en la base quedó %s, se esperaba %s", epoca, esperado)
			}
		})
	}
}
