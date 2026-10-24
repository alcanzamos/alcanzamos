import { fechaEnPalabras, fechaLocalEnPalabras, MESES } from '../src/fechas';

describe('fechaLocalEnPalabras (E17-ECO 4.9)', () => {
  it('escribe la fecha en palabras, nunca en números', () => {
    expect(fechaLocalEnPalabras(new Date(1990, 4, 14))).toBe('14 de mayo de 1990');
    expect(fechaLocalEnPalabras(new Date(2026, 9, 21))).toBe('21 de octubre de 2026');
  });

  it('el día no lleva cero adelante y se leen los doce meses', () => {
    expect(fechaLocalEnPalabras(new Date(2000, 0, 1))).toBe('1 de enero de 2000');
    expect(MESES).toHaveLength(12);
    MESES.forEach((mes, i) => expect(fechaLocalEnPalabras(new Date(2001, i, 5))).toContain(`de ${mes} de`));
  });
});

describe('fechaEnPalabras (PN-71, hora de Colombia)', () => {
  it('el ejemplo de E14-PCP 4.14: 1 de noviembre de 2026, 9:40 p. m. en Bogotá', () => {
    expect(fechaEnPalabras('2026-11-02T02:40:00Z')).toBe('el 1 de noviembre de 2026, a las 9:40 p. m.');
  });

  it.each([
    ['2026-11-02T13:15:00Z', 'el 2 de noviembre de 2026, a las 8:15 a. m.'],
    ['2026-11-02T06:05:00Z', 'el 2 de noviembre de 2026, a la 1:05 a. m.'],
    ['2026-11-02T05:00:00Z', 'el 2 de noviembre de 2026, a las 12:00 a. m.'],
    ['2026-11-02T17:00:00Z', 'el 2 de noviembre de 2026, a las 12:00 p. m.'],
    ['2026-11-02T18:00:00Z', 'el 2 de noviembre de 2026, a la 1:00 p. m.'],
    ['2026-11-02T04:59:00Z', 'el 1 de noviembre de 2026, a las 11:59 p. m.'],
  ])('%s → %s', (rfc3339, esperado) => {
    expect(fechaEnPalabras(rfc3339)).toBe(esperado);
  });

  it('cruza el día, el mes y el año según Colombia, no según UTC', () => {
    expect(fechaEnPalabras('2027-01-01T04:30:00Z')).toBe('el 31 de diciembre de 2026, a las 11:30 p. m.');
    expect(fechaEnPalabras('2026-03-01T03:00:00Z')).toBe('el 28 de febrero de 2026, a las 10:00 p. m.');
  });

  it('no cambia con la zona del teléfono ni con un desfase en el texto', () => {
    expect(fechaEnPalabras('2026-11-01T21:40:00-05:00')).toBe('el 1 de noviembre de 2026, a las 9:40 p. m.');
    expect(fechaEnPalabras('2026-11-02T09:40:00+07:00')).toBe('el 1 de noviembre de 2026, a las 9:40 p. m.');
  });

  it('un texto que no es una fecha da null', () => {
    expect(fechaEnPalabras('ayer')).toBeNull();
    expect(fechaEnPalabras('')).toBeNull();
  });
});
