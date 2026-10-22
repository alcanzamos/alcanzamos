// Revisa que las dependencias de producción de web/ tengan licencias compatibles con AGPLv3
// (condición 4 de ADR-003). Sin dependencias: solo lee package-lock.json.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { paquetesDeProduccion, revisar } from "./licencias-logica.mjs";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const lock = JSON.parse(readFileSync(`${raiz}package-lock.json`, "utf8"));

const leerRespaldo = (ruta) => {
  const archivo = `${raiz}${ruta}/package.json`;
  if (!existsSync(archivo)) return undefined;
  return JSON.parse(readFileSync(archivo, "utf8")).license;
};

const paquetes = paquetesDeProduccion(lock, leerRespaldo);
const { conteo, infractores } = revisar(paquetes);

console.log(`Paquetes de producción revisados: ${paquetes.length}`);
for (const [licencia, cantidad] of [...conteo].sort()) {
  console.log(`  ${licencia}: ${cantidad}`);
}

if (infractores.length > 0) {
  console.error("\nLicencias no permitidas o desconocidas:");
  for (const p of infractores) {
    console.error(
      `  ${p.nombre}@${p.version}: ${p.licencia ?? "(sin licencia)"}`,
    );
  }
  process.exit(1);
}
console.log("Todas las licencias de producción están permitidas.");
