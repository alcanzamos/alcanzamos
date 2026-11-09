// Lee y escribe dinero en el formulario de registro (D-082, E17-ECO 4.8): los montos son centavos enteros. Es solo
// formato y lectura de lo que escribe la persona, no una regla de negocio: el API vuelve a validar todo. Mismo código
// que `web/src/dinero.ts`, más `montoEnElCampo` (el campo de monto con TalkBack, solo en Android). Sin `Intl` ni
// `parseFloat`: el resultado no depende de los datos de idioma de Hermes ni de decimales binarios, y un entero de
// 64 bits no cabe exacto en un `number`, por eso `bigint`.

/** El símbolo del peso: va antes de la cifra en `formatearPesos` y como prefijo fijo del campo de monto. */
export const SIMBOLO_DE_PESOS = '$';

/** La cifra de un monto positivo, sin símbolo: con punto de miles o sin él, y coma para los centavos si no son cero. */
function cifraDePesos(absoluto: bigint, conMiles: boolean): string {
  const resto = absoluto % 100n;
  const pesos = String(absoluto / 100n);
  const decimales = resto === 0n ? '' : `,${String(resto).padStart(2, '0')}`;
  return `${conMiles ? pesos.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : pesos}${decimales}`;
}

// Formato colombiano: punto para los miles, coma para los centavos, y los centavos solo si no son cero.
export function formatearPesos(centavos: number | bigint): string {
  if (typeof centavos === 'number' && !Number.isSafeInteger(centavos)) {
    throw new RangeError('El monto debe ser un entero de centavos');
  }
  const valor = BigInt(centavos);
  const absoluto = valor < 0n ? -valor : valor;
  return `${valor < 0n ? '-' : ''}${SIMBOLO_DE_PESOS}${cifraDePesos(absoluto, true)}`;
}

/** El mayor monto que guarda el API: un entero de centavos de 64 bits con signo. */
export const MONTO_MAXIMO = 9223372036854775807n;

/** Lo que dice el texto de un monto: los centavos exactos, o por qué no se puede leer (E14-PPN 3.1, errores de campo). */
export type LecturaDeMonto =
  | { ok: true; centavos: bigint }
  | { ok: false; motivo: 'vacio' | 'cero' | 'decimales' | 'ilegible' | 'grande' }
  | {
      ok: false;
      motivo: 'ambiguo';
      /** «12.5» leído con punto de miles: $12.500 */
      miles: bigint;
      /** «12.5» leído con coma decimal: $12,50 */
      decimal: bigint;
    };

const GRUPOS_DE_MILES = /^(\d+|\d{1,3}(\.\d{3})+)$/;
const sinPuntos = (texto: string) => texto.replace(/\./g, '');
const aCentavos = (pesos: string, decimales: string) => BigInt(pesos) * 100n + BigInt(decimales.padEnd(2, '0'));

/**
 * Lee el monto que escribe la persona («45.000», «$123.456,78», «12,5») a centavos enteros: el punto es de miles y la
 * coma es decimal. Un punto que no agrupa de a tres dígitos («12.5») puede ser de miles o decimal: se rechaza sin
 * adivinar (E14-PPN 3.1, D-084) y se devuelven las dos lecturas.
 */
export function leerMonto(texto: string): LecturaDeMonto {
  const limpio = texto.replace(/[\s$]/g, '');
  if (limpio === '') return { ok: false, motivo: 'vacio' };
  const negativo = limpio.startsWith('-');
  const partes = /^-?([\d.]+)(?:,(\d*))?$/.exec(limpio);
  if (!partes?.[1] || !/\d/.test(partes[1])) return { ok: false, motivo: 'ilegible' };
  const entera = partes[1];
  const coma = partes[2];
  let centavos: bigint;
  if (coma !== undefined) {
    // Con coma decimal, el punto solo puede agrupar miles.
    if (!GRUPOS_DE_MILES.test(entera)) return { ok: false, motivo: 'ilegible' };
    if (coma.length > 2) return { ok: false, motivo: 'decimales' };
    centavos = aCentavos(sinPuntos(entera), coma);
  } else if (GRUPOS_DE_MILES.test(entera)) {
    centavos = aCentavos(sinPuntos(entera), '');
  } else {
    // Un solo punto con uno, dos o más dígitos después: «12.5» o «12.50», lo que escribiría quien usa punto decimal.
    const [pesos = '', resto = '', ...otros] = entera.split('.');
    if (otros.length > 0 || pesos === '' || resto === '') return { ok: false, motivo: 'ilegible' };
    if (resto.length > 2) return { ok: false, motivo: 'decimales' };
    return {
      ok: false,
      motivo: 'ambiguo',
      miles: aCentavos(pesos + resto.padEnd(3, '0'), ''),
      decimal: aCentavos(pesos, resto),
    };
  }
  if (negativo || centavos === 0n) return { ok: false, motivo: 'cero' };
  if (centavos > MONTO_MAXIMO) return { ok: false, motivo: 'grande' };
  return { ok: true, centavos };
}

/**
 * Lo que muestra el campo de monto (ACC-004, opción A del dueño): sin «$», que va como prefijo fuera del campo, con
 * punto de miles («15.000,50») o sin él («15000,50»), que es como TalkBack lo lee bien («quince mil»; «15.000» lo leía
 * «15, cero cero cero»). Un texto que no se lee como monto queda como se escribió. Las dos formas son los mismos
 * centavos para `leerMonto`.
 */
export function montoEnElCampo(texto: string, { conMiles }: { conMiles: boolean }): string {
  const lectura = leerMonto(texto);
  return lectura.ok ? cifraDePesos(lectura.centavos, conMiles) : texto;
}
