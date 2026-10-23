package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
)

// Sesiones es el almacén de sesiones en PostgreSQL (E13 §5.3, D-081) y el ResolutorDeSujeto de E12: implementa
// sesion.Almacen. En la base solo está el SHA-256 del token; nunca el token.
type Sesiones struct {
	pool  *pgxpool.Pool
	regla cuenta.ReglaDeFinalidades
}

// NuevoSesiones crea el almacén sobre un pool.
func NuevoSesiones(pool *pgxpool.Pool) *Sesiones { return &Sesiones{pool: pool} }

// Crear guarda una sesión nueva de la persona y, en la misma transacción, borra las menos recientes hasta dejar 5.
// Vence a los 30 días de `ahora` (el tope de 90 desde la creación solo se alcanza deslizando). Cada sesión lleva un
// token nuevo: nunca se reutiliza ni se renueva el de otra (ADR-002 §5.2, contra la fijación de sesión).
func (s *Sesiones) Crear(ctx context.Context, persona string, huella []byte, ahora time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit
	if err := insertarSesion(ctx, tx, persona, huella, ahora); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// Sujeto busca la sesión por la clave primaria (el SHA-256 del token), comprueba que no venció y desliza su
// vencimiento: `ultimo_uso_en` solo se escribe si pasaron más de 5 minutos desde el anterior, y
// `vence_en = menor(ahora + 30 días, creada_en + 90 días)`. Con la sesión vigente arma el Sujeto: si la cuenta
// confirmó el correo y si tiene autorizadas las finalidades necesarias de su etapa según `ReglaDeFinalidades` (D-139).
// Una persona menor no tiene correo que verificar: su `Verificada` queda en falso y no llega más allá de las rutas
// `sin_verificar` hasta que I11 defina su ingreso. Se lee en
// cada petición, sin guardar el resultado: retirar una autorización surte efecto al instante.
func (s *Sesiones) Sujeto(ctx context.Context, huella []byte, ahora time.Time) (seguridad.Sujeto, error) {
	var persona string
	var etapa cuenta.Etapa
	var verificada bool
	var ultimoUso time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT s.persona_id::text, p.etapa, COALESCE(pa.correo_verificado, false), s.ultimo_uso_en
		 FROM sesion s
		 JOIN persona p ON p.id = s.persona_id
		 LEFT JOIN perfil_adulto pa ON pa.persona_id = p.id
		 WHERE s.hash_token = $1 AND s.vence_en > $2`, huella, ahora).Scan(&persona, &etapa, &verificada, &ultimoUso)
	if errors.Is(err, pgx.ErrNoRows) {
		return seguridad.Sujeto{}, seguridad.ErrSinSesion
	}
	if err != nil {
		return seguridad.Sujeto{}, fmt.Errorf("buscar la sesión: %w", err)
	}
	if ahora.Sub(ultimoUso) > sesion.IntervaloDeEscritura {
		if _, err := s.pool.Exec(ctx,
			`UPDATE sesion SET ultimo_uso_en = $2, vence_en = LEAST($2::timestamptz + $3::interval, creada_en + $4::interval)
			 WHERE hash_token = $1`,
			huella, ahora, sesion.Vigencia, sesion.Tope); err != nil {
			return seguridad.Sujeto{}, fmt.Errorf("deslizar la sesión: %w", err)
		}
	}
	// «Autorizada» no depende de «verificada»: son dos hechos distintos y Sujeto.Alcanza exige los dos donde hace falta.
	autorizada, err := s.autorizada(ctx, persona, etapa)
	if err != nil {
		return seguridad.Sujeto{}, err
	}
	return seguridad.Sujeto{Persona: persona, Verificada: verificada, Autorizada: autorizada}, nil
}

// autorizada pregunta a ReglaDeFinalidades si el titular tiene vigentes (retirada_en nula) las necesarias de su etapa,
// otorgadas por quien la regla dice: él mismo, o uno de sus tutores si es menor.
func (s *Sesiones) autorizada(ctx context.Context, persona string, etapa cuenta.Etapa) (bool, error) {
	filas, err := s.pool.Query(ctx,
		`SELECT finalidad, otorgante_id::text FROM autorizacion WHERE titular_id = $1::uuid AND retirada_en IS NULL`, persona)
	if err != nil {
		return false, fmt.Errorf("consultar las autorizaciones: %w", err)
	}
	vigentes, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (cuenta.Otorgamiento, error) {
		var o cuenta.Otorgamiento
		return o, f.Scan(&o.Finalidad, &o.OtorganteID)
	})
	if err != nil {
		return false, fmt.Errorf("leer las autorizaciones: %w", err)
	}
	var tutores []string
	if etapa == cuenta.EtapaMenor {
		filas, err := s.pool.Query(ctx, `SELECT tutor_id::text FROM tutoria WHERE menor_id = $1::uuid`, persona)
		if err != nil {
			return false, fmt.Errorf("consultar los tutores: %w", err)
		}
		if tutores, err = pgx.CollectRows(filas, pgx.RowTo[string]); err != nil {
			return false, fmt.Errorf("leer los tutores: %w", err)
		}
	}
	return s.regla.Cumple(etapa, persona, vigentes, tutores), nil
}

// insertarSesion guarda la sesión con su vencimiento deslizante de 30 días y, en la misma transacción, borra las
// menos recientes de la persona hasta dejar 5 (E13 §5.3). El límite no es una restricción: dos inicios simultáneos
// pueden pasar de 5 por un instante. También la usa la creación de la cuenta.
func insertarSesion(ctx context.Context, tx pgx.Tx, persona string, huella []byte, ahora time.Time) error {
	if _, err := tx.Exec(ctx,
		`INSERT INTO sesion (hash_token, persona_id, creada_en, ultimo_uso_en, vence_en) VALUES ($1, $2::uuid, $3, $3, $4)`,
		huella, persona, ahora, ahora.Add(sesion.Vigencia)); err != nil {
		return fmt.Errorf("crear la sesión: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM sesion WHERE persona_id = $1::uuid AND hash_token IN (
		     SELECT hash_token FROM sesion WHERE persona_id = $1::uuid
		     ORDER BY ultimo_uso_en DESC, creada_en DESC, hash_token OFFSET $2)`,
		persona, sesion.MaximoPorPersona); err != nil {
		return fmt.Errorf("limitar las sesiones de la persona: %w", err)
	}
	return nil
}
