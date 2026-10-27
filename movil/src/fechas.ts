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

// Colombia no tiene horario de verano (America/Bogota es UTC−5 todo el año desde 1993). Se resta la diferencia a mano
// y se leen los campos en UTC, en vez de pedirle la zona a `Intl`: así el resultado no depende de los datos de idioma
// ni de la zona del teléfono.
const DIFERENCIA_CON_BOGOTA_MS = -5 * 60 * 60 * 1000;

/** «el 1 de noviembre de 2026, a las 9:40 p. m.» a partir de un RFC 3339, en la hora de Colombia; `null` si no es una fecha. */
export function fechaEnPalabras(rfc3339: string): string | null {
  const instante = new Date(rfc3339);
  if (Number.isNaN(instante.getTime())) return null;
  const bogota = new Date(instante.getTime() + DIFERENCIA_CON_BOGOTA_MS);
  const hora = bogota.getUTCHours();
  const hora12 = hora % 12 || 12;
  const minutos = String(bogota.getUTCMinutes()).padStart(2, '0');
  const articulo = hora12 === 1 ? 'a la' : 'a las';
  const jornada = hora < 12 ? 'a. m.' : 'p. m.';
  return `el ${bogota.getUTCDate()} de ${MESES[bogota.getUTCMonth()]} de ${bogota.getUTCFullYear()}, ${articulo} ${hora12}:${minutos} ${jornada}`;
}

/** «30 de octubre de 2026» a partir de «AAAA-MM-DD» (una fecha sin hora, como la de la versión de un texto); `null` si no lo es. */
export function diaEnPalabras(iso: string): string | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return null;
  const [anio, mes, dia] = partes.slice(1).map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

/** «AAAA-MM-DD» del día de hoy en Colombia (UTC−5 todo el año, sin horario de verano), como lo calcula el API. */
export const hoyEnColombia = (ahora: Date = new Date()): string =>
  new Date(ahora.getTime() + DIFERENCIA_CON_BOGOTA_MS).toISOString().slice(0, 10);

/** Una fecha real que el API acepta para un movimiento: «AAAA-MM-DD» desde el año 1900. */
export const esFechaDeMovimiento = (iso: string): boolean => diaEnPalabras(iso) !== null && iso >= '1900-01-01';

const dosDigitos = (n: number) => String(n).padStart(2, '0');

/** «AAAA-MM-DD» de una fecha del calendario local (la que eligió la persona en el selector). */
export const aIso = (fecha: Date): string =>
  `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;

/** La fecha del calendario local de un «AAAA-MM-DD» (para abrir el selector en ella). */
export const desdeIso = (iso: string): Date => {
  const [anio = 0, mes = 1, dia = 1] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
};
