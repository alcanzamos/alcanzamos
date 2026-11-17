//go:build integration

package pg_test

import (
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
	"github.com/alcanzamos/alcanzamos/api/src/pg"
	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/test/correo/correotest"
)

// servicioDeCuentas arma el servicio con las dependencias dadas, y falla la prueba si falta una (NuevoServicio las exige todas).
func servicioDeCuentas(t *testing.T, d cuenta.Dependencias) *cuenta.Servicio {
	t.Helper()
	s, err := cuenta.NuevoServicio(d)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// servicioDeLaPurga es el servicio de cuentas con el repositorio real, el reloj del sistema y un correo falso: para las
// pruebas que solo corren la purga.
func servicioDeLaPurga(t *testing.T, pool *pgxpool.Pool) *cuenta.Servicio {
	t.Helper()
	hora := reloj.Sistema{}
	return servicioDeCuentas(t, cuenta.Dependencias{
		Repo: pg.NuevoCuentas(pool), Correo: &correotest.Falso{}, Politica: seguridad.NuevaPoliticaDeContrasena(),
		Hasher: argon2id.Predeterminado(), Reloj: hora, Limitador: seguridad.NuevoLimitadorDeIntentos(hora),
		Log: slog.New(slog.NewJSONHandler(io.Discard, nil)),
	})
}
