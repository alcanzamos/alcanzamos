// @vitest-environment node
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// D-162 (US-59, S2): la regla de web/eslint.config.js que impide textos sueltos en JSX hace lo mismo que
// `react/jsx-no-literals` con `noStrings: true` (sin instalar el complemento). Esta prueba corre ESLint de verdad con
// la configuración del proyecto: lo que DEBE reportar, lo que NO debe reportar, y que el código real pasa.
const raiz = fileURLToPath(new URL("../../", import.meta.url));
const eslint = new ESLint({
  cwd: raiz,
  overrideConfigFile: `${raiz}eslint.config.js`,
});

async function hallazgos(codigo: string) {
  const [resultado] = await eslint.lintText(codigo, {
    filePath: `${raiz}src/Ejemplo.tsx`,
  });
  return (resultado?.messages ?? []).filter((m) =>
    m.message.startsWith("Texto suelto"),
  );
}

const envolver = (jsx: string) =>
  `export const Ejemplo = ({ cond, x }: { cond: boolean; x: string }) => ${jsx};\n`;

describe("regla de textos sueltos en JSX (D-162)", () => {
  describe("reporta", () => {
    it.each([
      ["texto como hijo", "<p>Hola</p>"],
      ["texto con tildes y signos", "<p>¿Olvidaste tu contraseña?</p>"],
      ["texto junto a otro elemento", "<p>Hola <b>{x}</b></p>"],
      ["texto en un fragmento", "<>Hola</>"],
      ["texto en varias líneas", "<p>\n  Hola\n  mundo\n</p>"],
      ["cadena en una expresión hija", '<p>{"Hola"}</p>'],
      ["plantilla en una expresión hija", "<p>{`Hola ${x}`}</p>"],
      ["plantilla sin datos en una expresión hija", "<p>{`Hola`}</p>"],
      ["cadena en un ternario hijo", '<p>{cond ? "Sí" : x}</p>'],
      ["cadena en un && hijo", '<p>{cond && "Hola"}</p>'],
      ["cadena en un fragmento con expresión", '<>{"Hola"}</>'],
      ["aria-label", '<a aria-label="Atrás" href="/">{x}</a>'],
      ["title", '<a title="Atrás" href="/">{x}</a>'],
      ["alt", '<img alt="Logo" src={x} />'],
      ["placeholder", '<input placeholder="Correo" />'],
      ["titulo de un componente", '<Pagina titulo="Hola" />'],
      ["etiqueta de un componente", '<Campo etiqueta="Correo" />'],
      ["ayuda de un componente", '<Campo ayuda="Usa una frase" />'],
      ["texto de un componente", '<Casilla texto="Soy mayor" />'],
      ["error de un componente", '<Campo error="Falta" />'],
      ["mensaje de un componente", '<Aviso mensaje="Hola" />'],
      ["propiedad con cadena entre llaves", '<img alt={"Logo"} src={x} />'],
      ["propiedad con plantilla", "<img alt={`Logo ${x}`} src={x} />"],
      ["propiedad con ternario", '<a aria-label={cond ? "Ver" : "Ocultar"} />'],
      ["propiedad con ||", '<a title={x || "Sin título"} />'],
    ])("%s", async (_caso, jsx) => {
      expect((await hallazgos(envolver(jsx))).length).toBeGreaterThan(0);
    });

    it("dice dónde está el texto", async () => {
      const [primero] = await hallazgos(envolver("<p>Hola</p>"));
      expect(primero?.ruleId).toBe("no-restricted-syntax");
      expect(primero?.message).toMatch(/es\.generated\.ts/);
    });
  });

  describe("no reporta", () => {
    it.each([
      ["un dato como hijo", "<p>{x}</p>"],
      ["espacio en blanco entre elementos", "<p> <b>{x}</b> </p>"],
      ["un salto de línea entre elementos", "<p>\n  <b>{x}</b>\n</p>"],
      ["un espacio entre llaves", '<p>{x}{" "}{x}</p>'],
      ["un número", "<p>{1}</p>"],
      ["un comentario JSX", "<p>{/* nota */}</p>"],
      ["un elemento condicional", "<p>{cond && <b>{x}</b>}</p>"],
      ["className", '<p className="titulo">{x}</p>'],
      ["className con plantilla", "<p className={`a${x}`}>{x}</p>"],
      ["type", '<button type="submit">{x}</button>'],
      ["id y name", '<input id="correo" name="correo" />'],
      ["href", '<a href="/entrar">{x}</a>'],
      ["autoComplete", '<input autoComplete="email" />'],
      ["role y aria-live", '<div role="status" aria-live="polite">{x}</div>'],
      ["aria-hidden", '<svg aria-hidden="true" />'],
      ["data-*", '<div data-prueba="Hola">{x}</div>'],
      [
        "tipo y variante de un componente",
        '<Boton tipo="submit" variante="texto">{x}</Boton>',
      ],
      ["alt vacío (imagen decorativa)", '<img alt="" src={x} />'],
      ["propiedades de texto con datos", "<a aria-label={x} title={x}>{x}</a>"],
      ["propiedad con ternario de datos", "<a title={cond ? x : undefined} />"],
    ])("%s", async (_caso, jsx) => {
      expect(await hallazgos(envolver(jsx))).toEqual([]);
    });

    it("una cadena fuera de JSX", async () => {
      expect(
        await hallazgos(
          'export const mensaje = "Hola";\nconsole.info("Hola");\n',
        ),
      ).toEqual([]);
    });
  });

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
