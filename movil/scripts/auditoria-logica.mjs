// Lógica pura de la revisión de vulnerabilidades (sin dependencias). La usan scripts/auditoria.mjs y
// tests/auditoria.test.ts.
//
// `npm audit --omit=dev --json` lista los paquetes vulnerables y, en `via`, el aviso (un objeto con la URL GHSA) o el
// nombre de otro paquete vulnerable del que depende. Solo los objetos son avisos; los nombres son propagación.
// Falla todo aviso alto o crítico que no esté en `auditoria-excepciones.json`, y toda excepción que ya no se
// reporte, cuyo camino de dependencias haya cambiado o cuya fecha `revisar_antes_de` (D-150) ya pasó.

const GRAVES = new Set(["high", "critical"]);

export function idDelAviso(url) {
  return /GHSA-[0-9a-z-]+/i.exec(url ?? "")?.[0].toLowerCase().replace(/^ghsa/, "GHSA");
}

// Caminos desde una dependencia directa hasta `paquete`, como «expo > @expo/cli > node-forge». Se siguen los
// `effects` (quién depende del vulnerable) hacia arriba hasta los paquetes `isDirect`.
export function caminosHasta(paquete, vulnerabilidades) {
  const caminos = new Set();
  const subir = (nombre, cola, visitados) => {
    const camino = [nombre, ...cola];
    const datos = vulnerabilidades[nombre];
    if (datos?.isDirect) caminos.add(camino.join(" > "));
    for (const padre of datos?.effects ?? []) {
      if (!visitados.has(padre)) subir(padre, camino, new Set([...visitados, padre]));
    }
  };
  subir(paquete, [], new Set([paquete]));
  return [...caminos].sort();
}

// Avisos altos o críticos del informe: [{ id, paquete, severidad, titulo, caminos }].
export function avisosGraves(informe) {
  const vulnerabilidades = informe.vulnerabilities ?? {};
  const avisos = new Map();
  for (const [nombre, datos] of Object.entries(vulnerabilidades)) {
    for (const via of datos.via ?? []) {
      if (typeof via !== "object" || !GRAVES.has(via.severity)) continue;
      const id = idDelAviso(via.url) ?? `fuente-${via.source}`;
      avisos.set(`${id}|${nombre}`, {
        id,
        paquete: nombre,
        severidad: via.severity,
        titulo: via.title,
        caminos: caminosHasta(nombre, vulnerabilidades),
      });
    }
  }
  return [...avisos.values()];
}

const CAMPOS = ["ghsa", "paquete", "rutas", "motivo", "revisado", "revisar_antes_de"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Fecha de hoy en UTC, AAAA-MM-DD.
export const hoyUtc = () => new Date().toISOString().slice(0, 10);

// Valida la forma de las excepciones y devuelve los errores (vacío si están bien).
export function validarExcepciones(excepciones) {
  if (!Array.isArray(excepciones)) return ["auditoria-excepciones.json debe ser una lista"];
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
    for (const campo of ["revisado", "revisar_antes_de"]) {
      if (typeof e?.[campo] === "string" && e[campo].trim() !== "" && !FECHA.test(e[campo])) {
        errores.push(`la excepción ${i + 1} tiene «${campo}» que no es una fecha AAAA-MM-DD`);
      }
    }
  });
  return errores;
}

// Devuelve { fallas, aceptados }: `fallas` son frases para imprimir; `aceptados` son los avisos con excepción vigente.
// `hoy` es AAAA-MM-DD en UTC: una excepción con `revisar_antes_de` anterior a hoy falla.
export function revisar(informe, excepciones, hoy = hoyUtc()) {
  const fallas = validarExcepciones(excepciones);
  if (fallas.length > 0) return { fallas, aceptados: [] };

  const avisos = avisosGraves(informe);
  const aceptados = [];
  for (const e of excepciones) {
    if (hoy > e.revisar_antes_de) {
      fallas.push(
        `la excepción ${e.ghsa} (${e.paquete}) venció el ${e.revisar_antes_de}: revísala en el cierre de la iteración ` +
          "(y al subir de versión de Expo) y renueva `revisar_antes_de` en auditoria-excepciones.json, o quítala",
      );
    }
  }
  for (const aviso of avisos) {
    const excepcion = excepciones.find((e) => e.ghsa === aviso.id && e.paquete === aviso.paquete);
    if (!excepcion) {
      fallas.push(
        `${aviso.id} (${aviso.severidad}) en ${aviso.paquete}: ${aviso.titulo}. Caminos: ${aviso.caminos.join("; ") || "(ninguno directo)"}`,
      );
      continue;
    }
    const nuevas = aviso.caminos.filter((c) => !excepcion.rutas.includes(c));
    const perdidas = excepcion.rutas.filter((r) => !aviso.caminos.includes(r));
    if (nuevas.length > 0 || perdidas.length > 0) {
      fallas.push(
        `${aviso.id} en ${aviso.paquete}: el camino de dependencias cambió y la excepción hay que revisarla. ` +
          `Nuevos: ${nuevas.join("; ") || "ninguno"}. Ya no aparecen: ${perdidas.join("; ") || "ninguno"}`,
      );
      continue;
    }
    aceptados.push({ ...aviso, motivo: excepcion.motivo, revisado: excepcion.revisado, revisarAntesDe: excepcion.revisar_antes_de });
  }
  for (const e of excepciones) {
    if (!avisos.some((a) => a.id === e.ghsa && a.paquete === e.paquete)) {
      fallas.push(
        `la excepción ${e.ghsa} (${e.paquete}) ya no se reporta: quítala de auditoria-excepciones.json`,
      );
    }
  }
  return { fallas, aceptados };
}
