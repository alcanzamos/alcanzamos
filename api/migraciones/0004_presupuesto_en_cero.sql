-- +goose Up
-- E13-MDD v1.18 · migración de REFERENCIA (US-77, decisión del dueño del 2026-11-10). La migración real es idéntica y vive en el repositorio del producto (D-122).
-- «Dejar el presupuesto en cero» (PN-07, E14-PPA 4.2, CU-10 2a) se guarda: el periodo queda definido en cero y el botón no vuelve al recargar.
-- Una marca por persona adulta y mes, propia (sin hogar). Como `valoracion_mensual`: la llave apunta a `perfil_adulto` (solo adultos) y se borra con la cuenta.
CREATE TABLE presupuesto_en_cero (
    persona_id uuid NOT NULL,
    periodo date NOT NULL,
    creado_en timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_presupuesto_en_cero PRIMARY KEY (persona_id, periodo),
    CONSTRAINT ck_presupuesto_en_cero_periodo CHECK (EXTRACT(day FROM periodo) = 1),
    CONSTRAINT fk_presupuesto_en_cero_persona_id FOREIGN KEY (persona_id) REFERENCES perfil_adulto (persona_id) ON DELETE CASCADE
);
COMMENT ON TABLE presupuesto_en_cero IS 'Mes que una persona adulta dejó con el presupuesto en cero («Dejar el presupuesto en cero», PN-07, CU-10 2a). Solo se marca el mes en curso, sin ingreso registrado ni nada asignado; que sea así lo hace cumplir `PresupuestoServicio`. La marca se conserva aunque después llegue un ingreso o se asigne algo: la pantalla la muestra solo mientras el mes siga en cero.';
COMMENT ON COLUMN presupuesto_en_cero.persona_id IS 'Persona adulta que dejó el mes en cero.';
COMMENT ON COLUMN presupuesto_en_cero.periodo IS 'Primer día del mes que quedó en cero (periodo de E09).';
COMMENT ON COLUMN presupuesto_en_cero.creado_en IS 'Cuándo lo dejó en cero, en UTC.';

-- +goose Down
DROP TABLE IF EXISTS presupuesto_en_cero;
