package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
)

const (
	codigoViolacionDeUnico = "23505"
	restriccionDelCorreo   = "uq_perfil_adulto_correo"
	// intentosDeCreacion: si dos creaciones del mismo correo corren a la vez, la segunda choca con la restricción
	// única y se repite, ya viendo la cuenta de la primera.
	intentosDeCreacion = 3
)

// Cuentas implementa cuenta.Repositorio.
type Cuentas struct{ pool *pgxpool.Pool }

// NuevoCuentas crea el repositorio sobre un pool.
func NuevoCuentas(pool *pgxpool.Pool) *Cuentas { return &Cuentas{pool: pool} }

// Crear guarda persona, perfil_adulto, credencial, enlace_un_uso de verificación y la sesión limitada en una sola
// transacción (D-141). El correo se normaliza con lower(btrim()) en la base, que es lo que exige ck_perfil_adulto_correo.
//
//   - Sin cuenta con ese correo: la crea.
//   - Con una cuenta sin verificar: la borra (ON DELETE CASCADE se lleva su perfil, credencial, sesiones y enlaces, así
//     el enlace y la sesión anteriores dejan de servir) y crea la nueva con la contraseña de ahora. Una cuenta sin
//     verificar no tiene datos: no pudo autorizar nada (D-141 (1)).
//   - Con una cuenta verificada: no toca nada y devuelve cuenta.ErrCorreoYaRegistrado.
func (r *Cuentas) Crear(ctx context.Context, c cuenta.NuevaCuenta) (string, error) {
	var err error
	for range intentosDeCreacion {
		var persona string
		persona, err = r.crearUnaVez(ctx, c)
		if !errors.Is(err, errCorreoOcupado) {
			return persona, err
		}
	}
	return "", fmt.Errorf("crear la cuenta: el correo cambió de dueña varias veces seguidas: %w", err)
}

var errCorreoOcupado = errors.New("el correo se ocupó mientras se creaba la cuenta")

func (r *Cuentas) crearUnaVez(ctx context.Context, c cuenta.NuevaCuenta) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	// Dos creaciones del mismo correo a la vez se turnan: sin esto, ninguna ve la cuenta de la otra (no hay fila que
	// bloquear) y se pelearían borrándose la una a la otra. El candado se suelta con la transacción.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(lower(btrim($1)), 0))`, c.Correo); err != nil {
		return "", fmt.Errorf("turnarse para crear la cuenta: %w", err)
	}
	var existente string
	var verificada bool
	err = tx.QueryRow(ctx,
		`SELECT persona_id::text, correo_verificado FROM perfil_adulto WHERE correo = lower(btrim($1)) FOR UPDATE`,
		c.Correo).Scan(&existente, &verificada)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return "", fmt.Errorf("buscar el correo: %w", err)
	case verificada:
		return "", cuenta.ErrCorreoYaRegistrado
	default:
		if _, err := tx.Exec(ctx, `DELETE FROM persona WHERE id = $1::uuid`, existente); err != nil {
			return "", fmt.Errorf("borrar la cuenta sin verificar: %w", err)
		}
	}

	var persona string
	if err := tx.QueryRow(ctx,
		`INSERT INTO persona (nombre, etapa, creada_en) VALUES ($1, 'adulta', $2) RETURNING id::text`,
		c.Nombre, c.Ahora).Scan(&persona); err != nil {
		return "", fmt.Errorf("crear la persona: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO perfil_adulto (persona_id, correo) VALUES ($1::uuid, lower(btrim($2)))`,
		persona, c.Correo); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == codigoViolacionDeUnico && pgErr.ConstraintName == restriccionDelCorreo {
			return "", errCorreoOcupado
		}
		return "", fmt.Errorf("crear el perfil de adulto: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO credencial (persona_id, hash, es_temporal) VALUES ($1::uuid, $2, false)`,
		persona, c.HashContrasena); err != nil {
		return "", fmt.Errorf("crear la credencial: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en)
		 VALUES ($1, $2::uuid, 'verificacion', $3, $4)`,
		c.HuellaDelEnlace, persona, c.Ahora, c.VenceElEnlaceEn); err != nil {
		return "", fmt.Errorf("crear el enlace de verificación: %w", err)
	}
	if err := insertarSesion(ctx, tx, persona, c.HuellaDeSesion, c.Ahora); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("confirmar la transacción: %w", err)
	}
	return persona, nil
}
