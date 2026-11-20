-- +goose Up
-- E13-MDD · migración de REFERENCIA (bug 308, D-210). La migración real es idéntica y vive en el repositorio del producto (D-122).
-- Cuando el texto de las finalidades cambia de versión, la persona vuelve a aceptar lo necesario y la aceptación de antes se conserva como prueba (RF-063, Ley 1581): queda como «reemplazada por una versión nueva», no como retirada (la persona no retiró nada).
-- Una columna `autorizacion.reemplazada_en timestamptz NULL`, sin valor por defecto: ninguna fila que ya existe cambia. Una autorización vigente es la que no está retirada ni reemplazada, y de esas hay una por titular y finalidad: el índice único de las vigentes pasa a excluir también las reemplazadas, con el mismo nombre.
-- Sin cambio de roles ni de permisos: la tabla ya es del API.
ALTER TABLE autorizacion ADD COLUMN reemplazada_en timestamptz;
ALTER TABLE autorizacion ADD CONSTRAINT ck_autorizacion_reemplazo CHECK (reemplazada_en IS NULL OR reemplazada_en >= otorgada_en);
COMMENT ON COLUMN autorizacion.reemplazada_en IS 'Cuándo la persona aceptó una versión nueva del texto de la misma finalidad, en UTC (bug 308, D-210). Vacía: la fila no se ha reemplazado. La fila reemplazada no se retira ni se borra: queda como prueba de lo que la persona aceptó con la versión de entonces, y deja de ser vigente. Solo la escribe el API al otorgar una finalidad necesaria cuya versión guardada es anterior a la vigente; `retirada_en` sigue siendo solo del retiro de la persona y del borrado de la cuenta.';
DROP INDEX ix_autorizacion_vigente;
CREATE UNIQUE INDEX ix_autorizacion_vigente ON autorizacion (titular_id, finalidad) WHERE retirada_en IS NULL AND reemplazada_en IS NULL;

-- +goose Down
-- Falla si alguna finalidad de una persona tiene una fila reemplazada y otra vigente (el índice de antes exige una sola sin retirar por titular y finalidad): la prueba de lo que la persona aceptó con la versión de entonces no se borra al bajar.
DROP INDEX ix_autorizacion_vigente;
CREATE UNIQUE INDEX ix_autorizacion_vigente ON autorizacion (titular_id, finalidad) WHERE retirada_en IS NULL;
ALTER TABLE autorizacion DROP CONSTRAINT IF EXISTS ck_autorizacion_reemplazo;
ALTER TABLE autorizacion DROP COLUMN IF EXISTS reemplazada_en;
