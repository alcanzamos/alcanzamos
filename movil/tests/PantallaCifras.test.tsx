import { render, screen } from '@testing-library/react-native';
import { PantallaCifras } from '../src/PantallaCifras';

describe('PantallaCifras', () => {
  it('muestra el título y las tres secciones de la prueba de tipografía', async () => {
    await render(<PantallaCifras />);
    expect(screen.getByText('Prueba de tipografía')).toBeOnTheScreen();
    expect(screen.getByText('a) Cifras tabulares de Figtree')).toBeOnTheScreen();
    expect(screen.getByText('b) Cero de Atkinson Hyperlegible Next')).toBeOnTheScreen();
    expect(screen.getByText('c) Fuente cargada')).toBeOnTheScreen();
  });

  it('pone cada monto inventado en las dos columnas, con y sin cifras tabulares', async () => {
    await render(<PantallaCifras />);
    for (const monto of ['$ 1.234.567', '$ 98.000', '$ 111.111', '$ 7.080', '$ 10.001']) {
      expect(screen.getAllByText(monto)).toHaveLength(2);
    }
    expect(screen.getByText('Sin tabulares')).toBeOnTheScreen();
    expect(screen.getByText('Con tabulares')).toBeOnTheScreen();
  });

  it('pide las cifras tabulares solo en la columna que lo dice', async () => {
    await render(<PantallaCifras />);
    const [sin, con] = screen.getAllByText('$ 111.111');
    expect(sin?.props.style).toEqual(expect.not.arrayContaining([expect.objectContaining({ fontVariant: ['tabular-nums'] })]));
    expect(con?.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontVariant: ['tabular-nums'] })]));
  });
});
