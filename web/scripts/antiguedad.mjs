// Revisa que ninguna versión de package-lock.json se haya publicado hace menos de `min-release-age` días (.npmrc),
// salvo las de antiguedad-excepciones.json con su fecha vigente (D-158). Corre antes de `npm ci`: npm ci no aplica
// la edad a lo que ya está en el lockfile. Sin dependencias: lee el lockfile y consulta el registro de npm.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  diasDelNpmrc,
  obtenerFechas,
  paquetesDelLock,
  revisar,
  urlDelPaquete,
} from "./antiguedad-logica.mjs";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const leer = (archivo) => readFileSync(`${raiz}${archivo}`, "utf8");

const dias = diasDelNpmrc(leer(".npmrc"));
if (dias === undefined) {
  console.error(
    ".npmrc no tiene un min-release-age entero y positivo: no hay contra qué comparar.",
  );
  process.exit(1);
}
const { paquetes, errores } = paquetesDelLock(
  JSON.parse(leer("package-lock.json")),
);
if (errores.length > 0) {
  console.error("El lockfile tiene entradas que no se pueden revisar:");
  for (const e of errores) console.error(`  ${e}`);
  process.exit(1);
}
const excepciones = JSON.parse(leer("antiguedad-excepciones.json"));

// Documento completo del paquete (el abreviado no trae `time`). Tres intentos ante fallas de red o del registro;
// un 404 no se reintenta.
const buscar = async (nombre) => {
  let ultimo;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const respuesta = await fetch(urlDelPaquete(nombre), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (respuesta.status === 404)
        throw Object.assign(new Error("el registro respondió 404"), {
          definitivo: true,
        });
      if (!respuesta.ok)
        throw new Error(`el registro respondió ${respuesta.status}`);
      return (await respuesta.json()).time;
    } catch (e) {
      if (e.definitivo) throw e;
      ultimo = e;
      await new Promise((listo) => setTimeout(listo, 1000 * intento));
    }
  }
  throw ultimo;
};

const fechas = await obtenerFechas(
  paquetes.map((p) => p.nombre),
  buscar,
);
const { fallas, aceptados, sobrantes, masJoven } = revisar({
  paquetes,
  fechas,
  excepciones,
  dias,
  ahora: Date.now(),
});

console.log(
  `Versiones del lockfile revisadas: ${paquetes.length} (mínimo ${dias} días desde su publicación)`,
);
if (masJoven) {
  console.log(
    `  La más reciente: ${masJoven.nombre}@${masJoven.version}, publicada el ${new Date(masJoven.publicado).toISOString()}`,
  );
}
for (const a of aceptados) {
  console.log(
    `Aceptada: ${a.nombre}@${a.version}, publicada el ${a.fecha}, excepción vigente hasta el ${a.revisarAntesDe}`,
  );
  console.log(`  ${a.motivo}`);
}
for (const s of sobrantes) {
  console.log(
    `Aviso: ${s.nombre}@${s.version} ya cumple la edad (publicada el ${s.fecha}): su excepción sobra, quítala.`,
  );
}
if (fallas.length > 0) {
  console.error(
    "\nVersiones demasiado recientes, fechas que no se pudieron obtener o excepciones que no valen:",
  );
  for (const f of fallas) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `Todas las versiones cumplen la edad mínima, salvo ${aceptados.length} con excepción vigente.`,
);
