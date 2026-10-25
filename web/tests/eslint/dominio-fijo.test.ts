// @vitest-environment node
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// D-129: ningún literal fija el dominio de la app. Única excepción: «privacidad@alcanzamos.co» (texto legal de E14,
// D-120) en el módulo generado de textos. Esta prueba corre ESLint de verdad con la configuración del proyecto.
const raiz = fileURLToPath(new URL("../../", import.meta.url));
const eslint = new ESLint({
  cwd: raiz,
  overrideConfigFile: `${raiz}eslint.config.js`,
});

async function hallazgos(codigo: string, archivo: string) {
  const [resultado] = await eslint.lintText(codigo, {
    filePath: `${raiz}${archivo}`,
  });
  return (resultado?.messages ?? []).filter((m) =>
    m.message.startsWith("Sin dominio fijo"),
  );
}

const GENERADO = "src/textos/es.generated.ts";
const texto = (cadena: string) =>
  `export const t = ${JSON.stringify(cadena)};\n`;

describe("regla de dominio fijo (D-129) y el buzón de privacidad", () => {
  describe(`en ${GENERADO}`, () => {
    it.each([
      ["la dirección exacta", "privacidad@alcanzamos.co"],
      [
        "la dirección dentro de una frase, con punto al final",
        "Escríbele a privacidad@alcanzamos.co.",
      ],
      [
        "la dirección dentro de una frase, sin punto",
        "lo que escribes a privacidad@alcanzamos.co queda en Estados Unidos.",
      ],
    ])("admite %s", async (_caso, cadena) => {
      expect(await hallazgos(texto(cadena), GENERADO)).toEqual([]);
    });

    it.each([
      ["una dirección web", "https://app.alcanzamos.co"],
      ["otro dominio de alcanzamos.co", "app.alcanzamos.co"],
      ["otro buzón del dominio", "otro@alcanzamos.co"],
      ["el buzón con un dominio más largo", "privacidad@alcanzamos.company"],
      [
        "el buzón y una dirección web",
        "privacidad@alcanzamos.co y https://api.alcanzamos.co",
      ],
      ["localhost", "localhost:8080"],
      ["la dirección local", "127.0.0.1"],
      ["una URL cualquiera", "https://ejemplo.org"],
    ])("sigue reportando %s", async (_caso, cadena) => {
      expect((await hallazgos(texto(cadena), GENERADO)).length).toBeGreaterThan(
        0,
      );
    });
  });

  describe("en el resto de src/", () => {
    it.each([
      ["el buzón de privacidad", "privacidad@alcanzamos.co"],
      ["una dirección web", "https://app.alcanzamos.co"],
      ["alcanzamos.co", "alcanzamos.co"],
      ["localhost", "localhost"],
    ])("reporta %s", async (_caso, cadena) => {
      expect(
        (await hallazgos(texto(cadena), "src/Ejemplo.ts")).length,
      ).toBeGreaterThan(0);
    });

    it("no reporta una ruta relativa", async () => {
      expect(
        await hallazgos(texto("/api/v1/sesiones"), "src/Ejemplo.ts"),
      ).toEqual([]);
    });
  });

  it("el módulo generado real pasa", async () => {
    const resultados = await eslint.lintFiles([GENERADO]);
    expect(resultados.flatMap((r) => r.messages)).toEqual([]);
  });
});
