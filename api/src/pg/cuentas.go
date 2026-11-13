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

// Cuentas implementa cuenta.Repositorio.
type Cuentas struct{ pool *pgxpool.Pool }

// NuevoCuentas crea el repositorio sobre un pool.
func NuevoCuentas(pool *pgxpool.Pool) *Cuentas { return &Cuentas{pool: pool} }

// SolicitarVerificacion guarda el enlace de verificación nuevo de un correo en una sola transacción (D-172 (2)). El
// correo se normaliza con lower(btrim()) en la base, que es lo que exige ck_perfil_adulto_correo.
//
//   - Sin cuenta con ese correo: crea persona y perfil de adulto, sin credencial (la contraseña la elige quien abre el
//     enlace, PN-74) y con el nombre provisional.
//   - Con una cuenta sin verificar: borra solo sus enlaces pendientes y guarda el nuevo. **No borra ni recrea la cuenta**:
//     quien pide el correo de otra persona no cambia nada de ella (pre-hijacking, SEG-012) y la fecha de creación sigue
//     siendo la primera, así que la tarea de D-135 la borra a los 7 días.
//   - Con una cuenta verificada: no toca nada y devuelve cuenta.ErrCorreoYaRegistrado.
//   - Sin cuenta y con SoloSiExiste (el reenvío): no crea nada y devuelve cuenta.ErrSinCuenta.
func (r *Cuentas) SolicitarVerificacion(ctx context.Context, v cuenta.NuevaVerificacion) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)

	// Dos pedidos del mismo correo a la vez se turnan: sin esto, ninguno ve la cuenta del otro (no hay fila que bloquear)
	// y los dos la crearían. El candado se suelta con la transacción.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(lower(btrim($1)), 0))`, v.Correo); err != nil {
		return fmt.Errorf("turnarse para pedir la verificación: %w", err)
	}
	persona, verificada, existe, err := bloquearCuentaDelCorreo(ctx, tx, v.Correo)
	switch {
	case err != nil:
		return err
	case existe && verificada:
		return cuenta.ErrCorreoYaRegistrado
	case existe:
		if err := invalidarEnlaces(ctx, tx, persona); err != nil {
			return err
		}
	case v.SoloSiExiste:
		return cuenta.ErrSinCuenta
	default:
		if persona, err = crearPersonaPendiente(ctx, tx, v); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO enlace_un_uso (hash_token, persona_id, proposito, creado_en, vence_en)
		 VALUES ($1, $2::uuid, 'verificacion', $3, $4)`,
		v.HuellaDelEnlace, persona, v.Ahora, v.VenceElEnlaceEn); err != nil {
		return fmt.Errorf("crear el enlace de verificación: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
	}
	return nil
}

// bloquearCuentaDelCorreo busca la cuenta del correo y, si existe, toma sus candados en el orden global (credencial,
// persona, perfil; ver bloquearCuentaParaEnlace) para no cruzarse con el borrado de la cuenta. Se busca sin bloquear y,
// con los candados, se vuelve a leer: si la cuenta se borró mientras se esperaba, es como si no existiera.
func bloquearCuentaDelCorreo(ctx context.Context, tx pgx.Tx, correo string) (persona string, verificada, existe bool, err error) {
	err = tx.QueryRow(ctx, `SELECT persona_id::text FROM perfil_adulto WHERE correo = lower(btrim($1))`, correo).Scan(&persona)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, false, nil
	}
	if err != nil {
		return "", false, false, fmt.Errorf("buscar el correo: %w", err)
	}
	if err := bloquearCuentaParaEnlace(ctx, tx, persona); err != nil {
		return "", false, false, err
	}
	err = tx.QueryRow(ctx,
		`SELECT correo_verificado FROM perfil_adulto WHERE persona_id = $1::uuid AND correo = lower(btrim($2)) FOR UPDATE`,
		persona, correo).Scan(&verificada)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, false, nil
	}
	if err != nil {
		return "", false, false, fmt.Errorf("buscar el correo: %w", err)
	}
	return persona, verificada, true, nil
}

// crearPersonaPendiente crea la persona y el perfil de adulto de un correo sin cuenta, sin credencial ni sesión.
func crearPersonaPendiente(ctx context.Context, tx pgx.Tx, v cuenta.NuevaVerificacion) (string, error) {
	var persona string
	if err := tx.QueryRow(ctx,
		`INSERT INTO persona (nombre, etapa, creada_en) VALUES ($1, 'adulta', $2) RETURNING id::text`,
		v.Nombre, v.Ahora).Scan(&persona); err != nil {
		return "", fmt.Errorf("crear la persona: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO perfil_adulto (persona_id, correo) VALUES ($1::uuid, lower(btrim($2)))`,
		persona, v.Correo); err != nil {
		return "", fmt.Errorf("crear el perfil de adulto: %w", err)
	}
	return persona, nil
}

// CorreoDelEnlace lee el correo de la cuenta de un enlace de verificación vigente y sin usar, sin consumirlo.
func (r *Cuentas) CorreoDelEnlace(ctx context.Context, huella []byte, ahora time.Time) (string, error) {
	var correo *string
	err := r.pool.QueryRow(ctx,
		`SELECT pa.correo FROM enlace_un_uso e JOIN perfil_adulto pa ON pa.persona_id = e.persona_id
		 WHERE e.hash_token = $1 AND e.proposito = 'verificacion' AND e.usado_en IS NULL AND e.vence_en > $2
		   AND NOT pa.correo_verificado`, huella, ahora).Scan(&correo)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && correo == nil) {
		return "", cuenta.ErrEnlaceInvalido
	}
	if err != nil {
		return "", fmt.Errorf("buscar el enlace de verificación: %w", err)
	}
	return *correo, nil
}

// CompletarCuenta consume el enlace, guarda el nombre y la credencial, verifica el correo y crea la sesión, todo en una
// transacción: si algo falla no queda nada, y en particular no queda una sesión sin contraseña (D-172 (3)). El UPDATE del
// enlace, con las condiciones en el WHERE, es atómico: de dos usos simultáneos pasa uno. Primero se toman los candados de
// la cuenta, en el mismo orden que el borrado y que los demás enlaces, y solo después se consume el enlace.
func (r *Cuentas) CompletarCuenta(ctx context.Context, c cuenta.CuentaElegida) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)

	var persona string
	err = tx.QueryRow(ctx,
		`SELECT persona_id::text FROM enlace_un_uso WHERE hash_token = $1 AND proposito = 'verificacion' AND usado_en IS NULL AND vence_en > $2`,
		c.HuellaDelEnlace, c.Ahora).Scan(&persona)
	if errors.Is(err, pgx.ErrNoRows) {
		return cuenta.ErrEnlaceInvalido
	}
	if err != nil {
		return fmt.Errorf("buscar el enlace: %w", err)
	}
	if err := bloquearCuentaParaEnlace(ctx, tx, persona); err != nil {
		return err
	}
	var verificada bool
	err = tx.QueryRow(ctx, `SELECT correo_verificado FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE`, persona).Scan(&verificada)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && verificada) {
		return cuenta.ErrEnlaceInvalido // la cuenta se borró mientras se esperaba, o ya estaba confirmada
	}
	if err != nil {
		return fmt.Errorf("leer el perfil: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`UPDATE enlace_un_uso SET usado_en = $2
		 WHERE hash_token = $1 AND proposito = 'verificacion' AND usado_en IS NULL AND vence_en > $2
		 RETURNING persona_id::text`, c.HuellaDelEnlace, c.Ahora).Scan(&persona); errors.Is(err, pgx.ErrNoRows) {
		return cuenta.ErrEnlaceInvalido
	} else if err != nil {
		return fmt.Errorf("consumir el enlace: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE persona SET nombre = $2 WHERE id = $1::uuid`, persona, c.Nombre); err != nil {
		return fmt.Errorf("guardar el nombre: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE perfil_adulto SET correo_verificado = true WHERE persona_id = $1::uuid`, persona); err != nil {
		return fmt.Errorf("verificar el correo: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO credencial (persona_id, hash, es_temporal) VALUES ($1::uuid, $2, false)
		 ON CONFLICT (persona_id) DO UPDATE SET hash = EXCLUDED.hash, es_temporal = false`,
		persona, c.HashContrasena); err != nil {
		return fmt.Errorf("guardar la credencial: %w", err)
	}
	if err := invalidarEnlaces(ctx, tx, persona); err != nil {
		return err
	}
	// Las sesiones que la persona pendiente pudiera tener (no debería) no sobreviven a elegir la contraseña.
	if _, err := tx.Exec(ctx, `DELETE FROM sesion WHERE persona_id = $1::uuid`, persona); err != nil {
		return fmt.Errorf("borrar las sesiones previas: %w", err)
	}
	if err := insertarSesion(ctx, tx, persona, c.HuellaDeSesion, c.Ahora); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("confirmar la transacción: %w", err)
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

// BorrarSinConfirmar borra la persona (ON DELETE CASCADE se lleva perfil, credencial, sesiones, enlaces y datos) de las
// cuentas adultas que no confirmaron el correo (caso 1) o que lo confirmaron y **nunca autorizaron nada**: sin ninguna
// fila en `autorizacion` como titular, vigente o retirada (caso 2; D-135, SC-E21-25 sección 5, D-202). Una cuenta que ya
// autorizó algo y a la que le falta una finalidad necesaria nueva no se borra: queda en `sin_autorizacion`, sin plazo,
// hasta que acepte (`ReglaDeFinalidades.Faltantes`); por eso esta consulta no mira las necesarias. Sin llave a la persona,
// `autorizacion` no se borra en cascada: las que hubiera (solo las de una cuenta sin confirmar) quedan retiradas en
// `Ahora` y conservadas hasta `ConservarHasta` (E13 §7).
//
// Los plazos (D-203; ver `condicionDeLaPurga`): el caso 1, 7 días desde creada_en. El caso 2, 7 días desde creada_en **y**
// 48 horas desde `aviso_de_purga_en`; sin aviso, 14 días desde creada_en, y esas cuentas se devuelven en
// `ResultadoDeLaPurga.SinAviso` para que el servicio deje el error en el registro.
//
// **Dos sentencias en una transacción, porque una sola no es correcta.** Otorgar (y retirar, y registrar un token) toman
// la fila de la persona con `FOR UPDATE` y después escriben en `autorizacion`, que no tiene llave a la persona. En READ
// COMMITTED, una sentencia única que decidiera los candidatos con `NOT EXISTS (… autorizacion …)` los decide con la foto
// del inicio: si un otorgamiento tiene la fila, la sentencia espera el bloqueo y, al soltarse, relee solo la fila de
// `persona` (la tabla bloqueada), nunca el `NOT EXISTS` de otra tabla, y borra a una persona que ya autorizó, dejando
// autorizaciones vigentes huérfanas. Por eso: (1) se eligen los candidatos y se **bloquean** sus filas (`FOR UPDATE`, en
// orden de id); con el bloqueo tomado, ningún otorgamiento puede estar a medias, y (2) una sentencia nueva, con foto
// nueva que ya ve lo confirmado (también un aviso recién escrito), **vuelve a evaluar la condición** sobre las filas
// bloqueadas y solo entonces retira y borra. Quien llegó después de (2) espera el bloqueo y encuentra la cuenta borrada
// (`ErrSinCuenta`).
//
// Quedan fuera: las cuentas que pasaron de menor a adulta (fecha_de_paso), que tienen historia con su tutor y
// no pasan por la verificación de este correo, y las de menores.
func (r *Cuentas) BorrarSinConfirmar(ctx context.Context, p cuenta.PlazosDeLaPurga) (cuenta.ResultadoDeLaPurga, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return cuenta.ResultadoDeLaPurga{}, fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)
	filas, err := tx.Query(ctx,
		`WITH candidatas AS (
		     SELECT p.id
		     FROM persona p
		     JOIN perfil_adulto pa ON pa.persona_id = p.id
		     WHERE `+condicionDeLaPurga+`
		 )
		 SELECT p.id::text FROM persona p JOIN candidatas c ON c.id = p.id ORDER BY p.id FOR UPDATE OF p`,
		p.CreadasHasta, p.AvisadasHasta, p.SinAvisoHasta)
	if err != nil {
		return cuenta.ResultadoDeLaPurga{}, fmt.Errorf("bloquear las cuentas sin confirmar: %w", err)
	}
	bloqueadas, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return cuenta.ResultadoDeLaPurga{}, fmt.Errorf("leer las cuentas sin confirmar: %w", err)
	}
	if len(bloqueadas) == 0 {
		return cuenta.ResultadoDeLaPurga{}, nil
	}
	// `sin_aviso`: del caso 2 (correo verificado) y sin aviso; solo puede estar en las candidatas por el límite de 14 días.
	filas, err = tx.Query(ctx,
		`WITH candidatas AS (
		     SELECT p.id, (pa.correo_verificado AND pa.aviso_de_purga_en IS NULL) AS sin_aviso
		     FROM persona p
		     JOIN perfil_adulto pa ON pa.persona_id = p.id
		     WHERE p.id = ANY($6::uuid[]) AND `+condicionDeLaPurga+`
		 ), retiradas AS (
		     UPDATE autorizacion a
		        SET retirada_en = GREATEST(a.otorgada_en, $4), conservar_hasta = $5::date
		       FROM candidatas c
		      WHERE a.titular_id = c.id AND a.retirada_en IS NULL
		     RETURNING a.id
		 )
		 DELETE FROM persona p USING candidatas c WHERE p.id = c.id RETURNING p.id::text, c.sin_aviso`,
		p.CreadasHasta, p.AvisadasHasta, p.SinAvisoHasta, p.Ahora, p.ConservarHasta, bloqueadas)
	if err != nil {
		return cuenta.ResultadoDeLaPurga{}, fmt.Errorf("borrar las cuentas sin confirmar: %w", err)
	}
	var res cuenta.ResultadoDeLaPurga
	for filas.Next() {
		var id string
		var sinAviso bool
		if err := filas.Scan(&id, &sinAviso); err != nil {
			return cuenta.ResultadoDeLaPurga{}, fmt.Errorf("leer las cuentas borradas: %w", err)
		}
		res.Borradas++
		if sinAviso {
			res.SinAviso = append(res.SinAviso, id)
		}
	}
	if err := filas.Err(); err != nil {
		return cuenta.ResultadoDeLaPurga{}, fmt.Errorf("borrar las cuentas sin confirmar: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return cuenta.ResultadoDeLaPurga{}, fmt.Errorf("confirmar la transacción: %w", err)
	}
	return res, nil
}

// condicionDeLaPurga es la condición de BorrarSinConfirmar (sobre `p` y `pa`, con `$1` = CreadasHasta, `$2` =
// AvisadasHasta y `$3` = SinAvisoHasta): se evalúa dos veces, al elegir y al confirmar con las filas ya bloqueadas.
//
//   - caso 1 (`NOT correo_verificado`): creada hasta `$1` (7 días), como desde D-135, con o sin autorizaciones;
//   - caso 2 (correo verificado y ninguna autorización como titular, D-202): creada hasta `$1` **y**, o avisada hasta `$2`
//     (48 horas desde el aviso), o sin aviso y creada hasta `$3` (el límite de 14 días, D-203).
const condicionDeLaPurga = `p.etapa = 'adulta'
		       AND pa.fecha_de_paso IS NULL
		       AND p.creada_en <= $1
		       AND (
		           NOT pa.correo_verificado
		           OR (
		               NOT EXISTS (SELECT 1 FROM autorizacion a WHERE a.titular_id = p.id)
		               AND (
		                   pa.aviso_de_purga_en <= $2
		                   OR (pa.aviso_de_purga_en IS NULL AND p.creada_en <= $3)
		               )
		           )
		       )`

// AvisarAntesDeLaPurga manda el aviso del día 5 a las cuentas del caso 2 y lo registra (ítem 294, D-203): adulta, sin
// fecha_de_paso, con el correo confirmado, ninguna fila en `autorizacion` como titular (vigente o retirada, D-202), creada
// hasta `avisarHasta` y sin `aviso_de_purga_en`.
//
// **Una cuenta por transacción**, para que el envío, que es lento y puede fallar, tenga bloqueada una sola cuenta a la vez
// (y el servicio le pone un plazo corto): (1) se bloquean la fila de la persona y la de su perfil (en ese orden, el de
// la purga y el del resto de las operaciones sobre la cuenta, para no abrazarse con ninguna); (2) con una sentencia nueva,
// con la foto que ya ve lo confirmado, se **vuelve a evaluar** el caso 2 sobre las filas bloqueadas (si la persona acaba de
// autorizar, o ya la avisó otra pasada, no se manda nada); (3) se envía; (4) solo si salió, se escribe
// `aviso_de_purga_en` y se confirma. Si el envío falla, la transacción se deshace sin escribir nada y sigue la siguiente
// cuenta. Si el correo sale y la escritura o la confirmación fallan, la pasada siguiente lo manda otra vez.
func (r *Cuentas) AvisarAntesDeLaPurga(ctx context.Context, avisarHasta time.Time, enviar cuenta.EnvioDelAviso) (int, error) {
	filas, err := r.pool.Query(ctx,
		`SELECT p.id::text FROM persona p JOIN perfil_adulto pa ON pa.persona_id = p.id WHERE `+condicionDelAviso+` ORDER BY p.creada_en, p.id`,
		avisarHasta)
	if err != nil {
		return 0, fmt.Errorf("buscar las cuentas por avisar: %w", err)
	}
	ids, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return 0, fmt.Errorf("leer las cuentas por avisar: %w", err)
	}
	avisadas := 0
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return avisadas, err
		}
		avisada, err := r.avisarUna(ctx, id, avisarHasta, enviar)
		if err != nil {
			return avisadas, err
		}
		if avisada {
			avisadas++
		}
	}
	return avisadas, nil
}

// avisarUna es una cuenta de AvisarAntesDeLaPurga. Devuelve true si el aviso salió y quedó registrado.
func (r *Cuentas) avisarUna(ctx context.Context, id string, avisarHasta time.Time, enviar cuenta.EnvioDelAviso) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("abrir la transacción: %w", err)
	}
	defer tx.Rollback(ctx)
	for _, q := range []string{
		`SELECT 1 FROM persona WHERE id = $1::uuid FOR UPDATE`,
		`SELECT 1 FROM perfil_adulto WHERE persona_id = $1::uuid FOR UPDATE`,
	} {
		if _, err := tx.Exec(ctx, q, id); err != nil {
			return false, fmt.Errorf("bloquear la cuenta por avisar: %w", err)
		}
	}
	c := cuenta.CuentaPorAvisar{ID: id}
	err = tx.QueryRow(ctx,
		`SELECT pa.correo, p.creada_en FROM persona p JOIN perfil_adulto pa ON pa.persona_id = p.id
		  WHERE p.id = $2::uuid AND `+condicionDelAviso, avisarHasta, id).Scan(&c.Correo, &c.CreadaEn)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil // se borró, autorizó o la avisó otra pasada mientras se esperaba el bloqueo
	}
	if err != nil {
		return false, fmt.Errorf("volver a evaluar la cuenta por avisar: %w", err)
	}
	avisoEn, err := enviar(ctx, c)
	if err != nil {
		return false, nil // el servicio ya lo registró; nada se escribe y la pasada siguiente lo reintenta
	}
	if _, err := tx.Exec(ctx, `UPDATE perfil_adulto SET aviso_de_purga_en = $2 WHERE persona_id = $1::uuid`, id, avisoEn); err != nil {
		return false, fmt.Errorf("registrar el aviso: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("confirmar el aviso: %w", err)
	}
	return true, nil
}

// condicionDelAviso es el caso 2 sin aviso (sobre `p` y `pa`, con `$1` = creadas hasta `avisarHasta`): se evalúa al elegir
// y, con las filas bloqueadas, antes de enviar.
const condicionDelAviso = `p.etapa = 'adulta'
		       AND pa.fecha_de_paso IS NULL
		       AND pa.correo_verificado
		       AND pa.correo IS NOT NULL
		       AND pa.aviso_de_purga_en IS NULL
		       AND p.creada_en <= $1
		       AND NOT EXISTS (SELECT 1 FROM autorizacion a WHERE a.titular_id = p.id)`
