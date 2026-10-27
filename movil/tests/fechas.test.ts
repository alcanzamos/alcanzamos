import {
  aIso,
  desdeIso,
  diaEnPalabras,
  esFechaDeMovimiento,
  fechaEnPalabras,
  fechaLocalEnPalabras,
  hoyEnColombia,
  mesAnterior,
  mesEnPalabras,
  MESES,
  relativoDelDia,
} from '../src/fechas';
import { fijarHoy } from './ayudas/reloj';

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

describe('diaEnPalabras', () => {
  it('escribe una fecha AAAA-MM-DD en palabras, sin hora y sin ceros (D-090)', () => {
    expect(diaEnPalabras('2026-10-30')).toBe('30 de octubre de 2026');
    expect(diaEnPalabras('2027-01-05')).toBe('5 de enero de 2027');
  });

  it.each(['', '30 de octubre', '2026-10-30T00:00:00Z', '2026-13-01', '2026-00-10', '2026-02-30'])(
    '«%s» no es una fecha: null',
    (entrada) => {
      expect(diaEnPalabras(entrada)).toBeNull();
    },
  );
});

describe('hoyEnColombia', () => {
  // Las mismas fechas que TestHoyEnColombiaEsUTCMenosCinco del API.
  it.each([
    ['2026-10-26T04:59:59Z', '2026-10-25'],
    ['2026-10-26T05:00:00Z', '2026-10-26'],
    ['2026-10-27T04:59:59Z', '2026-10-26'],
    ['2026-12-31T23:00:00Z', '2026-12-31'],
    ['2027-01-01T04:00:00Z', '2026-12-31'],
  ])('a las %s en Colombia es %s', (utc, hoy) => {
    expect(hoyEnColombia(new Date(utc))).toBe(hoy);
  });

  it('sin argumento usa el reloj', () => {
    fijarHoy(new Date('2026-10-26T15:00:00Z'));
    expect(hoyEnColombia()).toBe('2026-10-26');
    jest.useRealTimers();
  });
});

describe('esFechaDeMovimiento', () => {
  it('acepta una fecha real desde 1900, también una futura', () => {
    expect(esFechaDeMovimiento('2026-12-20')).toBe(true);
    expect(esFechaDeMovimiento('1900-01-01')).toBe(true);
  });

  it('rechaza lo que el API rechaza', () => {
    expect(esFechaDeMovimiento('')).toBe(false);
    expect(esFechaDeMovimiento('2026-02-30')).toBe(false);
    expect(esFechaDeMovimiento('1899-12-31')).toBe(false);
    expect(esFechaDeMovimiento('0002-10-26')).toBe(false);
  });
});

describe('aIso y desdeIso (la fecha del selector y la del API)', () => {
  it('pasan una fecha del calendario local a AAAA-MM-DD y de vuelta, con ceros', () => {
    expect(aIso(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(aIso(new Date(2026, 11, 20))).toBe('2026-12-20');
    const fecha = desdeIso('2026-08-15');
    expect([fecha.getFullYear(), fecha.getMonth(), fecha.getDate()]).toEqual([2026, 7, 15]);
    expect(aIso(desdeIso('2027-01-31'))).toBe('2027-01-31');
  });
});

describe('relativoDelDia, mesEnPalabras y mesAnterior (PN-01)', () => {
  it('relativoDelDia: «hoy», «ayer» (también al cruzar el mes y el año) y nada más', () => {
    expect(relativoDelDia('2026-11-02', '2026-11-02')).toBe('hoy');
    expect(relativoDelDia('2026-11-01', '2026-11-02')).toBe('ayer');
    expect(relativoDelDia('2026-12-31', '2027-01-01')).toBe('ayer');
    expect(relativoDelDia('2026-10-31', '2026-11-02')).toBeNull();
    expect(relativoDelDia('2026-11-03', '2026-11-02')).toBeNull();
  });

  it('mesEnPalabras: «Noviembre», «Noviembre de 2026» y null si no es AAAA-MM', () => {
    expect(mesEnPalabras('2026-11')).toBe('Noviembre');
    expect(mesEnPalabras('2026-01', true)).toBe('Enero de 2026');
    expect(mesEnPalabras('2026-13')).toBeNull();
    expect(mesEnPalabras('2026-00')).toBeNull();
    expect(mesEnPalabras('noviembre')).toBeNull();
  });

  it('mesAnterior: el mes de antes, con el cero y cruzando el año', () => {
    expect(mesAnterior('2026-11')).toBe('2026-10');
    expect(mesAnterior('2026-10')).toBe('2026-09');
    expect(mesAnterior('2027-01')).toBe('2026-12');
  });
});
