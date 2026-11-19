package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/autorizacion"
	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
)

// condicionVigente es la única definición de «vigente» de una autorización (bug 308, D-210): ni retirada por la persona o
// por el borrado de la cuenta (`retirada_en`), ni reemplazada por la aceptación de una versión nueva del texto
// (`reemplazada_en`). Es el predicado del índice único `ix_autorizacion_vigente` y se usa en todas las consultas, también
// en el `ON CONFLICT` que debe coincidir con él. Sin alias de tabla.
const condicionVigente = "retirada_en IS NULL AND reemplazada_en IS NULL"

// retiroAlConservar es la asignación de `retirada_en` de quien conserva la prueba de las autorizaciones al borrar una cuenta
// (con `$2` = el instante): la vigente queda retirada; la reemplazada (bug 308, D-210) no se retiró, así que conserva su
// `retirada_en` como estaba y solo recibe `conservar_hasta`, para no quedarse sin plazo. Sobre la tabla sin alias.
const retiroAlConservar = "retirada_en = CASE WHEN reemplazada_en IS NULL THEN COALESCE(retirada_en, GREATEST(otorgada_en, $2)) ELSE retirada_en END"

// Autorizaciones es la persistencia de PN-64 (E13 `autorizacion`): implementa autorizacion.Repositorio.
type Autorizaciones struct{ pool *pgxpool.Pool }

// NuevoAutorizaciones crea el repositorio sobre un pool.
func NuevoAutorizaciones(pool *pgxpool.Pool) *Autorizaciones { return &Autorizaciones{pool: pool} }

// Vigentes devuelve las finalidades que la persona se otorgó a sí misma, sin retirar ni reemplazar, con la versión del
// texto con que las aceptó. Una vigente es la que no tiene `retirada_en` ni `reemplazada_en` (bug 308, D-210).
func (a *Autorizaciones) Vigentes(ctx context.Context, persona string) ([]autorizacion.Aceptada, error) {
	filas, err := a.pool.Query(ctx,
		`SELECT finalidad, version_del_texto FROM autorizacion
		  WHERE titular_id = $1::uuid AND otorgante_id = $1::uuid AND `+condicionVigente, persona)
	if err != nil {
		return nil, fmt.Errorf("consultar las autorizaciones: %w", err)
	}
	aceptadas, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (autorizacion.Aceptada, error) {
		var x autorizacion.Aceptada
		return x, f.Scan(&x.Codigo, &x.Version)
	})
	if err != nil {
		return nil, fmt.Errorf("leer las autorizaciones: %w", err)
	}
	return aceptadas, nil
}

// bloquear toma la fila de la persona adulta hasta el final de la transacción: otorgar y rechazar se turnan, y una
// autorización no puede quedar guardada para una cuenta que se acaba de borrar (`autorizacion` no tiene llave a persona).
func bloquear(ctx context.Context, tx pgx.Tx, persona string) error {
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM persona WHERE id = $1::uuid AND etapa = 'adulta' FOR UPDATE`, persona).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return autorizacion.ErrSinCuenta
	}
	if err != nil {
		return fmt.Errorf("bloquear la cuenta: %w", err)
	}
	return nil
}

// Otorgar inserta una fila por finalidad, con titular y otorgante la propia persona. El índice único de las vigentes
// (`ix_autorizacion_vigente`, una por titular y finalidad) hace que la que ya estaba otorgada por ella no se repita.
//
// **A los 18 años (PN-54, SC-E21-25) la aceptación propia reemplaza a la del tutor.** Si de esa finalidad hay una vigente
// dada por otra persona (el tutor, cuando era menor), ocuparía el único lugar de las vigentes y la de la persona no
// entraría: `ReglaDeFinalidades` solo cuenta la dada por ella, y la cuenta seguiría en `sin_autorizacion` aunque el POST
// respondiera 200. Antes de insertar se **retira** la del otro otorgante (`retirada_en`, sin `conservar_hasta`: la cuenta
// existe): la fila no se borra, queda como historia y como prueba de lo que dio el tutor (RF-063, Ley 1581). No se cambia el
// esquema: E13 fija la unicidad de las vigentes por (titular, finalidad), que es lo correcto, y retirar es lo que E12 llama
// `Autorizacion.Retirar`. Todo en la misma transacción y bajo el bloqueo de la persona.
//
// `otorgada_en` es la hora del `Reloj`, salvo que ya haya una fila de esa finalidad igual o posterior (la retirada recién,
// o una del reloj de otro nodo): entonces queda un microsegundo después de la más reciente, porque (titular, finalidad,
// otorgada_en) es único (`uq_autorizacion_titular_finalidad_otorgada`) y volver a otorgar en el mismo instante en que se
// retiró no debe fallar.
//
// **Con un texto nuevo, la persona vuelve a aceptar lo necesario y la aceptación de antes queda como prueba (bug 308, D-210).**
// Si de una finalidad necesaria que se otorga hay una vigente propia con una versión anterior a `version`, se **reemplaza**:
// solo se pone `reemplazada_en` (no `retirada_en`: la persona no retiró nada) y la fila sigue como estaba, sin borrarse ni
// cambiar lo demás. El índice de las vigentes la deja de contar y la nueva entra. Una opcional ya vigente no se reemplaza ni
// se repite: no se vuelve obligatoria. Todo en la misma transacción y bajo el bloqueo de la persona.
func (a *Autorizaciones) Otorgar(ctx context.Context, persona string, finalidades []string, version string, ahora time.Time) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := bloquear(ctx, tx, persona); err != nil {
		return err
	}
	if err := reemplazarLasDeVersionAnterior(ctx, tx, persona, finalidades, version, ahora); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE autorizacion SET retirada_en = GREATEST(otorgada_en, $3)
		 WHERE titular_id = $1::uuid AND otorgante_id <> $1::uuid AND finalidad = ANY($2::text[]) AND `+condicionVigente,
		persona, finalidades, ahora); err != nil {
		return fmt.Errorf("retirar lo que otorgó otra persona: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en)
		 SELECT $1::uuid, $1::uuid, f, $3,
		        GREATEST($4::timestamptz, COALESCE((SELECT max(a.otorgada_en) + interval '1 microsecond'
		                                              FROM autorizacion a WHERE a.titular_id = $1::uuid AND a.finalidad = f), $4::timestamptz))
		   FROM unnest($2::text[]) AS f
		 ON CONFLICT (titular_id, finalidad) WHERE `+condicionVigente+` DO NOTHING`,
		persona, finalidades, version, ahora); err != nil {
		return fmt.Errorf("guardar las autorizaciones: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// reemplazarLasDeVersionAnterior pone `reemplazada_en` a las autorizaciones necesarias, propias y vigentes de las
// finalidades dadas cuya versión guardada es anterior a `version`. No toca ninguna otra columna ni ninguna otra fila.
func reemplazarLasDeVersionAnterior(ctx context.Context, tx pgx.Tx, persona string, finalidades []string, version string, ahora time.Time) error {
	filas, err := tx.Query(ctx,
		`SELECT id::text, finalidad, version_del_texto FROM autorizacion
		  WHERE titular_id = $1::uuid AND otorgante_id = $1::uuid AND finalidad = ANY($2::text[])
		    AND `+condicionVigente, persona, finalidades)
	if err != nil {
		return fmt.Errorf("buscar las autorizaciones de una versión anterior: %w", err)
	}
	type vigente struct{ id, finalidad, version string }
	vigentes, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (vigente, error) {
		var v vigente
		return v, f.Scan(&v.id, &v.finalidad, &v.version)
	})
	if err != nil {
		return fmt.Errorf("leer las autorizaciones de una versión anterior: %w", err)
	}
	var viejas []string
	for _, v := range vigentes {
		if (cuenta.ReglaDeFinalidades{}).Clasificada(v.finalidad) && autorizacion.VersionAnterior(v.version, version) {
			viejas = append(viejas, v.id)
		}
	}
	if len(viejas) == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx,
		`UPDATE autorizacion SET reemplazada_en = GREATEST(otorgada_en, $2) WHERE id = ANY($1::uuid[])`, viejas, ahora); err != nil {
		return fmt.Errorf("reemplazar las autorizaciones de una versión anterior: %w", err)
	}
	return nil
}

// Rechazar borra la persona (ON DELETE CASCADE se lleva perfil, credencial, sesiones, enlaces y todo lo que tenga
// llave a ella) si nunca autorizó nada: con todas las `necesarias` vigentes, ErrYaAutorizada; con alguna autorización de
// antes, ErrConHistorial, y no toca nada. Como BorrarSinConfirmar (D-135), no borra las
// autorizaciones que hubiera: quedan retiradas y conservadas hasta `conservarHasta` como prueba mínima (E13 §7).
func (a *Autorizaciones) Rechazar(ctx context.Context, persona string, necesarias []string, ahora, conservarHasta time.Time) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := bloquear(ctx, tx, persona); err != nil {
		return err
	}
	filas, err := tx.Query(ctx,
		`SELECT finalidad, version_del_texto FROM autorizacion WHERE titular_id = $1::uuid AND otorgante_id = $1::uuid
		   AND `+condicionVigente+` AND finalidad = ANY($2::text[])`, persona, necesarias)
	if err != nil {
		return fmt.Errorf("contar las autorizaciones: %w", err)
	}
	aceptadas, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (autorizacion.Aceptada, error) {
		var x autorizacion.Aceptada
		return x, f.Scan(&x.Codigo, &x.Version)
	})
	if err != nil {
		return fmt.Errorf("leer las autorizaciones: %w", err)
	}
	vigentes := 0
	for _, x := range aceptadas {
		if autorizacion.CuentaComoOtorgada(x.Codigo, x.Version) {
			vigentes++
		}
	}
	if vigentes == len(necesarias) {
		return autorizacion.ErrYaAutorizada
	}
	// Una cuenta que ya autorizó algo antes y solo le falta una aceptación nueva no se borra de un toque (SC-E21-25,
	// sección 5): el mismo criterio de la tarea diaria, sin ninguna fila como titular.
	var conHistorial bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM autorizacion WHERE titular_id = $1::uuid)`, persona).Scan(&conHistorial); err != nil {
		return fmt.Errorf("buscar las autorizaciones de antes: %w", err)
	}
	if conHistorial {
		return autorizacion.ErrConHistorial
	}
	// Defensa: desde SC-E21-25 la cuenta que llega aquí no tiene ninguna fila como titular y esto no retira nada; si un día
	// el criterio de arriba se estrecha, lo que quede se conserva como prueba mínima (E13 §7), igual que al borrar la cuenta.
	// Una reemplazada (bug 308) no se retira: solo recibe el plazo de conservación.
	if _, err := tx.Exec(ctx,
		`UPDATE autorizacion SET `+retiroAlConservar+`, conservar_hasta = $3::date
		 WHERE titular_id = $1::uuid AND retirada_en IS NULL`, persona, ahora, conservarHasta); err != nil {
		return fmt.Errorf("retirar las autorizaciones: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM persona WHERE id = $1::uuid`, persona); err != nil {
		return fmt.Errorf("borrar la cuenta: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// ConHistorial dice si la persona tiene alguna fila en `autorizacion` como titular, vigente o retirada. Es el criterio de
// BorrarSinConfirmar y de Rechazar para no borrar una cuenta que ya autorizó algo (SC-E21-25, sección 5).
func (a *Autorizaciones) ConHistorial(ctx context.Context, persona string) (bool, error) {
	var si bool
	if err := a.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM autorizacion WHERE titular_id = $1::uuid)`, persona).Scan(&si); err != nil {
		return false, fmt.Errorf("buscar las autorizaciones: %w", err)
	}
	return si, nil
}

// Retirar pone `retirada_en` a la autorización vigente de la finalidad del titular y, si es `avisos`, borra en la misma
// transacción todos los tokens de dispositivo de la persona (SC-E21-25, criterio 12; NM-17): ni un token queda para
// recibir un aviso, y un registro que corra a la vez espera el bloqueo y ve el retiro. La fila de la autorización no se
// borra (es la prueba, RF-063) y `conservar_hasta` queda nulo mientras la cuenta exista (E13 §7).
func (a *Autorizaciones) Retirar(ctx context.Context, titular, finalidad string, ahora time.Time) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := bloquearPersona(ctx, tx, titular); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE autorizacion SET retirada_en = GREATEST(otorgada_en, $3)
		 WHERE titular_id = $1::uuid AND finalidad = $2 AND `+condicionVigente, titular, finalidad, ahora); err != nil {
		return fmt.Errorf("retirar la autorización: %w", err)
	}
	if finalidad == cuenta.Avisos {
		if _, err := tx.Exec(ctx, `DELETE FROM token_dispositivo WHERE persona_id = $1::uuid`, titular); err != nil {
			return fmt.Errorf("borrar los tokens de dispositivo: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// bloquearPersona toma la fila de la persona, de cualquier etapa, hasta el final de la transacción: retirar `avisos` y
// registrar un token se turnan (SC-E21-25, criterios 10 y 12). ErrSinCuenta si ya no existe.
func bloquearPersona(ctx context.Context, tx pgx.Tx, persona string) error {
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM persona WHERE id = $1::uuid FOR UPDATE`, persona).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return autorizacion.ErrSinCuenta
	}
	if err != nil {
		return fmt.Errorf("bloquear la cuenta: %w", err)
	}
	return nil
}
