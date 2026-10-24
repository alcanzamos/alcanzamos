// Fechas en texto, no en formato numérico (D-090, E17-ECO 4.9). Los nombres de los meses son propios: no dependen de
// los datos de idioma del teléfono.
export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** «14 de mayo de 1990» a partir de una fecha del calendario local (la que eligió la persona en el selector). */
export const fechaLocalEnPalabras = (fecha: Date): string =>
  `${fecha.getDate()} de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
