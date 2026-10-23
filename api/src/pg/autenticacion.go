package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autenticacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
)

// Autenticacion implementa autenticacion.Repositorio.
type Autenticacion struct{ pool *pgxpool.Pool }

// NuevoAutenticacion crea el repositorio sobre un pool.
func NuevoAutenticacion(pool *pgxpool.Pool) *Autenticacion { return &Autenticacion{pool: pool} }

// CredencialPorCorreo busca la credencial por el correo del perfil de adulto. La búsqueda usa el índice único del correo.
func (r *Autenticacion) CredencialPorCorreo(ctx context.Context, correo string) (autenticacion.Credencial, error) {
	var c autenticacion.Credencial
	err := r.pool.QueryRow(ctx,
		`SELECT c.persona_id::text, c.hash, pa.correo_verificado
		 FROM perfil_adulto pa JOIN credencial c ON c.persona_id = pa.persona_id
		 WHERE pa.correo = lower(btrim($1))`, correo).Scan(&c.Persona, &c.Hash, &c.Verificada)
	if errors.Is(err, pgx.ErrNoRows) {
		return autenticacion.Credencial{}, autenticacion.ErrNoExiste
	}
	if err != nil {
		return autenticacion.Credencial{}, fmt.Errorf("buscar la credencial: %w", err)
	}
	return c, nil
}

// IniciarSesion guarda la sesión nueva (con el límite de 5 por persona) y mueve el ingreso en la misma transacción:
// `ingreso_anterior = ultimo_ingreso` y `ultimo_ingreso = ahora` (D-134). En el UPDATE, la parte derecha de cada
// asignación ve la fila como estaba, así que en el primer ingreso `ingreso_anterior` queda nulo. La fila queda
// bloqueada hasta el commit: dos inicios simultáneos de la misma cuenta se turnan y el segundo ve el ingreso del primero.
// Con `mejora`, el mismo UPDATE reemplaza `credencial.hash` (D-144) si sigue siendo el verificado: o se guarda todo,
// o nada.
func (r *Autenticacion) IniciarSesion(ctx context.Context, persona string, huella []byte, ahora time.Time, mejora *autenticacion.MejoraDeHash) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)  //nolint:errcheck // sin efecto tras el commit
	var viejo, nuevo string // vacíos: el hash no cambia
	if mejora != nil {
		viejo, nuevo = mejora.Viejo, mejora.Nuevo
	}
	res, err := tx.Exec(ctx,
		`UPDATE credencial SET ingreso_anterior = ultimo_ingreso, ultimo_ingreso = $2,
		   hash = CASE WHEN $3 <> '' AND hash = $3 THEN $4 ELSE hash END
		 WHERE persona_id = $1::uuid`, persona, ahora, viejo, nuevo)
	if err != nil {
		return fmt.Errorf("registrar el ingreso: %w", err)
	}
	if res.RowsAffected() != 1 {
		return errors.New("registrar el ingreso: la cuenta no tiene credencial")
	}
	if err := insertarSesion(ctx, tx, persona, huella, ahora); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// CerrarSesion borra la fila de la sesión: revocar es borrar (E13 §5.3).
func (r *Autenticacion) CerrarSesion(ctx context.Context, huella []byte) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM sesion WHERE hash_token = $1`, huella); err != nil {
		return fmt.Errorf("cerrar la sesión: %w", err)
	}
	return nil
}

// IngresoAnterior lee `credencial.ingreso_anterior`: nulo en el primer ingreso.
func (r *Autenticacion) IngresoAnterior(ctx context.Context, persona string) (*time.Time, error) {
	var anterior *time.Time
	err := r.pool.QueryRow(ctx, `SELECT ingreso_anterior FROM credencial WHERE persona_id = $1::uuid`, persona).Scan(&anterior)
	if err != nil {
		return nil, fmt.Errorf("leer el ingreso anterior: %w", err)
	}
	return anterior, nil
}

// CredencialDe lee el hash y el correo de la persona. El correo es el del perfil de adulto: una persona sin él (un
// menor) no llega a PN-73 por este camino hasta I11 y da error.
func (r *Autenticacion) CredencialDe(ctx context.Context, persona string) (autenticacion.Credencial, error) {
	c := autenticacion.Credencial{Persona: persona}
	err := r.pool.QueryRow(ctx,
		`SELECT c.hash, COALESCE(pa.correo, ''), COALESCE(pa.correo_verificado, false)
		 FROM credencial c LEFT JOIN perfil_adulto pa ON pa.persona_id = c.persona_id
		 WHERE c.persona_id = $1::uuid`, persona).Scan(&c.Hash, &c.Correo, &c.Verificada)
	if err != nil {
		return autenticacion.Credencial{}, fmt.Errorf("leer la credencial: %w", err)
	}
	return c, nil
}

// NuevoEnlaceDeRecuperacion borra los enlaces de recuperación pendientes de la cuenta y guarda el nuevo, en una
// transacción (pedir uno nuevo invalida los pendientes, E13 §5.4). Bloquea el perfil: dos pedidos a la vez no dejan dos
// enlaces vigentes. Sin cuenta, o con el correo sin verificar, no guarda nada y devuelve false: el llamador responde igual.
func (r *Autenticacion) NuevoEnlaceDeRecuperacion(ctx context.Context, correo string, huella []byte, ahora, vence time.Time) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	var persona string
	var verificada bool
	err = tx.QueryRow(ctx,
		`SELECT persona_id::text, correo_verificado FROM perfil_adulto WHERE correo = lower(btrim($1)) FOR UPDATE`,
		correo).Scan(&persona, &verificada)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !verificada) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("buscar la cuenta: %w", err)
	}
	if err := borrarEnlacesDeRecuperacion(ctx, tx, persona); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en)
		 VALUES ($1, $2::uuid, 'recuperacion', $3, $4)`, huella, persona, ahora, vence); err != nil {
		return false, fmt.Errorf("crear el enlace de recuperación: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("confirmar la transacción: %w", err)
	}
	return true, nil
}

func borrarEnlacesDeRecuperacion(ctx context.Context, tx pgx.Tx, persona string) error {
	if _, err := tx.Exec(ctx,
		`DELETE FROM enlace_un_uso WHERE persona_id = $1::uuid AND proposito = 'recuperacion' AND usado_en IS NULL`, persona); err != nil {
		return fmt.Errorf("invalidar los enlaces de recuperación pendientes: %w", err)
	}
	return nil
}

// CorreoDelEnlaceDeRecuperacion lee el correo de la cuenta de un enlace vigente y sin usar, sin consumirlo.
func (r *Autenticacion) CorreoDelEnlaceDeRecuperacion(ctx context.Context, huella []byte, ahora time.Time) (string, error) {
	var correo *string
	err := r.pool.QueryRow(ctx,
		`SELECT pa.correo FROM enlace_un_uso e LEFT JOIN perfil_adulto pa ON pa.persona_id = e.persona_id
		 WHERE e.hash_token = $1 AND e.proposito = 'recuperacion' AND e.usado_en IS NULL AND e.vence_en > $2`,
		huella, ahora).Scan(&correo)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && correo == nil) {
		return "", cuenta.ErrEnlaceInvalido
	}
	if err != nil {
		return "", fmt.Errorf("buscar el enlace de recuperación: %w", err)
	}
	return *correo, nil
}

// FijarContrasenaConEnlace consume el enlace, guarda el hash nuevo y borra todas las sesiones de la persona en una sola
// transacción. El UPDATE del enlace, con las condiciones en el WHERE, es atómico: dos usos simultáneos del mismo enlace
// no pasan los dos.
func (r *Autenticacion) FijarContrasenaConEnlace(ctx context.Context, huella []byte, hash string, ahora time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	var persona string
	err = tx.QueryRow(ctx,
		`UPDATE enlace_un_uso SET usado_en = $2
		 WHERE hash_token = $1 AND proposito = 'recuperacion' AND usado_en IS NULL AND vence_en > $2
		 RETURNING persona_id::text`, huella, ahora).Scan(&persona)
	if errors.Is(err, pgx.ErrNoRows) {
		return cuenta.ErrEnlaceInvalido
	}
	if err != nil {
		return fmt.Errorf("consumir el enlace: %w", err)
	}
	if err := guardarHashYCerrarSesiones(ctx, tx, persona, hash, nil); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// CambiarContrasena guarda el hash nuevo y borra las demás sesiones de la persona, menos `conservar`, en una transacción.
func (r *Autenticacion) CambiarContrasena(ctx context.Context, persona, hash string, conservar []byte) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	if err := guardarHashYCerrarSesiones(ctx, tx, persona, hash, conservar); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// guardarHashYCerrarSesiones pone el hash nuevo (y la credencial deja de ser temporal: la persona eligió esta) y borra
// las sesiones de la persona. Con `conservar` nulo borra todas.
func guardarHashYCerrarSesiones(ctx context.Context, tx pgx.Tx, persona, hash string, conservar []byte) error {
	res, err := tx.Exec(ctx, `UPDATE credencial SET hash = $2, es_temporal = false WHERE persona_id = $1::uuid`, persona, hash)
	if err != nil {
		return fmt.Errorf("guardar la contraseña: %w", err)
	}
	if res.RowsAffected() != 1 {
		return errors.New("guardar la contraseña: la cuenta no tiene credencial")
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM sesion WHERE persona_id = $1::uuid AND ($2::bytea IS NULL OR hash_token <> $2::bytea)`, persona, conservar); err != nil {
		return fmt.Errorf("cerrar las sesiones: %w", err)
	}
	return nil
}
