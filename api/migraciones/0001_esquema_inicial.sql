-- +goose Up
-- E13-MDD v1.15 · migración de REFERENCIA. Es documentación: la migración real vive en el repositorio del producto y se escribe en E17.
-- La genera _generadores/e13-base-de-datos.py a partir de la misma definición que el diccionario y los diagramas. No se edita a mano.
-- Destino: PostgreSQL 16 o posterior (servidor flexible de Azure). Solo usa funciones del núcleo: gen_random_uuid() existe desde la 13.
-- Convenciones: nombres en español, ASCII y snake_case; claves uuid; montos bigint en centavos; instantes timestamptz en UTC;
-- días de calendario (fecha de Bogotá) como date; enumeraciones cerradas de E12 como CHECK.

-- finalidad: Catálogo de finalidades de tratamiento a las que se puede autorizar. Cerrado y sembrado por migración.
CREATE TABLE finalidad (
    codigo text NOT NULL,
    tipo text NOT NULL,
    activa boolean NOT NULL DEFAULT true,
    descripcion text NOT NULL,
    CONSTRAINT pk_finalidad PRIMARY KEY (codigo),
    CONSTRAINT ck_finalidad_codigo CHECK (codigo ~ '^[a-z][a-z0-9_]{2,40}$'),
    CONSTRAINT ck_finalidad_tipo CHECK (tipo IN ('necesaria', 'accesoria')),
    CONSTRAINT ck_finalidad_descripcion CHECK (char_length(descripcion) BETWEEN 1 AND 200)
);

-- categoria: Catálogo único de categorías del sistema, igual para todas las personas. Nadie la crea ni la renombra (RN-011).
CREATE TABLE categoria (
    id smallint NOT NULL,
    nombre text NOT NULL,
    tipo text NOT NULL,
    marca text,
    apta_para_menores boolean NOT NULL,
    oculta_por_defecto_menor boolean NOT NULL DEFAULT false,
    general boolean NOT NULL DEFAULT false,
    CONSTRAINT pk_categoria PRIMARY KEY (id),
    CONSTRAINT uq_categoria_nombre_tipo UNIQUE (nombre, tipo),
    CONSTRAINT uq_categoria_id_tipo UNIQUE (id, tipo),
    CONSTRAINT uq_categoria_id_general UNIQUE (id, general),
    CONSTRAINT ck_categoria_nombre CHECK (nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 60),
    CONSTRAINT ck_categoria_tipo CHECK (tipo IN ('gasto', 'ingreso')),
    CONSTRAINT ck_categoria_marca CHECK (marca IN ('recortable', 'esencial')),
    CONSTRAINT ck_categoria_marca_segun_tipo CHECK ((tipo = 'gasto') = (marca IS NOT NULL)),
    CONSTRAINT ck_categoria_general_apta CHECK (NOT general OR apta_para_menores),
    CONSTRAINT ck_categoria_por_defecto_apta CHECK (NOT oculta_por_defecto_menor OR apta_para_menores)
);
CREATE UNIQUE INDEX ix_categoria_general_por_tipo ON categoria (tipo) WHERE general;

-- persona: Cuenta de una persona durante toda su vida: la misma fila antes y después de los 18 años (P-16). La etapa reemplaza a las subclases.
CREATE TABLE persona (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    nombre text NOT NULL,
    etapa text NOT NULL,
    gasto_mensual_declarado bigint,
    preferencias jsonb NOT NULL DEFAULT '{}'::jsonb,
    creada_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_persona PRIMARY KEY (id),
    CONSTRAINT uq_persona_id_etapa UNIQUE (id, etapa),
    CONSTRAINT ck_persona_nombre CHECK (nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 60),
    CONSTRAINT ck_persona_etapa CHECK (etapa IN ('menor', 'adulta')),
    CONSTRAINT ck_persona_gasto_mensual_declarado CHECK (gasto_mensual_declarado >= 0),
    CONSTRAINT ck_persona_preferencias CHECK (jsonb_typeof(preferencias) = 'object')
);

-- perfil_menor: Lo propio de un menor: su usuario de acceso y su correo opcional. Existe mientras sea menor y, tras los 18 años, mientras complete el primer ingreso.
CREATE TABLE perfil_menor (
    persona_id uuid NOT NULL,
    nombre_de_usuario text NOT NULL,
    correo_opcional text,
    correo_confirmado boolean NOT NULL DEFAULT false,
    CONSTRAINT pk_perfil_menor PRIMARY KEY (persona_id),
    CONSTRAINT uq_perfil_menor_usuario UNIQUE (nombre_de_usuario),
    CONSTRAINT ck_perfil_menor_nombre_de_usuario CHECK (nombre_de_usuario ~ '^[a-z0-9._-]{3,30}$'),
    CONSTRAINT ck_perfil_menor_correo_opcional CHECK (correo_opcional = lower(btrim(correo_opcional)) AND position('@' IN correo_opcional) > 1),
    CONSTRAINT ck_perfil_menor_correo_confirmado CHECK (NOT correo_confirmado OR correo_opcional IS NOT NULL),
    CONSTRAINT fk_perfil_menor_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE
);

-- nacimiento_menor: Fecha de nacimiento de un menor, cifrada por la aplicación. Se borra en `PasarAAdulta` (D-084 (1), RNF-004). Es el único dueño del dato (NM-03).
CREATE TABLE nacimiento_menor (
    persona_id uuid NOT NULL,
    etapa text NOT NULL DEFAULT 'menor',
    valor_cifrado bytea NOT NULL,
    version_clave smallint NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_nacimiento_menor PRIMARY KEY (persona_id),
    CONSTRAINT ck_nacimiento_menor_etapa CHECK (etapa = 'menor'),
    CONSTRAINT ck_nacimiento_menor_valor_cifrado CHECK (octet_length(valor_cifrado) = 38),
    CONSTRAINT ck_nacimiento_menor_version_clave CHECK (version_clave > 0),
    CONSTRAINT fk_nacimiento_menor_persona_etapa FOREIGN KEY (persona_id, etapa) REFERENCES persona (id, etapa) ON DELETE CASCADE
);

-- perfil_adulto: Lo propio de una persona adulta: correo, ingreso y horas declarados, estado de la cuenta y fecha de paso desde menor. Existe solo si la persona es adulta.
CREATE TABLE perfil_adulto (
    persona_id uuid NOT NULL,
    etapa text NOT NULL DEFAULT 'adulta',
    correo text,
    correo_verificado boolean NOT NULL DEFAULT false,
    ingreso_neto bigint,
    horas_de_trabajo numeric(6,2),
    horas_de_vida_activadas boolean NOT NULL DEFAULT false,
    estado text NOT NULL DEFAULT 'activa',
    fecha_de_paso date,
    CONSTRAINT pk_perfil_adulto PRIMARY KEY (persona_id),
    CONSTRAINT uq_perfil_adulto_correo UNIQUE (correo),
    CONSTRAINT ck_perfil_adulto_etapa CHECK (etapa = 'adulta'),
    CONSTRAINT ck_perfil_adulto_correo CHECK (correo = lower(btrim(correo)) AND position('@' IN correo) > 1),
    CONSTRAINT ck_perfil_adulto_ingreso_neto CHECK (ingreso_neto > 0),
    CONSTRAINT ck_perfil_adulto_horas_de_trabajo CHECK (horas_de_trabajo > 0 AND horas_de_trabajo <= 744),
    CONSTRAINT ck_perfil_adulto_estado CHECK (estado IN ('activa', 'bloqueada')),
    CONSTRAINT ck_perfil_adulto_correo_verificado CHECK (NOT correo_verificado OR correo IS NOT NULL),
    CONSTRAINT ck_perfil_adulto_correo_o_paso CHECK (correo IS NOT NULL OR fecha_de_paso IS NOT NULL),
    CONSTRAINT ck_perfil_adulto_bloqueo CHECK (estado = 'activa' OR fecha_de_paso IS NOT NULL),
    CONSTRAINT fk_perfil_adulto_persona_etapa FOREIGN KEY (persona_id, etapa) REFERENCES persona (id, etapa) ON DELETE CASCADE
);
CREATE INDEX ix_perfil_adulto_paso ON perfil_adulto (fecha_de_paso) WHERE fecha_de_paso IS NOT NULL;

-- credencial: Cómo entra una persona: el hash de su contraseña, si es temporal y su último ingreso. No guarda correo ni usuario: son de los perfiles.
CREATE TABLE credencial (
    persona_id uuid NOT NULL,
    hash text NOT NULL,
    es_temporal boolean NOT NULL DEFAULT false,
    ultimo_ingreso timestamptz,
    CONSTRAINT pk_credencial PRIMARY KEY (persona_id),
    CONSTRAINT ck_credencial_hash CHECK (left(hash, 10) = '$argon2id$' AND char_length(hash) <= 255),
    CONSTRAINT fk_credencial_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE
);

-- hogar: Grupo de personas que comparten parte de sus finanzas. Siempre tiene un administrador que es miembro (RN-007).
CREATE TABLE hogar (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    nombre text,
    creado_en date NOT NULL,
    administrador_id uuid NOT NULL,
    CONSTRAINT pk_hogar PRIMARY KEY (id),
    CONSTRAINT uq_hogar_administrador UNIQUE (administrador_id),
    CONSTRAINT ck_hogar_nombre CHECK (nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 60),
    CONSTRAINT fk_hogar_administrador_id FOREIGN KEY (administrador_id) REFERENCES perfil_adulto (persona_id) ON DELETE NO ACTION
);

-- miembro_hogar: Pertenencia de una persona a un hogar, con la fecha de ingreso. La clave en `persona_id` impone un hogar a la vez (RN-009). Guarda también a los menores a cargo (RN-010), pero «Miembros del hogar» solo lee las filas de personas adultas: un menor nunca aparece ni se nombra en el hogar (CU-27 2b, D-098).
CREATE TABLE miembro_hogar (
    persona_id uuid NOT NULL,
    hogar_id uuid NOT NULL,
    desde timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_miembro_hogar PRIMARY KEY (persona_id),
    CONSTRAINT uq_miembro_hogar_hogar_persona UNIQUE (hogar_id, persona_id),
    CONSTRAINT fk_miembro_hogar_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE,
    CONSTRAINT fk_miembro_hogar_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE CASCADE
);

-- tutoria: Vínculo entre una persona adulta tutora y un menor. Guarda las declaraciones con la versión de su texto. Se borra al cumplir 18 años (RN-016).
CREATE TABLE tutoria (
    tutor_id uuid NOT NULL,
    menor_id uuid NOT NULL,
    declaro_escuchar_al_menor boolean NOT NULL,
    declaro_representacion boolean NOT NULL,
    autorizacion_expresa boolean NOT NULL,
    version_declaracion text NOT NULL,
    inicio date NOT NULL,
    CONSTRAINT pk_tutoria PRIMARY KEY (tutor_id, menor_id),
    CONSTRAINT ck_tutoria_version_declaracion CHECK (char_length(version_declaracion) BETWEEN 1 AND 20),
    CONSTRAINT ck_tutoria_distintos CHECK (tutor_id <> menor_id),
    CONSTRAINT fk_tutoria_tutor_id FOREIGN KEY (tutor_id) REFERENCES perfil_adulto (persona_id) ON DELETE CASCADE,
    CONSTRAINT fk_tutoria_menor_id FOREIGN KEY (menor_id) REFERENCES perfil_menor (persona_id) ON DELETE CASCADE
);
CREATE INDEX ix_tutoria_menor ON tutoria (menor_id);

-- comparticion_categoria: Categorías que un adolescente comparte en detalle con todos sus tutores. Se vacía al cumplir 18 años (RN-016).
CREATE TABLE comparticion_categoria (
    menor_id uuid NOT NULL,
    categoria_id smallint NOT NULL,
    CONSTRAINT pk_comparticion_categoria PRIMARY KEY (menor_id, categoria_id),
    CONSTRAINT fk_comparticion_categoria_menor_id FOREIGN KEY (menor_id) REFERENCES perfil_menor (persona_id) ON DELETE CASCADE,
    CONSTRAINT fk_comparticion_categoria_categoria_id FOREIGN KEY (categoria_id) REFERENCES categoria (id) ON DELETE RESTRICT
);

-- ocultamiento_categoria: Categoría que una persona deja de ver. El vínculo mismo es la ocultación (clase de asociación de E09). Guarda el origen, para que a los 18 años se muestre lo que ocultó la regla de menores (hoy, Salud) y lo que la persona ocultó siga oculto (D-089, D-102).
CREATE TABLE ocultamiento_categoria (
    persona_id uuid NOT NULL,
    categoria_id smallint NOT NULL,
    categoria_general boolean NOT NULL DEFAULT false,
    fecha date,
    origen text NOT NULL DEFAULT 'decision_propia',
    CONSTRAINT pk_ocultamiento_categoria PRIMARY KEY (persona_id, categoria_id),
    CONSTRAINT ck_ocultamiento_categoria_categoria_general CHECK (NOT categoria_general),
    CONSTRAINT ck_ocultamiento_categoria_origen CHECK (origen IN ('regla_de_menores', 'decision_propia')),
    CONSTRAINT fk_ocultamiento_categoria_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE,
    CONSTRAINT fk_ocultamiento_categoria_categoria FOREIGN KEY (categoria_id, categoria_general) REFERENCES categoria (id, general) ON DELETE RESTRICT
);

-- invitacion: Invitación de un solo uso a un hogar, válida 7 días. Guarda solo el SHA-256 del código. Nunca la acepta un menor.
CREATE TABLE invitacion (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    hogar_id uuid NOT NULL,
    codigo_hash bytea NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente',
    vence date NOT NULL,
    aceptada_por uuid,
    creada_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_invitacion PRIMARY KEY (id),
    CONSTRAINT uq_invitacion_codigo UNIQUE (codigo_hash),
    CONSTRAINT ck_invitacion_codigo_hash CHECK (octet_length(codigo_hash) = 32),
    CONSTRAINT ck_invitacion_estado CHECK (estado IN ('pendiente', 'usada', 'rechazada', 'vencida', 'revocada')),
    CONSTRAINT ck_invitacion_aceptada CHECK (aceptada_por IS NULL OR estado = 'usada'),
    CONSTRAINT fk_invitacion_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE CASCADE,
    CONSTRAINT fk_invitacion_aceptada_por FOREIGN KEY (aceptada_por) REFERENCES perfil_adulto (persona_id) ON DELETE SET NULL
);
CREATE INDEX ix_invitacion_hogar_estado ON invitacion (hogar_id, estado);
CREATE INDEX ix_invitacion_vence ON invitacion (vence) WHERE estado = 'pendiente';

-- propuesta_transferencia: Propuesta, con vencimiento de 7 días, de transferir la administración de un hogar o la tutoría de un menor. Solo uno de los dos destinos está presente: el hogar o el menor.
CREATE TABLE propuesta_transferencia (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tipo text NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente',
    vence date NOT NULL,
    proponente_id uuid NOT NULL,
    destinataria_id uuid NOT NULL,
    hogar_id uuid,
    menor_id uuid,
    creada_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_propuesta_transferencia PRIMARY KEY (id),
    CONSTRAINT ck_propuesta_transferencia_tipo CHECK (tipo IN ('administrador_del_hogar', 'tutoria')),
    CONSTRAINT ck_propuesta_transferencia_estado CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'vencida', 'cancelada')),
    CONSTRAINT ck_propuesta_destino CHECK ((tipo = 'administrador_del_hogar' AND hogar_id IS NOT NULL AND menor_id IS NULL) OR (tipo = 'tutoria' AND menor_id IS NOT NULL AND hogar_id IS NULL)),
    CONSTRAINT ck_propuesta_distintos CHECK (proponente_id <> destinataria_id),
    CONSTRAINT fk_propuesta_transferencia_proponente_id FOREIGN KEY (proponente_id) REFERENCES perfil_adulto (persona_id) ON DELETE CASCADE,
    CONSTRAINT fk_propuesta_transferencia_destinataria_id FOREIGN KEY (destinataria_id) REFERENCES perfil_adulto (persona_id) ON DELETE CASCADE,
    CONSTRAINT fk_propuesta_transferencia_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE CASCADE,
    CONSTRAINT fk_propuesta_transferencia_menor_id FOREIGN KEY (menor_id) REFERENCES perfil_menor (persona_id) ON DELETE CASCADE
);
CREATE INDEX ix_propuesta_destinataria ON propuesta_transferencia (destinataria_id, estado);
CREATE INDEX ix_propuesta_hogar ON propuesta_transferencia (hogar_id) WHERE hogar_id IS NOT NULL;
CREATE INDEX ix_propuesta_menor ON propuesta_transferencia (menor_id) WHERE menor_id IS NOT NULL;
CREATE INDEX ix_propuesta_vence ON propuesta_transferencia (vence) WHERE estado = 'pendiente';

-- movimiento_recurrente: Gasto o ingreso que se registra una vez. Cada fecha programada queda pendiente y la persona la confirma: solo entonces nace una fila de `movimiento`. La fecha pendiente no se guarda (D-091); la que la persona marca «No pasó» sí, en `ocurrencia_omitida` (D-092). Los intereses de cesantías se ofrecen con recurrencia anual en enero (RF-053).
CREATE TABLE movimiento_recurrente (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    persona_id uuid,
    hogar_id uuid,
    tipo text NOT NULL,
    categoria_id smallint NOT NULL,
    periodicidad text NOT NULL,
    monto_habitual bigint NOT NULL,
    medio text NOT NULL,
    inicio date NOT NULL,
    detenido_en date,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_movimiento_recurrente PRIMARY KEY (id),
    CONSTRAINT ck_movimiento_recurrente_tipo CHECK (tipo IN ('gasto', 'ingreso')),
    CONSTRAINT ck_movimiento_recurrente_periodicidad CHECK (periodicidad IN ('semanal', 'quincenal', 'mensual', 'semestral', 'anual')),
    CONSTRAINT ck_movimiento_recurrente_monto_habitual CHECK (monto_habitual > 0),
    CONSTRAINT ck_movimiento_recurrente_medio CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia')),
    CONSTRAINT ck_recurrente_persona_o_hogar CHECK (persona_id IS NOT NULL OR hogar_id IS NOT NULL),
    CONSTRAINT ck_recurrente_medio_ingreso CHECK (tipo <> 'ingreso' OR medio IN ('efectivo', 'transferencia')),
    CONSTRAINT ck_recurrente_detenido CHECK (detenido_en IS NULL OR detenido_en >= inicio),
    CONSTRAINT fk_movimiento_recurrente_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE SET NULL,
    CONSTRAINT fk_movimiento_recurrente_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE SET NULL,
    CONSTRAINT fk_recurrente_categoria_tipo FOREIGN KEY (categoria_id, tipo) REFERENCES categoria (id, tipo) ON DELETE RESTRICT
);
CREATE INDEX ix_recurrente_persona ON movimiento_recurrente (persona_id);
CREATE INDEX ix_recurrente_hogar ON movimiento_recurrente (hogar_id) WHERE hogar_id IS NOT NULL;

-- meta: Monto que una persona quiere reunir. El fondo de emergencia es una meta personal, a lo sumo una, nunca compartida (RF-013).
CREATE TABLE meta (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    persona_id uuid,
    hogar_id uuid,
    nombre text NOT NULL,
    monto_objetivo bigint NOT NULL,
    fecha_objetivo date,
    es_fondo_de_emergencia boolean NOT NULL DEFAULT false,
    meses_objetivo smallint,
    creada_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_meta PRIMARY KEY (id),
    CONSTRAINT uq_meta_persona_nombre UNIQUE (persona_id, nombre),
    CONSTRAINT ck_meta_nombre CHECK (nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 60),
    CONSTRAINT ck_meta_monto_objetivo CHECK (monto_objetivo > 0),
    CONSTRAINT ck_meta_meses_objetivo CHECK (meses_objetivo BETWEEN 1 AND 120),
    CONSTRAINT ck_meta_persona_o_hogar CHECK (persona_id IS NOT NULL OR hogar_id IS NOT NULL),
    CONSTRAINT ck_meta_fondo_personal CHECK (NOT es_fondo_de_emergencia OR hogar_id IS NULL),
    CONSTRAINT ck_meta_meses_fondo CHECK (es_fondo_de_emergencia = (meses_objetivo IS NOT NULL)),
    CONSTRAINT fk_meta_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE SET NULL,
    CONSTRAINT fk_meta_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX ix_meta_fondo_unico ON meta (persona_id) WHERE es_fondo_de_emergencia;
CREATE INDEX ix_meta_hogar ON meta (hogar_id) WHERE hogar_id IS NOT NULL;

-- recordatorio_meta: Recordatorio de aporte que una persona activa para una meta (clase de asociación de E09). Es una preferencia personal: en una meta compartida cada persona adulta del hogar tiene el suyo y el aviso solo le llega a quien lo activó. Sin fila, el recordatorio está apagado (RF-015, D-098).
CREATE TABLE recordatorio_meta (
    persona_id uuid NOT NULL,
    meta_id uuid NOT NULL,
    frecuencia text NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_recordatorio_meta PRIMARY KEY (persona_id, meta_id),
    CONSTRAINT ck_recordatorio_meta_frecuencia CHECK (frecuencia IN ('semanal', 'quincenal', 'mensual')),
    CONSTRAINT fk_recordatorio_meta_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE,
    CONSTRAINT fk_recordatorio_meta_meta_id FOREIGN KEY (meta_id) REFERENCES meta (id) ON DELETE CASCADE
);
CREATE INDEX ix_recordatorio_meta_meta ON recordatorio_meta (meta_id);

-- movimiento: Gasto, ingreso o aporte a una meta, en una sola tabla con el discriminador `tipo`. Un retiro es un aporte con `sentido` de salida (P-15). Nunca cambia de tipo.
CREATE TABLE movimiento (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    persona_id uuid,
    hogar_id uuid,
    tipo text NOT NULL,
    monto bigint NOT NULL,
    fecha date NOT NULL,
    medio text NOT NULL,
    descripcion text,
    categoria_id smallint,
    deuda_saldada_id uuid,
    meta_id uuid,
    sentido text,
    referencia text,
    recurrente_id uuid,
    fecha_programada date,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_movimiento PRIMARY KEY (id),
    CONSTRAINT uq_movimiento_recurrente_programada UNIQUE (recurrente_id, fecha_programada),
    CONSTRAINT ck_movimiento_tipo CHECK (tipo IN ('gasto', 'ingreso', 'aporte')),
    CONSTRAINT ck_movimiento_monto CHECK (monto > 0),
    CONSTRAINT ck_movimiento_medio CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia')),
    CONSTRAINT ck_movimiento_descripcion CHECK (char_length(descripcion) <= 280),
    CONSTRAINT ck_movimiento_sentido CHECK (sentido IN ('entrada', 'salida')),
    CONSTRAINT ck_movimiento_referencia CHECK (char_length(referencia) BETWEEN 1 AND 80),
    CONSTRAINT ck_movimiento_forma CHECK ((tipo IN ('gasto', 'ingreso') AND categoria_id IS NOT NULL AND meta_id IS NULL AND sentido IS NULL AND referencia IS NULL) OR (tipo = 'aporte' AND categoria_id IS NULL AND meta_id IS NOT NULL AND sentido IS NOT NULL AND deuda_saldada_id IS NULL)),
    CONSTRAINT ck_movimiento_medio_ingreso CHECK (tipo <> 'ingreso' OR medio IN ('efectivo', 'transferencia')),
    CONSTRAINT ck_movimiento_deuda CHECK (deuda_saldada_id IS NULL OR tipo = 'gasto'),
    CONSTRAINT ck_movimiento_recurrencia CHECK ((recurrente_id IS NULL) = (fecha_programada IS NULL) AND (recurrente_id IS NULL OR tipo <> 'aporte')),
    CONSTRAINT ck_movimiento_persona_o_hogar CHECK (persona_id IS NOT NULL OR hogar_id IS NOT NULL),
    CONSTRAINT fk_movimiento_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE SET NULL,
    CONSTRAINT fk_movimiento_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE SET NULL,
    CONSTRAINT fk_movimiento_categoria_tipo FOREIGN KEY (categoria_id, tipo) REFERENCES categoria (id, tipo) ON DELETE RESTRICT,
    CONSTRAINT fk_movimiento_meta_id FOREIGN KEY (meta_id) REFERENCES meta (id) ON DELETE CASCADE,
    CONSTRAINT fk_movimiento_recurrente_id FOREIGN KEY (recurrente_id) REFERENCES movimiento_recurrente (id) ON DELETE SET NULL
);
CREATE INDEX ix_movimiento_persona_fecha ON movimiento (persona_id, fecha);
CREATE INDEX ix_movimiento_hogar_fecha ON movimiento (hogar_id, fecha) WHERE hogar_id IS NOT NULL;
CREATE INDEX ix_movimiento_meta ON movimiento (meta_id, sentido) INCLUDE (monto) WHERE meta_id IS NOT NULL;
CREATE INDEX ix_movimiento_deuda ON movimiento (deuda_saldada_id) INCLUDE (monto) WHERE deuda_saldada_id IS NOT NULL;

-- ocurrencia_omitida: Fecha programada de un recurrente que la persona marcó «No pasó»: no se confirma, no se ofrece otra vez y la simulación deja de contarla como esperada. No es un movimiento: nada pasó (RF-006, RF-016, D-092). Una misma fecha no puede estar a la vez aquí y en `movimiento`.
CREATE TABLE ocurrencia_omitida (
    recurrente_id uuid NOT NULL,
    fecha_programada date NOT NULL,
    omitida_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_ocurrencia_omitida PRIMARY KEY (recurrente_id, fecha_programada),
    CONSTRAINT fk_ocurrencia_omitida_recurrente_id FOREIGN KEY (recurrente_id) REFERENCES movimiento_recurrente (id) ON DELETE CASCADE
);

-- comparticion_movimiento: Movimiento que un adolescente comparte en detalle con sus tutores. El movimiento es siempre suyo. Se vacía al cumplir 18 años (RN-016).
CREATE TABLE comparticion_movimiento (
    movimiento_id uuid NOT NULL,
    menor_id uuid NOT NULL,
    CONSTRAINT pk_comparticion_movimiento PRIMARY KEY (movimiento_id),
    CONSTRAINT fk_comparticion_movimiento_movimiento_id FOREIGN KEY (movimiento_id) REFERENCES movimiento (id) ON DELETE CASCADE,
    CONSTRAINT fk_comparticion_movimiento_menor_id FOREIGN KEY (menor_id) REFERENCES perfil_menor (persona_id) ON DELETE CASCADE
);
CREATE INDEX ix_comparticion_movimiento_menor ON comparticion_movimiento (menor_id);

-- presupuesto: Límite de gasto de una persona adulta para una categoría en un periodo (mes calendario). Único por persona, categoría y periodo (E13-7). Corregir el monto o quitar la fila no tiene restricción en la base de datos; que solo se pueda en el mes en curso lo hace cumplir `PresupuestoServicio` (D-094, SC-E21-13).
CREATE TABLE presupuesto (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    persona_id uuid,
    hogar_id uuid,
    categoria_id smallint NOT NULL,
    categoria_tipo text NOT NULL DEFAULT 'gasto',
    periodo date NOT NULL,
    monto_asignado bigint NOT NULL,
    CONSTRAINT pk_presupuesto PRIMARY KEY (id),
    CONSTRAINT uq_presupuesto_persona_periodo_categoria UNIQUE (persona_id, periodo, categoria_id),
    CONSTRAINT ck_presupuesto_categoria_tipo CHECK (categoria_tipo = 'gasto'),
    CONSTRAINT ck_presupuesto_periodo CHECK (EXTRACT(day FROM periodo) = 1),
    CONSTRAINT ck_presupuesto_monto_asignado CHECK (monto_asignado >= 0),
    CONSTRAINT ck_presupuesto_persona_o_hogar CHECK (persona_id IS NOT NULL OR hogar_id IS NOT NULL),
    CONSTRAINT fk_presupuesto_persona_id FOREIGN KEY (persona_id) REFERENCES perfil_adulto (persona_id) ON DELETE SET NULL,
    CONSTRAINT fk_presupuesto_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE SET NULL,
    CONSTRAINT fk_presupuesto_categoria_gasto FOREIGN KEY (categoria_id, categoria_tipo) REFERENCES categoria (id, tipo) ON DELETE RESTRICT
);
CREATE INDEX ix_presupuesto_hogar_periodo ON presupuesto (hogar_id, periodo) WHERE hogar_id IS NOT NULL;

-- valoracion_mensual: Marca +, − o 0 de una persona adulta para una categoría con gasto en un periodo. Solo para adultos, opcional (RF-056).
CREATE TABLE valoracion_mensual (
    persona_id uuid NOT NULL,
    periodo date NOT NULL,
    categoria_id smallint NOT NULL,
    categoria_tipo text NOT NULL DEFAULT 'gasto',
    valoracion text NOT NULL,
    CONSTRAINT pk_valoracion_mensual PRIMARY KEY (persona_id, periodo, categoria_id),
    CONSTRAINT ck_valoracion_mensual_periodo CHECK (EXTRACT(day FROM periodo) = 1),
    CONSTRAINT ck_valoracion_mensual_categoria_tipo CHECK (categoria_tipo = 'gasto'),
    CONSTRAINT ck_valoracion_mensual_valoracion CHECK (valoracion IN ('mas', 'menos', 'cero')),
    CONSTRAINT fk_valoracion_mensual_persona_id FOREIGN KEY (persona_id) REFERENCES perfil_adulto (persona_id) ON DELETE CASCADE,
    CONSTRAINT fk_valoracion_categoria_gasto FOREIGN KEY (categoria_id, categoria_tipo) REFERENCES categoria (id, tipo) ON DELETE RESTRICT
);

-- respuesta_suscripcion: Respuesta de una persona a «¿Esto es una suscripción?» para un grupo de gastos repetidos: «Sí, es una suscripción» o «No lo es». Un grupo con respuesta no se vuelve a preguntar (señal baja) y la señal alta no lleva botones (D-094, P-4 opción A de E14-PPA). El grupo no es una fila: se identifica con `clave_grupo`, que calcula E15 5.9 (categoría, palabras clave de la descripción del primer gasto del grupo y monto de ese gasto). Única por persona y grupo.
CREATE TABLE respuesta_suscripcion (
    persona_id uuid NOT NULL,
    categoria_id smallint NOT NULL,
    categoria_tipo text NOT NULL DEFAULT 'gasto',
    clave_grupo text NOT NULL,
    respuesta text NOT NULL,
    respondida_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_respuesta_suscripcion PRIMARY KEY (persona_id, categoria_id, clave_grupo),
    CONSTRAINT ck_respuesta_suscripcion_categoria_tipo CHECK (categoria_tipo = 'gasto'),
    CONSTRAINT ck_respuesta_suscripcion_clave_grupo CHECK (clave_grupo = btrim(clave_grupo) AND char_length(clave_grupo) BETWEEN 3 AND 200),
    CONSTRAINT ck_respuesta_suscripcion_respuesta CHECK (respuesta IN ('es_suscripcion', 'no_lo_es')),
    CONSTRAINT fk_respuesta_suscripcion_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE,
    CONSTRAINT fk_respuesta_suscripcion_categoria_gasto FOREIGN KEY (categoria_id, categoria_tipo) REFERENCES categoria (id, tipo) ON DELETE RESTRICT
);

-- tarjeta_credito: Tarjeta de crédito de una persona adulta. Agrupa sus compras a cuotas y recuerda la última tasa para proponerla en la compra siguiente.
CREATE TABLE tarjeta_credito (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    persona_id uuid NOT NULL,
    nombre text NOT NULL,
    tasa_de_referencia numeric(12,6),
    CONSTRAINT pk_tarjeta_credito PRIMARY KEY (id),
    CONSTRAINT uq_tarjeta_persona_nombre UNIQUE (persona_id, nombre),
    CONSTRAINT ck_tarjeta_credito_nombre CHECK (nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 40),
    CONSTRAINT ck_tarjeta_credito_tasa_de_referencia CHECK (tasa_de_referencia >= 0 AND tasa_de_referencia <= 999999.999999),
    CONSTRAINT fk_tarjeta_credito_persona_id FOREIGN KEY (persona_id) REFERENCES perfil_adulto (persona_id) ON DELETE CASCADE
);

-- extracto_tarjeta: Extracto de una tarjeta en un periodo: lo que la persona escribe desde su extracto. El abono a capital se calcula y no se guarda.
CREATE TABLE extracto_tarjeta (
    tarjeta_id uuid NOT NULL,
    periodo date NOT NULL,
    pago_minimo bigint NOT NULL,
    intereses_y_cargos bigint NOT NULL,
    CONSTRAINT pk_extracto_tarjeta PRIMARY KEY (tarjeta_id, periodo),
    CONSTRAINT ck_extracto_tarjeta_periodo CHECK (EXTRACT(day FROM periodo) = 1),
    CONSTRAINT ck_extracto_tarjeta_pago_minimo CHECK (pago_minimo >= 0),
    CONSTRAINT ck_extracto_tarjeta_intereses_y_cargos CHECK (intereses_y_cargos >= 0),
    CONSTRAINT fk_extracto_tarjeta_tarjeta_id FOREIGN KEY (tarjeta_id) REFERENCES tarjeta_credito (id) ON DELETE CASCADE
);

-- deuda: Obligación de pago, formal o informal, incluida la compra a cuotas con tarjeta. La tasa puede faltar y nunca se inventa (RN-005).
CREATE TABLE deuda (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    persona_id uuid,
    hogar_id uuid,
    nombre text,
    monto bigint NOT NULL,
    total_a_pagar bigint,
    saldo_informado bigint,
    saldo_informado_en date,
    cuotas integer NOT NULL,
    frecuencia_pago text,
    fecha_primer_pago date,
    cuota bigint,
    tasa numeric(12,6),
    inicio date NOT NULL,
    vence date NOT NULL,
    origen text NOT NULL,
    titular text NOT NULL,
    se_paga_por_nomina boolean NOT NULL DEFAULT false,
    tarjeta_id uuid,
    gasto_de_origen_id uuid,
    CONSTRAINT pk_deuda PRIMARY KEY (id),
    CONSTRAINT uq_deuda_gasto_de_origen UNIQUE (gasto_de_origen_id),
    CONSTRAINT ck_deuda_nombre CHECK (char_length(nombre) BETWEEN 1 AND 60),
    CONSTRAINT ck_deuda_monto CHECK (monto > 0),
    CONSTRAINT ck_deuda_saldo_informado CHECK (saldo_informado >= 0),
    CONSTRAINT ck_deuda_cuotas CHECK (cuotas BETWEEN 1 AND 600),
    CONSTRAINT ck_deuda_frecuencia_pago CHECK (frecuencia_pago IN ('diario', 'semanal', 'quincenal', 'mensual')),
    CONSTRAINT ck_deuda_cuota CHECK (cuota > 0),
    CONSTRAINT ck_deuda_tasa CHECK (tasa >= 0 AND tasa <= 999999.999999),
    CONSTRAINT ck_deuda_origen CHECK (origen IN ('formal', 'informal', 'familiar_o_amigo')),
    CONSTRAINT ck_deuda_titular CHECK (titular IN ('propia', 'de_tercero')),
    CONSTRAINT ck_deuda_fechas CHECK (vence >= inicio),
    CONSTRAINT ck_deuda_total_a_pagar CHECK (total_a_pagar IS NULL OR (total_a_pagar >= monto AND origen <> 'formal')),
    CONSTRAINT ck_deuda_calendario CHECK ((total_a_pagar IS NOT NULL) = (frecuencia_pago IS NOT NULL) AND (total_a_pagar IS NOT NULL) = (fecha_primer_pago IS NOT NULL) AND (total_a_pagar IS NOT NULL) = (cuota IS NOT NULL)),
    CONSTRAINT ck_deuda_calendario_en_fechas CHECK (cuota IS NULL OR (cuota <= total_a_pagar AND fecha_primer_pago >= inicio AND fecha_primer_pago <= vence)),
    CONSTRAINT ck_deuda_saldo_informado_con_fecha CHECK ((saldo_informado IS NULL) = (saldo_informado_en IS NULL)),
    CONSTRAINT ck_deuda_persona_o_hogar CHECK (persona_id IS NOT NULL OR hogar_id IS NOT NULL),
    CONSTRAINT fk_deuda_persona_id FOREIGN KEY (persona_id) REFERENCES perfil_adulto (persona_id) ON DELETE SET NULL,
    CONSTRAINT fk_deuda_hogar_id FOREIGN KEY (hogar_id) REFERENCES hogar (id) ON DELETE SET NULL,
    CONSTRAINT fk_deuda_tarjeta_id FOREIGN KEY (tarjeta_id) REFERENCES tarjeta_credito (id) ON DELETE SET NULL,
    CONSTRAINT fk_deuda_gasto_de_origen_id FOREIGN KEY (gasto_de_origen_id) REFERENCES movimiento (id) ON DELETE SET NULL
);
CREATE INDEX ix_deuda_persona ON deuda (persona_id);
CREATE INDEX ix_deuda_hogar ON deuda (hogar_id) WHERE hogar_id IS NOT NULL;
CREATE INDEX ix_deuda_tarjeta ON deuda (tarjeta_id) WHERE tarjeta_id IS NOT NULL;

-- persona_comprometida: Codeudor o fiador de una deuda, con un nombre o una relación opcional. No tiene cuenta ni autorizó el tratamiento: se guarda lo mínimo (RF-052).
CREATE TABLE persona_comprometida (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    deuda_id uuid NOT NULL,
    papel text NOT NULL,
    nombre_o_relacion text,
    CONSTRAINT pk_persona_comprometida PRIMARY KEY (id),
    CONSTRAINT ck_persona_comprometida_papel CHECK (papel IN ('codeudor', 'fiador')),
    CONSTRAINT ck_persona_comprometida_nombre_o_relacion CHECK (char_length(nombre_o_relacion) BETWEEN 1 AND 60),
    CONSTRAINT fk_persona_comprometida_deuda_id FOREIGN KEY (deuda_id) REFERENCES deuda (id) ON DELETE CASCADE
);
CREATE INDEX ix_persona_comprometida_deuda ON persona_comprometida (deuda_id);

-- aviso: Aviso a una persona: faltante, sugerencia, resumen, recordatorio, novedad del hogar o cambio de edad o de cuenta. El texto es fijo y la marca de IA queda siempre en falso (D-075).
CREATE TABLE aviso (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    persona_id uuid NOT NULL,
    tipo text NOT NULL,
    texto text NOT NULL,
    fecha date NOT NULL,
    periodo date,
    meta_id uuid,
    generado_por_ia boolean NOT NULL DEFAULT false,
    enviado boolean NOT NULL DEFAULT false,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_aviso PRIMARY KEY (id),
    CONSTRAINT ck_aviso_tipo CHECK (tipo IN ('faltante', 'recorte_sugerido', 'posible_suscripcion', 'resumen', 'recordatorio_de_meta', 'recordatorio_de_valoracion', 'hogar', 'cambio_de_edad_o_de_cuenta')),
    CONSTRAINT ck_aviso_texto CHECK (char_length(texto) BETWEEN 1 AND 500),
    CONSTRAINT ck_aviso_periodo CHECK (EXTRACT(day FROM periodo) = 1),
    CONSTRAINT ck_aviso_generado_por_ia CHECK (NOT generado_por_ia),
    CONSTRAINT ck_aviso_meta CHECK (tipo <> 'recordatorio_de_meta' OR meta_id IS NOT NULL),
    CONSTRAINT fk_aviso_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE,
    CONSTRAINT fk_aviso_meta_id FOREIGN KEY (meta_id) REFERENCES meta (id) ON DELETE CASCADE
);
CREATE INDEX ix_aviso_persona_fecha ON aviso (persona_id, fecha DESC);
CREATE INDEX ix_aviso_pendiente ON aviso (fecha) WHERE NOT enviado;
CREATE INDEX ix_aviso_meta ON aviso (meta_id) WHERE meta_id IS NOT NULL;

-- autorizacion: Cada otorgamiento de una autorización es un registro nuevo; retirarla no lo borra (Ley 1581). Tras borrar la cuenta queda la prueba mínima, sin llaves a la persona, por un plazo provisional.
CREATE TABLE autorizacion (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    titular_id uuid NOT NULL,
    otorgante_id uuid NOT NULL,
    finalidad text NOT NULL,
    version_del_texto text NOT NULL,
    otorgada_en timestamptz NOT NULL,
    retirada_en timestamptz,
    conservar_hasta date,
    CONSTRAINT pk_autorizacion PRIMARY KEY (id),
    CONSTRAINT uq_autorizacion_titular_finalidad_otorgada UNIQUE (titular_id, finalidad, otorgada_en),
    CONSTRAINT ck_autorizacion_version_del_texto CHECK (char_length(version_del_texto) BETWEEN 1 AND 20),
    CONSTRAINT ck_autorizacion_retiro CHECK (retirada_en IS NULL OR retirada_en >= otorgada_en),
    CONSTRAINT fk_autorizacion_finalidad FOREIGN KEY (finalidad) REFERENCES finalidad (codigo) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ix_autorizacion_vigente ON autorizacion (titular_id, finalidad) WHERE retirada_en IS NULL;
CREATE INDEX ix_autorizacion_conservar ON autorizacion (conservar_hasta) WHERE conservar_hasta IS NOT NULL;

-- sesion: Sesión opaca. La clave es el SHA-256 del token: el token nunca llega a la base (D-081). Revocar es borrar la fila.
CREATE TABLE sesion (
    hash_token bytea NOT NULL,
    persona_id uuid NOT NULL,
    creada_en timestamptz NOT NULL DEFAULT now(),
    ultimo_uso_en timestamptz NOT NULL DEFAULT now(),
    vence_en timestamptz NOT NULL,
    exige_nueva_contrasena boolean NOT NULL DEFAULT false,
    CONSTRAINT pk_sesion PRIMARY KEY (hash_token),
    CONSTRAINT ck_sesion_hash_token CHECK (octet_length(hash_token) = 32),
    CONSTRAINT ck_sesion_tiempos CHECK (ultimo_uso_en >= creada_en AND vence_en > creada_en),
    CONSTRAINT fk_sesion_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE
);
CREATE INDEX ix_sesion_persona ON sesion (persona_id, ultimo_uso_en);
CREATE INDEX ix_sesion_vence ON sesion (vence_en);

-- token_dispositivo: Token del dispositivo para avisos. Va ligado a la persona y al dispositivo, no a la sesión: no muere al vencer la sesión. Se borra al cerrar sesión a propósito, con la cuenta, cuando FCM lo reporta inválido o tras 180 días sin uso (NM-17, D-085). No guarda otros identificadores del dispositivo.
CREATE TABLE token_dispositivo (
    persona_id uuid NOT NULL,
    dispositivo_id text NOT NULL,
    token text NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    ultimo_uso_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_token_dispositivo PRIMARY KEY (persona_id, dispositivo_id),
    CONSTRAINT uq_token_dispositivo_token UNIQUE (token),
    CONSTRAINT ck_token_dispositivo_dispositivo_id CHECK (char_length(dispositivo_id) BETWEEN 1 AND 64),
    CONSTRAINT ck_token_dispositivo_token CHECK (char_length(token) BETWEEN 1 AND 2048),
    CONSTRAINT ck_token_dispositivo_tiempos CHECK (ultimo_uso_en >= creado_en),
    CONSTRAINT fk_token_dispositivo_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE
);
CREATE INDEX ix_token_dispositivo_ultimo_uso ON token_dispositivo (ultimo_uso_en);

-- enlace_un_uso: Enlace de verificación de correo o de recuperación de acceso. Guarda solo el SHA-256 del token y se usa una vez.
CREATE TABLE enlace_un_uso (
    hash_token bytea NOT NULL,
    persona_id uuid NOT NULL,
    proposito text NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    vence_en timestamptz NOT NULL,
    usado_en timestamptz,
    CONSTRAINT pk_enlace_un_uso PRIMARY KEY (hash_token),
    CONSTRAINT ck_enlace_un_uso_hash_token CHECK (octet_length(hash_token) = 32),
    CONSTRAINT ck_enlace_un_uso_proposito CHECK (proposito IN ('verificacion', 'recuperacion')),
    CONSTRAINT ck_enlace_tiempos CHECK (vence_en > creado_en),
    CONSTRAINT fk_enlace_un_uso_persona_id FOREIGN KEY (persona_id) REFERENCES persona (id) ON DELETE CASCADE
);
CREATE INDEX ix_enlace_persona ON enlace_un_uso (persona_id);
CREATE INDEX ix_enlace_vence ON enlace_un_uso (vence_en);

-- Llaves foráneas que cierran ciclos entre tablas.
ALTER TABLE hogar ADD CONSTRAINT fk_hogar_administrador_miembro FOREIGN KEY (id, administrador_id) REFERENCES miembro_hogar (hogar_id, persona_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE movimiento ADD CONSTRAINT fk_movimiento_deuda_saldada_id FOREIGN KEY (deuda_saldada_id) REFERENCES deuda (id) ON DELETE SET NULL;

-- Disparadores de integridad: lo que una restricción declarativa no alcanza a expresar.
-- +goose StatementBegin
CREATE FUNCTION fn_perfiles_coherentes(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_etapa text;
    v_menor boolean;
    v_adulto boolean;
    v_nacimiento boolean;
    v_paso date;
BEGIN
    SELECT etapa INTO v_etapa FROM persona WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN; -- la persona se borró: sus perfiles se fueron en cascada
    END IF;
    v_menor := EXISTS (SELECT 1 FROM perfil_menor WHERE persona_id = p_id);
    v_nacimiento := EXISTS (SELECT 1 FROM nacimiento_menor WHERE persona_id = p_id);
    SELECT fecha_de_paso INTO v_paso FROM perfil_adulto WHERE persona_id = p_id;
    v_adulto := FOUND;
    IF v_etapa = 'menor' AND NOT (v_menor AND v_nacimiento AND NOT v_adulto) THEN
        RAISE EXCEPTION 'persona %: una cuenta de menor exige perfil_menor y nacimiento_menor, y no admite perfil_adulto', p_id
            USING ERRCODE = '23514';
    END IF;
    IF v_etapa = 'adulta' AND NOT v_adulto THEN
        RAISE EXCEPTION 'persona %: una cuenta adulta exige perfil_adulto', p_id USING ERRCODE = '23514';
    END IF;
    IF v_etapa = 'adulta' AND v_menor AND v_paso IS NULL THEN
        RAISE EXCEPTION 'persona %: perfil_menor solo sobrevive al paso a adulta mientras se completa el primer ingreso', p_id
            USING ERRCODE = '23514';
    END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_perfiles_desde_persona() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_perfiles_coherentes(NEW.id);
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_perfiles_desde_perfil() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_perfiles_coherentes(OLD.persona_id);
    ELSE
        PERFORM fn_perfiles_coherentes(NEW.persona_id);
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_compartido_solo_de_adultos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.hogar_id IS NOT NULL AND NEW.persona_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM persona WHERE id = NEW.persona_id AND etapa = 'adulta') THEN
        RAISE EXCEPTION 'los datos de un menor nunca se comparten con el hogar (RF-026)' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_comparticion_de_movimiento_propio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM movimiento WHERE id = NEW.movimiento_id AND persona_id = NEW.menor_id) THEN
        RAISE EXCEPTION 'un menor solo comparte en detalle un movimiento suyo' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_omitida_sin_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Bloquea la fila del recurrente: serializa esta comprobación con la de fn_movimiento_sin_omitida().
    PERFORM 1 FROM movimiento_recurrente WHERE id = NEW.recurrente_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM movimiento WHERE recurrente_id = NEW.recurrente_id AND fecha_programada = NEW.fecha_programada) THEN
        RAISE EXCEPTION 'una fecha confirmada no se puede marcar como «No pasó»' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_movimiento_sin_omitida() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.recurrente_id IS NOT NULL THEN
        PERFORM 1 FROM movimiento_recurrente WHERE id = NEW.recurrente_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM ocurrencia_omitida WHERE recurrente_id = NEW.recurrente_id AND fecha_programada = NEW.fecha_programada) THEN
            RAISE EXCEPTION 'una fecha marcada «No pasó» no se puede confirmar' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_recordatorio_de_miembro() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM persona WHERE id = NEW.persona_id AND etapa = 'adulta') THEN
        RAISE EXCEPTION 'solo una persona adulta tiene recordatorios de meta' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM meta m
        WHERE m.id = NEW.meta_id
          AND (m.persona_id = NEW.persona_id
               OR EXISTS (SELECT 1 FROM miembro_hogar h WHERE h.hogar_id = m.hogar_id AND h.persona_id = NEW.persona_id))
    ) THEN
        RAISE EXCEPTION 'el recordatorio es de quien creó la meta o de un miembro del hogar con el que se comparte' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_recordatorios_del_que_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM recordatorio_meta r USING meta m
    WHERE r.meta_id = m.id AND r.persona_id = OLD.persona_id
      AND m.hogar_id = OLD.hogar_id AND m.persona_id IS DISTINCT FROM OLD.persona_id;
    RETURN OLD;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_recordatorios_ajenos_de_meta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM recordatorio_meta r
    WHERE r.meta_id = NEW.id AND r.persona_id IS DISTINCT FROM NEW.persona_id
      AND NOT EXISTS (SELECT 1 FROM miembro_hogar h WHERE h.hogar_id = NEW.hogar_id AND h.persona_id = r.persona_id);
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER tr_persona_perfiles AFTER INSERT OR UPDATE OF etapa ON persona
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_perfiles_desde_persona();
CREATE CONSTRAINT TRIGGER tr_perfil_menor_perfiles AFTER INSERT OR DELETE ON perfil_menor
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_perfiles_desde_perfil();
CREATE CONSTRAINT TRIGGER tr_perfil_adulto_perfiles AFTER INSERT OR DELETE OR UPDATE OF fecha_de_paso ON perfil_adulto
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_perfiles_desde_perfil();
CREATE CONSTRAINT TRIGGER tr_nacimiento_menor_perfiles AFTER INSERT OR DELETE ON nacimiento_menor
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_perfiles_desde_perfil();

CREATE TRIGGER tr_comparticion_movimiento_propio BEFORE INSERT OR UPDATE ON comparticion_movimiento
    FOR EACH ROW EXECUTE FUNCTION fn_comparticion_de_movimiento_propio();
CREATE TRIGGER tr_movimiento_solo_adultos BEFORE INSERT OR UPDATE OF hogar_id, persona_id ON movimiento
    FOR EACH ROW EXECUTE FUNCTION fn_compartido_solo_de_adultos();
CREATE TRIGGER tr_movimiento_recurrente_solo_adultos BEFORE INSERT OR UPDATE OF hogar_id, persona_id ON movimiento_recurrente
    FOR EACH ROW EXECUTE FUNCTION fn_compartido_solo_de_adultos();
CREATE TRIGGER tr_presupuesto_solo_adultos BEFORE INSERT OR UPDATE OF hogar_id, persona_id ON presupuesto
    FOR EACH ROW EXECUTE FUNCTION fn_compartido_solo_de_adultos();
CREATE TRIGGER tr_deuda_solo_adultos BEFORE INSERT OR UPDATE OF hogar_id, persona_id ON deuda
    FOR EACH ROW EXECUTE FUNCTION fn_compartido_solo_de_adultos();
CREATE TRIGGER tr_meta_solo_adultos BEFORE INSERT OR UPDATE OF hogar_id, persona_id ON meta
    FOR EACH ROW EXECUTE FUNCTION fn_compartido_solo_de_adultos();
CREATE TRIGGER tr_ocurrencia_omitida_sin_movimiento BEFORE INSERT OR UPDATE ON ocurrencia_omitida
    FOR EACH ROW EXECUTE FUNCTION fn_omitida_sin_movimiento();
CREATE TRIGGER tr_movimiento_sin_omitida BEFORE INSERT OR UPDATE OF recurrente_id, fecha_programada ON movimiento
    FOR EACH ROW EXECUTE FUNCTION fn_movimiento_sin_omitida();
CREATE TRIGGER tr_recordatorio_meta_miembro BEFORE INSERT OR UPDATE ON recordatorio_meta
    FOR EACH ROW EXECUTE FUNCTION fn_recordatorio_de_miembro();
CREATE TRIGGER tr_miembro_hogar_sin_recordatorios AFTER DELETE ON miembro_hogar
    FOR EACH ROW EXECUTE FUNCTION fn_recordatorios_del_que_sale();
CREATE TRIGGER tr_meta_sin_recordatorios_ajenos AFTER UPDATE OF hogar_id ON meta
    FOR EACH ROW EXECUTE FUNCTION fn_recordatorios_ajenos_de_meta();

-- Diccionario dentro de la base: los comentarios salen de la misma definición.
COMMENT ON TABLE finalidad IS 'Catálogo de finalidades de tratamiento a las que se puede autorizar. Cerrado y sembrado por migración.';
COMMENT ON COLUMN finalidad.codigo IS 'Código estable de la finalidad. Es la clave natural que usa `Finalidad.codigo` en E12.';
COMMENT ON COLUMN finalidad.tipo IS 'Finalidad necesaria o accesoria. Las accesorias se otorgan por separado de las necesarias (RF-031).';
COMMENT ON COLUMN finalidad.activa IS 'Falso si la finalidad existe en el catálogo pero no se ofrece. La de transferencia nace inactiva (NM-06).';
COMMENT ON COLUMN finalidad.descripcion IS 'Descripción interna en lenguaje de negocio. El texto legal que ve la persona vive en `TextosLegales`, en el código.';
COMMENT ON TABLE categoria IS 'Catálogo único de categorías del sistema, igual para todas las personas. Nadie la crea ni la renombra (RN-011).';
COMMENT ON COLUMN categoria.id IS 'Identificador estable de la categoría. Lo fija la migración de siembra; no se genera.';
COMMENT ON COLUMN categoria.nombre IS 'Nombre en lenguaje cotidiano (RNF-015). «Mesada» existe como gasto y como ingreso.';
COMMENT ON COLUMN categoria.tipo IS 'Gasto o ingreso. La categoría solo se usa en movimientos de su tipo (RN-011).';
COMMENT ON COLUMN categoria.marca IS 'Recortable o esencial. Solo las categorías de gasto la llevan (RF-020).';
COMMENT ON COLUMN categoria.apta_para_menores IS 'Falso si la categoría queda oculta siempre en la cuenta de un menor (bebidas alcohólicas y tabaco). Salud es apta: parte oculta por defecto, pero se puede mostrar (D-071, D-088). La marca solo vale mientras la cuenta es de un menor: a los 18 años la categoría se muestra, sin fila que borrar (D-102).';
COMMENT ON COLUMN categoria.oculta_por_defecto_menor IS 'Verdadero si la categoría parte oculta en la cuenta de un menor y se puede mostrar. Hoy solo Salud: la muestra el tutor si el menor tiene menos de 12 años y el adolescente de 12 a 17 (D-071, D-088).';
COMMENT ON COLUMN categoria.general IS 'Verdadero en la categoría general de cada tipo: la que usa la sugerencia por defecto y nunca se oculta (RN-011, RF-005).';
COMMENT ON TABLE persona IS 'Cuenta de una persona durante toda su vida: la misma fila antes y después de los 18 años (P-16). La etapa reemplaza a las subclases.';
COMMENT ON COLUMN persona.id IS 'Identificador de la persona. Lo genera la aplicación o la base.';
COMMENT ON COLUMN persona.nombre IS 'Nombre o apodo para mostrar (RNF-016).';
COMMENT ON COLUMN persona.etapa IS 'Menor o adulta. Es el discriminador de la generalización de E09. Solo `MenoresServicio` la cambia.';
COMMENT ON COLUMN persona.gasto_mensual_declarado IS 'Gasto mensual que la persona declara, en centavos. Sirve de mes típico si no hay un mes completo (RN-008).';
COMMENT ON COLUMN persona.preferencias IS 'Preferencias de privacidad y de notificaciones como un solo objeto de claves booleanas. Los avisos del hogar son una clave más, activada por defecto (D-098).';
COMMENT ON COLUMN persona.creada_en IS 'Instante en que se creó la cuenta, en UTC.';
COMMENT ON TABLE perfil_menor IS 'Lo propio de un menor: su usuario de acceso y su correo opcional. Existe mientras sea menor y, tras los 18 años, mientras complete el primer ingreso.';
COMMENT ON COLUMN perfil_menor.persona_id IS 'Persona a la que pertenece el perfil. Relación 1:1 con `persona`.';
COMMENT ON COLUMN perfil_menor.nombre_de_usuario IS 'Usuario con el que el menor inicia sesión. Sin arroba, para que nunca choque con un correo.';
COMMENT ON COLUMN perfil_menor.correo_opcional IS 'Correo que el menor registra en los 30 días previos a los 18 años, con autorización del tutor. Finalidad única: acceso propio a los 18 (RNF-004).';
COMMENT ON COLUMN perfil_menor.correo_confirmado IS 'Verdadero cuando el menor confirmó el correo desde su propia sesión (NM-04).';
COMMENT ON TABLE nacimiento_menor IS 'Fecha de nacimiento de un menor, cifrada por la aplicación. Se borra en `PasarAAdulta` (D-084 (1), RNF-004). Es el único dueño del dato (NM-03).';
COMMENT ON COLUMN nacimiento_menor.persona_id IS 'Persona menor a la que pertenece la fecha.';
COMMENT ON COLUMN nacimiento_menor.etapa IS 'Constante `menor`. Ancla la llave compuesta que impide guardar la fecha de una persona adulta.';
COMMENT ON COLUMN nacimiento_menor.valor_cifrado IS 'Fecha ISO `AAAA-MM-DD` cifrada con AES-256-GCM: nonce de 12 bytes, 10 de fecha y 16 de etiqueta. Siempre 38 bytes. La clave vive en Key Vault, no en la base.';
COMMENT ON COLUMN nacimiento_menor.version_clave IS 'Versión de la clave de Key Vault con la que se cifró. Permite rotarla.';
COMMENT ON COLUMN nacimiento_menor.creado_en IS 'Instante del registro, en UTC.';
COMMENT ON TABLE perfil_adulto IS 'Lo propio de una persona adulta: correo, ingreso y horas declarados, estado de la cuenta y fecha de paso desde menor. Existe solo si la persona es adulta.';
COMMENT ON COLUMN perfil_adulto.persona_id IS 'Persona adulta a la que pertenece el perfil. Relación 1:1 con `persona`.';
COMMENT ON COLUMN perfil_adulto.etapa IS 'Constante `adulta`. Ancla la llave compuesta que impide un perfil de adulto en una persona menor.';
COMMENT ON COLUMN perfil_adulto.correo IS 'Correo de acceso. Puede faltar solo mientras la persona completa el primer ingreso tras ser menor (RN-016).';
COMMENT ON COLUMN perfil_adulto.correo_verificado IS 'Verdadero cuando la persona verificó el correo con el enlace de un solo uso.';
COMMENT ON COLUMN perfil_adulto.ingreso_neto IS 'Ingreso neto mensual declarado, en centavos. Opcional (RF-054).';
COMMENT ON COLUMN perfil_adulto.horas_de_trabajo IS 'Horas reales de trabajo **al mes**, con los desplazamientos, con dos decimales (E15 4.2, D-086). Opcional (RF-054, RN-014).';
COMMENT ON COLUMN perfil_adulto.horas_de_vida_activadas IS 'Preferencia apagada por defecto: mostrar el costo de un gasto en horas (RF-054, RF-033).';
COMMENT ON COLUMN perfil_adulto.estado IS 'Activa o bloqueada. Solo se bloquea una cuenta que pasó de menor a adulta sin completar los pasos (RN-016).';
COMMENT ON COLUMN perfil_adulto.fecha_de_paso IS 'Día en que la cuenta pasó de menor a adulta. De ella corren los plazos de bloqueo (30 días) y de borrado (60). Nula si siempre fue adulta.';
COMMENT ON TABLE credencial IS 'Cómo entra una persona: el hash de su contraseña, si es temporal y su último ingreso. No guarda correo ni usuario: son de los perfiles.';
COMMENT ON COLUMN credencial.persona_id IS 'Persona dueña de la credencial.';
COMMENT ON COLUMN credencial.hash IS 'Hash Argon2id en formato PHC. Los parámetros viajan dentro, así se pueden subir después (D-081). Nunca es recuperable (RNF-014).';
COMMENT ON COLUMN credencial.es_temporal IS 'Verdadero mientras el menor usa la contraseña que le dio su tutor. Si es adolescente, debe fijar la suya (NM-14).';
COMMENT ON COLUMN credencial.ultimo_ingreso IS 'Último inicio de sesión, en UTC. El menor lo ve (NM-14).';
COMMENT ON TABLE hogar IS 'Grupo de personas que comparten parte de sus finanzas. Siempre tiene un administrador que es miembro (RN-007).';
COMMENT ON COLUMN hogar.id IS 'Identificador del hogar.';
COMMENT ON COLUMN hogar.nombre IS 'Nombre del hogar. Opcional: si falta, la app lo llama «Nuestro hogar» (D-098); el nombre por defecto no se guarda.';
COMMENT ON COLUMN hogar.creado_en IS 'Día de creación, en la fecha de Bogotá.';
COMMENT ON COLUMN hogar.administrador_id IS 'Persona adulta que administra el hogar. Debe ser miembro (llave compuesta diferida).';
COMMENT ON TABLE miembro_hogar IS 'Pertenencia de una persona a un hogar, con la fecha de ingreso. La clave en `persona_id` impone un hogar a la vez (RN-009). Guarda también a los menores a cargo (RN-010), pero «Miembros del hogar» solo lee las filas de personas adultas: un menor nunca aparece ni se nombra en el hogar (CU-27 2b, D-098).';
COMMENT ON COLUMN miembro_hogar.persona_id IS 'Persona que pertenece al hogar. Es la clave: una persona, un hogar (RN-009).';
COMMENT ON COLUMN miembro_hogar.hogar_id IS 'Hogar al que pertenece.';
COMMENT ON COLUMN miembro_hogar.desde IS 'Instante de ingreso al hogar. Decide el miembro adulto con más antigüedad que recibe la administración cuando el administrador borra su cuenta o sale del hogar sin que nadie haya aceptado el papel (RN-007, D-099).';
COMMENT ON TABLE tutoria IS 'Vínculo entre una persona adulta tutora y un menor. Guarda las declaraciones con la versión de su texto. Se borra al cumplir 18 años (RN-016).';
COMMENT ON COLUMN tutoria.tutor_id IS 'Persona adulta que ejerce la tutoría.';
COMMENT ON COLUMN tutoria.menor_id IS 'Menor tutelado.';
COMMENT ON COLUMN tutoria.declaro_escuchar_al_menor IS 'El tutor declara que escuchó al menor según su edad y su madurez.';
COMMENT ON COLUMN tutoria.declaro_representacion IS 'El tutor declara ser padre, madre o representante legal.';
COMMENT ON COLUMN tutoria.autorizacion_expresa IS 'Quien recibe la tutoría da su autorización expresa.';
COMMENT ON COLUMN tutoria.version_declaracion IS 'Versión del texto de la declaración que el tutor aceptó (NM-15).';
COMMENT ON COLUMN tutoria.inicio IS 'Día en que empezó la tutoría.';
COMMENT ON TABLE comparticion_categoria IS 'Categorías que un adolescente comparte en detalle con todos sus tutores. Se vacía al cumplir 18 años (RN-016).';
COMMENT ON COLUMN comparticion_categoria.menor_id IS 'Menor que comparte.';
COMMENT ON COLUMN comparticion_categoria.categoria_id IS 'Categoría compartida en detalle.';
COMMENT ON TABLE ocultamiento_categoria IS 'Categoría que una persona deja de ver. El vínculo mismo es la ocultación (clase de asociación de E09). Guarda el origen, para que a los 18 años se muestre lo que ocultó la regla de menores (hoy, Salud) y lo que la persona ocultó siga oculto (D-089, D-102).';
COMMENT ON COLUMN ocultamiento_categoria.persona_id IS 'Persona que oculta.';
COMMENT ON COLUMN ocultamiento_categoria.categoria_id IS 'Categoría oculta.';
COMMENT ON COLUMN ocultamiento_categoria.categoria_general IS 'Constante falsa. Ancla la llave compuesta que impide ocultar la categoría general (RN-011).';
COMMENT ON COLUMN ocultamiento_categoria.fecha IS 'Día en que se ocultó. Opcional.';
COMMENT ON COLUMN ocultamiento_categoria.origen IS 'Por qué está oculta: la regla de menores (el sistema oculta Salud al crear la cuenta de un menor) o la decisión de la persona. Al pasar a cuenta de adulto se borran solo las filas de la regla de menores; las de decisión propia quedan. Las categorías no aptas para menores no tienen fila: las oculta la marca `categoria.apta_para_menores`, que deja de aplicar a los 18 años (RN-016, D-089, D-102).';
COMMENT ON TABLE invitacion IS 'Invitación de un solo uso a un hogar, válida 7 días. Guarda solo el SHA-256 del código. Nunca la acepta un menor.';
COMMENT ON COLUMN invitacion.id IS 'Identificador de la invitación. Sirve para revocarla sin conservar el código.';
COMMENT ON COLUMN invitacion.hogar_id IS 'Hogar que emite la invitación.';
COMMENT ON COLUMN invitacion.codigo_hash IS 'SHA-256 del código o enlace. Se guarda el hash por la misma razón que el de las sesiones (D-081): una filtración no deja unirse a un hogar.';
COMMENT ON COLUMN invitacion.estado IS 'Pendiente, usada, rechazada, vencida o revocada. Solo cambia desde pendiente.';
COMMENT ON COLUMN invitacion.vence IS 'Último día de validez: 7 días desde la creación (RF-045).';
COMMENT ON COLUMN invitacion.aceptada_por IS 'Persona adulta que la aceptó. Nula si no se aceptó o si esa persona borró su cuenta (D-053).';
COMMENT ON COLUMN invitacion.creada_en IS 'Instante de creación, en UTC.';
COMMENT ON TABLE propuesta_transferencia IS 'Propuesta, con vencimiento de 7 días, de transferir la administración de un hogar o la tutoría de un menor. Solo uno de los dos destinos está presente: el hogar o el menor.';
COMMENT ON COLUMN propuesta_transferencia.id IS 'Identificador de la propuesta.';
COMMENT ON COLUMN propuesta_transferencia.tipo IS 'Administración del hogar o tutoría.';
COMMENT ON COLUMN propuesta_transferencia.estado IS 'Pendiente, aceptada, rechazada, vencida o cancelada.';
COMMENT ON COLUMN propuesta_transferencia.vence IS 'Último día de validez: 7 días (RN-007, RN-010).';
COMMENT ON COLUMN propuesta_transferencia.proponente_id IS 'Persona adulta que propone.';
COMMENT ON COLUMN propuesta_transferencia.destinataria_id IS 'Persona adulta que recibe la propuesta.';
COMMENT ON COLUMN propuesta_transferencia.hogar_id IS 'Hogar cuya administración se propone. Solo si el tipo es administración.';
COMMENT ON COLUMN propuesta_transferencia.menor_id IS 'Menor cuya tutoría se propone. Solo si el tipo es tutoría.';
COMMENT ON COLUMN propuesta_transferencia.creada_en IS 'Instante de creación, en UTC.';
COMMENT ON TABLE movimiento_recurrente IS 'Gasto o ingreso que se registra una vez. Cada fecha programada queda pendiente y la persona la confirma: solo entonces nace una fila de `movimiento`. La fecha pendiente no se guarda (D-091); la que la persona marca «No pasó» sí, en `ocurrencia_omitida` (D-092). Los intereses de cesantías se ofrecen con recurrencia anual en enero (RF-053).';
COMMENT ON COLUMN movimiento_recurrente.id IS 'Identificador del recurrente.';
COMMENT ON COLUMN movimiento_recurrente.persona_id IS 'Persona dueña de la fila. Es nula solo en un dato compartido cuya titular borró su cuenta: sigue en el hogar sin identificarla (D-053, RN-006).';
COMMENT ON COLUMN movimiento_recurrente.hogar_id IS 'Hogar con el que se comparte. Nulo es «propio»: el valor cero de `Visibilidad` (NM-05). Disolver el hogar lo vuelve propio.';
COMMENT ON COLUMN movimiento_recurrente.tipo IS 'Gasto o ingreso.';
COMMENT ON COLUMN movimiento_recurrente.categoria_id IS 'Categoría del movimiento que nace al confirmar. Su tipo coincide con el del recurrente (llave compuesta).';
COMMENT ON COLUMN movimiento_recurrente.periodicidad IS 'Semanal, quincenal, mensual, semestral o anual (D-084 (6)).';
COMMENT ON COLUMN movimiento_recurrente.monto_habitual IS 'Monto habitual en centavos. Al confirmar una fecha la persona puede corregirlo solo para esa fecha (RF-009, D-091).';
COMMENT ON COLUMN movimiento_recurrente.medio IS 'Medio de pago de los movimientos que nacen al confirmar. E12 no lo trae y el movimiento lo exige: E13 lo agrega y E12 v1.1 lo incorpora (D-085, Q-2).';
COMMENT ON COLUMN movimiento_recurrente.inicio IS 'Primera fecha programada.';
COMMENT ON COLUMN movimiento_recurrente.detenido_en IS 'Primer día en que ya no se propone ninguna fecha programada: el día siguiente a aquel en que la persona dejó de repetirlo (o `inicio`, si lo detuvo antes de empezar). Lo ya confirmado se conserva y lo que ya llegó sigue por confirmar (RF-006, D-091). Nula mientras se repite.';
COMMENT ON COLUMN movimiento_recurrente.creado_en IS 'Instante de creación, en UTC. Las fechas programadas anteriores a este día no se proponen: son historia y se registran a mano (D-091).';
COMMENT ON TABLE meta IS 'Monto que una persona quiere reunir. El fondo de emergencia es una meta personal, a lo sumo una, nunca compartida (RF-013).';
COMMENT ON COLUMN meta.id IS 'Identificador de la meta. Es la fila que `MetaRepo` bloquea en el retiro (E13-8).';
COMMENT ON COLUMN meta.persona_id IS 'Persona dueña de la fila. Es nula solo en un dato compartido cuya titular borró su cuenta: sigue en el hogar sin identificarla (D-053, RN-006).';
COMMENT ON COLUMN meta.hogar_id IS 'Hogar con el que se comparte. Nulo es «propio» (NM-05).';
COMMENT ON COLUMN meta.nombre IS 'Nombre de la meta.';
COMMENT ON COLUMN meta.monto_objetivo IS 'Monto que se quiere reunir, en centavos.';
COMMENT ON COLUMN meta.fecha_objetivo IS 'Fecha en que se quiere reunir. Opcional.';
COMMENT ON COLUMN meta.es_fondo_de_emergencia IS 'Verdadero en el fondo de emergencia: personal, a lo sumo uno por persona (RF-013).';
COMMENT ON COLUMN meta.meses_objetivo IS 'Meses de gasto que el fondo de emergencia quiere cubrir (el N de «Cubre X de N meses»). Solo el fondo lo tiene; en otra meta es nulo. De 1 a 120, el tope de E15 3.2 (diez años de gasto). La persona lo fija al crear el fondo y no depende del gasto (D-087, 5).';
COMMENT ON COLUMN meta.creada_en IS 'Instante de creación, en UTC.';
COMMENT ON TABLE recordatorio_meta IS 'Recordatorio de aporte que una persona activa para una meta (clase de asociación de E09). Es una preferencia personal: en una meta compartida cada persona adulta del hogar tiene el suyo y el aviso solo le llega a quien lo activó. Sin fila, el recordatorio está apagado (RF-015, D-098).';
COMMENT ON COLUMN recordatorio_meta.persona_id IS 'Persona que recibe el recordatorio. Debe ser quien creó la meta o miembro del hogar con el que se comparte (disparador `tr_recordatorio_meta_miembro`).';
COMMENT ON COLUMN recordatorio_meta.meta_id IS 'Meta que se recuerda.';
COMMENT ON COLUMN recordatorio_meta.frecuencia IS 'Cada cuánto se recuerda: semanal («Cada semana»), quincenal («Cada 15 días») o mensual («Cada mes»).';
COMMENT ON COLUMN recordatorio_meta.creado_en IS 'Instante en que la persona lo activó, en UTC. Apagarlo borra la fila.';
COMMENT ON TABLE movimiento IS 'Gasto, ingreso o aporte a una meta, en una sola tabla con el discriminador `tipo`. Un retiro es un aporte con `sentido` de salida (P-15). Nunca cambia de tipo.';
COMMENT ON COLUMN movimiento.id IS 'Identificador del movimiento.';
COMMENT ON COLUMN movimiento.persona_id IS 'Persona dueña de la fila. Es nula solo en un dato compartido cuya titular borró su cuenta: sigue en el hogar sin identificarla (D-053, RN-006).';
COMMENT ON COLUMN movimiento.hogar_id IS 'Hogar con el que se comparte. Nulo es «propio» (NM-05). Nunca presente si la persona es menor (disparador).';
COMMENT ON COLUMN movimiento.tipo IS 'Gasto, ingreso o aporte. Es el discriminador de la generalización de E09.';
COMMENT ON COLUMN movimiento.monto IS 'Monto en centavos, siempre positivo. El sentido de un aporte va aparte (D-082, P-15).';
COMMENT ON COLUMN movimiento.fecha IS 'Día del movimiento en Bogotá. El periodo (mes) se deriva de ella: no se guarda.';
COMMENT ON COLUMN movimiento.medio IS 'Efectivo, tarjeta o transferencia. Tarjeta cubre débito y crédito; transferencia, las billeteras (D-084 (7)).';
COMMENT ON COLUMN movimiento.descripcion IS 'Texto libre opcional. Nadie lo lee salvo para mostrarlo y sugerir categoría (D-084 (4)). Hasta 280 caracteres, como el texto del interpretador.';
COMMENT ON COLUMN movimiento.categoria_id IS 'Categoría del gasto o del ingreso. Nula en un aporte (RN-011, RN-013). Su tipo coincide con `tipo` (llave compuesta).';
COMMENT ON COLUMN movimiento.deuda_saldada_id IS 'Deuda que este gasto paga. Solo en gastos (RN-012, RF-041).';
COMMENT ON COLUMN movimiento.meta_id IS 'Meta a la que aporta o de la que retira. Solo en aportes.';
COMMENT ON COLUMN movimiento.sentido IS 'Entrada (aporte) o salida (retiro). Solo en aportes (P-15, D-066).';
COMMENT ON COLUMN movimiento.referencia IS 'Grupo de ahorro o familiar de un aporte informal. Solo en aportes (RF-014).';
COMMENT ON COLUMN movimiento.recurrente_id IS 'Recurrente cuya fecha programada se confirmó para crear este movimiento. Nulo si se registró a mano.';
COMMENT ON COLUMN movimiento.fecha_programada IS 'Fecha programada que la persona confirmó. El movimiento nace con `fecha` = `fecha_programada`, aunque la confirmación llegue tarde: nunca con la fecha de la confirmación, para que no pase a otro mes (D-094). No cambia aunque la persona corrija `fecha` después; evita confirmar dos veces la misma fecha.';
COMMENT ON COLUMN movimiento.creado_en IS 'Instante del registro, en UTC.';
COMMENT ON TABLE ocurrencia_omitida IS 'Fecha programada de un recurrente que la persona marcó «No pasó»: no se confirma, no se ofrece otra vez y la simulación deja de contarla como esperada. No es un movimiento: nada pasó (RF-006, RF-016, D-092). Una misma fecha no puede estar a la vez aquí y en `movimiento`.';
COMMENT ON COLUMN ocurrencia_omitida.recurrente_id IS 'Recurrente al que pertenece la fecha omitida.';
COMMENT ON COLUMN ocurrencia_omitida.fecha_programada IS 'Fecha programada que la persona marcó «No pasó». Es una fecha que el recurrente propone según su periodicidad (E15 5.2).';
COMMENT ON COLUMN ocurrencia_omitida.omitida_en IS 'Instante en que la persona la marcó, en UTC.';
COMMENT ON TABLE comparticion_movimiento IS 'Movimiento que un adolescente comparte en detalle con sus tutores. El movimiento es siempre suyo. Se vacía al cumplir 18 años (RN-016).';
COMMENT ON COLUMN comparticion_movimiento.movimiento_id IS 'Movimiento compartido. A lo sumo un menor lo comparte: su dueño.';
COMMENT ON COLUMN comparticion_movimiento.menor_id IS 'Menor dueño del movimiento. El disparador `tr_comparticion_movimiento_propio` comprueba que lo sea.';
COMMENT ON TABLE presupuesto IS 'Límite de gasto de una persona adulta para una categoría en un periodo (mes calendario). Único por persona, categoría y periodo (E13-7). Corregir el monto o quitar la fila no tiene restricción en la base de datos; que solo se pueda en el mes en curso lo hace cumplir `PresupuestoServicio` (D-094, SC-E21-13).';
COMMENT ON COLUMN presupuesto.id IS 'Identificador del presupuesto.';
COMMENT ON COLUMN presupuesto.persona_id IS 'Persona dueña de la fila. Es nula solo en un dato compartido cuya titular borró su cuenta: sigue en el hogar sin identificarla (D-053, RN-006).';
COMMENT ON COLUMN presupuesto.hogar_id IS 'Hogar con el que se comparte. Nulo es «propio» (NM-05).';
COMMENT ON COLUMN presupuesto.categoria_id IS 'Categoría de gasto que limita.';
COMMENT ON COLUMN presupuesto.categoria_tipo IS 'Constante `gasto`. Ancla la llave compuesta: un presupuesto limita una categoría de gasto.';
COMMENT ON COLUMN presupuesto.periodo IS 'Primer día del mes que presupuesta (periodo de E09).';
COMMENT ON COLUMN presupuesto.monto_asignado IS 'Límite en centavos. Puede ser cero.';
COMMENT ON TABLE valoracion_mensual IS 'Marca +, − o 0 de una persona adulta para una categoría con gasto en un periodo. Solo para adultos, opcional (RF-056).';
COMMENT ON COLUMN valoracion_mensual.persona_id IS 'Persona adulta que valora.';
COMMENT ON COLUMN valoracion_mensual.periodo IS 'Primer día del mes valorado.';
COMMENT ON COLUMN valoracion_mensual.categoria_id IS 'Categoría de gasto valorada.';
COMMENT ON COLUMN valoracion_mensual.categoria_tipo IS 'Constante `gasto`. Ancla la llave compuesta: solo se valoran categorías de gasto.';
COMMENT ON COLUMN valoracion_mensual.valoracion IS 'Más, menos o cero. Orienta qué recorte se sugiere primero (RF-020).';
COMMENT ON TABLE respuesta_suscripcion IS 'Respuesta de una persona a «¿Esto es una suscripción?» para un grupo de gastos repetidos: «Sí, es una suscripción» o «No lo es». Un grupo con respuesta no se vuelve a preguntar (señal baja) y la señal alta no lleva botones (D-094, P-4 opción A de E14-PPA). El grupo no es una fila: se identifica con `clave_grupo`, que calcula E15 5.9 (categoría, palabras clave de la descripción del primer gasto del grupo y monto de ese gasto). Única por persona y grupo.';
COMMENT ON COLUMN respuesta_suscripcion.persona_id IS 'Persona que respondió.';
COMMENT ON COLUMN respuesta_suscripcion.categoria_id IS 'Categoría de gasto del grupo. También forma parte de `clave_grupo`.';
COMMENT ON COLUMN respuesta_suscripcion.categoria_tipo IS 'Constante `gasto`. Ancla la llave compuesta: las suscripciones se buscan solo en gastos.';
COMMENT ON COLUMN respuesta_suscripcion.clave_grupo IS 'Clave estable del grupo: `categoría|palabras clave|monto` del primer gasto del grupo (el ancla de E15 5.9). Las palabras clave van sin tildes ni mayúsculas, ordenadas y unidas por un espacio; el monto va en centavos. Un grupo sin descripción útil lleva las palabras vacías.';
COMMENT ON COLUMN respuesta_suscripcion.respuesta IS '«Sí, es una suscripción» o «No lo es».';
COMMENT ON COLUMN respuesta_suscripcion.respondida_en IS 'Instante en que la persona respondió, en UTC. Responder otra vez el mismo grupo lo actualiza.';
COMMENT ON TABLE tarjeta_credito IS 'Tarjeta de crédito de una persona adulta. Agrupa sus compras a cuotas y recuerda la última tasa para proponerla en la compra siguiente.';
COMMENT ON COLUMN tarjeta_credito.id IS 'Identificador de la tarjeta.';
COMMENT ON COLUMN tarjeta_credito.persona_id IS 'Persona adulta dueña. Una tarjeta nunca se comparte.';
COMMENT ON COLUMN tarjeta_credito.nombre IS 'Nombre con que la persona reconoce la tarjeta.';
COMMENT ON COLUMN tarjeta_credito.tasa_de_referencia IS 'Última tasa que la persona registró en la tarjeta, como tasa efectiva anual en porcentaje (28,5 es 28,5 % EA). Solo sirve para proponerla por defecto (RF-050). Hasta 999.999,999999 (D-086, E15 4.2).';
COMMENT ON TABLE extracto_tarjeta IS 'Extracto de una tarjeta en un periodo: lo que la persona escribe desde su extracto. El abono a capital se calcula y no se guarda.';
COMMENT ON COLUMN extracto_tarjeta.tarjeta_id IS 'Tarjeta del extracto.';
COMMENT ON COLUMN extracto_tarjeta.periodo IS 'Primer día del mes del extracto.';
COMMENT ON COLUMN extracto_tarjeta.pago_minimo IS 'Pago mínimo en centavos, tal como lo escribe la persona.';
COMMENT ON COLUMN extracto_tarjeta.intereses_y_cargos IS 'Intereses y cargos en centavos, tal como los escribe la persona. El sistema no los calcula (RF-051).';
COMMENT ON TABLE deuda IS 'Obligación de pago, formal o informal, incluida la compra a cuotas con tarjeta. La tasa puede faltar y nunca se inventa (RN-005).';
COMMENT ON COLUMN deuda.id IS 'Identificador de la deuda.';
COMMENT ON COLUMN deuda.persona_id IS 'Persona dueña de la fila. Es nula solo en un dato compartido cuya titular borró su cuenta: sigue en el hogar sin identificarla (D-053, RN-006).';
COMMENT ON COLUMN deuda.hogar_id IS 'Hogar con el que se comparte. Nulo es «propio» (NM-05).';
COMMENT ON COLUMN deuda.nombre IS 'Nombre opcional para reconocer la deuda en la lista («Crédito de consumo»). Sin nombre, la lista muestra el tipo de deuda y su monto. Es texto libre: la persona puede escribir el de un tercero («Préstamo de mi tía»), por eso lleva la marca T (SC-E21-14, D-096).';
COMMENT ON COLUMN deuda.monto IS 'Monto de la deuda en centavos. En una deuda informal o de un familiar o amigo registrada con total a pagar es el «monto prestado».';
COMMENT ON COLUMN deuda.total_a_pagar IS 'Total a pagar en centavos de una deuda informal o de un familiar o amigo registrada con «monto prestado» (`monto`) y «total a pagar»: $20.000 diarios por 30 días son $600.000. Con él, el costo es `total_a_pagar − monto`, sin tasa, y el saldo es el total menos los pagos, aunque la deuda también tenga tasa (E15 5.17, 5.16). Con total a pagar, `frecuencia_pago`, `fecha_primer_pago` y `cuota` son obligatorias (D-097). Nulo en las demás deudas, y en una informal registrada con tasa: ahí el costo es el de E15 5.11. Convive con `tasa`, que sigue siendo opcional y no cambia el costo cuando hay total (SC-E21-15, D-096).';
COMMENT ON COLUMN deuda.saldo_informado IS 'Saldo de la deuda en centavos que la persona copió de su extracto al corregirla (RF-040). Es un dato, no un cálculo: el saldo estimado (E15 5.16) parte de él y solo cuenta los pagos posteriores a `saldo_informado_en`. Nulo mientras no lo corrija.';
COMMENT ON COLUMN deuda.saldo_informado_en IS 'Fecha del extracto con que se corrigió el saldo. Los pagos de esa fecha en adelante bajan el saldo informado; los anteriores ya están en él. Nula si `saldo_informado` es nulo.';
COMMENT ON COLUMN deuda.cuotas IS 'Número de cuotas. Una deuda de una sola cuota es válida. Con total a pagar es el número de pagos del calendario («Número de pagos», E15 5.18).';
COMMENT ON COLUMN deuda.frecuencia_pago IS 'Cada cuánto paga una deuda con «total a pagar»: diario, semanal, quincenal o mensual. «Diario» solo existe aquí: los movimientos recurrentes (`periodicidad`) no lo tienen. Nula si no hay total a pagar; obligatoria si lo hay (`ck_deuda_calendario`, SC-E21-16, D-097).';
COMMENT ON COLUMN deuda.fecha_primer_pago IS 'Fecha del primer pago de una deuda con «total a pagar». Con la frecuencia y el número de pagos da el calendario que la simulación cuenta mes a mes (E15 5.18, 5.19). Nula si no hay total a pagar; obligatoria si lo hay (`ck_deuda_calendario`, SC-E21-16, D-097).';
COMMENT ON COLUMN deuda.cuota IS 'Cuota de cada pago en centavos de una deuda con «total a pagar»: el total dividido entre el número de pagos, redondeado al peso (E15 4.1), o la que la persona escribió. El último pago salda la diferencia (E15 5.18). Nula si no hay total a pagar; obligatoria si lo hay (`ck_deuda_calendario`, SC-E21-16, D-097).';
COMMENT ON COLUMN deuda.tasa IS 'Tasa efectiva anual en porcentaje (28,5 es 28,5 % EA), hasta 999.999,999999: cabe el gota a gota (25 % mensual son 1.355,2 % EA). Si la persona solo conoce la tasa mensual, la pantalla la convierte con EA = (1 + m)^12 − 1 (D-086, E15 4.2). Nula si la persona no la sabe: el sistema nunca la inventa (RN-005).';
COMMENT ON COLUMN deuda.inicio IS 'Fecha de inicio.';
COMMENT ON COLUMN deuda.vence IS 'Fecha de vencimiento.';
COMMENT ON COLUMN deuda.origen IS 'Formal, informal o de un familiar o amigo.';
COMMENT ON COLUMN deuda.titular IS 'A nombre propio o de un tercero (RF-052).';
COMMENT ON COLUMN deuda.se_paga_por_nomina IS 'Libranza: la cuota se descuenta por nómina y la persona confirma el pago cada mes (RN-017).';
COMMENT ON COLUMN deuda.tarjeta_id IS 'Tarjeta de crédito con que se compró a cuotas. Nula si la deuda no es una compra con tarjeta. Reemplaza al indicador `esCompraACuotas` de E12, que se deriva de ella.';
COMMENT ON COLUMN deuda.gasto_de_origen_id IS 'Gasto de la compra que originó la deuda. Nulo en un préstamo, el gota a gota o una libranza (D-084 (3)).';
COMMENT ON TABLE persona_comprometida IS 'Codeudor o fiador de una deuda, con un nombre o una relación opcional. No tiene cuenta ni autorizó el tratamiento: se guarda lo mínimo (RF-052).';
COMMENT ON COLUMN persona_comprometida.id IS 'Identificador de la fila.';
COMMENT ON COLUMN persona_comprometida.deuda_id IS 'Deuda a la que afecta.';
COMMENT ON COLUMN persona_comprometida.papel IS 'Codeudor o fiador.';
COMMENT ON COLUMN persona_comprometida.nombre_o_relacion IS 'Nombre o relación («mi hermano»). Opcional: basta la relación (NM-01).';
COMMENT ON TABLE aviso IS 'Aviso a una persona: faltante, sugerencia, resumen, recordatorio, novedad del hogar o cambio de edad o de cuenta. El texto es fijo y la marca de IA queda siempre en falso (D-075).';
COMMENT ON COLUMN aviso.id IS 'Identificador del aviso. La app consulta el contenido con él (D-071 (b)).';
COMMENT ON COLUMN aviso.persona_id IS 'Persona que recibe el aviso.';
COMMENT ON COLUMN aviso.tipo IS 'Uno de los ocho tipos de aviso de E09. El tipo `hogar` (alguien se unió, propuesta de administrador) se puede apagar; `cambio_de_edad_o_de_cuenta` no (RN-016, D-098).';
COMMENT ON COLUMN aviso.texto IS 'Texto del aviso, que la app muestra por dentro. Nada de esto sale por FCM (NM-11).';
COMMENT ON COLUMN aviso.fecha IS 'Día del aviso en Bogotá.';
COMMENT ON COLUMN aviso.periodo IS 'Primer día del mes al que se refiere. Opcional.';
COMMENT ON COLUMN aviso.meta_id IS 'Meta que recuerda aportar. Solo en el recordatorio de meta.';
COMMENT ON COLUMN aviso.generado_por_ia IS 'Marca de contenido de IA. Siempre falso: no hay proveedor de IA (D-075, RF-030). Una decisión futura la relajaría con una migración.';
COMMENT ON COLUMN aviso.enviado IS 'Falso mientras el aviso espera su envío. `ReintentarAvisos` envía los pendientes.';
COMMENT ON COLUMN aviso.creado_en IS 'Instante de creación, en UTC.';
COMMENT ON TABLE autorizacion IS 'Cada otorgamiento de una autorización es un registro nuevo; retirarla no lo borra (Ley 1581). Tras borrar la cuenta queda la prueba mínima, sin llaves a la persona, por un plazo provisional.';
COMMENT ON COLUMN autorizacion.id IS 'Identificador del registro.';
COMMENT ON COLUMN autorizacion.titular_id IS 'Persona dueña de los datos. Sin llave foránea a propósito: tras borrar la cuenta ya no apunta a nadie (decisión 9 del estudio de privacidad).';
COMMENT ON COLUMN autorizacion.otorgante_id IS 'Persona adulta que otorgó: la propia titular, o su tutor si la titular es menor. Sin llave foránea, por la misma razón.';
COMMENT ON COLUMN autorizacion.finalidad IS 'Finalidad autorizada.';
COMMENT ON COLUMN autorizacion.version_del_texto IS 'Versión del texto que la persona aceptó (NM-10).';
COMMENT ON COLUMN autorizacion.otorgada_en IS 'Instante del otorgamiento, en UTC. Parte del identificador de E09. Precisa al instante para poder otorgar de nuevo el mismo día.';
COMMENT ON COLUMN autorizacion.retirada_en IS 'Instante del retiro. Nulo si sigue vigente. Al borrar la cuenta se fija en ese instante.';
COMMENT ON COLUMN autorizacion.conservar_hasta IS 'Día hasta el que se conserva la prueba mínima tras borrar la cuenta. Nulo mientras la cuenta existe. El plazo es provisional (E11-EIP decisión 9).';
COMMENT ON TABLE sesion IS 'Sesión opaca. La clave es el SHA-256 del token: el token nunca llega a la base (D-081). Revocar es borrar la fila.';
COMMENT ON COLUMN sesion.hash_token IS 'SHA-256 del token de 32 bytes. Siempre 32 bytes.';
COMMENT ON COLUMN sesion.persona_id IS 'Persona dueña de la sesión.';
COMMENT ON COLUMN sesion.creada_en IS 'Instante de inicio de sesión, en UTC.';
COMMENT ON COLUMN sesion.ultimo_uso_en IS 'Último uso, en UTC. Se actualiza como mucho cada 5 minutos para no escribir en cada solicitud.';
COMMENT ON COLUMN sesion.vence_en IS 'Vencimiento: el menor entre 30 días de inactividad desde el último uso y 90 días desde la creación (propuesta Q-5).';
COMMENT ON COLUMN sesion.exige_nueva_contrasena IS 'Verdadero si la sesión solo deja fijar una contraseña propia (adolescente con contraseña temporal, NM-14, D-084).';
COMMENT ON TABLE token_dispositivo IS 'Token del dispositivo para avisos. Va ligado a la persona y al dispositivo, no a la sesión: no muere al vencer la sesión. Se borra al cerrar sesión a propósito, con la cuenta, cuando FCM lo reporta inválido o tras 180 días sin uso (NM-17, D-085). No guarda otros identificadores del dispositivo.';
COMMENT ON COLUMN token_dispositivo.persona_id IS 'Persona dueña del token. No hay llave a la sesión: el token sobrevive a su vencimiento (D-085).';
COMMENT ON COLUMN token_dispositivo.dispositivo_id IS 'Identificador aleatorio que la aplicación genera al instalarse y que solo sirve para distinguir los dispositivos de una persona. No es un identificador de hardware (NM-17).';
COMMENT ON COLUMN token_dispositivo.token IS 'Token de FCM o de Web Push. Es el único dato del dispositivo que se guarda (NM-17).';
COMMENT ON COLUMN token_dispositivo.creado_en IS 'Instante del registro, en UTC.';
COMMENT ON COLUMN token_dispositivo.ultimo_uso_en IS 'Último uso, en UTC: la aplicación registra o confirma su token al abrirse (como mucho una vez al día). A los 180 días sin uso la tarea de limpieza lo borra (D-085).';
COMMENT ON TABLE enlace_un_uso IS 'Enlace de verificación de correo o de recuperación de acceso. Guarda solo el SHA-256 del token y se usa una vez.';
COMMENT ON COLUMN enlace_un_uso.hash_token IS 'SHA-256 del token de 32 bytes.';
COMMENT ON COLUMN enlace_un_uso.persona_id IS 'Persona a la que corresponde el enlace.';
COMMENT ON COLUMN enlace_un_uso.proposito IS 'Verificación o recuperación.';
COMMENT ON COLUMN enlace_un_uso.creado_en IS 'Instante de creación, en UTC.';
COMMENT ON COLUMN enlace_un_uso.vence_en IS 'Vencimiento: 24 horas la verificación y 1 hora la recuperación (propuesta Q-5).';
COMMENT ON COLUMN enlace_un_uso.usado_en IS 'Instante en que se usó. Nulo si no se usó. Un enlace usado no sirve de nuevo.';

-- +goose Down
-- CASCADE porque hay ciclos de llaves (hogar con miembro_hogar, movimiento con deuda).
DROP TRIGGER IF EXISTS tr_meta_sin_recordatorios_ajenos ON meta;
DROP TRIGGER IF EXISTS tr_miembro_hogar_sin_recordatorios ON miembro_hogar;
DROP TRIGGER IF EXISTS tr_recordatorio_meta_miembro ON recordatorio_meta;
DROP TRIGGER IF EXISTS tr_movimiento_sin_omitida ON movimiento;
DROP TRIGGER IF EXISTS tr_ocurrencia_omitida_sin_movimiento ON ocurrencia_omitida;
DROP TRIGGER IF EXISTS tr_comparticion_movimiento_propio ON comparticion_movimiento;
DROP TRIGGER IF EXISTS tr_nacimiento_menor_perfiles ON nacimiento_menor;
DROP TRIGGER IF EXISTS tr_perfil_adulto_perfiles ON perfil_adulto;
DROP TRIGGER IF EXISTS tr_perfil_menor_perfiles ON perfil_menor;
DROP TRIGGER IF EXISTS tr_persona_perfiles ON persona;
DROP TABLE IF EXISTS enlace_un_uso CASCADE;
DROP TABLE IF EXISTS token_dispositivo CASCADE;
DROP TABLE IF EXISTS sesion CASCADE;
DROP TABLE IF EXISTS autorizacion CASCADE;
DROP TABLE IF EXISTS aviso CASCADE;
DROP TABLE IF EXISTS persona_comprometida CASCADE;
DROP TABLE IF EXISTS deuda CASCADE;
DROP TABLE IF EXISTS extracto_tarjeta CASCADE;
DROP TABLE IF EXISTS tarjeta_credito CASCADE;
DROP TABLE IF EXISTS respuesta_suscripcion CASCADE;
DROP TABLE IF EXISTS valoracion_mensual CASCADE;
DROP TABLE IF EXISTS presupuesto CASCADE;
DROP TABLE IF EXISTS comparticion_movimiento CASCADE;
DROP TABLE IF EXISTS ocurrencia_omitida CASCADE;
DROP TABLE IF EXISTS movimiento CASCADE;
DROP TABLE IF EXISTS recordatorio_meta CASCADE;
DROP TABLE IF EXISTS meta CASCADE;
DROP TABLE IF EXISTS movimiento_recurrente CASCADE;
DROP TABLE IF EXISTS propuesta_transferencia CASCADE;
DROP TABLE IF EXISTS invitacion CASCADE;
DROP TABLE IF EXISTS ocultamiento_categoria CASCADE;
DROP TABLE IF EXISTS comparticion_categoria CASCADE;
DROP TABLE IF EXISTS tutoria CASCADE;
DROP TABLE IF EXISTS miembro_hogar CASCADE;
DROP TABLE IF EXISTS hogar CASCADE;
DROP TABLE IF EXISTS credencial CASCADE;
DROP TABLE IF EXISTS perfil_adulto CASCADE;
DROP TABLE IF EXISTS nacimiento_menor CASCADE;
DROP TABLE IF EXISTS perfil_menor CASCADE;
DROP TABLE IF EXISTS persona CASCADE;
DROP TABLE IF EXISTS categoria CASCADE;
DROP TABLE IF EXISTS finalidad CASCADE;
DROP FUNCTION IF EXISTS fn_recordatorios_ajenos_de_meta();
DROP FUNCTION IF EXISTS fn_recordatorios_del_que_sale();
DROP FUNCTION IF EXISTS fn_recordatorio_de_miembro();
DROP FUNCTION IF EXISTS fn_movimiento_sin_omitida();
DROP FUNCTION IF EXISTS fn_omitida_sin_movimiento();
DROP FUNCTION IF EXISTS fn_comparticion_de_movimiento_propio();
DROP FUNCTION IF EXISTS fn_compartido_solo_de_adultos();
DROP FUNCTION IF EXISTS fn_perfiles_desde_perfil();
DROP FUNCTION IF EXISTS fn_perfiles_desde_persona();
DROP FUNCTION IF EXISTS fn_perfiles_coherentes(uuid);
