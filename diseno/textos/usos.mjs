// Análisis de los usos de `textos` en el código de una app (US-59, S2). Lo comparten las pruebas de claves de web
// (Vitest) y de móvil (Jest): una sola copia. No importa `typescript`: lo recibe, para usar el de la app que lo prueba.
//
// Cómo se cuentan los usos: se leen con el compilador de TypeScript los archivos de la app menos el generado, y en
// cada uno se siguen las cadenas de acceso que parten de `textos` (la constante importada de es.generated):
//  - `textos.avisos.sinConexion.titulo` usa esa hoja; una cadena que termina en un grupo (`...textos.correo`,
//    `correo: textos.correo`) usa todas las hojas del grupo; una que sigue más allá de una hoja (`.one`) usa la hoja.
//  - `const a = textos.avisos;` crea un alias en ese archivo y `a.sinConexion.titulo` se cuenta desde `textos.avisos`.
//  - No se admiten usos que el análisis no puede seguir (`textos[x]`, `const { avisos } = textos`, pasar `textos`
//    entero): se reportan con el lugar, y se reescriben con acceso por punto.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Los archivos .ts y .tsx de una carpeta, a cualquier profundidad. */
export function archivosDe(carpeta) {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? archivosDe(join(carpeta, e.name))
      : /\.(ts|tsx)$/.test(e.name)
        ? [join(carpeta, e.name)]
        : [],
  );
}

const empiezaPor = (ruta, prefijo) => prefijo.every((p, i) => ruta[i] === p);

/** Compara los usos con las hojas: claves que no existen y hojas que nadie usa. */
export function comparar(hojas, usos) {
  const nombres = new Set(hojas.map((h) => h.join('.')));
  const noExisten = usos
    .filter((u) => !hojas.some((h) => empiezaPor(h, u) || empiezaPor(u, h)) && !nombres.has(u.join('.')))
    .map((u) => u.join('.'));
  const sinUso = hojas
    .filter((h) => !usos.some((u) => empiezaPor(h, u) || empiezaPor(u, h)))
    .map((h) => h.join('.'));
  return { noExisten: [...new Set(noExisten)], sinUso };
}

/** Las cadenas de acceso a `textos` de un archivo, con los alias de una sola asignación. */
export function analizar(ts, nombre, codigo, hojas) {
  const fuente = ts.createSourceFile(
    nombre,
    codigo,
    ts.ScriptTarget.ES2023,
    true,
    nombre.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const importa = fuente.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text.endsWith('es.generated') &&
      s.importClause?.namedBindings &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((el) => (el.propertyName ?? el.name).text === 'textos'),
  );
  const usos = [];
  const problemas = [];
  if (!importa) return { usos, problemas };

  const donde = (n) => `${nombre}:${fuente.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const raices = new Map([['textos', []]]);

  // Sube desde un identificador por sus accesos y devuelve la cadena y el nodo donde termina.
  function cadena(id) {
    const ruta = [...(raices.get(id.text) ?? [])];
    let nodo = id;
    for (;;) {
      const padre = nodo.parent;
      if (ts.isPropertyAccessExpression(padre) && padre.expression === nodo) {
        ruta.push(padre.name.text);
      } else if (ts.isElementAccessExpression(padre) && padre.expression === nodo) {
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

  const exportada = (d) =>
    ts.isVariableDeclarationList(d.parent) &&
    ts.isVariableStatement(d.parent.parent) &&
    (ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Export) !== 0;

  // Los alias se descubren hasta que no aparezca ninguno nuevo.
  let nuevo = true;
  while (nuevo) {
    nuevo = false;
    const visitar = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && !raices.has(n.name.text)) {
        let e = n.initializer;
        while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
        let base = e;
        while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) base = base.expression;
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

  const visitar = (n) => {
    if (
      ts.isIdentifier(n) &&
      raices.has(n.text) &&
      !ts.isImportSpecifier(n.parent) &&
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
          hojas.some((h) => h.length > ruta.length && ruta.every((p, i) => h[i] === p));
        if (ruta.length === 0 && n.text === 'textos') {
          problemas.push(`${donde(n)}: «textos» se usa sin acceso por punto`);
        } else if (!esAlias) usos.push(ruta);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { usos, problemas };
}
