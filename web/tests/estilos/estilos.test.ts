// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// E17-ECO 4.5 y S4 sobre las hojas CSS (ESLint solo mira TypeScript). tokens.css se excluye: es la fuente de las medidas.
const aqui = new URL("../../src/estilos/", import.meta.url);
const hojas = readdirSync(aqui)
  .filter((nombre) => nombre.endsWith(".css") && nombre !== "tokens.css")
  .map((nombre) => ({
    nombre,
    texto: readFileSync(new URL(nombre, aqui), "utf8"),
  }));

// Los comentarios y las reglas @font-face (que declaran la fuente, no la usan) no cuentan.
const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sinFontFace = (css: string) => css.replace(/@font-face\s*{[^}]*}/g, "");
const estilosDeUso = (css: string) => sinFontFace(sinComentarios(css));

describe("hojas de estilo", () => {
  it("hay hojas que revisar", () => {
    expect(hojas.length).toBeGreaterThan(0);
  });

  it.each(hojas)("$nombre no usa colores ni medidas sueltas", ({ texto }) => {
    const css = estilosDeUso(texto);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(css).not.toMatch(/\d(px|rem|em)\b/);
    expect(css).not.toMatch(/--paleta-/);
  });

  it.each(hojas)("$nombre no activa ss02 ni dominios fijos", ({ texto }) => {
    const css = sinComentarios(texto);
    expect(css).not.toMatch(/ss02/i);
    expect(css).not.toMatch(/font-feature-settings/);
    expect(css).not.toMatch(/https?:\/\//);
  });
});
