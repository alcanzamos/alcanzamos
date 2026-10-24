import { render, screen } from '@testing-library/react-native';
import { Logo } from '../../src/componentes/Logo';

describe('Logo', () => {
  it('es una imagen con el nombre accesible «Alcanzamos»', async () => {
    await render(<Logo />);
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
  });
});
