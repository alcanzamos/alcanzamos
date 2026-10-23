import { MAYORIA_DE_EDAD, resultadoDeEdad } from '../../src/edad/calculo';

// «Hoy» de las pruebas: 23 de octubre de 2026, a mediodía (la hora no cuenta: se compara por día del calendario).
const hoy = new Date(2026, 9, 23, 12, 0, 0);

describe('resultadoDeEdad (PN-65, corte en 18 años, D-089)', () => {
  it('el corte es de 18 años', () => {
    expect(MAYORIA_DE_EDAD).toBe(18);
  });

  it.each([
    ['cumple 18 hoy', new Date(2008, 9, 23), 'mayor'],
    ['cumple 18 hoy, medianoche', new Date(2008, 9, 23, 0, 0, 0), 'mayor'],
    ['cumple 18 hoy, a última hora del día de nacimiento', new Date(2008, 9, 23, 23, 59, 59), 'mayor'],
    ['cumplió 18 ayer', new Date(2008, 9, 22), 'mayor'],
    ['cumple 18 mañana', new Date(2008, 9, 24), 'menor'],
    ['cumple 18 en un mes', new Date(2008, 10, 23), 'menor'],
    ['cumple 18 en un año menos un día', new Date(2009, 9, 22), 'menor'],
    ['tiene 17 años y un día de diferencia con el mes', new Date(2008, 11, 1), 'menor'],
    ['nació el mismo día de este año', new Date(2026, 9, 23), 'menor'],
    ['nació ayer', new Date(2026, 9, 22), 'menor'],
    ['tiene 36 años', new Date(1990, 4, 14), 'mayor'],
    ['tiene más de 100 años', new Date(1900, 0, 1), 'mayor'],
  ] as const)('%s → %s', (_caso, nacimiento, esperado) => {
    expect(resultadoDeEdad(nacimiento, hoy)).toBe(esperado);
  });

  it.each([
    ['mañana', new Date(2026, 9, 24)],
    ['el año que viene', new Date(2027, 9, 23)],
    ['dentro de un mes', new Date(2026, 10, 23)],
  ])('una fecha que no ha pasado (%s) es «futura»', (_caso, fecha) => {
    expect(resultadoDeEdad(fecha, hoy)).toBe('futura');
  });

  it('una fecha de hoy no es futura, es de un recién nacido', () => {
    expect(resultadoDeEdad(new Date(2026, 9, 23, 23, 59), hoy)).toBe('menor');
  });

  it('sin fecha, o con una fecha inválida, es «vacía»', () => {
    expect(resultadoDeEdad(undefined, hoy)).toBe('vacia');
    expect(resultadoDeEdad(new Date('no es una fecha'), hoy)).toBe('vacia');
  });

  it('quien nació un 29 de febrero cumple 18 el 1 de marzo en los años que no son bisiestos', () => {
    const nacimiento = new Date(2008, 1, 29);
    expect(resultadoDeEdad(nacimiento, new Date(2026, 1, 28))).toBe('menor');
    expect(resultadoDeEdad(nacimiento, new Date(2026, 2, 1))).toBe('mayor');
    expect(resultadoDeEdad(new Date(2004, 1, 29), new Date(2022, 1, 28))).toBe('menor');
    expect(resultadoDeEdad(new Date(2004, 1, 29), new Date(2022, 2, 1))).toBe('mayor');
  });

  it('no depende de la hora del día de hoy', () => {
    for (const hora of [0, 6, 12, 23]) {
      const ahora = new Date(2026, 9, 23, hora, 59, 59);
      expect(resultadoDeEdad(new Date(2008, 9, 23), ahora)).toBe('mayor');
      expect(resultadoDeEdad(new Date(2008, 9, 24), ahora)).toBe('menor');
    }
  });
});
