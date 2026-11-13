package pg

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
)

// Tokens es la persistencia del token de dispositivo (E13 `token_dispositivo`): implementa autorizacion.RepositorioDeTokens.
type Tokens struct{ pool *pgxpool.Pool }

// NuevoTokens crea el repositorio sobre un pool.
func NuevoTokens(pool *pgxpool.Pool) *Tokens { return &Tokens{pool: pool} }

// Registrar guarda el token del dispositivo de la persona, solo si tiene la autorización `avisos` vigente (SC-E21-25,
// criterio 10). Todo en una transacción que toma antes el bloqueo de la persona, el mismo de Autorizaciones.Retirar: o el
// retiro de `avisos` ya está confirmado y aquí no se guarda nada, o el registro ya está y el retiro lo borra.
//
// El token es único en la tabla (`uq_token_dispositivo_token`): si estaba en otro dispositivo o de otra persona (otra
// persona entró en el mismo dispositivo), se borra y queda el nuevo registro (E13). Si el dispositivo de la persona ya
// tenía otro token, se reemplaza. `creado_en` y `ultimo_uso_en` salen del reloj del API, no del de la base.
func (a *Tokens) Registrar(ctx context.Context, persona, dispositivo, token string, ahora time.Time) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := bloquearPersona(ctx, tx, persona); err != nil {
		return err
	}
	var autorizada bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM autorizacion WHERE titular_id = $1::uuid AND finalidad = $2 AND retirada_en IS NULL)`,
		persona, cuenta.Avisos).Scan(&autorizada); err != nil {
		return fmt.Errorf("leer la autorización de los avisos: %w", err)
	}
	if !autorizada {
		return autorizacion.ErrSinAutorizacionDeAvisos
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM token_dispositivo WHERE token = $3 AND NOT (persona_id = $1::uuid AND dispositivo_id = $2)`,
		persona, dispositivo, token); err != nil {
		return fmt.Errorf("reemplazar el token de otro dispositivo: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO token_dispositivo (persona_id, dispositivo_id, token, creado_en, ultimo_uso_en)
		 VALUES ($1::uuid, $2, $3, $4, $4)
		 ON CONFLICT (persona_id, dispositivo_id)
		 DO UPDATE SET token = EXCLUDED.token, ultimo_uso_en = GREATEST(token_dispositivo.creado_en, EXCLUDED.ultimo_uso_en)`,
		persona, dispositivo, token, ahora); err != nil {
		return fmt.Errorf("guardar el token del dispositivo: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}
