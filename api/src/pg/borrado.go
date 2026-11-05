package pg

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
		`SELECT COALESCE(pa.correo, ''), cr.hash, pe.etapa = 'menor'
		 FROM credencial cr
		 JOIN persona pe ON pe.id = cr.persona_id
		 LEFT JOIN perfil_adulto pa ON pa.persona_id = cr.persona_id
		 WHERE cr.persona_id = $1::uuid`, persona).Scan(&c.Correo, &c.Hash, &c.EsMenor)
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
	r := cuenta.ResumenDeBorrado{}
	for i, id := range s.menores {
		r.Menores = append(r.Menores, cuenta.MenorACargo{ID: id, Nombre: s.menoresNombres[i]})
	}
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

// intentosDeBorrado: cuántas veces se repite la transacción entera si la base la aborta por un choque con otra
// (40001 serialización, 40P01 interbloqueo) o por una escritura concurrente que se coló y chocó con una de las
// restricciones conocidas (las `ck_*_persona_o_hogar` y las llaves del administrador del hogar). Cualquier otro error
// de integridad no se repite: sale como error y se registra. Cada intento vuelve a leer y a calcular todo. Después de
// eso, ErrNoExiste si la cuenta ya no está y ErrOcupada si sigue.
const intentosDeBorrado = 3

// BorrarCuenta borra la cuenta de la persona, en una sola transacción: o queda todo borrado o no cambia nada (RN-006,
// RN-007, CU-40).
//
// **Los candados van primero, en un orden fijo**, y después se lee y se calcula:
//
//  1. Su hogar, si tiene. Va primero para que dos personas del mismo hogar que se borran a la vez se turnen enteras
//     y no se crucen al pasar el papel de administrador; si la persona cambió de hogar mientras esperaba, se repite.
//  2. La credencial, la persona y su perfil de adulta (en ese orden, que también siguen `IniciarSesion`, elegir la
//     contraseña con un enlace y pedir un enlace). Las llaves foráneas de lo que otros escriban de ella (movimientos,
//     metas, sesiones…, que apuntan a `persona`; presupuestos, deudas y tarjetas, que apuntan a `perfil_adulto`) toman
//     un candado compartido sobre esas filas: quedan esperando y, cuando la persona se borra, fallan por la llave sin
//     que nada quede a medias.
//  3. Los menores que ella tutela: su persona, su perfil de menor y **todas las tutorías de esos menores**, ordenadas.
//     Así dos tutores de la misma menor que borran a la vez se turnan (la segunda ve a la menor a cargo solo de ella),
//     una tutoría nueva espera, y lo que escriba la menor espera.
//  4. Los miembros del hogar, para no pasar el papel de administrador a quien se está borrando.
//     4b. Las repeticiones de ella, de sus menores y del hogar, ordenadas por id y antes de borrar nada. Es el mismo orden
//     que sigue `Decidir` (la persona y luego sus repeticiones por id).
//
// Con eso:
//
//  5. Los menores que dependen solo de ella son exactamente `vistos`, los que la pantalla mostró; si no, o si cambiaron
//     entre tanto, cuenta.ErrMenoresCambiaron y no cambia nada (RN-006: cada menor se avisa y se confirma). Sin
//     `confirmaMenores`, cuenta.ErrFaltaConfirmarMenores. Los menores se borran con ella.
//  6. Si administra el hogar y queda otra persona adulta, el papel pasa a la más antigua. Si era la única adulta, el
//     hogar se disuelve: lo compartido pasa a ser suyo y se borra con ella (`hogar_id` de cada tabla de datos).
//  7. Se borra lo propio (`hogar_id` nulo) de ella y de los menores. Lo compartido de un hogar que sigue queda en el
//     hogar sin su nombre: el SET NULL de `persona_id` (D-053).
//  8. Las autorizaciones, que no tienen llave a la persona, quedan retiradas y se conservan hasta `conservarHasta`.
//  9. Se borra la persona: el CASCADE se lleva los perfiles, la credencial, **todas las sesiones**, los tokens de
//     dispositivo, los enlaces, los avisos, la pertenencia al hogar, las tutorías y las propuestas pendientes.
//
// Corre en READ COMMITTED, con los candados de arriba, y no en SERIALIZABLE (se probó los dos): con los candados puestos,
// cada lectura posterior ve lo último confirmado y ninguna escritura relevante puede colarse; en SERIALIZABLE la foto se
// toma en la primera sentencia, antes de esperar los candados, y una fila que otros actualizan sin parar (la credencial,
// con inicios de sesión seguidos) hace abortar con 40001 el primer candado en cada intento: el borrado se quedaba en
// «ocupado» tres veces de tres (`TestBorrarMientrasOtroDispositivoEntra`). Con los candados puestos, las pruebas de
// R1 a R5 pasan en los dos niveles. Si aun así la base aborta (40001, 40P01) o una escritura se cuela y choca con una
// restricción conocida, se repite todo, hasta `intentosDeBorrado` veces; otro error de integridad sale y se registra.
func (r *Borrado) BorrarCuenta(ctx context.Context, persona string, vistos []string, confirmaMenores bool, ahora, conservarHasta time.Time) error {
	var err error
	for range intentosDeBorrado {
		err = r.borrarUnaVez(ctx, persona, vistos, confirmaMenores, ahora, conservarHasta)
		if !esChoqueDeTransacciones(err) {
			return conRestriccion(err)
		}
	}
	// La base siguió ocupada: si la cuenta ya no está, otro pedido la borró y esto es lo mismo que llegar tarde. Si no se
	// puede mirar, se supone que sigue (y se dice «ocupado», que es seguro: no se borró nada) y el error de la consulta
	// se suma al que sale, para el registro.
	var existe bool
	if errMirar := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM persona WHERE id = $1::uuid)`, persona).Scan(&existe); errMirar != nil {
		return fmt.Errorf("%w: %w (y no se pudo comprobar si la cuenta sigue: %w)", cuenta.ErrOcupada, conRestriccion(err), errMirar)
	}
	if !existe {
		return cuenta.ErrNoExiste
	}
	return fmt.Errorf("%w: %w", cuenta.ErrOcupada, conRestriccion(err))
}

// restriccionesDeEscrituraConcurrente son las únicas restricciones de integridad que el borrado reintenta: las que salta
// una escritura de otra conexión que se coló entre leer y borrar. Cualquier otra violación es un error de verdad: se
// intenta una sola vez, sale tal cual y la ruta lo vuelve un 500 con su línea de registro.
//   - 23514 `ck_*_persona_o_hogar`: una fila nueva «propia» que apareció cuando ya se había borrado lo propio, y que el
//     SET NULL de `persona_id` dejaría sin dueño.
//   - 23503 `fk_hogar_administrador_id` y `fk_hogar_administrador_miembro`: el papel de administrador apuntaba a una
//     persona que otro borrado se llevó (o la membresía cambió).
var restriccionesDeEscrituraConcurrente = map[string]bool{
	"ck_movimiento_persona_o_hogar": true, "ck_recurrente_persona_o_hogar": true, "ck_meta_persona_o_hogar": true,
	"ck_presupuesto_persona_o_hogar": true, "ck_deuda_persona_o_hogar": true,
	"fk_hogar_administrador_id": true, "fk_hogar_administrador_miembro": true,
}

// errHogarCambio: el hogar de la persona cambió entre mirarlo y bloquearlo; se repite con el hogar de ahora.
var errHogarCambio = errors.New("el hogar de la persona cambió mientras se bloqueaba")

// esChoqueDeTransacciones dice si el error es un choque con otra transacción que se arregla repitiendo todo: 40001
// serialización, 40P01 interbloqueo, o una de las restricciones de `restriccionesDeEscrituraConcurrente`.
func esChoqueDeTransacciones(err error) bool {
	if errors.Is(err, errHogarCambio) {
		return true
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	switch pgErr.Code {
	case "40001", "40P01":
		return true
	case "23503", "23514":
		return restriccionesDeEscrituraConcurrente[pgErr.ConstraintName]
	}
	return false
}

// conRestriccion agrega al error de la base el código y la restricción que violó, para el registro: el texto de la
// base no los trae siempre y nunca lleva datos de la persona (ni el `Detail` de la base, que sí podría).
func conRestriccion(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return fmt.Errorf("%w [SQLSTATE %s, restricción %q]", err, pgErr.Code, pgErr.ConstraintName)
	}
	return err
}

// mismosIDs dice si dos listas de ids son el mismo conjunto.
func mismosIDs(a, b []string) bool {
	conjunto := make(map[string]bool, len(a))
	for _, id := range a {
		conjunto[strings.ToLower(id)] = true
	}
	if len(conjunto) != len(b) {
		return false
	}
	for _, id := range b {
		if !conjunto[strings.ToLower(id)] {
			return false
		}
	}
	return true
}

// leerHogar lee, sin bloquear, el hogar de la persona (nulo si no tiene).
func leerHogar(ctx context.Context, q consultor, persona string) (*string, error) {
	var hogar *string
	err := q.QueryRow(ctx, `SELECT hogar_id::text FROM miembro_hogar WHERE persona_id = $1::uuid`, persona).Scan(&hogar)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("leer el hogar: %w", err)
	}
	return hogar, nil
}

// bloquearParaBorrar toma los candados del borrado en un orden global fijo: 0 el hogar, 1 la credencial, la persona y su
// perfil de adulta, 2 los menores que tutela (persona, perfil y todas sus tutorías), 3 los miembros del hogar, 4 las
// repeticiones que se borran o quedan sin nombre, por id (después de la persona, como `Decidir`). El hogar va
// primero para que dos personas del mismo hogar se turnen enteras y no se crucen (una pasando el papel de administrador a
// la otra, que ya tiene bloqueado su perfil); y la credencial antes que la persona es el orden de `IniciarSesion`, de
// elegir la contraseña con un enlace y de pedir un enlace, que llegan a la persona por ahí. Cada sentencia ordena sus filas.
func bloquearParaBorrar(ctx context.Context, tx pgx.Tx, persona string) error {
	hogar, err := leerHogar(ctx, tx, persona)
	if err != nil {
		return err
	}
	if hogar != nil {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM hogar WHERE id = $1::uuid FOR UPDATE`, *hogar); err != nil {
			return fmt.Errorf("bloquear el hogar: %w", err)
		}
	}
	for _, q := range []struct{ que, sql string }{
		{"la credencial", `SELECT 1 FROM credencial WHERE persona_id = $1::uuid FOR UPDATE`},
		{"la persona", `SELECT 1 FROM persona WHERE id = $1::uuid FOR UPDATE`},
		{"el perfil de adulta", `SELECT 1 FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE`},
		// Los menores que ella tutela, con sus otros tutores: la persona y el perfil de cada menor, y todas las tutorías.
		{"las personas de los menores", `SELECT 1 FROM persona WHERE id IN (SELECT menor_id FROM tutoria WHERE tutor_id = $1::uuid) ORDER BY id FOR UPDATE`},
		{"los perfiles de los menores", `SELECT 1 FROM perfil_menor WHERE persona_id IN (SELECT menor_id FROM tutoria WHERE tutor_id = $1::uuid) ORDER BY persona_id FOR UPDATE`},
		{"las tutorías de los menores", `SELECT 1 FROM tutoria WHERE menor_id IN (SELECT menor_id FROM tutoria WHERE tutor_id = $1::uuid) ORDER BY menor_id, tutor_id FOR UPDATE`},
		// Quienes forman su hogar.
		{"los miembros del hogar", `SELECT 1 FROM miembro_hogar WHERE hogar_id IN (SELECT hogar_id FROM miembro_hogar WHERE persona_id = $1::uuid) ORDER BY persona_id FOR UPDATE`},
		// Las repeticiones que se borrarán o quedarán sin nombre (SET NULL), todas por id y antes de cualquier DELETE: así
		// el borrado y `Decidir` (que bloquea la persona y luego sus repeticiones por id) siguen el mismo orden y no se
		// esperan en círculo; borrarlas después, una a una en el orden del montón, cruzaba el orden por id.
		{"las repeticiones", `SELECT 1 FROM movimiento_recurrente
			WHERE persona_id = $1::uuid
			   OR persona_id IN (SELECT menor_id FROM tutoria WHERE tutor_id = $1::uuid)
			   OR hogar_id IN (SELECT hogar_id FROM miembro_hogar WHERE persona_id = $1::uuid)
			ORDER BY id FOR UPDATE`},
	} {
		if _, err := tx.Exec(ctx, q.sql, persona); err != nil {
			return fmt.Errorf("bloquear %s: %w", q.que, err)
		}
	}
	// Si la persona cambió de hogar mientras se esperaba, el que se bloqueó ya no es el suyo.
	despues, err := leerHogar(ctx, tx, persona)
	if err != nil {
		return err
	}
	if (hogar == nil) != (despues == nil) || (hogar != nil && *hogar != *despues) {
		return errHogarCambio
	}
	return nil
}

func (r *Borrado) borrarUnaVez(ctx context.Context, persona string, vistos []string, confirmaMenores bool, ahora, conservarHasta time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // sin efecto tras el commit

	// Lo primero de la transacción, antes de leer nada.
	if err := bloquearParaBorrar(ctx, tx, persona); err != nil {
		return err
	}
	s, err := leerSituacion(ctx, tx, persona)
	if err != nil {
		return err
	}
	if s.etapa != "adulta" {
		return cuenta.ErrCuentaDeMenor
	}
	if !mismosIDs(vistos, s.menores) {
		return cuenta.ErrMenoresCambiaron
	}
	if len(s.menores) > 0 && !confirmaMenores {
		return cuenta.ErrFaltaConfirmarMenores
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

// MovimientosDe implementa cuenta.RepositorioDeExportacion: lo que la persona registró (`persona_id` suyo), con el nombre
// de la categoría y, en un aporte, el de su propia meta (nunca el de una meta de otra persona), y sin ningún id. Nada
// que otra persona registró en un hogar ni los terceros que anotó (SC-E21-20). Cuenta.ErrNoExiste si la persona no está.
func (r *Borrado) MovimientosDe(ctx context.Context, persona string) ([]cuenta.MovimientoExportado, error) {
	var existe bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM persona WHERE id = $1::uuid)`, persona).Scan(&existe); err != nil {
		return nil, fmt.Errorf("leer la persona: %w", err)
	}
	if !existe {
		return nil, cuenta.ErrNoExiste
	}
	filas, err := r.pool.Query(ctx,
		`SELECT m.fecha::text, m.tipo, m.monto, COALESCE(c.nombre, ''), m.medio, COALESCE(m.descripcion, ''),
		        COALESCE(mt.nombre, ''), COALESCE(m.sentido, ''), m.hogar_id IS NOT NULL
		 FROM movimiento m
		 LEFT JOIN categoria c ON c.id = m.categoria_id
		 LEFT JOIN meta mt ON mt.id = m.meta_id AND mt.persona_id = m.persona_id
		 WHERE m.persona_id = $1::uuid
		 ORDER BY m.fecha, m.creado_en, m.id`, persona)
	if err != nil {
		return nil, fmt.Errorf("leer los movimientos: %w", err)
	}
	defer filas.Close()
	var salida []cuenta.MovimientoExportado
	for filas.Next() {
		var m cuenta.MovimientoExportado
		if err := filas.Scan(&m.Fecha, &m.Tipo, &m.MontoCentavos, &m.Categoria, &m.Medio, &m.Descripcion, &m.Meta, &m.Sentido, &m.Compartido); err != nil {
			return nil, fmt.Errorf("leer un movimiento: %w", err)
		}
		salida = append(salida, m)
	}
	return salida, filas.Err()
}
