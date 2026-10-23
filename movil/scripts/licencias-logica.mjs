// Lógica pura de la revisión de licencias (sin dependencias). La usan scripts/licencias.mjs y tests/licencias.test.ts.

// Licencias compatibles con AGPLv3 que se aceptan en el árbol de producción.
export const PERMITIDAS = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "Zlib",
  "BlueOak-1.0.0",
  "MPL-2.0",
]);

// Divide una expresión SPDX en paréntesis, operadores e identificadores.
function dividir(expresion) {
  return expresion.match(/\(|\)|[^\s()]+/g) ?? [];
}

// Evalúa una expresión SPDX: AND tiene más precedencia que OR. OR pasa si alguna opción
// está permitida; AND solo si todas. Un identificador desconocido (o un WITH, o una
// expresión mal formada) falla.
export function esPermitida(expresion, permitidas = PERMITIDAS) {
  if (typeof expresion !== "string" || expresion.trim() === "") return false;
  const fichas = dividir(expresion);
  let i = 0;

  const o = () => {
    let valor = y();
    while (fichas[i] === "OR") {
      i++;
      const derecha = y();
      valor = valor || derecha;
    }
    return valor;
  };
  const y = () => {
    let valor = atomo();
    while (fichas[i] === "AND") {
      i++;
      const derecha = atomo();
      valor = valor && derecha;
    }
    return valor;
  };
  const atomo = () => {
    const ficha = fichas[i++];
    if (ficha === "(") {
      const valor = o();
      if (fichas[i++] !== ")") throw new Error("paréntesis sin cerrar");
      return valor;
    }
    if (
      ficha === undefined ||
      ficha === ")" ||
      ficha === "AND" ||
      ficha === "OR"
    ) {
      throw new Error("expresión mal formada");
    }
    return permitidas.has(ficha);
  };

  try {
    const valor = o();
    return i === fichas.length && valor;
  } catch {
    return false;
  }
}

// Paquetes de producción del lockfile (todo lo que no es "dev": true, incluido lo transitivo).
// `leerRespaldo(ruta)` devuelve la licencia desde node_modules/<pkg>/package.json si el lockfile no la trae.
export function paquetesDeProduccion(lock, leerRespaldo = () => undefined) {
  const resultado = [];
  for (const [ruta, datos] of Object.entries(lock.packages ?? {})) {
    if (ruta === "" || datos.dev === true) continue;
    resultado.push({
      nombre: datos.name ?? ruta.replace(/^.*node_modules\//, ""),
      version: datos.version,
      licencia: datos.license ?? leerRespaldo(ruta),
    });
  }
  return resultado;
}

// Cuenta por licencia y lista los que no pasan.
export function revisar(paquetes, permitidas = PERMITIDAS) {
  const conteo = new Map();
  const infractores = [];
  for (const paquete of paquetes) {
    const clave = paquete.licencia ?? "(sin licencia)";
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    if (!esPermitida(paquete.licencia, permitidas)) infractores.push(paquete);
  }
  return { conteo, infractores };
}
