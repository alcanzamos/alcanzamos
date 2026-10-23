// Lógica pura de la revisión de licencias (sin dependencias). La usan scripts/licencias.mjs y tests/licencias.test.ts.
// Copia de la de web/ con las excepciones por paquete de D-150 (licencias-excepciones.json): la lista general no cambia.

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
      ruta,
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

// --- Excepciones por paquete (D-150) ---

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CAMPOS = ["paquete", "licencia", "rutas", "motivo", "revisar_antes_de"];

// Fecha de hoy en UTC, AAAA-MM-DD.
export const hoyUtc = () => new Date().toISOString().slice(0, 10);

// Ruta del lockfile del paquete al que resuelve `nombre` visto desde `desde` (sube por node_modules como Node).
function resolver(paquetes, desde, nombre) {
  let base = desde;
  for (;;) {
    const clave = `${base ? `${base}/` : ""}node_modules/${nombre}`;
    if (paquetes[clave]) return clave;
    if (base === "") return undefined;
    const i = base.lastIndexOf("/node_modules/");
    base = i >= 0 ? base.slice(0, i) : "";
  }
}

// Caminos por los que llega a producción el paquete de `ruta`: uno por cada paquete que depende de él, el más corto
// desde las dependencias directas (a igual largo gana el orden alfabético). Es como «expo > @expo/cli > js-yaml >
// argparse». Si el paquete es una dependencia directa, su camino es su nombre. Solo cuenta lo que no es "dev".
export function caminosDeProduccion(lock, ruta) {
  const paquetes = lock.packages ?? {};
  const hijos = (clave) => {
    const d = paquetes[clave] ?? {};
    return Object.keys({ ...d.dependencies, ...d.optionalDependencies, ...d.peerDependencies })
      .sort()
      .map((n) => [n, resolver(paquetes, clave, n)])
      .filter(([, destino]) => destino !== undefined && paquetes[destino].dev !== true);
  };
  // Recorrido a lo ancho desde la raíz: `previo` guarda el camino más corto a cada paquete.
  const previo = new Map([["", []]]);
  const cola = [""];
  const padres = new Map();
  while (cola.length > 0) {
    const actual = cola.shift();
    for (const [nombre, destino] of hijos(actual)) {
      if (!padres.has(destino)) padres.set(destino, new Set());
      padres.get(destino).add(actual);
      if (!previo.has(destino)) {
        previo.set(destino, [...previo.get(actual), nombre]);
        cola.push(destino);
      }
    }
  }
  const nombre = (clave) => paquetes[clave]?.name ?? clave.replace(/^.*node_modules\//, "");
  const caminos = [...(padres.get(ruta) ?? [])]
    .filter((p) => previo.has(p))
    .map((p) => [...previo.get(p), nombre(ruta)]);
  return [...new Set(caminos.map((c) => c.join(" > ")))].sort();
}

// Valida la forma de las excepciones y devuelve los errores (vacío si están bien).
export function validarExcepciones(excepciones) {
  if (!Array.isArray(excepciones)) return ["licencias-excepciones.json debe ser una lista"];
  const errores = [];
  excepciones.forEach((e, i) => {
    for (const campo of CAMPOS) {
      const valor = e?.[campo];
      const vacio =
        valor === undefined ||
        valor === null ||
        (typeof valor === "string" && valor.trim() === "") ||
        (Array.isArray(valor) && (valor.length === 0 || valor.some((r) => typeof r !== "string" || r.trim() === "")));
      if (vacio) errores.push(`la excepción ${i + 1} no tiene «${campo}»`);
    }
    if (typeof e?.revisar_antes_de === "string" && e.revisar_antes_de.trim() !== "" && !FECHA.test(e.revisar_antes_de)) {
      errores.push(`la excepción ${i + 1} tiene «revisar_antes_de» que no es una fecha AAAA-MM-DD`);
    }
  });
  return errores;
}

// Revisa las licencias de producción con excepciones por paquete. Devuelve { conteo, fallas, aceptados }.
// Falla si: un paquete no permitido no tiene excepción; la licencia de uno con excepción cambió; su camino de
// dependencias cambió; la excepción quedó obsoleta (el paquete ya no está o ya tiene licencia permitida); o la fecha
// `revisar_antes_de` pasó (`hoy`, AAAA-MM-DD en UTC).
export function revisarConExcepciones(lock, leerRespaldo, excepciones, hoy = hoyUtc(), permitidas = PERMITIDAS) {
  const errores = validarExcepciones(excepciones);
  const paquetes = paquetesDeProduccion(lock, leerRespaldo);
  const { conteo, infractores } = revisar(paquetes, permitidas);
  if (errores.length > 0) return { conteo, fallas: errores, aceptados: [] };

  const fallas = [];
  const aceptados = [];
  const usadas = new Set();
  for (const p of infractores) {
    const etiqueta = `${p.nombre}@${p.version}: ${p.licencia ?? "(sin licencia)"}`;
    const excepcion = excepciones.find((e) => e.paquete === p.nombre);
    if (!excepcion) {
      fallas.push(`${etiqueta} (licencia no permitida y sin excepción)`);
      continue;
    }
    usadas.add(excepcion);
    if (excepcion.licencia !== p.licencia) {
      fallas.push(`${etiqueta}: la licencia cambió (la excepción es para ${excepcion.licencia}); revisa la excepción`);
      continue;
    }
    const caminos = caminosDeProduccion(lock, p.ruta);
    const nuevos = caminos.filter((c) => !excepcion.rutas.includes(c));
    const perdidos = excepcion.rutas.filter((r) => !caminos.includes(r));
    if (nuevos.length > 0 || perdidos.length > 0) {
      fallas.push(
        `${etiqueta}: el camino de dependencias cambió y la excepción hay que revisarla. ` +
          `Nuevos: ${nuevos.join("; ") || "ninguno"}. Ya no aparecen: ${perdidos.join("; ") || "ninguno"}`,
      );
      continue;
    }
    aceptados.push({ ...p, motivo: excepcion.motivo, revisarAntesDe: excepcion.revisar_antes_de });
  }
  for (const e of excepciones) {
    if (!usadas.has(e)) {
      fallas.push(
        `la excepción de ${e.paquete} (${e.licencia}) ya no hace falta: el paquete no está en producción o su licencia ahora es permitida; quítala de licencias-excepciones.json`,
      );
    }
    if (hoy > e.revisar_antes_de) {
      fallas.push(
        `la excepción de ${e.paquete} (${e.licencia}) venció el ${e.revisar_antes_de}: revísala en el cierre de la iteración ` +
          "(y al subir de versión de Expo) y renueva `revisar_antes_de` en licencias-excepciones.json, o quítala",
      );
    }
  }
  return { conteo, fallas, aceptados };
}
