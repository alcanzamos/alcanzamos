// Comprueba que node-forge no entra en el paquete de JavaScript de la app (D-150): genera el paquete de Android con
// `expo export` en una carpeta temporal fuera del repositorio y falla si aparece. Sin dependencias.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { revisarArchivos } from "./bundle-logica.mjs";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const salida = mkdtempSync(join(tmpdir(), "movil-bundle-"));
let codigo = 0;
try {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const inicio = Date.now();
  const exportacion = spawnSync(npx, ["expo", "export", "--platform", "android", "--output-dir", salida], {
    cwd: raiz,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (exportacion.status !== 0) {
    console.error(exportacion.stdout, exportacion.stderr);
    throw new Error("expo export falló");
  }
  console.log(`expo export terminó en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);

  const carpeta = join(salida, "_expo", "static", "js", "android");
  const archivos = readdirSync(carpeta).map((nombre) => ({
    nombre,
    contenido: readFileSync(join(carpeta, nombre)),
  }));
  const { fallas, revisados } = revisarArchivos(archivos);
  console.log(`Paquetes de JavaScript revisados: ${revisados}`);
  if (fallas.length > 0) {
    for (const f of fallas) console.error(`  ${f}`);
    codigo = 1;
  } else {
    console.log("node-forge no está en el paquete de la app.");
  }
} catch (error) {
  console.error(`No se pudo comprobar el paquete: ${error.message}`);
  codigo = 1;
} finally {
  rmSync(salida, { recursive: true, force: true });
}
process.exit(codigo);
