import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { borradorDeMovimiento, cambiarBorrador, reiniciarBorrador, useBorrador } from '../src/borradorDeRegistro';

function Muestra() {
  const b = useBorrador();
  return <Text>{`${b.tipo}|${b.monto}|${b.fecha ?? 'hoy'}|${b.periodicidad ?? 'no'}`}</Text>;
}

describe('borrador del formulario de registro', () => {
  afterEach(() => act(() => reiniciarBorrador()));

  it('empieza como «Gasto», sin monto, con la fecha de hoy y sin repetir', async () => {
    await render(<Muestra />);
    expect(screen.getByText('gasto||hoy|no')).toBeOnTheScreen();
  });

  it('un cambio llega a quien lo mira y conserva el resto', async () => {
    await render(<Muestra />);
    await act(() => cambiarBorrador({ monto: '45.000', periodicidad: 'mensual' }));
    expect(screen.getByText('gasto|45.000|hoy|mensual')).toBeOnTheScreen();
    await act(() => cambiarBorrador({ tipo: 'ingreso' }));
    expect(screen.getByText('ingreso|45.000|hoy|mensual')).toBeOnTheScreen();
  });

  it('reiniciar lo deja vacío', async () => {
    await render(<Muestra />);
    await act(() => cambiarBorrador({ monto: '1', fecha: '2026-12-20' }));
    await act(() => reiniciarBorrador());
    expect(screen.getByText('gasto||hoy|no')).toBeOnTheScreen();
  });

  it('quien deja de mirar ya no recibe cambios', async () => {
    await render(<Muestra />);
    await screen.unmount();
    expect(() => cambiarBorrador({ monto: '2' })).not.toThrow();
  });
});

describe('borradorDeMovimiento («Corregir» de PN-02)', () => {
  const base = {
    id: 'm1',
    tipo: 'gasto',
    monto_centavos: '4500000',
    fecha: '2026-11-01',
    categoria_id: 1,
    medio: 'efectivo',
    descripcion: 'Mercado',
    compartido: false,
    meta: null,
    sentido: null,
    recurrente: null,
  } as const;

  it('llena los campos con lo que ya tiene el movimiento: monto en pesos, fecha y categoría', () => {
    expect(borradorDeMovimiento(base)).toEqual({
      tipo: 'gasto',
      monto: '$45.000',
      fecha: '2026-11-01',
      categoriaId: 1,
      medio: 'efectivo',
      descripcion: 'Mercado',
      periodicidad: null,
    });
  });

  it('un monto de 64 bits y una descripción vacía llegan sin perder nada', () => {
    expect(borradorDeMovimiento({ ...base, monto_centavos: '9223372036854775807', descripcion: null })).toMatchObject({
      monto: '$92.233.720.368.547.758,07',
      descripcion: '',
    });
  });

  it('un aporte no tiene tipo ni categoría: queda «gasto» y sin categoría', () => {
    expect(borradorDeMovimiento({ ...base, tipo: 'aporte', categoria_id: null })).toMatchObject({
      tipo: 'gasto',
      categoriaId: null,
    });
  });
});
