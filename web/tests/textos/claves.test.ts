// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { hojasDeLaPlataforma } from "../../../diseno/generar-textos.mjs";

// S2 (D-160, E17-ECO 4.13): una clave usada que no existe falla (`tsc` ya lo hace; esta prueba lo repite sobre el
// código fuente) y una clave de comun o solo_web que nadie usa también falla.
//
// Cómo se cuentan los usos: se leen con el compilador de TypeScript todos los archivos de src/ menos el generado, y
// en cada uno se siguen las cadenas de acceso que parten de `textos` (la constante importada de es.generated):
//  - `textos.avisos.sinConexion.titulo` usa esa hoja; una cadena que termina en un grupo (`...textos.correo`,
//    `correo: textos.correo`) usa todas las hojas del grupo; una que sigue más allá de una hoja (`.one`) usa la hoja.
//  - `const a = textos.avisos;` crea un alias en ese archivo y `a.sinConexion.titulo` se cuenta desde `textos.avisos`.
//  - No se admiten usos que el análisis no puede seguir (`textos[x]`, `const { avisos } = textos`, pasar `textos`
//    entero): la prueba falla con el lugar, y se reescribe con acceso por punto.
// Los textos de solo_android no se usan en la web: usarlos es una clave que no existe aquí.

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const generado = join(raiz, "src/textos/es.generated.ts");

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? archivosDe(join(carpeta, e.name))
      : /\.(ts|tsx)$/.test(e.name)
        ? [join(carpeta, e.name)]
        : [],
  );
}

const hojasWeb = hojasDeLaPlataforma(
  JSON.parse(readFileSync(join(raiz, "../diseno/textos/es.json"), "utf8")),
  "web",
).map(([ruta]) => ruta);

type Analisis = { usos: string[][]; problemas: string[] };

/** Las cadenas de acceso a `textos` de un archivo, con los alias de una sola asignación. */
function analizar(nombre: string, codigo: string, hojas: string[][]): Analisis {
  const fuente = ts.createSourceFile(
    nombre,
    codigo,
    ts.ScriptTarget.ES2023,
    true,
    nombre.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const importa = fuente.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text.endsWith("es.generated") &&
      s.importClause?.namedBindings &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some(
        (el) => (el.propertyName ?? el.name).text === "textos",
      ),
  );
  const usos: string[][] = [];
  const problemas: string[] = [];
  if (!importa) return { usos, problemas };

  const donde = (n: ts.Node) =>
    `${nombre}:${fuente.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const raices = new Map<string, string[]>([["textos", []]]);

  // Sube desde un identificador por sus accesos y devuelve la cadena y el nodo donde termina.
  function cadena(id: ts.Identifier) {
    const ruta = [...(raices.get(id.text) ?? [])];
    let nodo: ts.Node = id;
    for (;;) {
      const padre: ts.Node = nodo.parent;
      if (ts.isPropertyAccessExpression(padre) && padre.expression === nodo) {
        ruta.push(padre.name.text);
      } else if (
        ts.isElementAccessExpression(padre) &&
        padre.expression === nodo
      ) {
        const arg = padre.argumentExpression;
        if (!ts.isStringLiteralLike(arg)) {
          problemas.push(`${donde(padre)}: acceso dinámico a «${id.text}»`);
          return { ruta, nodo, valido: false };
        }
        ruta.push(arg.text);
      } else return { ruta, nodo, valido: true };
      nodo = padre;
    }
  }

  const exportada = (d: ts.VariableDeclaration) =>
    ts.isVariableDeclarationList(d.parent) &&
    ts.isVariableStatement(d.parent.parent) &&
    (ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Export) !== 0;
  const esDeclaracionDeImportacion = (id: ts.Identifier) =>
    ts.isImportSpecifier(id.parent);

  // Los alias se descubren hasta que no aparezca ninguno nuevo.
  let nuevo = true;
  while (nuevo) {
    nuevo = false;
    const visitar = (n: ts.Node) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        !raices.has(n.name.text)
      ) {
        let e: ts.Expression = n.initializer;
        while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e))
          e = e.expression;
        let base = e;
        while (
          ts.isPropertyAccessExpression(base) ||
          ts.isElementAccessExpression(base)
        )
          base = base.expression;
        if (ts.isIdentifier(base) && raices.has(base.text) && e !== base) {
          const marca = problemas.length;
          const { ruta } = cadena(base);
          problemas.length = marca;
          raices.set(n.name.text, ruta);
          nuevo = true;
        }
      }
      ts.forEachChild(n, visitar);
    };
    visitar(fuente);
  }

  const visitar = (n: ts.Node) => {
    if (
      ts.isIdentifier(n) &&
      raices.has(n.text) &&
      !esDeclaracionDeImportacion(n) &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
      !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)
    ) {
      const { ruta, nodo, valido } = cadena(n);
      if (valido) {
        // `const a = textos.avisos;` solo da un nombre al grupo: no usa sus hojas. Si la declaración se exporta, o si
        // termina en una hoja, sí es un uso.
        const esAlias =
          ts.isVariableDeclaration(nodo.parent) &&
          nodo.parent.initializer === nodo &&
          ts.isIdentifier(nodo.parent.name) &&
          raices.has(nodo.parent.name.text) &&
          !exportada(nodo.parent) &&
          hojas.some(
            (h) => h.length > ruta.length && ruta.every((p, i) => h[i] === p),
          );
        if (ruta.length === 0 && n.text === "textos") {
          problemas.push(`${donde(n)}: «textos» se usa sin acceso por punto`);
        } else if (!esAlias) usos.push(ruta);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { usos, problemas };
}

/** Compara los usos con las hojas: claves que no existen y hojas que nadie usa. */
function comparar(hojas: string[][], usos: string[][]) {
  const claves = hojas.map((h) => h.join("."));
  const nombres = new Set(claves);
  const empiezaPor = (ruta: string[], prefijo: string[]) =>
    prefijo.every((p, i) => ruta[i] === p);
  const noExisten = usos
    .filter(
      (u) =>
        !hojas.some((h) => empiezaPor(h, u) || empiezaPor(u, h)) &&
        !nombres.has(u.join(".")),
    )
    .map((u) => u.join("."));
  const sinUso = hojas
    .filter((h) => !usos.some((u) => empiezaPor(h, u) || empiezaPor(u, h)))
    .map((h) => h.join("."));
  return { noExisten: [...new Set(noExisten)], sinUso };
}

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
