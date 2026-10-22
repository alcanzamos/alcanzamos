-- +goose Up
-- E13-MDD v1.15 · siembra de REFERENCIA del catálogo de categorías y de las finalidades. La migración real vive en el repositorio del producto (E17).
-- Las categorías salen de E09 «Catálogo de categorías» v1.6 (doce divisiones del IPC del DANE, adaptadas; D-060, D-084). Lo genera el generador al leer ese documento.
-- Los identificadores son explícitos y estables: no cambian entre ambientes. Una categoría nueva entra por una migración nueva, con la solicitud de cambio de E21 (RN-011). «Ayuda a la familia» (D-088) es la 26 y va en esta siembra de REFERENCIA porque todavía no hay una base con datos.
-- «Intereses de cesantías»: Ley 52 de 1975 (12 % anual sobre el saldo al 31 de diciembre, pagadero a más tardar el 31 de enero) y Ley 50 de 1990, art. 99, num. 2.
--   La recurrencia anual en enero (RF-053) es un valor por defecto del código (E12), no una columna.
-- apta_para_menores = false solo en «Bebidas alcohólicas y tabaco» (siempre oculta a un menor).
-- oculta_por_defecto_menor = true solo en «Salud»: parte oculta en la cuenta de un menor y se puede mostrar (D-071, D-088).

INSERT INTO categoria (id, nombre, tipo, marca, apta_para_menores, oculta_por_defecto_menor, general) VALUES
    (1, 'Alimentación', 'gasto', 'esencial', true, false, false),
    (2, 'Bebidas alcohólicas y tabaco', 'gasto', 'recortable', false, false, false), -- siempre oculta a un menor (minimización de datos, RNF-005)
    (3, 'Ropa y calzado', 'gasto', 'recortable', true, false, false),
    (4, 'Arriendo o cuota de vivienda', 'gasto', 'esencial', true, false, false),
    (5, 'Servicios públicos', 'gasto', 'esencial', true, false, false),
    (6, 'Hogar y mantenimiento', 'gasto', 'recortable', true, false, false),
    (7, 'Salud', 'gasto', 'esencial', true, true, false), -- D-071, D-088: oculta por defecto a un menor y se puede mostrar
    (8, 'Transporte', 'gasto', 'esencial', true, false, false),
    (9, 'Comunicaciones', 'gasto', 'recortable', true, false, false),
    (10, 'Suscripciones', 'gasto', 'recortable', true, false, false),
    (11, 'Recreación y cultura', 'gasto', 'recortable', true, false, false),
    (12, 'Educación', 'gasto', 'esencial', true, false, false),
    (13, 'Restaurantes y hoteles', 'gasto', 'recortable', true, false, false),
    (14, 'Pagos de deudas', 'gasto', 'esencial', true, false, false),
    (15, 'Mesada', 'gasto', 'esencial', true, false, false),
    (16, 'Otros gastos', 'gasto', 'recortable', true, false, true), -- categoría general de gasto: nunca se oculta (RN-011)
    (17, 'Salario', 'ingreso', NULL, true, false, false),
    (18, 'Trabajo independiente o ventas', 'ingreso', NULL, true, false, false),
    (19, 'Remesas o giros familiares', 'ingreso', NULL, true, false, false),
    (20, 'Ayudas y subsidios', 'ingreso', NULL, true, false, false),
    (21, 'Mesada', 'ingreso', NULL, true, false, false),
    (22, 'Prima de servicios', 'ingreso', NULL, true, false, false),
    (23, 'Intereses de cesantías', 'ingreso', NULL, true, false, false), -- Ley 52 de 1975 y Ley 50 de 1990, art. 99, num. 2; recurrencia por defecto anual en enero (RF-053)
    (24, 'Retiro de cesantías', 'ingreso', NULL, true, false, false),
    (25, 'Otros ingresos', 'ingreso', NULL, true, false, true), -- categoría general de ingreso: nunca se oculta (RN-011)
    (26, 'Ayuda a la familia', 'gasto', 'esencial', true, false, false); -- D-088 (C-04): esencial; la plata que se manda o entrega a la familia, también en efectivo

-- Finalidades: PROPUESTA del asistente. El dueño las confirma con los textos legales (E14, y la revisión jurídica de D-071).
INSERT INTO finalidad (codigo, tipo, activa, descripcion) VALUES
    ('cuenta_y_acceso', 'necesaria', true, 'Crear la cuenta, iniciar sesión y recuperar el acceso.'),
    ('funciones_financieras', 'necesaria', true, 'Registrar y analizar movimientos, presupuestos, deudas y metas.'),
    ('cuenta_del_menor', 'necesaria', true, 'Cuenta propia de un menor con acompañamiento de su tutor (FM-1).'),
    ('avisos', 'accesoria', true, 'Avisos con la aplicación cerrada, con el token del dispositivo (NM-17).'),
    ('horas_de_vida', 'accesoria', true, 'Mostrar el costo de un gasto en horas de vida (RF-054).'),
    ('correo_del_menor', 'accesoria', true, 'Correo opcional del menor en los 30 días previos a los 18 años (NM-04).'),
    ('transferencia', 'accesoria', false, 'Transferencia de datos a un país sin nivel adecuado. Hoy no se activa (NM-06).');

-- +goose Down
DELETE FROM finalidad;
DELETE FROM categoria;
