import * as fs from 'fs';
import * as path from 'path';
import { generarDesdeArchivos, hojasDeLaPlataforma, marcadoresDe } from '../../../diseno/generar-textos.mjs';
import { formatear, plural, textos, type Datos, type Marcadores } from '../../src/textos/es.generated';

// S3 y S4 (D-160) en Android: los marcadores `{nombre}` se pasan exactos y los plurales usan `one` y `other`. El código
// de `formatear` y `plural` es el mismo de la web (diseno/textos/ayudas.plantilla.ts); la web prueba además el
// generador y el escaneo de es.json (web/tests/textos). `tsc --noEmit` (npm run typecheck) revisa esta carpeta: cada
// `@ts-expect-error` falla si el compilador deja de ver el error que se espera.

const raiz = path.resolve(__dirname, '../..');
const json = JSON.parse(fs.readFileSync(path.join(raiz, '../diseno/textos/es.json'), 'utf8')) as object;

describe('src/textos/es.generated.ts', () => {
  it('es lo que genera el generador (npm run textos)', () => {
    expect(fs.readFileSync(path.join(raiz, 'src/textos/es.generated.ts'), 'utf8')).toBe(generarDesdeArchivos('android'));
  });

  it('trae comun y solo_android, y nada de solo_web', () => {
    expect(textos.avisos.menorDeEdad.titulo).toBe('Esta cuenta la crea una persona adulta.');
    expect(textos.entrar.entrar).toBe('Iniciar sesión');
    expect('recuperar' in textos).toBe(false);
    expect('pagina' in textos && 'atras' in textos.pagina).toBe(false);
  });
});

describe('formatear (S3: marcadores {nombre})', () => {
  const ingresoAnterior = textos.seguridadDeLaCuenta.ingresoAnterior;

  it('pone cada dato en su marcador', () => {
    expect(formatear(textos.revisaTuCorreo.enviadoA, { correo: 'laura@ejemplo.com' })).toBe(
      'Te enviamos un enlace a laura@ejemplo.com. Ábrelo para confirmar tu cuenta.',
    );
    expect(formatear(ingresoAnterior, { fecha: '14 de mayo de 1990' })).toBe('Tu ingreso anterior fue 14 de mayo de 1990');
  });

  it('un texto sin marcadores se usa sin datos', () => {
    expect(formatear(textos.acciones.cerrarSesion)).toBe('Cerrar sesión');
  });

  it('los marcadores se leen del tipo del texto', () => {
    expectTypeOfIgual<Marcadores<typeof ingresoAnterior>, 'fecha'>();
    expectTypeOfIgual<Datos<typeof textos.revisaTuCorreo.enviadoA>, { correo: string }>();
    expect(ingresoAnterior).toMatch(/\{fecha\}/);
  });

  it('falta un marcador: error de tipo y de ejecución', () => {
    // @ts-expect-error falta el dato «fecha»
    expect(() => formatear(ingresoAnterior, {})).toThrow(/faltan \[fecha\] y sobran \[\]/);
    // @ts-expect-error faltan los datos de «{correo}»
    expect(() => formatear(textos.revisaTuCorreo.enviadoA)).toThrow(/faltan \[correo\]/);
  });

  it('sobra un dato: error de tipo y de ejecución', () => {
    // @ts-expect-error «dia» no es un marcador del texto
    expect(() => formatear(ingresoAnterior, { fecha: 'hoy', dia: 'lunes' })).toThrow(/sobran \[dia\]/);
    // @ts-expect-error un texto sin marcadores no recibe datos
    expect(() => formatear(textos.acciones.cerrarSesion, { x: 'y' })).toThrow(/sobran \[x\]/);
  });

  it('un dato con otro nombre cuenta como uno que falta y otro que sobra', () => {
    // @ts-expect-error el marcador es «correo», no «mail»
    expect(() => formatear(textos.revisaTuCorreo.enviadoA, { mail: 'laura@ejemplo.com' })).toThrow(
      /faltan \[correo\] y sobran \[mail\]/,
    );
  });

  it('cada texto de Android con marcadores pide exactamente los suyos, en ejecución', () => {
    const conMarcadores = hojasDeLaPlataforma(json, 'android').flatMap(([ruta, hoja]) =>
      typeof hoja.texto === 'string' && marcadoresDe(hoja.texto).length > 0
        ? [{ ruta: ruta.join('.'), texto: hoja.texto, nombres: marcadoresDe(hoja.texto) }]
        : [],
    );
    expect(conMarcadores.map((t) => t.ruta)).toEqual(
      expect.arrayContaining(['revisaTuCorreo.enviadoA', 'seguridadDeLaCuenta.ingresoAnterior']),
    );
    const aTexto = formatear as (texto: string, datos: Record<string, string>) => string;
    const fallos: string[] = [];
    for (const { ruta, texto, nombres } of conMarcadores) {
      const datos = Object.fromEntries(nombres.map((nombre) => [nombre, `<${nombre}>`]));
      if (/[{}]/.test(aTexto(texto, datos))) fallos.push(`${ruta}: quedó un marcador sin llenar`);
      if (!throws(() => aTexto(texto, {}), /faltan/)) fallos.push(`${ruta}: no falla si faltan datos`);
      if (!throws(() => aTexto(texto, { ...datos, de_mas: 'x' }), /sobran \[de_mas\]/)) {
        fallos.push(`${ruta}: no falla si sobra un dato`);
      }
    }
    expect(fallos).toEqual([]);
  });
});

function throws(f: () => unknown, mensaje: RegExp): boolean {
  try {
    f();
    return false;
  } catch (error) {
    return mensaje.test((error as Error).message);
  }
}

// Comprobación de tipos sin ejecución: `tsc` falla si los dos tipos no son el mismo.
function expectTypeOfIgual<A, B>(..._: [A] extends [B] ? ([B] extends [A] ? [] : [never]) : [never]) {
  return _;
}

describe('plural (S4, D-163: one y other con la regla manual del español)', () => {
  const ingresos = textos.porConfirmar.ingresos;

  it.each([
    [0, '0 ingresos'],
    [1, '1 ingreso'],
    [2, '2 ingresos'],
    [13, '13 ingresos'],
    [1000000, '1000000 ingresos'],
  ])('con %d da «%s»', (n, esperado) => {
    expect(plural(ingresos, n)).toBe(esperado);
  });

  it('solo el 1 es «one»; 0, 2 y los millones son «other»', () => {
    expect(plural(ingresos, 1)).toBe('1 ingreso');
    for (const n of [0, 2, 13, 1000000]) expect(plural(ingresos, n)).toBe(`${n} ingresos`);
  });

  it('no usa Intl.PluralRules (Hermes no la trae): ni la consulta ni la necesita', () => {
    const select = jest.spyOn(Intl.PluralRules.prototype, 'select');
    for (const n of [0, 1, 2, 13, 1000000]) plural(ingresos, n);
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
  });

  it('una forma puede no llevar {n}, y los demás marcadores se piden exactos', () => {
    expect(plural({ one: 'Un ingreso', other: '{n} ingresos' } as const, 1)).toBe('Un ingreso');
    const formas = { one: '{n} cosa de {quien}', other: '{n} cosas de {quien}' } as const;
    expect(plural(formas, 2, { quien: 'Laura' })).toBe('2 cosas de Laura');
    // @ts-expect-error falta el dato «quien»
    expect(() => plural(formas, 2)).toThrow(/faltan \[quien\]/);
  });
});
