import { fireEvent, render, screen } from '@testing-library/react-native';
import { Entrar } from '../../src/pantallas/Entrar';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';

describe('Entrar (provisional hasta A4)', () => {
  it('muestra el logo, el título de PN-60 y «Crear una cuenta»', async () => {
    await render(<Entrar {...propiedades('Entrar', navegacionFalsa())} />);
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Crear una cuenta' })).toBeOnTheScreen();
  });

  it('«Crear una cuenta» abre PN-65, el único camino a esa pantalla', async () => {
    const navegacion = navegacionFalsa();
    await render(<Entrar {...propiedades('Entrar', navegacion)} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Crear una cuenta' }));
    expect(navegacion.navigate).toHaveBeenCalledWith('Edad');
  });
});
