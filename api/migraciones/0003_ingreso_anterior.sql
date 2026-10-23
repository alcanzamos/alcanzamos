-- +goose Up
-- E13-MDD v1.16 · migración de REFERENCIA (D-134). El API la lee en PN-71 (RF-062); la migración real es idéntica y vive en el repositorio del producto.
-- Sin IP ni dispositivo (NM-03, D-123). La columna nace vacía: queda así hasta el siguiente inicio de sesión de cada persona.
ALTER TABLE credencial ADD COLUMN ingreso_anterior timestamptz;
COMMENT ON COLUMN credencial.ingreso_anterior IS 'Inicio de sesión anterior al último, en UTC: es el que muestra PN-71 (RF-062). Solo fecha y hora, sin IP ni dispositivo (NM-03, D-123). Al iniciar sesión, en la misma transacción, `ingreso_anterior = ultimo_ingreso` y `ultimo_ingreso = ahora`. Vacía en el primer ingreso. `ultimo_ingreso` no cambia de significado: lo siguen usando NM-14 y RNF-018 (D-134).';

-- +goose Down
ALTER TABLE credencial DROP COLUMN IF EXISTS ingreso_anterior;
