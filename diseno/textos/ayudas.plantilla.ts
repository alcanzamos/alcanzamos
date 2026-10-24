// Ayudas de los textos con datos y de los plurales (US-59, D-160). Esta es la única copia: el generador
// (diseno/generar-textos.mjs) la pega al final del módulo de cada app, así web y móvil tienen el mismo código.
// No se compila aquí: se compila dentro de la app que la recibe.

/** Los marcadores `{nombre}` de un texto, leídos del tipo literal del propio texto. */
export type Marcadores<T extends string> = T extends `${string}{${infer M}}${infer R}`
  ? M | Marcadores<R>
  : never;

/** Los datos que `formatear` pide para un texto: exactamente sus marcadores, ni uno más ni uno menos. */
export type Datos<T extends string> = { [M in Marcadores<T>]: string };

type Argumentos<T extends string> = [Marcadores<T>] extends [never] ? [] : [datos: Datos<T>];

/** Las dos formas de un plural: `one` para 1 y `other` para todo lo demás. */
export type FormasDePlural = { readonly one: string; readonly other: string };

type MarcadoresDePlural<F extends FormasDePlural> = Exclude<
  Marcadores<F['one']> | Marcadores<F['other']>,
  'n'
>;

type ArgumentosDePlural<F extends FormasDePlural> = [MarcadoresDePlural<F>] extends [never]
  ? []
  : [datos: Record<MarcadoresDePlural<F>, string>];

const MARCADOR = /\{([^{}]*)\}/g;

function nombresDe(texto: string): string[] {
  return [...texto.matchAll(MARCADOR)].map((coincidencia) => coincidencia[1] ?? '');
}

/**
 * Pone los datos en los marcadores `{nombre}` del texto. Los datos llegan ya como texto: los montos y las fechas
 * se formatean antes con las funciones comunes, nunca aquí. Falla si falta un dato o sobra uno; el tipo ya lo
 * impide al compilar, y esta guarda cubre lo que el compilador no ve.
 */
export function formatear<T extends string>(texto: T, ...argumentos: Argumentos<T>): string {
  const datos: Record<string, string> = argumentos[0] ?? {};
  const esperados = new Set(nombresDe(texto));
  const dados = new Set(Object.keys(datos));
  const faltan = [...esperados].filter((nombre) => !dados.has(nombre));
  const sobran = [...dados].filter((nombre) => !esperados.has(nombre));
  if (faltan.length > 0 || sobran.length > 0) {
    throw new Error(
      `Marcadores de «${texto}»: faltan [${faltan.join(', ')}] y sobran [${sobran.join(', ')}]`,
    );
  }
  return texto.replace(MARCADOR, (_, nombre: string) => datos[nombre] ?? '');
}

// Hermes (Android) no implementa `Intl.PluralRules` (facebook/hermes#1462, abierto): crearla sin revisar tumbaría la app
// al arrancar. Sin ella se usa la regla del español para enteros: `one` solo para 1; lo demás es `other`. Es el mismo
// resultado que la convención de abajo con `Intl.PluralRules`, que solo agrega `many` para millones exactos.
const reglasDePlural =
  typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function' ? new Intl.PluralRules('es') : undefined;

/**
 * Elige la forma del plural y pone el número en `{n}`. La convención usa solo `one` y `other`: en español
 * `Intl.PluralRules` da `one` para 1, `other` para el resto y `many` para los millones exactos (1000000), que aquí
 * cae en `other`; sin `Intl.PluralRules` (Hermes) solo el 1 es `one`. El número va tal cual (sin separador de miles):
 * son recuentos pequeños.
 */
export function plural<F extends FormasDePlural>(
  formas: F,
  n: number,
  ...argumentos: ArgumentosDePlural<F>
): string {
  const forma = (reglasDePlural ? reglasDePlural.select(n) === 'one' : n === 1) ? formas.one : formas.other;
  const datos: Record<string, string> = { ...(argumentos[0] ?? {}) };
  if (nombresDe(forma).includes('n')) datos.n = String(n);
  return (formatear as (texto: string, datos: Record<string, string>) => string)(forma, datos);
}
