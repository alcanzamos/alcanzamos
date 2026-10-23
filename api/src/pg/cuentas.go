package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
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

// VerificarCorreo marca el enlace como usado y el correo como verificado en una sola transacción. El UPDATE con las
// condiciones en el WHERE es atómico: dos usos simultáneos del mismo enlace no pasan los dos. Devuelve la persona.
func (r *Cuentas) VerificarCorreo(ctx context.Context, huella []byte, ahora time.Time) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	var persona string
	err = tx.QueryRow(ctx,
		`UPDATE enlace_un_uso SET usado_en = $2
		 WHERE hash_token = $1 AND proposito = 'verificacion' AND usado_en IS NULL AND vence_en > $2
		 RETURNING persona_id::text`, huella, ahora).Scan(&persona)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", cuenta.ErrEnlaceInvalido
	}
	if err != nil {
		return "", fmt.Errorf("consumir el enlace: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE perfil_adulto SET correo_verificado = true WHERE persona_id = $1::uuid`, persona); err != nil {
		return "", fmt.Errorf("verificar el correo: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("confirmar la transacción: %w", err)
	}
	return persona, nil
}

// NuevoEnlaceDeVerificacion borra los enlaces de verificación pendientes de la persona y guarda el nuevo, en una
// transacción: pedir uno nuevo invalida los pendientes (E13 §5.4). Bloquea el perfil, así dos pedidos
// simultáneos no dejan dos enlaces vigentes.
func (r *Cuentas) NuevoEnlaceDeVerificacion(ctx context.Context, persona string, huella []byte, ahora, vence time.Time) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	var correo *string
	var verificado bool
	if err := tx.QueryRow(ctx,
		`SELECT correo, correo_verificado FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE`,
		persona).Scan(&correo, &verificado); err != nil {
		return "", fmt.Errorf("leer el perfil: %w", err)
	}
	if verificado {
		return "", cuenta.ErrYaVerificado
	}
	if correo == nil {
		return "", errors.New("la cuenta no tiene correo que verificar")
	}
	if err := reemplazarEnlace(ctx, tx, persona, huella, ahora, vence); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("confirmar la transacción: %w", err)
	}
	return *correo, nil
}

// reemplazarEnlace borra los enlaces de verificación sin usar de la persona y guarda el nuevo.
func reemplazarEnlace(ctx context.Context, tx pgx.Tx, persona string, huella []byte, ahora, vence time.Time) error {
	if err := invalidarEnlaces(ctx, tx, persona); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en)
		 VALUES ($1, $2::uuid, 'verificacion', $3, $4)`, huella, persona, ahora, vence); err != nil {
		return fmt.Errorf("crear el enlace de verificación: %w", err)
	}
	return nil
}

func invalidarEnlaces(ctx context.Context, tx pgx.Tx, persona string) error {
	if _, err := tx.Exec(ctx,
		`DELETE FROM enlace_un_uso WHERE persona_id = $1::uuid AND proposito = 'verificacion' AND usado_en IS NULL`,
		persona); err != nil {
		return fmt.Errorf("invalidar los enlaces pendientes: %w", err)
	}
	return nil
}

// CambiarCorreoSinVerificar cambia el correo de una cuenta sin verificar con las reglas de D-141 (ver
// cuenta.Repositorio). Toma el candado del correo nuevo, igual que Crear, para turnarse con quien lo esté creando.
func (r *Cuentas) CambiarCorreoSinVerificar(ctx context.Context, persona, nuevo string, huella []byte, ahora, vence time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(lower(btrim($1)), 0))`, nuevo); err != nil {
		return fmt.Errorf("turnarse para cambiar el correo: %w", err)
	}
	var verificado bool
	if err := tx.QueryRow(ctx,
		`SELECT correo_verificado FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE`, persona).Scan(&verificado); err != nil {
		return fmt.Errorf("leer el perfil: %w", err)
	}
	if verificado {
		return cuenta.ErrYaVerificado
	}
	var otra string
	var otraVerificada bool
	err = tx.QueryRow(ctx,
		`SELECT persona_id::text, correo_verificado FROM perfil_adulto WHERE correo = lower(btrim($1)) FOR UPDATE`,
		nuevo).Scan(&otra, &otraVerificada)
	switch {
	case errors.Is(err, pgx.ErrNoRows), err == nil && otra == persona:
	case err != nil:
		return fmt.Errorf("buscar el correo nuevo: %w", err)
	case otraVerificada:
		// El correo es de una cuenta verificada: no cambia nada de la cuenta, y los enlaces pendientes se anulan.
		if err := invalidarEnlaces(ctx, tx, persona); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("confirmar la transacción: %w", err)
		}
		return cuenta.ErrCorreoYaRegistrado
	default:
		// Una cuenta sin verificar con ese correo: se trata como en la creación y se borra (D-141 (1)).
		if _, err := tx.Exec(ctx, `DELETE FROM persona WHERE id = $1::uuid`, otra); err != nil {
			return fmt.Errorf("borrar la cuenta sin verificar del correo nuevo: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE perfil_adulto SET correo = lower(btrim($2)) WHERE persona_id = $1::uuid`, persona, nuevo); err != nil {
		return fmt.Errorf("cambiar el correo: %w", err)
	}
	if err := reemplazarEnlace(ctx, tx, persona, huella, ahora, vence); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// BorrarSinConfirmar borra la persona (ON DELETE CASCADE se lleva perfil, credencial, sesiones, enlaces y datos) de las
// cuentas adultas creadas hasta creadasHasta que no confirmaron el correo o no tienen vigente cada finalidad de
// `necesarias` otorgada por la propia persona (D-135, D-139). Las necesarias las entrega ReglaDeFinalidades: esta
// consulta no repite la lista. Sin llave a la persona, `autorizacion` no se borra en cascada: las que hubiera quedan
// retiradas en `ahora` y conservadas hasta `conservarHasta` (E13 §7). Todo en una sola sentencia.
//
// Quedan fuera: las cuentas que pasaron de menor a adulta (fecha_de_paso), que tienen historia con su tutor y
// no pasan por la verificación de este correo, y las de menores.
func (r *Cuentas) BorrarSinConfirmar(ctx context.Context, creadasHasta, ahora, conservarHasta time.Time, necesarias []string) (int, error) {
	res, err := r.pool.Exec(ctx,
		`WITH candidatas AS (
		     SELECT p.id
		     FROM persona p
		     JOIN perfil_adulto pa ON pa.persona_id = p.id
		     WHERE p.etapa = 'adulta'
		       AND pa.fecha_de_paso IS NULL
		       AND p.creada_en <= $1
		       AND (
		           NOT pa.correo_verificado
		           OR EXISTS (
		               SELECT 1 FROM unnest($4::text[]) AS n(codigo)
		               WHERE NOT EXISTS (
		                   SELECT 1 FROM autorizacion a
		                   WHERE a.titular_id = p.id AND a.otorgante_id = p.id AND a.finalidad = n.codigo AND a.retirada_en IS NULL)
		           )
		       )
		 ), retiradas AS (
		     UPDATE autorizacion a
		        SET retirada_en = GREATEST(a.otorgada_en, $2), conservar_hasta = $3::date
		       FROM candidatas c
		      WHERE a.titular_id = c.id AND a.retirada_en IS NULL
		     RETURNING a.id
		 )
		 DELETE FROM persona p USING candidatas c WHERE p.id = c.id`,
		creadasHasta, ahora, conservarHasta, necesarias)
	if err != nil {
		return 0, fmt.Errorf("borrar las cuentas sin confirmar: %w", err)
	}
	return int(res.RowsAffected()), nil
}
