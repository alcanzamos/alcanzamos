import {
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

  it('resumenDelDetalle: «Gasto en …», «Ingreso por …», «Aporte a «meta»» y «Retiro de «meta»» (D-170)', () => {
    expect(resumenDelDetalle(gastoDeAyer)).toBe('Gasto en Alimentación');
    expect(resumenDelDetalle(ingreso)).toBe('Ingreso por Salario');
    expect(resumenDelDetalle(arriendoDeEnero)).toBe('Aporte a «Arriendo de enero»');
    expect(resumenDelDetalle(retiro)).toBe('Retiro de «Arriendo de enero»');
  });

  it('queSeBorra: el día es «Hoy», «Ayer» o la fecha en palabras', () => {
    expect(queSeBorra(gastoDeAyer, hoy)).toBe('Gasto de $45.000 en Alimentación, Ayer.');
    expect(queSeBorra({ ...gastoDeAyer, fecha: hoy }, hoy)).toBe('Gasto de $45.000 en Alimentación, Hoy.');
    expect(queSeBorra({ ...gastoDeAyer, fecha: '2026-10-05' }, hoy)).toBe('Gasto de $45.000 en Alimentación, 5 de octubre de 2026.');
    expect(queSeBorra(ingreso, hoy)).toBe('Ingreso de $1.500.000 por Salario, Ayer.');
  });

  it('avisoDeBorrado: el gasto y el ingreso, con el monto', () => {
    expect(avisoDeBorrado(gastoDeAyer)).toEqual({ tipo: 'informacion', titulo: 'Listo, borramos el gasto de $45.000.' });
    expect(avisoDeBorrado(ingreso).titulo).toBe('Listo, borramos el ingreso de $1.500.000.');
  });
});
