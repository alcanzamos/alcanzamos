// Versión de npm que instala el paso previo de EAS (US-48) y la suma que debe tener su tarball. Los valores son los de
// `.azure-pipelines/plantillas/pasos/node.yml` (el control): cambiar uno obliga a cambiar el otro, y
// `tests/compilacionEas.test.ts` compara los dos archivos.
import { createHash } from "node:crypto";

export const NPM_VERSION = "12.2.1";

// SHA-512 del tarball de npm 12.2.1, igual al dist.integrity de https://registry.npmjs.org/npm/12.2.1 (en hexadecimal).
export const NPM_SHA512 =
  "6ca0a6151553fc107e60f1186d9c10d57508dcde6de31292a54d4cc4e8e8ef3de25b3281274657442d7115d10df930bb3794ddcb0681cdfd9d317189abf7b63d";

export function urlDelTarball(version = NPM_VERSION) {
  return `https://registry.npmjs.org/npm/-/npm-${version}.tgz`;
}

export function sumaSha512(contenido) {
  return createHash("sha512").update(contenido).digest("hex");
}
