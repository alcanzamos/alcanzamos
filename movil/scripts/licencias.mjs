// Revisa que las dependencias de producción de movil/ tengan licencias compatibles con AGPLv3
// (condición 4 de ADR-003). Sin dependencias: solo lee package-lock.json y licencias-excepciones.json.
// La lista general de licencias no cambia; las excepciones son por paquete, con camino y fecha de revisión (D-150).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revisarConExcepciones } from "./licencias-logica.mjs";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const lock = JSON.parse(readFileSync(`${raiz}package-lock.json`, "utf8"));
const excepciones = JSON.parse(readFileSync(`${raiz}licencias-excepciones.json`, "utf8"));

const leerRespaldo = (ruta) => {
  const archivo = `${raiz}${ruta}/package.json`;
  if (!existsSync(archivo)) return undefined;
  return JSON.parse(readFileSync(archivo, "utf8")).license;
};

const { conteo, fallas, aceptados } = revisarConExcepciones(lock, leerRespaldo, excepciones);

console.log(`Paquetes de producción revisados: ${[...conteo.values()].reduce((a, b) => a + b, 0)}`);
for (const [licencia, cantidad] of [...conteo].sort()) {
  console.log(`  ${licencia}: ${cantidad}`);
}
for (const a of aceptados) {
  console.log(`Excepción: ${a.nombre}@${a.version} (${a.licencia}), vigente hasta el ${a.revisarAntesDe}`);
}

if (fallas.length > 0) {
  console.error("\nLicencias no permitidas, desconocidas o excepciones que hay que revisar:");
  for (const f of fallas) console.error(`  ${f}`);
  process.exit(1);
}
console.log("Todas las licencias de producción están permitidas o tienen una excepción vigente.");
