import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pantalla } from '../../src/componentes/Pantalla';
import { avisos } from '../../src/textos';

describe('Pantalla', () => {
  beforeEach(() => {
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 24, left: 0, right: 0, bottom: 16 });
  });

  it('muestra el título como encabezado y el contenido', async () => {
    await render(
      <Pantalla titulo="Crea tu cuenta">
        <Text>Solo necesitamos tres datos.</Text>
      </Pantalla>,
    );
    expect(screen.getByRole('header', { name: 'Crea tu cuenta' })).toBeOnTheScreen();
    expect(screen.getByText('Solo necesitamos tres datos.')).toBeOnTheScreen();
  });

  it('con el logo lo pone arriba; sin él, no hay imagen', async () => {
    await render(<Pantalla conLogo titulo="Inicia sesión" />);
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
    await screen.rerender(<Pantalla titulo="Inicia sesión" />);
    expect(screen.queryByRole('image')).not.toBeOnTheScreen();
  });

  it('con un mensaje de estado lo muestra (región viva)', async () => {
    await render(<Pantalla titulo="Inicia sesión" estado={avisos.sesionCerrada} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Tu sesión se cerró. Entra de nuevo.')).toBeOnTheScreen();
  });

  it('sin título no dibuja encabezado (lo pone la barra nativa)', async () => {
    await render(<Pantalla conBarra />);
    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
  });

  it('deja los márgenes de la barra de estado arriba, salvo con la barra nativa', async () => {
    await render(<Pantalla titulo="Sin barra" />);
    const sinBarra = JSON.stringify(screen.toJSON());
    await screen.rerender(<Pantalla conBarra titulo="Con barra" />);
    const conBarra = JSON.stringify(screen.toJSON());
    expect(sinBarra).toContain('"paddingTop":48');
    expect(conBarra).toContain('"paddingTop":16');
    expect(conBarra).toContain('"paddingBottom":40');
  });
});
