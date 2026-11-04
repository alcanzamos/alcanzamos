// Corre ESLint 10 con la API de Node y la configuración del proyecto, en un proceso aparte (ver eslint-nodo.mjs), para
// tests/eslint/accesibilidad.test.ts (D-182). Escribe en la salida `{ activas, resultados }`: las reglas activas
// (nivel error) de eslint-plugin-react-native-a11y leídas de la configuración resuelta, y por cada fixture de
// tests/eslint/fixtures-a11y/ los ids de regla que reportó como error al lintearlo como si fuera src/Fixture.tsx.
import { readdirSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';

const raiz = new URL('../../', import.meta.url).pathname;
const carpeta = `${raiz}tests/eslint/fixtures-a11y/`;
const PREFIJO = 'react-native-a11y/';
const eslint = new ESLint({ cwd: raiz, overrideConfigFile: `${raiz}eslint.config.mjs` });

const config = await eslint.calculateConfigForFile(`${raiz}src/Ejemplo.tsx`);
const activas = Object.entries(config.rules ?? {})
  .filter(([id]) => id.startsWith(PREFIJO))
  .filter(([, valor]) => [2, 'error'].includes(Array.isArray(valor) ? valor[0] : valor))
  .map(([id]) => id.slice(PREFIJO.length))
  .sort();

const resultados = {};
for (const nombre of readdirSync(carpeta).filter((n) => n.endsWith('.jsx')).sort()) {
  const [resultado] = await eslint.lintText(readFileSync(`${carpeta}${nombre}`, 'utf8'), {
    filePath: `${raiz}src/Fixture.tsx`,
  });
  resultados[nombre.slice(0, -'.jsx'.length)] = (resultado?.messages ?? [])
    .filter((m) => m.severity === 2 && m.ruleId !== null)
    .map((m) => m.ruleId);
}
process.stdout.write(JSON.stringify({ activas, resultados }));
