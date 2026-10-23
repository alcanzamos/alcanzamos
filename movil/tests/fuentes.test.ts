import { archivosDeFuentes, estiloDeTipografia, familiaCargada } from '../src/fuentes';
import { tokens } from '../src/tokens/tokens.generated';

describe('familiaCargada', () => {
  it('elige el archivo por familia y peso, sin espacios en el nombre', () => {
    expect(familiaCargada('Figtree', '600')).toBe('Figtree-SemiBold');
    expect(familiaCargada('Figtree', '700')).toBe('Figtree-Bold');
    expect(familiaCargada('Atkinson Hyperlegible Next', '400')).toBe('AtkinsonHyperlegibleNext-Regular');
    expect(familiaCargada('Atkinson Hyperlegible Next', '700')).toBe('AtkinsonHyperlegibleNext-Bold');
  });

  it('falla con el nombre que no se cargó, en vez de caer en otra fuente', () => {
    expect(() => familiaCargada('Figtree', '400')).toThrow('Fuente no cargada: Figtree-Regular');
    expect(() => familiaCargada('Roboto', '400')).toThrow('Fuente no cargada: Roboto-Regular');
  });

  it('falla con un peso que no tiene archivo', () => {
    expect(() => familiaCargada('Figtree', '900')).toThrow('Fuente no cargada: Figtree-undefined');
  });
});

describe('estiloDeTipografia', () => {
  it('arma el estilo de React Native con los valores del token', () => {
    expect(estiloDeTipografia('cuerpo')).toEqual({
      fontFamily: 'AtkinsonHyperlegibleNext-Regular',
      fontSize: tokens.tipografia.cuerpo.fontSize,
      lineHeight: tokens.tipografia.cuerpo.lineHeight,
      letterSpacing: tokens.tipografia.cuerpo.letterSpacing,
    });
  });

  it('todo token de tipografía tiene su archivo de fuente cargado', () => {
    for (const nombre of Object.keys(tokens.tipografia) as (keyof typeof tokens.tipografia)[]) {
      const { fontFamily } = estiloDeTipografia(nombre);
      expect(Object.keys(archivosDeFuentes)).toContain(fontFamily);
    }
  });
});

describe('archivosDeFuentes', () => {
  it('trae los cinco archivos de las dos familias', () => {
    expect(Object.keys(archivosDeFuentes).sort()).toEqual([
      'AtkinsonHyperlegibleNext-Bold',
      'AtkinsonHyperlegibleNext-Regular',
      'AtkinsonHyperlegibleNext-SemiBold',
      'Figtree-Bold',
      'Figtree-SemiBold',
    ]);
    for (const archivo of Object.values(archivosDeFuentes)) expect(archivo).toBeDefined();
  });
});
