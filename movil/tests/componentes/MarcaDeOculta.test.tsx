import { render, screen } from '@testing-library/react-native';
import { MarcaDeOculta } from '../../src/componentes/MarcaDeOculta';

describe('MarcaDeOculta (E14-PRR 4.2, D-170)', () => {
  it('dice «Oculta» con su ícono y no solo con color', async () => {
    await render(<MarcaDeOculta color="#555555" />);
    expect(screen.getByText('Oculta')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('RNSVGSvgView');
  });
});
