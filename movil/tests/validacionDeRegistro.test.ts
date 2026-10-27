import type { Borrador } from '../src/borradorDeRegistro';
import { fijarHoy } from './ayudas/reloj';
import { campoDeApi, validarRegistro } from '../src/validacionDeRegistro';

const lleno: Borrador = {
  tipo: 'gasto',
  monto: '45.000',
  fecha: null,
  categoriaId: null,
  medio: 'efectivo',
  descripcion: '',
  periodicidad: null,
};
const hoy = '2026-10-26';
const errores = (
  cambio: Partial<Borrador>,
  categoriaId: number | null = 16,
) => {
  const r = validarRegistro({ ...lleno, ...cambio }, categoriaId, hoy);
  return 'errores' in r ? r.errores : null;
};

describe('validación del formulario (E14-PPN 3.1, errores de campo)', () => {
  it('un formulario lleno da la solicitud con centavos enteros y la fecha de hoy', () => {
    expect(validarRegistro(lleno, 16, hoy)).toEqual({
      solicitud: {
        tipo: 'gasto',
        montoCentavos: 4500000n,
        fecha: '2026-10-26',
        categoriaId: 16,
        medio: 'efectivo',
        descripcion: '',
        periodicidad: null,
      },
    });
  });

  it('una fecha futura sin repetición es válida (L3)', () => {
    const r = validarRegistro({ ...lleno, fecha: '2026-12-20' }, 16, hoy);
    expect(r).toMatchObject({ solicitud: { fecha: '2026-12-20' } });
  });

  it('monto vacío', () => {
    expect(errores({ monto: '' })).toEqual({ monto: 'Falta el monto.' });
  });

  it('monto con más de dos decimales', () => {
    expect(errores({ monto: '12,345' })).toEqual({
      monto: 'El monto puede tener hasta dos decimales.',
    });
  });

  it('monto ambiguo: pregunta con lo que escribió la persona', () => {
    expect(errores({ monto: '12.5' })).toEqual({
      monto: '¿Quisiste decir $12.500 o $12,50?',
    });
    expect(errores({ monto: '3.05' })).toEqual({
      monto: '¿Quisiste decir $3.050 o $3,05?',
    });
  });

  it('monto en cero', () => {
    expect(errores({ monto: '0' })).toEqual({
      monto: 'El monto debe ser mayor que $0.',
    });
  });

  it('monto que no es un número y monto demasiado grande (E14-PPN 1.11, D-165)', () => {
    expect(errores({ monto: 'mucho' })).toEqual({
      monto: 'Escribe el monto con números, por ejemplo $45.000.',
    });
    expect(errores({ monto: '99999999999999999999' })).toEqual({
      monto: 'El monto es demasiado grande. Revisa que no sobren ceros.',
    });
  });

  it('fecha vacía, o una que no existe o es anterior a 1900', () => {
    for (const fecha of ['', '2026-02-30', '1899-12-31'])
      expect(errores({ fecha })).toEqual({ fecha: 'Falta la fecha.' });
  });

  it('categoría sin elegir (D-165): no hay solicitud', () => {
    expect(errores({}, null)).toEqual({
      categoria: 'Falta elegir la categoría.',
    });
  });

  it('medio de pago sin elegir', () => {
    expect(errores({ medio: null })).toEqual({
      medio: 'Falta elegir el medio de pago.',
    });
  });

  it('muestra todos los errores a la vez', () => {
    expect(errores({ monto: '', fecha: '', medio: null }, null)).toEqual({
      monto: 'Falta el monto.',
      fecha: 'Falta la fecha.',
      categoria: 'Falta elegir la categoría.',
      medio: 'Falta elegir el medio de pago.',
    });
  });

  it('los campos del cuerpo del API tienen su campo en la pantalla', () => {
    expect(campoDeApi.monto_centavos).toBe('monto');
    expect(campoDeApi.categoria_id).toBe('categoria');
    expect(campoDeApi.repeticion).toBe('repeticion');
  });

  it('sin «hoy» dado usa el día de hoy en Colombia', () => {
    fijarHoy(new Date('2026-10-26T15:00:00Z'));
    expect(validarRegistro(lleno, 16)).toMatchObject({ solicitud: { fecha: '2026-10-26' } });
    jest.useRealTimers();
  });
});
