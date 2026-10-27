import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { cambiarBorrador, reiniciarBorrador, useBorrador } from '../src/borradorDeRegistro';

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
