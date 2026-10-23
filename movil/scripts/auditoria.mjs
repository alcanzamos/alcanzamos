// Revisa las vulnerabilidades altas y críticas de las dependencias de producción de movil/ (condición 4 de ADR-003).
// Corre `npm audit --omit=dev --json` y falla con todo aviso que no esté en auditoria-excepciones.json y con toda
// excepción que ya no se reporte. Sin dependencias.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revisar } from "./auditoria-logica.mjs";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const excepciones = JSON.parse(readFileSync(`${raiz}auditoria-excepciones.json`, "utf8"));

// npm audit sale con 1 cuando hay avisos: lo que importa es el JSON, no el código de salida.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const resultado = spawnSync(npm, ["audit", "--omit=dev", "--json"], {
  cwd: raiz,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

let informe;
try {
  informe = JSON.parse(resultado.stdout);
} catch {
  console.error("npm audit no devolvió un JSON válido:");
  console.error(resultado.stderr || resultado.stdout || resultado.error);
  process.exit(1);
}
if (informe.error) {
  console.error(`npm audit falló: ${informe.error.summary ?? informe.error.code}`);
  process.exit(1);
}

const { fallas, aceptados } = revisar(informe, excepciones);

for (const a of aceptados) {
  console.log(`Aceptado: ${a.id} (${a.severidad}) en ${a.paquete}, revisado el ${a.revisado}, vigente hasta el ${a.revisarAntesDe}`);
  console.log(`  ${a.motivo}`);
}
if (fallas.length > 0) {
  console.error("\nVulnerabilidades altas o críticas sin excepción vigente:");
  for (const f of fallas) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Sin avisos altos o críticos fuera de las ${aceptados.length} excepción(es) documentadas.`);
