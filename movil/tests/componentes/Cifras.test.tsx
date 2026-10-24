import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { cifras } from '../../src/componentes/Cifras';

describe('cifras (D-123)', () => {
  it('envuelve cada número en Figtree con cifras tabulares y deja el resto igual', async () => {
    await render(<Text>{cifras('Al menos 15 caracteres, a las 9:40')}</Text>);
    expect(screen.getByText('15')).toHaveStyle({ fontFamily: 'Figtree-SemiBold', fontVariant: ['tabular-nums'] });
    expect(screen.getByText('9:40')).toHaveStyle({ fontFamily: 'Figtree-SemiBold' });
    expect(screen.getByText(/Al menos/)).toBeOnTheScreen();
  });

  it('sobre texto en negrita el número va en 700', async () => {
    await render(<Text>{cifras('Tienes 7 días', true)}</Text>);
    expect(screen.getByText('7')).toHaveStyle({ fontFamily: 'Figtree-Bold' });
  });

  it('nunca pide ss02 (el cero lleva barra con él)', () => {
    const [, numero] = cifras('1');
    expect(JSON.stringify(numero)).not.toContain('stylistic-two');
    expect(JSON.stringify(numero)).not.toContain('ss02');
  });

  it('un texto sin números queda como un solo trozo', () => {
    expect(cifras('Sin números')).toEqual(['Sin números']);
  });
});
