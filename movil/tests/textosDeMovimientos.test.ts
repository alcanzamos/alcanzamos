import {
  avanceQueBaja,
  avisoDeBorrado,
  queSeBorra,
  resumenDelDetalle,
  textosDeFila,
  tituloDelDia,
} from '../src/textosDeMovimientos';
import { arriendoDeEnero, gastoDeAyer, movimiento } from './ayudas/movimientosFalsos';

const hoy = '2026-11-02';
const ingreso = movimiento({ tipo: 'ingreso', categoria_id: 17, monto_centavos: '150000000', medio: 'transferencia' });
const retiro = { ...arriendoDeEnero, sentido: 'salida' as const };

describe('textos de PN-01 y PN-02 que se arman con el movimiento (E14-PRR 4.1 y 4.2)', () => {
  it('tituloDelDia: «Hoy, …», «Ayer, …» o la fecha en palabras', () => {
    expect(tituloDelDia('2026-11-02', hoy)).toBe('Hoy, 2 de noviembre de 2026');
    expect(tituloDelDia('2026-11-01', hoy)).toBe('Ayer, 1 de noviembre de 2026');
    expect(tituloDelDia('2026-10-05', hoy)).toBe('5 de octubre de 2026');
    expect(tituloDelDia('no es una fecha', hoy)).toBe('no es una fecha');
  });

  it('textosDeFila: categoría, con descripción, aporte con su meta, retiro e ingreso', () => {
    expect(textosDeFila(gastoDeAyer)).toEqual({ principal: 'Alimentación · Mercado', apoyo: 'Gasto · Efectivo' });
    expect(textosDeFila(ingreso)).toEqual({ principal: 'Salario', apoyo: 'Ingreso · Transferencia' });
    expect(textosDeFila(arriendoDeEnero)).toEqual({ principal: 'Arriendo de enero', apoyo: 'Aporte a una meta · Transferencia' });
    expect(textosDeFila(retiro).apoyo).toBe('Retiro de una meta · Transferencia');
  });

  it('resumenDelDetalle: «Gasto en …», «Ingreso en …» y «Aporte a «meta»»', () => {
    expect(resumenDelDetalle(gastoDeAyer)).toBe('Gasto en Alimentación');
    expect(resumenDelDetalle(ingreso)).toBe('Ingreso en Salario');
    expect(resumenDelDetalle(arriendoDeEnero)).toBe('Aporte a «Arriendo de enero»');
  });

  it('queSeBorra: el día es «Hoy», «Ayer» o la fecha en palabras', () => {
    expect(queSeBorra(gastoDeAyer, hoy)).toBe('Gasto de $45.000 en Alimentación, Ayer.');
    expect(queSeBorra({ ...gastoDeAyer, fecha: hoy }, hoy)).toBe('Gasto de $45.000 en Alimentación, Hoy.');
    expect(queSeBorra({ ...gastoDeAyer, fecha: '2026-10-05' }, hoy)).toBe('Gasto de $45.000 en Alimentación, 5 de octubre de 2026.');
    expect(queSeBorra(ingreso, hoy)).toBe('Ingreso de $1.500.000 en Salario, Ayer.');
    expect(queSeBorra(arriendoDeEnero, hoy)).toBe('Aporte de $100.000 a «Arriendo de enero», 30 de octubre de 2026.');
  });

  it('avanceQueBaja: solo un aporte que entró a la meta', () => {
    expect(avanceQueBaja(arriendoDeEnero)).toBe(
      'El avance de «Arriendo de enero» baja $100.000. El avance nunca queda por debajo de cero.',
    );
    expect(avanceQueBaja(retiro)).toBeNull();
    expect(avanceQueBaja(gastoDeAyer)).toBeNull();
  });

  it('avisoDeBorrado: el gasto, el ingreso y el aporte, con el monto', () => {
    expect(avisoDeBorrado(gastoDeAyer)).toEqual({ tipo: 'informacion', titulo: 'Listo, borramos el gasto de $45.000.' });
    expect(avisoDeBorrado(ingreso).titulo).toBe('Listo, borramos el ingreso de $1.500.000.');
    expect(avisoDeBorrado(arriendoDeEnero).titulo).toBe('Listo, borramos el aporte de $100.000.');
  });
});
