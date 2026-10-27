import { render, screen } from '@testing-library/react-native';
import { MarcaDePropiedad } from '../../src/componentes/MarcaDePropiedad';

describe('MarcaDePropiedad (E14-SDD 5.16)', () => {
  it('lo compartido dice «Compartido con el hogar», con su ícono y no solo con color', async () => {
    await render(<MarcaDePropiedad compartido />);
    expect(screen.getByText('Compartido con el hogar')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('RNSVGSvgView');
  });

  it('lo propio dice «Solo mío»', async () => {
    await render(<MarcaDePropiedad compartido={false} />);
    expect(screen.getByText('Solo mío')).toBeOnTheScreen();
    expect(screen.queryByText('Compartido con el hogar')).not.toBeOnTheScreen();
  });
});
