// Única función que muestra dinero en la web (D-082, E17-ECO 4.8): los montos son centavos enteros.
// Formato colombiano: punto para los miles, coma para los centavos, y los centavos solo si no son cero.
// Sin Intl ni parseFloat: así el resultado no depende de los datos de idioma del navegador ni de decimales binarios.
// Acepta `bigint` para los montos que escribe la persona: un entero de 64 bits no cabe exacto en un `number`.
export function formatearPesos(centavos: number | bigint): string {
  if (typeof centavos === "number" && !Number.isSafeInteger(centavos)) {
    throw new RangeError("El monto debe ser un entero de centavos");
  }
  const valor = BigInt(centavos);
  const absoluto = valor < 0n ? -valor : valor;
  const resto = absoluto % 100n;
  const miles = String(absoluto / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimales = resto === 0n ? "" : `,${String(resto).padStart(2, "0")}`;
  // Un monto negativo (por ejemplo un saldo en contra) lleva el signo antes del peso: «-$80.000».
  const signo = valor < 0n ? "-" : "";
  return `${signo}$${miles}${decimales}`;
}

/** El mayor monto que guarda el API: un entero de centavos de 64 bits con signo. */
export const MONTO_MAXIMO = 9223372036854775807n;

/** Lo que dice el texto de un monto: los centavos exactos, o por qué no se puede leer (E14-PPN 3.1, errores de campo). */
export type LecturaDeMonto =
  | { ok: true; centavos: bigint }
  | {
      ok: false;
      motivo: "vacio" | "cero" | "decimales" | "ilegible" | "grande";
    }
  | {
      ok: false;
      motivo: "ambiguo";
      /** «12.5» leído con punto de miles: $12.500 */
      miles: bigint;
      /** «12.5» leído con coma decimal: $12,50 */
      decimal: bigint;
    };

const GRUPOS_DE_MILES = /^(\d+|\d{1,3}(\.\d{3})+)$/;

const aCentavos = (pesos: string, decimales: string) =>
  BigInt(pesos) * 100n + BigInt(decimales.padEnd(2, "0"));

/**
 * Lee el monto que escribe la persona («45.000», «$123.456,78», «12,5») a centavos enteros, sin `Number` ni
 * `parseFloat` (D-082, EXA-001): el punto es de miles y la coma es decimal. Un punto que no agrupa de a tres dígitos
 * («12.5») puede ser de miles o decimal: se rechaza sin adivinar (E14-PPN 3.1, D-084) y se devuelven las dos lecturas.
 */
export function leerMonto(texto: string): LecturaDeMonto {
  const limpio = texto.replace(/[\s$]/g, "");
  if (limpio === "") return { ok: false, motivo: "vacio" };
  const negativo = limpio.startsWith("-");
  const partes = /^-?([\d.]+)(?:,(\d*))?$/.exec(limpio);
  if (!partes?.[1] || !/\d/.test(partes[1]))
    return { ok: false, motivo: "ilegible" };
  const entera = partes[1];
  const coma = partes[2];
  let centavos: bigint;
  if (coma !== undefined) {
    // Con coma decimal, el punto solo puede agrupar miles.
    if (!GRUPOS_DE_MILES.test(entera)) return { ok: false, motivo: "ilegible" };
    if (coma.length > 2) return { ok: false, motivo: "decimales" };
    centavos = aCentavos(entera.replaceAll(".", ""), coma);
  } else if (GRUPOS_DE_MILES.test(entera)) {
    centavos = aCentavos(entera.replaceAll(".", ""), "");
  } else {
    // Un solo punto con uno, dos o más dígitos después: «12.5» o «12.50», lo que escribiría quien usa punto decimal.
    const [pesos = "", resto = "", ...otros] = entera.split(".");
    if (otros.length > 0 || pesos === "" || resto === "")
      return { ok: false, motivo: "ilegible" };
    if (resto.length > 2) return { ok: false, motivo: "decimales" };
    return {
      ok: false,
      motivo: "ambiguo",
      miles: aCentavos(pesos + resto.padEnd(3, "0"), ""),
      decimal: aCentavos(pesos, resto),
    };
  }
  if (negativo || centavos === 0n) return { ok: false, motivo: "cero" };
  if (centavos > MONTO_MAXIMO) return { ok: false, motivo: "grande" };
  return { ok: true, centavos };
}
