import {
  avisoDeBorrado,
  queSeBorra,
  queSeBorraHablado,
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
    expect(textosDeFila(gastoDeAyer)).toMatchObject({ principal: 'Alimentación · Mercado', apoyo: 'Gasto · Efectivo' });
    expect(textosDeFila(ingreso)).toMatchObject({ principal: 'Salario', apoyo: 'Ingreso · Transferencia' });
    expect(textosDeFila(arriendoDeEnero)).toMatchObject({
      principal: 'Arriendo de enero',
      apoyo: 'Aporte a una meta · Transferencia',
    });
    expect(textosDeFila(retiro).apoyo).toBe('Retiro de una meta · Transferencia');
  });

  it('textosDeFila: la etiqueta dice el monto en pesos (ACC-004) y la marca de «Compartido con el hogar» si la lleva', () => {
    expect(textosDeFila(gastoDeAyer).etiqueta).toBe('Alimentación · Mercado, Gasto · Efectivo, 45000 pesos');
    expect(textosDeFila(arriendoDeEnero).etiqueta).toBe(
      'Arriendo de enero, Aporte a una meta · Transferencia, Compartido con el hogar, 100000 pesos',
    );
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

  it('queSeBorraHablado: el mismo texto con el monto en pesos (ACC-004)', () => {
    expect(queSeBorraHablado(gastoDeAyer, hoy)).toBe('Gasto de 45000 pesos en Alimentación, Ayer.');
    expect(queSeBorraHablado(ingreso, hoy)).toBe('Ingreso de 1500000 pesos por Salario, Ayer.');
  });

  it('avisoDeBorrado: el gasto y el ingreso, con el monto', () => {
    expect(avisoDeBorrado(gastoDeAyer)).toEqual({
      tipo: 'informacion',
      titulo: 'Listo, borramos el gasto de $45.000.',
      tituloHablado: 'Listo, borramos el gasto de 45000 pesos.',
    });
    expect(avisoDeBorrado(ingreso).titulo).toBe('Listo, borramos el ingreso de $1.500.000.');
    expect(avisoDeBorrado(ingreso).tituloHablado).toBe('Listo, borramos el ingreso de 1500000 pesos.');
  });
});
