-- +goose Up
-- E13-MDD v1.19 · migración de REFERENCIA (US-67, SC-E21-25, D-202). La migración real es idéntica y vive en el repositorio del producto (D-122).
-- Siembra la finalidad necesaria `transmision_a_encargados`: la aceptación expresa del titular de que sus datos se envíen a los encargados que los guardan y los procesan (Ley 1581, art. 26, lit. a).
-- La da la persona adulta (PN-64), el tutor por el titular menor (PN-36) y la persona a los 18 años (PN-54). Quién la otorga en cada etapa lo fija `ReglaDeFinalidades`, no la base.
-- Sin cambio de esquema ni de datos: las cuentas de antes no la tienen y quedan sin autorización completa hasta que la acepten (SC-E21-25, sección 5).
INSERT INTO finalidad (codigo, tipo, activa, descripcion) VALUES
    ('transmision_a_encargados', 'necesaria', true, 'Aceptación expresa de que los datos se envíen a los encargados que los guardan y los procesan por cuenta del responsable (SC-E21-25).');

-- +goose Down
-- Falla si ya hay autorizaciones de esta finalidad (fk_autorizacion_finalidad es RESTRICT): la prueba de lo que la persona aceptó no se borra al bajar.
DELETE FROM finalidad WHERE codigo = 'transmision_a_encargados';
