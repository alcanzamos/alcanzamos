import { fechaLocalEnPalabras, MESES } from '../src/fechas';

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
