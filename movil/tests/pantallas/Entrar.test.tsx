import { render, screen } from '@testing-library/react-native';
import { Entrar } from '../../src/pantallas/Entrar';

describe('Entrar (provisional de A1)', () => {
  it('muestra el logo y el título de PN-60', async () => {
    await render(<Entrar />);
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
  });
});
