// Generador de los textos de interfaz (US-59, D-160). Un solo archivo fuente, diseno/textos/es.json, y un solo
// generador para todas las apps: web usa `comun` + `solo_web`; Android, `comun` + `solo_android`.
//
//   node ../diseno/generar-textos.mjs <web|android> <archivo de salida>     (`npm run textos` en web/)
//
// La salida es un módulo de TypeScript con las constantes (tipos literales, para que `formatear` sepa los marcadores
// de cada texto) y las ayudas `formatear` y `plural` de diseno/textos/ayudas.plantilla.ts, pegadas tal cual.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const carpeta = new URL('./textos/', import.meta.url);
const PLATAFORMAS = { web: 'solo_web', android: 'solo_android' };
const NOMBRE_VALIDO = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CLAVE_VALIDA = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Los marcadores `{nombre}` de un texto; falla con una llave suelta o un nombre que no es válido. */
export function marcadoresDe(texto) {
  const sinMarcadores = texto.replace(/\{([^{}]*)\}/g, (_, nombre) => {
    if (!NOMBRE_VALIDO.test(nombre)) throw new Error(`Marcador inválido «{${nombre}}» en «${texto}»`);
    return '';
  });
  if (/[{}]/.test(sinMarcadores)) throw new Error(`Llaves sin cerrar en «${texto}»`);
  return [...texto.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
}

const esHoja = (nodo) => typeof nodo === 'object' && nodo !== null && 'texto' in nodo;
const esPlural = (texto) => typeof texto === 'object' && texto !== null;

/** Recorre una sección y devuelve las hojas como `[ruta, hoja]`; valida la forma de cada una. */
export function hojasDe(seccion, prefijo = []) {
  const salida = [];
  for (const [clave, nodo] of Object.entries(seccion)) {
    const ruta = [...prefijo, clave];
    const nombre = ruta.join('.');
    if (!CLAVE_VALIDA.test(clave)) throw new Error(`Clave inválida «${nombre}»`);
    if (typeof nodo !== 'object' || nodo === null) throw new Error(`«${nombre}» no es una hoja ni un grupo`);
    if (!esHoja(nodo)) {
      salida.push(...hojasDe(nodo, ruta));
      continue;
    }
    const { texto, e14, ...resto } = nodo;
    if (Object.keys(resto).length > 0) throw new Error(`«${nombre}» tiene claves de más: ${Object.keys(resto)}`);
    if (typeof e14 !== 'string' || e14.trim() === '') throw new Error(`«${nombre}» no tiene referencia de E14`);
    if (esPlural(texto)) {
      if (Object.keys(texto).sort().join() !== 'one,other' || Object.values(texto).some((f) => typeof f !== 'string')) {
        throw new Error(`«${nombre}»: un plural tiene solo las formas «one» y «other»`);
      }
      const uno = marcadoresDe(texto.one).filter((m) => m !== 'n').sort().join();
      const otro = marcadoresDe(texto.other).filter((m) => m !== 'n').sort().join();
      if (uno !== otro) throw new Error(`«${nombre}»: «one» y «other» llevan marcadores distintos`);
    } else if (typeof texto === 'string') {
      marcadoresDe(texto);
    } else {
      throw new Error(`«${nombre}»: el texto es una cadena o un plural`);
    }
    salida.push([ruta, { texto, e14 }]);
  }
  return salida;
}

/** Las hojas de `comun` y de `solo_<plataforma>`; una ruta en las dos secciones es un error. */
export function hojasDeLaPlataforma(json, plataforma) {
  const solo = PLATAFORMAS[plataforma];
  if (!solo) throw new Error(`Plataforma desconocida «${plataforma}»; usa ${Object.keys(PLATAFORMAS)}`);
  const todas = [...hojasDe(json.comun ?? {}), ...hojasDe(json[solo] ?? {})];
  const vistas = new Set();
  for (const [ruta] of todas) {
    const nombre = ruta.join('.');
    if (vistas.has(nombre)) throw new Error(`El texto «${nombre}» está en «comun» y en «${solo}»`);
    vistas.add(nombre);
  }
  return todas;
}

function arbolDe(hojas) {
  const raiz = {};
  for (const [ruta, hoja] of hojas) {
    let nodo = raiz;
    for (const clave of ruta.slice(0, -1)) {
      nodo[clave] ??= {};
      if (esHoja(nodo[clave])) throw new Error(`«${ruta.join('.')}» cuelga de una hoja`);
      nodo = nodo[clave];
    }
    const ultima = ruta.at(-1);
    if (ultima in nodo) throw new Error(`«${ruta.join('.')}» es hoja y grupo a la vez`);
    nodo[ultima] = hoja;
  }
  return raiz;
}

function aTypeScript(nodo, sangria) {
  const margen = '  '.repeat(sangria);
  const lineas = [];
  for (const [clave, valor] of Object.entries(nodo)) {
    if (esHoja(valor)) {
      lineas.push(`${margen}// ${valor.e14}`);
      const texto = esPlural(valor.texto)
        ? `{ one: ${JSON.stringify(valor.texto.one)}, other: ${JSON.stringify(valor.texto.other)} }`
        : JSON.stringify(valor.texto);
      lineas.push(`${margen}${clave}: ${texto},`);
    } else {
      lineas.push(`${margen}${clave}: {`, aTypeScript(valor, sangria + 1), `${margen}},`);
    }
  }
  return lineas.join('\n');
}

export function generar(json, plataforma, ayudas) {
  const solo = PLATAFORMAS[plataforma];
  const cuerpo = aTypeScript(arbolDe(hojasDeLaPlataforma(json, plataforma)), 1);
  return `// Archivo generado por \`npm run textos\` (diseno/generar-textos.mjs) desde diseno/textos/es.json: secciones «comun» y
// «${solo}». No editar a mano: un cambio de texto va primero a E14 y después a es.json (E17-ECO 4.13).
// Cada texto lleva encima su referencia de E14. Los marcadores son \`{nombre}\`; se llenan con \`formatear\` y \`plural\`.

export const textos = {
${cuerpo}
} as const;

${ayudas}`;
}

export function generarDesdeArchivos(plataforma) {
  const json = JSON.parse(readFileSync(new URL('es.json', carpeta), 'utf8'));
  const ayudas = readFileSync(new URL('ayudas.plantilla.ts', carpeta), 'utf8');
  return generar(json, plataforma, ayudas);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [plataforma, salida] = process.argv.slice(2);
  if (!plataforma || !salida) {
    console.error('Uso: node generar-textos.mjs <web|android> <archivo de salida>');
    process.exit(2);
  }
  writeFileSync(salida, generarDesdeArchivos(plataforma));
  console.log(`Generado ${salida} (${plataforma})`);
}
