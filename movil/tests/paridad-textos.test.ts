import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

// Regla 4.13 de E17-ECO (paso 51), D-160: `diseno/textos/es.json` es la única fuente de los textos de interfaz.
// Mientras `movil/src/textos.ts` siga con sus propias cadenas (hasta que lo reemplace el módulo generado desde el
// archivo único), esta prueba comprueba que cada texto de `movil/` está en `comun` o en `solo_android` con el mismo
// valor, y que cada texto de `comun` que `movil/` ya tiene es idéntico. Los de `comun` que `movil/` todavía no tiene
// (p. ej. el recuento de PN-72) se listan sin fallar.
//
// `movil/src/textos.ts` se lee con el compilador de TypeScript (devDependency) y se evalúan sus objetos literales, sin
// ejecutar nada. Los `...spread` y las propiedades abreviadas se saltan: repiten textos que ya se leen donde se declaran.

type Textos = Map<string, string>;

const raiz = path.resolve(__dirname, '../..');

function aplanar(objeto: ts.ObjectLiteralExpression, prefijo: string, salida: Textos) {
  for (const propiedad of objeto.properties) {
    if (ts.isSpreadAssignment(propiedad) || ts.isShorthandPropertyAssignment(propiedad)) continue;
    if (!ts.isPropertyAssignment(propiedad)) throw new Error(`Propiedad no soportada: ${propiedad.getText()}`);
    const clave = propiedad.name.getText().replace(/^['"]|['"]$/g, '');
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    let valor: ts.Expression = propiedad.initializer;
    while (ts.isAsExpression(valor) || ts.isSatisfiesExpression(valor)) valor = valor.expression;
    if (ts.isObjectLiteralExpression(valor)) aplanar(valor, ruta, salida);
    else if (ts.isStringLiteralLike(valor)) {
      // `tipo` (informacion, atencion, logro) es la clase del aviso, no un texto.
      if (clave !== 'tipo') salida.set(ruta, valor.text);
    } else throw new Error(`Valor no soportado en ${ruta}: ${valor.getText()}`);
  }
}

function leerTextos(archivo: string): Textos {
  const fuente = ts.createSourceFile(archivo, fs.readFileSync(archivo, 'utf8'), ts.ScriptTarget.ES2023, true);
  const salida: Textos = new Map();
  for (const sentencia of fuente.statements) {
    if (!ts.isVariableStatement(sentencia)) continue;
    for (const declaracion of sentencia.declarationList.declarations) {
      let valor = declaracion.initializer;
      while (valor && (ts.isAsExpression(valor) || ts.isSatisfiesExpression(valor))) valor = valor.expression;
      if (!valor || !ts.isObjectLiteralExpression(valor) || !ts.isIdentifier(declaracion.name)) continue;
      aplanar(valor, declaracion.name.text, salida);
    }
  }
  return salida;
}

type Hoja = { texto: string | { one: string; other: string }; e14: string };
type Nodo = Hoja | { [clave: string]: Nodo };

// Una hoja de es.json es un objeto con `texto` (README de diseno/textos/). Un plural no existe en `movil/` todavía.
function leerJson(seccion: Record<string, Nodo>, prefijo = '', salida: Textos = new Map()): Textos {
  for (const [clave, nodo] of Object.entries(seccion)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    if ('texto' in nodo && 'e14' in nodo) {
      salida.set(ruta, typeof nodo.texto === 'string' ? nodo.texto : JSON.stringify(nodo.texto));
    } else leerJson(nodo as Record<string, Nodo>, ruta, salida);
  }
  return salida;
}

const json = JSON.parse(fs.readFileSync(path.join(raiz, 'diseno/textos/es.json'), 'utf8')) as Record<
  'comun' | 'solo_android' | 'solo_web',
  Record<string, Nodo>
>;
const comun = leerJson(json.comun);
const soloAndroid = leerJson(json.solo_android);
const movil = leerTextos(path.join(raiz, 'movil/src/textos.ts'));

describe('textos de movil contra diseno/textos/es.json (D-160, E17-ECO 4.13)', () => {
  it('lee textos de los dos lados', () => {
    expect(comun.size).toBeGreaterThan(0);
    expect(movil.size).toBeGreaterThan(0);
  });

  it('todo texto de comun que movil ya tiene es idéntico', () => {
    const distintos = [...comun.keys()]
      .filter((ruta) => movil.has(ruta) && movil.get(ruta) !== comun.get(ruta))
      .map((ruta) => `${ruta}\n  es.json: ${comun.get(ruta)}\n  móvil:   ${movil.get(ruta)}`);
    expect(distintos).toEqual([]);
  });

  it('todo texto de movil está en comun o en solo_android, con el mismo valor', () => {
    const fuera = [...movil.keys()]
      .filter((ruta) => (comun.get(ruta) ?? soloAndroid.get(ruta)) !== movil.get(ruta))
      .map((ruta) => `${ruta}\n  móvil:   ${movil.get(ruta)}\n  es.json: ${comun.get(ruta) ?? soloAndroid.get(ruta)}`);
    expect(fuera).toEqual([]);
  });

  it('lista los textos de comun que movil todavía no tiene, sin fallar', () => {
    const faltan = [...comun.keys()].filter((ruta) => !movil.has(ruta));
    if (faltan.length > 0) console.info(`En comun y no en móvil (${faltan.length}):\n  ${faltan.join('\n  ')}`);
    expect(faltan.length).toBeGreaterThanOrEqual(0);
  });
});
