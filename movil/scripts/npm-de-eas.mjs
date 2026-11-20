// Paso previo de EAS Build (`eas-build-pre-install` en package.json, US-48): instala npm 12.2.1 antes de que EAS corra
// `npm ci`. EAS trae el npm que acompaña a su Node, y `movil/.npmrc` (engine-strict, strict-allow-scripts,
// min-release-age) y `engines.npm` piden el 12.2.1. Se hace igual que el control (`plantillas/pasos/node.yml`): se baja
// el tarball del registro, se verifica su SHA-512 y se instala desde el archivo local. Si la suma no coincide, falla y
// no instala nada. Sin dependencias.
//
// Solo corre en una compilación de EAS (`EAS_BUILD=true`): en cualquier otro lugar sale sin hacer nada. EAS es el único
// que llama a `eas-build-pre-install` (no es un script de ciclo de vida de npm: `npm install` no lo ejecuta).
// `NPM_DE_EAS_URL` cambia solo la dirección de descarga (las pruebas usan un servidor local); la suma no se puede cambiar.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NPM_SHA512, NPM_VERSION, sumaSha512, urlDelTarball } from "./npm-de-eas-logica.mjs";

async function main() {
  if (process.env.EAS_BUILD !== "true") {
    console.log("npm-de-eas: fuera de EAS, no se instala npm.");
    return;
  }
  if (process.env.EAS_BUILD_RUNNER === "local-build-plugin") {
    console.log("npm-de-eas: compilación local de EAS, no se instala npm en este equipo.");
    return;
  }

  const url = process.env.NPM_DE_EAS_URL ?? urlDelTarball();
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se pudo bajar ${url}: HTTP ${respuesta.status}`);
  const contenido = new Uint8Array(await respuesta.arrayBuffer());

  const suma = sumaSha512(contenido);
  if (suma !== NPM_SHA512) {
    throw new Error(`La suma SHA-512 del tarball de npm no coincide: esperada ${NPM_SHA512}, obtenida ${suma}.`);
  }

  // Como en el control, se instala desde una carpeta fuera del proyecto: no lee movil/.npmrc (que el npm de EAS no entiende).
  const carpeta = mkdtempSync(join(tmpdir(), "npm-de-eas-"));
  try {
    const archivo = join(carpeta, `npm-${NPM_VERSION}.tgz`);
    writeFileSync(archivo, contenido);
    execFileSync("npm", ["install", "--global", archivo], { cwd: carpeta, stdio: "inherit" });
    const instalada = execFileSync("npm", ["--version"], { cwd: carpeta, encoding: "utf8" }).trim();
    if (instalada !== NPM_VERSION) throw new Error(`Se esperaba npm ${NPM_VERSION} y quedó ${instalada}.`);
    console.log(`npm-de-eas: npm ${instalada} instalado (SHA-512 verificado).`);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`npm-de-eas: ${error.message}`);
  process.exit(1);
});
