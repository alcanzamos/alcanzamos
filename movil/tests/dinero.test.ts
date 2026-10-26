import { formatearPesos, leerMonto, MONTO_MAXIMO } from '../src/dinero';

describe('formatearPesos', () => {
  it('muestra pesos enteros sin centavos', () => {
    expect(formatearPesos(8000000)).toBe('$80.000');
    expect(formatearPesos(120000000)).toBe('$1.200.000');
  });

  it('muestra los centavos con coma cuando no son cero', () => {
    expect(formatearPesos(12345678)).toBe('$123.456,78');
    expect(formatearPesos(5)).toBe('$0,05');
    expect(formatearPesos(150)).toBe('$1,50');
  });

  it('muestra cero', () => {
    expect(formatearPesos(0)).toBe('$0');
  });

  it('agrupa montos grandes', () => {
    expect(formatearPesos(123456789000)).toBe('$1.234.567.890');
    expect(formatearPesos(99900)).toBe('$999');
    expect(formatearPesos(100000)).toBe('$1.000');
  });

  it('pone el signo antes del peso en montos negativos', () => {
    expect(formatearPesos(-8000000)).toBe('-$80.000');
    expect(formatearPesos(-12345678)).toBe('-$123.456,78');
  });

  it('no muestra «-$0» para cero negativo', () => {
    expect(formatearPesos(-0)).toBe('$0');
  });

  it('rechaza montos que no son centavos enteros', () => {
    expect(() => formatearPesos(80.5)).toThrow(RangeError);
    expect(() => formatearPesos(Number.NaN)).toThrow(RangeError);
    expect(() => formatearPesos(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatearPesos con bigint', () => {
  it('da lo mismo que con number en lo que cabe', () => {
    expect(formatearPesos(12345678n)).toBe('$123.456,78');
    expect(formatearPesos(-8000000n)).toBe('-$80.000');
    expect(formatearPesos(0n)).toBe('$0');
  });

  it('muestra exacto un monto que un number no guarda', () => {
    expect(formatearPesos(MONTO_MAXIMO)).toBe('$92.233.720.368.547.758,07');
    expect(formatearPesos(9007199254740993n)).toBe('$90.071.992.547.409,93');
  });
});

describe('leerMonto (D-082, EXA-001)', () => {
  it.each([
    ['45.000', 4500000n],
    ['$45.000', 4500000n],
    ['  $ 45.000  ', 4500000n],
    ['45000', 4500000n],
    ['123.456,78', 12345678n],
    ['$123.456,78', 12345678n],
    ['12,5', 1250n],
    ['12,50', 1250n],
    ['12,05', 1205n],
    ['0,01', 1n],
    ['1,', 100n],
    ['1.000.000', 100000000n],
    ['007', 700n],
    ['12.500', 1250000n],
  ])('«%s» son %s centavos', (texto, centavos) => {
    expect(leerMonto(texto)).toEqual({ ok: true, centavos });
  });

  it('guarda exacto un monto de 64 bits, sin pasar por number', () => {
    expect(leerMonto('92.233.720.368.547.758,07')).toEqual({
      ok: true,
      centavos: MONTO_MAXIMO,
    });
    expect(leerMonto('90.071.992.547.409,93')).toEqual({
      ok: true,
      centavos: 9007199254740993n,
    });
    expect(leerMonto('92233720368547758')).toEqual({
      ok: true,
      centavos: 9223372036854775800n,
    });
  });

  it('rechaza lo que pasa de 2^63 − 1 centavos', () => {
    expect(leerMonto('92.233.720.368.547.758,08')).toEqual({
      ok: false,
      motivo: 'grande',
    });
    expect(leerMonto('99999999999999999999999')).toEqual({
      ok: false,
      motivo: 'grande',
    });
  });

  it('vacío o solo espacios y signo de pesos', () => {
    expect(leerMonto('')).toEqual({ ok: false, motivo: 'vacio' });
    expect(leerMonto('  $ ')).toEqual({ ok: false, motivo: 'vacio' });
  });

  it.each(['0', '0,00', '$0', '000.000', '-5', '-1.000,50'])(
    '«%s» no es mayor que cero',
    (texto) => {
      expect(leerMonto(texto)).toEqual({ ok: false, motivo: 'cero' });
    },
  );

  it.each(['12,345', '1.000,123', '12.5000', '1.2345'])(
    '«%s» tiene más de dos decimales',
    (texto) => {
      expect(leerMonto(texto)).toEqual({ ok: false, motivo: 'decimales' });
    },
  );

  it('un punto que no agrupa miles es ambiguo y da las dos lecturas', () => {
    expect(leerMonto('12.5')).toEqual({
      ok: false,
      motivo: 'ambiguo',
      miles: 1250000n,
      decimal: 1250n,
    });
    expect(leerMonto('12.50')).toMatchObject({
      motivo: 'ambiguo',
      miles: 1250000n,
      decimal: 1250n,
    });
    expect(leerMonto('$3.05')).toMatchObject({
      motivo: 'ambiguo',
      miles: 305000n,
      decimal: 305n,
    });
  });

  it.each([
    'abc',
    '12a',
    '$',
    '.',
    ',',
    ',5',
    '.5',
    '5.',
    '1.2.3',
    '1.2,5',
    '1,2,3',
    '1e5',
    '--5',
  ])('«%s» no es un monto', (texto) => {
    const lectura = leerMonto(texto);
    expect(lectura.ok).toBe(false);
    if (!lectura.ok) expect(['ilegible', 'vacio']).toContain(lectura.motivo);
  });
});
