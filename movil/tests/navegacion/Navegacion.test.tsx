import { render, screen } from '@testing-library/react-native';
import { Navegacion } from '../../src/navegacion/Navegacion';

describe('Navegacion', () => {
  it('la primera pantalla es PN-60: la edad nunca se pregunta antes de iniciar sesión', async () => {
    await render(<Navegacion />);
    expect(await screen.findByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(screen.queryByText('Antes de empezar')).not.toBeOnTheScreen();
  });
});
