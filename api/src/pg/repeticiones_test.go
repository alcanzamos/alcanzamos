package pg

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alcanzamos/alcanzamos/api/src/registro"
)

// La llave de `persona` o de la repetición rota en un INSERT de Decidir es una cuenta que ya no está (401 sin_sesion), y no
// un fallo (500). Con la persona bloqueada al empezar no se alcanza hoy; la traducción es la red de seguridad.
func TestErrorDeDecidirTraduceLasLlavesDeLaCuenta(t *testing.T) {
	for _, c := range []struct {
		nombre string
		err    error
		quiere error
	}{
		{"llave de persona", &pgconn.PgError{Code: "23503", ConstraintName: "fk_movimiento_persona_id"}, registro.ErrSinCuenta},
		{"llave de la repetición", &pgconn.PgError{Code: "23503", ConstraintName: "fk_movimiento_recurrente_id"}, registro.ErrSinCuenta},
		{"bloqueo mutuo", &pgconn.PgError{Code: "40P01"}, registro.ErrConflictoConcurrente},
		{"fecha repetida", &pgconn.PgError{Code: "23505", ConstraintName: "uq_movimiento_recurrente_programada"}, registro.ErrFechaNoPendiente},
	} {
		if err := errorDeDecidir("decidir", c.err); !errors.Is(err, c.quiere) {
			t.Errorf("%s: salió %v y se esperaba %v", c.nombre, err, c.quiere)
		}
	}
	otra := &pgconn.PgError{Code: "23503", ConstraintName: "fk_movimiento_categoria_tipo"}
	if err := errorDeDecidir("decidir", otra); errors.Is(err, registro.ErrSinCuenta) || !errors.Is(err, otra) {
		t.Errorf("otra llave: salió %v y se esperaba el error de la base envuelto", err)
	}
}
