-- +goose Up
-- E13-MDD · migración de REFERENCIA (ítem 294, D-203). La migración real es idéntica y vive en el repositorio del producto (D-122).
-- El aviso antes de la purga: la tarea de D-135 manda un correo a las cuentas del caso 2 (adulta, correo confirmado, ninguna autorización como titular) desde los 5 días de creada y espera 48 horas desde ese aviso para borrarlas.
-- Una columna en `perfil_adulto`, vacía en las cuentas que ya existen: la primera pasada de la tarea después de desplegar avisa a las que ya pasaron el día 5. Sin cambio de roles ni de permisos: la tabla ya es del API.
ALTER TABLE perfil_adulto ADD COLUMN aviso_de_purga_en timestamptz;
COMMENT ON COLUMN perfil_adulto.aviso_de_purga_en IS 'Cuándo salió el correo de aviso antes de la purga, en UTC (ítem 294, D-203). Solo lo escribe la tarea de avisos (AvisarAntesDeLaPurga), que corre después de la purga y de la limpieza, en la misma transacción en que elige y bloquea a la cuenta, después de enviar el correo con éxito, y solo a una cuenta del caso 2: adulta, sin fecha_de_paso, correo verificado y ninguna fila en `autorizacion` como titular. Vacía: no se avisó. Una cuenta del caso 2 se borra cuando se cumplen creada_en + 7 días y aviso_de_purga_en + 48 horas; sin aviso, a los 14 días de creada (con un error en el registro de la tarea). El caso 1 (correo sin confirmar) nunca se avisa.';

-- +goose Down
ALTER TABLE perfil_adulto DROP COLUMN IF EXISTS aviso_de_purga_en;
