// Corre ESLint con la API de Node y la configuración del proyecto, en un proceso aparte: Jest no deja que ESLint cargue
// eslint.config.mjs (import() dinámico sin --experimental-vm-modules). Lee de la entrada estándar
// `{ "codigos": ["…"], "archivos": ["…"] }` y escribe en la salida los mensajes de cada código (`lintText`, como si
// fuera src/Ejemplo.tsx) y los de cada patrón de archivos (`lintFiles`).
import { ESLint } from 'eslint';

const raiz = new URL('../../', import.meta.url).pathname;
const eslint = new ESLint({ cwd: raiz, overrideConfigFile: `${raiz}eslint.config.mjs` });

let entrada = '';
for await (const trozo of process.stdin) entrada += trozo;
const { codigos = [], archivos = [] } = JSON.parse(entrada);

const deCodigos = [];
for (const codigo of codigos) {
  const [resultado] = await eslint.lintText(codigo, { filePath: `${raiz}src/Ejemplo.tsx` });
  deCodigos.push(resultado?.messages ?? []);
}
const resultados = archivos.length > 0 ? await eslint.lintFiles(archivos) : [];
const deArchivos = resultados.map((r) => ({
  archivo: r.filePath,
  mensajes: r.messages.map((m) => `${m.line} ${m.message}`),
}));
process.stdout.write(JSON.stringify({ deCodigos, deArchivos }));
