import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

// PARCHE TEMPORAL de D-156 (3a), regla 4.13 de E17-ECO (paso 51): hasta que exista el archivo único de textos de
// `diseno/` (D-156 (3b)), un texto que está en `web/src/textos.ts` y en `movil/src/textos.ts` con la misma ruta de
// claves debe ser idéntico. Los textos que solo existen en un lado (p. ej. los de Android) se permiten: se listan
// pero no hacen fallar la prueba. Cuando llegue (3b) esta prueba se reemplaza por la del archivo único.
//
// No se importa `web/src/textos.ts` en Jest porque `erroresDeCampo`, `correo` y `contrasenaNueva` no se exportan y
// `web/` no se puede tocar. Los dos archivos se leen con el compilador de TypeScript (devDependency) y se evalúan sus
// objetos literales, sin ejecutar nada: es determinista y cubre lo exportado y lo que no.

type Textos = Map<string, string>;

const raiz = path.resolve(__dirname, '../..');

function aplanar(
  objeto: ts.ObjectLiteralExpression,
  nombres: Map<string, ts.ObjectLiteralExpression>,
  prefijo: string,
  salida: Textos,
) {
  for (const propiedad of objeto.properties) {
    if (ts.isSpreadAssignment(propiedad)) {
      const origen = ts.isIdentifier(propiedad.expression) ? nombres.get(propiedad.expression.text) : undefined;
      if (!origen) throw new Error(`Spread que no se puede resolver: ${propiedad.expression.getText()}`);
      aplanar(origen, nombres, prefijo, salida);
      continue;
    }
    if (!ts.isPropertyAssignment(propiedad) && !ts.isShorthandPropertyAssignment(propiedad))
      throw new Error(`Propiedad no soportada: ${propiedad.getText()}`);
    const clave = propiedad.name.getText().replace(/^['"]|['"]$/g, '');
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    let valor: ts.Expression | undefined = ts.isShorthandPropertyAssignment(propiedad)
      ? nombres.get(propiedad.name.text)
      : propiedad.initializer;
    if (!valor) throw new Error(`Valor que no se puede resolver: ${propiedad.getText()}`);
    while (ts.isAsExpression(valor) || ts.isSatisfiesExpression(valor)) valor = valor.expression;
    if (ts.isObjectLiteralExpression(valor)) aplanar(valor, nombres, ruta, salida);
    else if (ts.isStringLiteralLike(valor)) salida.set(ruta, valor.text);
    else throw new Error(`Valor no soportado en ${ruta}: ${valor.getText()}`);
  }
}

function leerTextos(archivo: string): Textos {
  const fuente = ts.createSourceFile(archivo, fs.readFileSync(archivo, 'utf8'), ts.ScriptTarget.ES2023, true);
  const nombres = new Map<string, ts.ObjectLiteralExpression>();
  const salida: Textos = new Map();
  for (const sentencia of fuente.statements) {
    if (!ts.isVariableStatement(sentencia)) continue;
    for (const declaracion of sentencia.declarationList.declarations) {
      let valor = declaracion.initializer;
      while (valor && (ts.isAsExpression(valor) || ts.isSatisfiesExpression(valor))) valor = valor.expression;
      if (!valor || !ts.isObjectLiteralExpression(valor) || !ts.isIdentifier(declaracion.name)) continue;
      nombres.set(declaracion.name.text, valor);
      aplanar(valor, nombres, declaracion.name.text, salida);
    }
  }
  return salida;
}

const web = leerTextos(path.join(raiz, 'web/src/textos.ts'));
const movil = leerTextos(path.join(raiz, 'movil/src/textos.ts'));

describe('paridad de textos entre web y móvil (D-156 (3a), E17-ECO 4.13)', () => {
  it('lee textos de los dos lados', () => {
    expect(web.size).toBeGreaterThan(0);
    expect(movil.size).toBeGreaterThan(0);
  });

  it('todo texto común tiene el mismo valor', () => {
    const distintos = [...movil.keys()]
      .filter((ruta) => web.has(ruta) && web.get(ruta) !== movil.get(ruta))
      .map((ruta) => `${ruta}\n  web:   ${web.get(ruta)}\n  móvil: ${movil.get(ruta)}`);
    expect(distintos).toEqual([]);
  });

  it('lista los textos de un solo lado sin fallar (los de Android se permiten)', () => {
    const soloWeb = [...web.keys()].filter((ruta) => !movil.has(ruta));
    const soloMovil = [...movil.keys()].filter((ruta) => !web.has(ruta));
    if (soloWeb.length > 0) console.info(`Solo en web (${soloWeb.length}):\n  ${soloWeb.join('\n  ')}`);
    if (soloMovil.length > 0) console.info(`Solo en móvil (${soloMovil.length}):\n  ${soloMovil.join('\n  ')}`);
    expect(soloWeb.length + soloMovil.length).toBeGreaterThanOrEqual(0);
  });
});
