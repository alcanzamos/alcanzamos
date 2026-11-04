// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// D-182 (3): ESLint 10 con eslint-plugin-jsx-a11y. Que `npm run lint` pase sin errores no prueba que las reglas de
// accesibilidad sigan vivas, así que esta prueba corre ESLint 10 de verdad (API de Node) con la configuración del
// proyecto y exige que CADA regla de jsx-a11y activa reporte un error en su fixture (tests/eslint/fixtures-a11y/<regla>.jsx).
// Los fixtures son .jsx para que tsc no los revise; se leen como texto y se lintean como src/Fixture.tsx.
// Las reglas activas se leen de la configuración resuelta: una regla nueva sin fixture hace fallar la prueba.
const raiz = fileURLToPath(new URL("../../", import.meta.url));
const carpeta = new URL("./fixtures-a11y/", import.meta.url);
const eslint = new ESLint({
  cwd: raiz,
  overrideConfigFile: `${raiz}eslint.config.js`,
});

const PREFIJO = "jsx-a11y/";

async function reglasActivas() {
  const config = await eslint.calculateConfigForFile(`${raiz}src/Ejemplo.tsx`);
  return Object.entries(config.rules ?? {})
    .filter(([id]) => id.startsWith(PREFIJO))
    .filter(([, valor]) => {
      const nivel = Array.isArray(valor) ? valor[0] : valor;
      return nivel === 2 || nivel === "error";
    })
    .map(([id]) => id.slice(PREFIJO.length))
    .sort();
}

const fixtures = readdirSync(carpeta)
  .filter((nombre) => nombre.endsWith(".jsx"))
  .map((nombre) => nombre.slice(0, -".jsx".length))
  .sort();

describe("reglas de accesibilidad de jsx-a11y con ESLint 10 (D-182)", () => {
  it("hay fixtures y reglas activas", async () => {
    expect((await reglasActivas()).length).toBeGreaterThan(20);
  });

  it("cada regla activa tiene su fixture, y cada fixture una regla activa", async () => {
    expect(fixtures).toEqual(await reglasActivas());
  });

  it("cada fixture reporta un error de su regla", async () => {
    const sinError: string[] = [];
    for (const regla of await reglasActivas()) {
      const codigo = readFileSync(new URL(`${regla}.jsx`, carpeta), "utf8");
      const [resultado] = await eslint.lintText(codigo, {
        filePath: `${raiz}src/Fixture.tsx`,
      });
      const errores = (resultado?.messages ?? []).filter(
        (m) => m.ruleId === `${PREFIJO}${regla}` && m.severity === 2,
      );
      if (errores.length === 0) sinError.push(regla);
    }
    expect(sinError).toEqual([]);
  }, 60_000);

  it("el código real de src/ pasa ESLint sin hallazgos", async () => {
    const resultados = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
    expect(resultados.length).toBeGreaterThan(20);
    expect(
      resultados.flatMap((r) =>
        r.messages.map((m) => `${r.filePath}:${m.line} ${m.message}`),
      ),
    ).toEqual([]);
  }, 60_000);
});
