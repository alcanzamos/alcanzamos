import { render, screen } from '@testing-library/react-native';
import { useFonts } from 'expo-font';
import App from '../App';

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('../src/navegacion/Navegacion', () => ({
  Navegacion: () => {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>Navegación</Text>;
  },
}));

const useFontsFalso = jest.mocked(useFonts);

describe('App (arranque en Android, E14-PCP 1.19, D-163)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('mientras cargan las fuentes dice «Cargando…»', async () => {
    useFontsFalso.mockReturnValue([false, null]);
    await render(<App />);
    expect(screen.getByText('Cargando…')).toBeOnTheScreen();
    expect(screen.queryByText('Navegación')).not.toBeOnTheScreen();
  });

  it('si fallan, dice solo el texto aprobado y deja el detalle del error en el registro', async () => {
    const error = new Error('detalle técnico: Figtree_400.ttf');
    const registro = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    useFontsFalso.mockReturnValue([false, error]);
    await render(<App />);
    expect(screen.getByText('No pudimos abrir la app. Ciérrala y vuelve a abrirla.')).toBeOnTheScreen();
    expect(screen.queryByText(/detalle técnico/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/Figtree/)).not.toBeOnTheScreen();
    expect(registro).toHaveBeenCalledWith('[App] No se cargaron las fuentes:', error);
  });

  it('con las fuentes cargadas monta la navegación y no registra errores', async () => {
    const registro = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    useFontsFalso.mockReturnValue([true, null]);
    await render(<App />);
    expect(screen.getByText('Navegación')).toBeOnTheScreen();
    expect(registro).not.toHaveBeenCalled();
  });
});
