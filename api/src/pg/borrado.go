package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alcanzamos/alcanzamos/api/src/cuenta"
)

// Borrado implementa cuenta.RepositorioDeBorrado (E13, RN-006, RN-007).
type Borrado struct{ pool *pgxpool.Pool }

// NuevoBorrado crea el repositorio sobre un pool.
func NuevoBorrado(pool *pgxpool.Pool) *Borrado { return &Borrado{pool: pool} }

// consultor es lo que comparten el pool y una transacción para leer.
type consultor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// CredencialDe lee el correo y el hash de la persona, o cuenta.ErrNoExiste. Una persona sin correo (un menor) lo
// devuelve vacío.
func (r *Borrado) CredencialDe(ctx context.Context, persona string) (cuenta.CredencialDeBorrado, error) {
	var c cuenta.CredencialDeBorrado
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(pa.correo, ''), cr.hash
		 FROM credencial cr
		 LEFT JOIN perfil_adulto pa ON pa.persona_id = cr.persona_id
		 WHERE cr.persona_id = $1::uuid`, persona).Scan(&c.Correo, &c.Hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, cuenta.ErrNoExiste
	}
	if err != nil {
		return c, fmt.Errorf("leer la credencial: %w", err)
	}
	return c, nil
}

// Resumen lee lo que PN-69 dice del hogar y de los menores, o cuenta.ErrNoExiste.
func (r *Borrado) Resumen(ctx context.Context, persona string) (cuenta.ResumenDeBorrado, error) {
	s, err := leerSituacion(ctx, r.pool, persona)
	if err != nil {
		return cuenta.ResumenDeBorrado{}, err
	}
	return s.resumen(), nil
}

// situacion es lo que el borrado necesita saber de la persona: su etapa, su hogar y sus menores.
type situacion struct {
	etapa            string
	hogar            *string // id del hogar, nulo si no tiene
	hogarNombre      *string
	esAdministradora bool
	sucesor          *string // persona adulta con más antigüedad que no es ella; nulo si es la única adulta
	sucesorNombre    string
	menores          []string // ids de quienes dependen solo de ella
	menoresNombres   []string
}

func (s situacion) resumen() cuenta.ResumenDeBorrado {
	r := cuenta.ResumenDeBorrado{Menores: s.menoresNombres}
	if s.hogar != nil {
		r.Hogar = &cuenta.HogarAlBorrar{Nombre: s.hogarNombre, EsAdministradora: s.esAdministradora, UnicaAdulta: s.sucesor == nil}
		if s.esAdministradora {
			r.Hogar.NuevoAdministrador = s.sucesorNombre
		}
	}
	return r
}

// leerSituacion lee la etapa, el hogar y los menores de la persona. RN-007: el papel pasa a la persona adulta con más
// antigüedad en el hogar (`miembro_hogar.desde`; a igual fecha, el id más bajo, para que sea siempre la misma).
// RN-006: dependen solo de ella los menores cuya única tutoría es la suya.
func leerSituacion(ctx context.Context, q consultor, persona string) (situacion, error) {
	var s situacion
	err := q.QueryRow(ctx,
		`SELECT p.etapa, mh.hogar_id::text, h.nombre, COALESCE(h.administrador_id = p.id, false)
		 FROM persona p
		 LEFT JOIN miembro_hogar mh ON mh.persona_id = p.id
		 LEFT JOIN hogar h ON h.id = mh.hogar_id
		 WHERE p.id = $1::uuid`, persona).Scan(&s.etapa, &s.hogar, &s.hogarNombre, &s.esAdministradora)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, cuenta.ErrNoExiste
	}
	if err != nil {
		return s, fmt.Errorf("leer la persona: %w", err)
	}
	if s.hogar != nil {
		err = q.QueryRow(ctx,
			`SELECT mh.persona_id::text, pe.nombre
			 FROM miembro_hogar mh
			 JOIN persona pe ON pe.id = mh.persona_id
			 JOIN perfil_adulto pa ON pa.persona_id = pe.id
			 WHERE mh.hogar_id = $2::uuid AND mh.persona_id <> $1::uuid
			 ORDER BY mh.desde, mh.persona_id
			 LIMIT 1`, persona, *s.hogar).Scan(&s.sucesor, &s.sucesorNombre)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return s, fmt.Errorf("leer a la persona adulta con más antigüedad: %w", err)
		}
	}
	filas, err := q.Query(ctx,
		`SELECT t.menor_id::text, pe.nombre
		 FROM tutoria t
		 JOIN persona pe ON pe.id = t.menor_id
		 WHERE t.tutor_id = $1::uuid
		   AND NOT EXISTS (SELECT 1 FROM tutoria otra WHERE otra.menor_id = t.menor_id AND otra.tutor_id <> t.tutor_id)
		 ORDER BY pe.nombre, t.menor_id`, persona)
	if err != nil {
		return s, fmt.Errorf("leer los menores a cargo: %w", err)
	}
	defer filas.Close()
	for filas.Next() {
		var id, nombre string
		if err := filas.Scan(&id, &nombre); err != nil {
			return s, fmt.Errorf("leer un menor a cargo: %w", err)
		}
		s.menores = append(s.menores, id)
		s.menoresNombres = append(s.menoresNombres, nombre)
	}
	return s, filas.Err()
}

// tablasConDatos son las tablas con `persona_id` y `hogar_id` anulables (E13 §3): el dato es propio si `hogar_id` es
// nulo y compartido si no. Todas llevan `ck_*_persona_o_hogar`: borrar la persona sin quitar antes lo propio fallaría el
// CHECK, porque el SET NULL de la llave dejaría la fila sin dueño. El orden importa: los movimientos van antes que
// las metas y los recurrentes que referencian (ck_movimiento_recurrencia), y las deudas, al final.
var tablasConDatos = []string{"movimiento", "movimiento_recurrente", "meta", "presupuesto", "deuda"}

// BorrarCuenta borra la cuenta de la persona, en una sola transacción serializable: o queda todo borrado o no cambia
// nada (RN-006, RN-007, CU-40).
//
//  1. Los menores que dependen solo de ella se borran con ella; sin `confirmaMenores`, cuenta.ErrFaltaConfirmarMenores.
//  2. Si administra el hogar y queda otra persona adulta, el papel pasa a la más antigua. Si era la única adulta, el
//     hogar se disuelve: lo compartido pasa a ser suyo y se borra con ella (`hogar_id` de cada tabla de datos).
//  3. Se borra lo propio (`hogar_id` nulo) de ella y de los menores. Lo compartido de un hogar que sigue queda en el
//     hogar sin su nombre: el SET NULL de `persona_id` (D-053).
//  4. Las autorizaciones, que no tienen llave a la persona, quedan retiradas y se conservan hasta `conservarHasta`.
//  5. Se borra la persona: el CASCADE se lleva los perfiles, la credencial, **todas las sesiones**, los tokens de
//     dispositivo, los enlaces, los avisos, la pertenencia al hogar, las tutorías y las propuestas pendientes.
func (r *Borrado) BorrarCuenta(ctx context.Context, persona string, confirmaMenores bool, ahora, conservarHasta time.Time) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	s, err := leerSituacion(ctx, tx, persona)
	if err != nil {
		return err
	}
	if s.etapa != "adulta" {
		return cuenta.ErrCuentaDeMenor
	}
	if len(s.menores) > 0 && !confirmaMenores {
		return cuenta.ErrFaltaConfirmarMenores
	}
	// Los candados de las filas de la persona, para que un borrado a la vez no se pise con otro.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM persona WHERE id = $1::uuid FOR UPDATE`, persona); err != nil {
		return fmt.Errorf("bloquear la persona: %w", err)
	}

	var disuelto *string
	if s.hogar != nil && s.sucesor == nil {
		disuelto = s.hogar
	} else if s.esAdministradora {
		if _, err := tx.Exec(ctx, `UPDATE hogar SET administrador_id = $2::uuid WHERE id = $1::uuid`, *s.hogar, *s.sucesor); err != nil {
			return fmt.Errorf("pasar el papel de administrador: %w", err)
		}
	}

	personas := append([]string{persona}, s.menores...)
	for _, tabla := range tablasConDatos {
		if _, err := tx.Exec(ctx,
			`DELETE FROM `+tabla+` WHERE (persona_id = ANY($1::uuid[]) AND hogar_id IS NULL) OR hogar_id = $2::uuid`,
			personas, disuelto); err != nil {
			return fmt.Errorf("borrar los datos de %s: %w", tabla, err)
		}
	}
	// Con el hogar cerrado, el administrador no puede quedar apuntando a una persona que se borra (NO ACTION).
	if disuelto != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM hogar WHERE id = $1::uuid`, *disuelto); err != nil {
			return fmt.Errorf("cerrar el hogar: %w", err)
		}
	}
	if _, err := tx.Exec(ctx,
		`UPDATE autorizacion
		    SET retirada_en = COALESCE(retirada_en, GREATEST(otorgada_en, $2)),
		        conservar_hasta = COALESCE(conservar_hasta, $3::date)
		  WHERE titular_id = ANY($1::uuid[])`, personas, ahora, conservarHasta); err != nil {
		return fmt.Errorf("conservar la prueba de las autorizaciones: %w", err)
	}
	borradas, err := tx.Exec(ctx, `DELETE FROM persona WHERE id = ANY($1::uuid[])`, personas)
	if err != nil {
		return fmt.Errorf("borrar las personas: %w", err)
	}
	if int(borradas.RowsAffected()) != len(personas) {
		return fmt.Errorf("se borraron %d personas y se esperaban %d", borradas.RowsAffected(), len(personas))
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}
