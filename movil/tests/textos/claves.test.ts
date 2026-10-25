import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { hojasDe, hojasDeLaPlataforma } from '../../../diseno/generar-textos.mjs';
import { analizar, archivosDe, comparar } from '../../../diseno/textos/usos.mjs';

// S2 (D-160, E17-ECO 4.13, paso 51): `diseno/textos/es.json` es la única fuente de los textos de Android. Esta prueba
// reemplaza a la de paridad con `movil/src/textos.ts`:
//  - toda clave que el código usa existe en `comun` o `solo_android`, y toda clave de `comun` y `solo_android` la usa
//    alguien. Como las hojas de Android son comun + solo_android, una clave de comun que móvil no usa falla aquí y una
//    que la web no usa falla en web/tests/textos/claves: comun exige uso en las dos apps; solo_android, en móvil.
//  - ningún texto de `movil/src` está escrito fuera del módulo generado.
// Cómo se siguen los accesos a `textos` está en diseno/textos/usos.mjs (una sola copia para web y móvil).

const raiz = path.resolve(__dirname, '../..');
const json = JSON.parse(fs.readFileSync(path.join(raiz, '../diseno/textos/es.json'), 'utf8')) as Record<string, object>;
const generado = path.join(raiz, 'src/textos/es.generated.ts');
const hojas = hojasDeLaPlataforma(json, 'android').map(([ruta]) => ruta);
const archivos = archivosDe(path.join(raiz, 'src')).filter((archivo) => archivo !== generado);
const analisis = archivos.map((archivo) =>
  analizar(ts, path.relative(raiz, archivo), fs.readFileSync(archivo, 'utf8'), hojas),
);

describe('claves de textos usadas en movil/src (S2)', () => {
  it('el código solo usa textos que el análisis puede seguir', () => {
    expect(analisis.flatMap((a) => a.problemas)).toEqual([]);
  });

  it('toda clave usada existe en comun o solo_android', () => {
    expect(comparar(hojas, analisis.flatMap((a) => a.usos)).noExisten).toEqual([]);
  });

  it('toda clave de comun y solo_android la usa alguien', () => {
    expect(comparar(hojas, analisis.flatMap((a) => a.usos)).sinUso).toEqual([]);
  });

  it('encuentra usos reales (la prueba no pasa por estar vacía)', () => {
    expect(analisis.flatMap((a) => a.usos).length).toBeGreaterThan(50);
  });

  it('una clave inexistente y una sobrante se reportan', () => {
    const { usos } = analizar(
      ts,
      'x.ts',
      "import { textos } from './textos/es.generated';\nexport const v = textos.avisos.noExiste.titulo;",
      hojas,
    );
    expect(comparar(hojas, usos).noExisten).toEqual(['avisos.noExiste.titulo']);
    expect(comparar(hojas, usos).sinUso.length).toBe(hojas.length);
  });
});

// Un texto copiado a mano fuera del módulo generado es una cadena igual a un texto de es.json (o, en una plantilla,
// un trozo largo de uno). Lo que no se parece a ningún texto de es.json lo revisa ESLint (eslint.config.mjs).
const textosDeAndroid = hojasDeLaPlataforma(json, 'android').flatMap(([, hoja]) =>
  typeof hoja.texto === 'string' ? [hoja.texto] : Object.values(hoja.texto),
);

function copiasDeTextos(nombre: string, codigo: string): string[] {
  const fuente = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TSX);
  const copias: string[] = [];
  const visitar = (nodo: ts.Node) => {
    const entero = ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo) || ts.isJsxText(nodo);
    const trozo = ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo);
    if (entero || trozo) {
      const texto = nodo.text.trim();
      const copia = entero
        ? textosDeAndroid.some((t) => t === texto)
        : texto.length >= 8 && textosDeAndroid.some((t) => t.includes(texto));
      if (copia) copias.push(`${nombre}:${fuente.getLineAndCharacterOfPosition(nodo.getStart()).line + 1} «${texto}»`);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return copias;
}

describe('ningún texto de movil/src está fuera del módulo generado', () => {
  it('el código no copia un texto de es.json', () => {
    const copias = archivos.flatMap((archivo) =>
      copiasDeTextos(path.relative(raiz, archivo), fs.readFileSync(archivo, 'utf8')),
    );
    expect(copias).toEqual([]);
  });

  it('detecta un texto copiado en una cadena, en JSX y en una plantilla (y no una cadena cualquiera)', () => {
    const codigo = [
      "export const a = 'Cerrar sesión';",
      'export const b = <Text>Falta el correo electrónico.</Text>;',
      'export const c = `Te enviamos un enlace a ${x}. Ábrelo para confirmar tu cuenta.`;',
      "export const d = 'flex-start';",
    ].join('\n');
    // La plantilla da dos trozos: el principio y el final.
    expect(copiasDeTextos('x.tsx', codigo)).toHaveLength(4);
  });

  it('lee los textos de Android del archivo único', () => {
    expect(textosDeAndroid.length).toBeGreaterThan(50);
    expect(hojasDe(json.comun).length).toBeGreaterThan(0);
  });
});
