-- +goose Up
-- E13-MDD · migración de REFERENCIA (US-103, D-219 y D-220). La migración real es idéntica y vive en el repositorio del producto (D-122).
-- BD-03: borrar un `movimiento_recurrente` que ya generó movimientos fallaba. La llave `fk_movimiento_recurrente_id` ya es `ON DELETE SET NULL`, pero `ck_movimiento_recurrencia` exigía que `recurrente_id` y `fecha_programada` fueran nulos o no nulos a la vez: el `SET NULL` dejaba la fecha y el CHECK rechazaba el borrado entero (23514). Se ajustan juntos: la llave queda como está (`SET NULL`, lo que E13 promete en 01-modelo-de-datos) y el CHECK pasa a admitir la fecha sin recurrente, así el `SET NULL` ya no lo viola. El movimiento conserva su `fecha_programada`.
-- Del CHECK de antes se conserva todo lo demás: la fecha programada solo existe en un gasto o un ingreso (nunca en un aporte, ni con recurrente ni sin él) y un movimiento con recurrente lleva siempre su fecha programada. `uq_movimiento_recurrente_programada` no cambia: un mismo recurrente no repite fecha y, con `recurrente_id` nulo, nulo no choca con nulo, así que movimientos de recurrentes borrados pueden compartir fecha.
-- Todo dato que ya existe cumple el CHECK nuevo (el de antes lo implica): la migración no cambia ninguna fila.
-- BD-05 y BD-06: tres índices. `invitacion.aceptada_por` y `propuesta_transferencia.proponente_id` son llaves sin índice: borrar una cuenta (ON DELETE SET NULL y CASCADE) las recorría enteras. El de `invitacion` es parcial porque casi todas son nulas. El de `movimiento` sirve al filtro por categoría de la lista de Movimientos (persona, categoría y rango de fechas).
-- BD-02: `ck_persona_preferencias` pasa de «es un objeto» a «es un objeto y todos sus valores son booleanos» (decisión del dueño, D-222). El camino va en modo `strict` porque en el `lax` por defecto `$.*` abre las listas y `{"a": [true]}` pasaría. No hay lista cerrada de claves: la fija la historia que construye PN-67. Si una fila ya guarda un valor que no es booleano, la migración falla nombrando la restricción; no reescribe datos.
-- BD-04: sin cambio de esquema. Condición para la historia que construya `clave_grupo` (E15 5.9): la arma sin el nombre de la categoría, con `categoria_id`.
-- Sin cambio de roles ni de permisos: las tablas ya son del API.
ALTER TABLE persona DROP CONSTRAINT ck_persona_preferencias;
ALTER TABLE persona ADD CONSTRAINT ck_persona_preferencias CHECK (jsonb_typeof(preferencias) = 'object' AND NOT jsonb_path_exists(preferencias, 'strict $.* ? (@.type() != "boolean")'));
ALTER TABLE movimiento DROP CONSTRAINT ck_movimiento_recurrencia;
ALTER TABLE movimiento ADD CONSTRAINT ck_movimiento_recurrencia CHECK ((recurrente_id IS NULL OR fecha_programada IS NOT NULL) AND (fecha_programada IS NULL OR tipo <> 'aporte'));
COMMENT ON COLUMN movimiento.recurrente_id IS 'Recurrente cuya fecha programada se confirmó para crear este movimiento. Nulo si se registró a mano o si el recurrente se borró: el movimiento se conserva con su `fecha_programada` (US-103, BD-03).';
COMMENT ON COLUMN movimiento.fecha_programada IS 'Fecha programada que la persona confirmó. El movimiento nace con `fecha` = `fecha_programada`, aunque la confirmación llegue tarde: nunca con la fecha de la confirmación, para que no pase a otro mes (D-094). No cambia aunque la persona corrija `fecha` después; evita confirmar dos veces la misma fecha. Nunca es nula si hay `recurrente_id`; sí puede haber fecha sin recurrente, cuando el recurrente se borró (US-103, BD-03).';

CREATE INDEX ix_invitacion_aceptada_por ON invitacion (aceptada_por) WHERE aceptada_por IS NOT NULL;
CREATE INDEX ix_propuesta_proponente ON propuesta_transferencia (proponente_id);
CREATE INDEX ix_movimiento_persona_categoria_fecha ON movimiento (persona_id, categoria_id, fecha);

-- +goose Down
-- Vuelve al CHECK de la 0001, que exige fecha y recurrente juntos. Falla, con este mensaje y sin dejar cambios a medias, si ya hay movimientos con `fecha_programada` y sin `recurrente_id`: esas fechas no se borran en silencio al bajar.
-- +goose StatementBegin
DO $$
DECLARE
    huerfanos bigint;
BEGIN
    SELECT count(*) INTO huerfanos FROM movimiento WHERE recurrente_id IS NULL AND fecha_programada IS NOT NULL;
    IF huerfanos > 0 THEN
        RAISE EXCEPTION 'no se puede bajar la 0008: % movimientos tienen fecha_programada y recurrente_id nulo (su recurrente se borró); el CHECK de la 0001 exige las dos columnas juntas', huerfanos
            USING ERRCODE = '23514';
    END IF;
END;
$$;
-- +goose StatementEnd
DROP INDEX IF EXISTS ix_movimiento_persona_categoria_fecha;
DROP INDEX IF EXISTS ix_propuesta_proponente;
DROP INDEX IF EXISTS ix_invitacion_aceptada_por;
ALTER TABLE persona DROP CONSTRAINT IF EXISTS ck_persona_preferencias;
ALTER TABLE persona ADD CONSTRAINT ck_persona_preferencias CHECK (jsonb_typeof(preferencias) = 'object');
ALTER TABLE movimiento DROP CONSTRAINT IF EXISTS ck_movimiento_recurrencia;
ALTER TABLE movimiento ADD CONSTRAINT ck_movimiento_recurrencia CHECK ((recurrente_id IS NULL) = (fecha_programada IS NULL) AND (recurrente_id IS NULL OR tipo <> 'aporte'));
COMMENT ON COLUMN movimiento.recurrente_id IS 'Recurrente cuya fecha programada se confirmó para crear este movimiento. Nulo si se registró a mano.';
COMMENT ON COLUMN movimiento.fecha_programada IS 'Fecha programada que la persona confirmó. El movimiento nace con `fecha` = `fecha_programada`, aunque la confirmación llegue tarde: nunca con la fecha de la confirmación, para que no pase a otro mes (D-094). No cambia aunque la persona corrija `fecha` después; evita confirmar dos veces la misma fecha.';
