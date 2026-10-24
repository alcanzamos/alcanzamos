// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { hojasDeLaPlataforma } from "../../../diseno/generar-textos.mjs";
import {
  analizar as analizarCon,
  archivosDe,
  comparar,
} from "../../../diseno/textos/usos.mjs";

// S2 (D-160, E17-ECO 4.13): una clave usada que no existe falla (`tsc` ya lo hace; esta prueba lo repite sobre el
// código fuente) y una clave de comun o solo_web que nadie usa también falla. Como las hojas de la web son comun +
// solo_web, una clave de comun que la web no usa falla aquí y una que móvil no usa falla en movil/tests/textos/claves:
// comun exige uso en las dos apps; solo_web, en la web (diseno/textos/README.md).
// El análisis (cómo se siguen los accesos a `textos`, los alias y lo que no se admite) vive en
// diseno/textos/usos.mjs, una sola copia para web y móvil. Los textos de solo_android no se usan en la web: usarlos
// es una clave que no existe aquí.

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const generado = join(raiz, "src/textos/es.generated.ts");

const hojasWeb = hojasDeLaPlataforma(
  JSON.parse(readFileSync(join(raiz, "../diseno/textos/es.json"), "utf8")),
  "web",
).map(([ruta]) => ruta);

const analizar = (nombre: string, codigo: string, hojas: string[][]) =>
  analizarCon(ts, nombre, codigo, hojas);

describe("claves de textos usadas en web/src (S2)", () => {
  const analisis = archivosDe(join(raiz, "src"))
    .filter((a) => a !== generado)
    .map((a) => analizar(relative(raiz, a), readFileSync(a, "utf8"), hojasWeb));

  it("el código solo usa textos que el análisis puede seguir", () => {
    expect(analisis.flatMap((a) => a.problemas)).toEqual([]);
  });

  it("toda clave usada existe en comun o solo_web", () => {
    const { noExisten } = comparar(
      hojasWeb,
      analisis.flatMap((a) => a.usos),
    );
    expect(noExisten).toEqual([]);
  });

  it("toda clave de comun y solo_web la usa alguien", () => {
    const { sinUso } = comparar(
      hojasWeb,
      analisis.flatMap((a) => a.usos),
    );
    expect(sinUso).toEqual([]);
  });

  it("encuentra usos reales (la prueba no pasa por estar vacía)", () => {
    expect(analisis.flatMap((a) => a.usos).length).toBeGreaterThan(50);
  });
});

describe("el análisis de usos", () => {
  const importar = 'import { textos } from "./textos/es.generated";\n';
  const hojas = [
    ["avisos", "a", "titulo"],
    ["avisos", "b", "titulo"],
    ["grupo", "uno"],
    ["grupo", "dos"],
    ["plural"],
  ];

  it("cuenta el acceso por punto, por corchetes con texto fijo y el que sigue más allá de una hoja", () => {
    const { usos, problemas } = analizar(
      "x.ts",
      `${importar}export const v = [textos.avisos.a.titulo, textos["avisos"]["b"].titulo, textos.plural.one];`,
      hojas,
    );
    expect(problemas).toEqual([]);
    expect(comparar(hojas, usos).sinUso).toEqual(["grupo.uno", "grupo.dos"]);
  });

  it("un grupo usado entero cuenta todas sus hojas", () => {
    const { usos } = analizar(
      "x.ts",
      `${importar}export const v = { ...textos.grupo };`,
      hojas,
    );
    expect(comparar(hojas, usos).sinUso).toEqual([
      "avisos.a.titulo",
      "avisos.b.titulo",
      "plural",
    ]);
  });

  it("sigue un alias y no cuenta como uso el alias solo", () => {
    const { usos } = analizar(
      "x.ts",
      `${importar}const a = textos.avisos;\nexport const v = a.a.titulo;`,
      hojas,
    );
    expect(usos).toEqual([["avisos", "a", "titulo"]]);
    expect(comparar(hojas, usos).sinUso).toContain("avisos.b.titulo");
  });

  it("una clave que no existe se reporta", () => {
    const { usos } = analizar(
      "x.ts",
      `${importar}export const v = textos.avisos.c.titulo;`,
      hojas,
    );
    expect(comparar(hojas, usos).noExisten).toEqual(["avisos.c.titulo"]);
  });

  it("falla con lo que no puede seguir", () => {
    const dinamico = analizar(
      "x.ts",
      `${importar}export const v = (k: string) => textos[k];`,
      hojas,
    );
    expect(dinamico.problemas[0]).toMatch(/acceso dinámico/);
    const entero = analizar(
      "y.ts",
      `${importar}export const v = JSON.stringify(textos);`,
      hojas,
    );
    expect(entero.problemas[0]).toMatch(/sin acceso por punto/);
  });

  it("ignora un archivo que no importa textos", () => {
    expect(
      analizar("z.ts", "const textos = { a: 1 }; textos.a;", hojas).usos,
    ).toEqual([]);
  });
});
