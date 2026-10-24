import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SinAutorizacion } from '../../src/pantallas/SinAutorizacion';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const aEntrar = CommonActions.reset({ index: 0, routes: [{ name: 'Entrar', params: undefined }] });

async function mostrar(llegada?: 'correo_confirmado') {
  const navegacion = navegacionFalsa();
  await render(<SinAutorizacion {...propiedades('SinAutorizacion', navegacion, llegada ? { llegada } : undefined)} />);
  return navegacion;
}

describe('Pantalla provisional sin autorización (E14-PCP 4.7, T2 y T11)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'token-real');
    jest.clearAllMocks();
  });

  it('dice «Sin esta autorización no podemos darte la cuenta.» y solo ofrece «Cerrar sesión»', async () => {
    await mostrar();
    expect(screen.getByRole('header', { name: 'Sin esta autorización no podemos darte la cuenta.' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeOnTheScreen();
  });

  it('con la llegada del correo muestra arriba «Listo, confirmamos tu correo.» como mensaje de estado', async () => {
    await mostrar('correo_confirmado');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Listo, confirmamos tu correo.')).toBeOnTheScreen();
  });

  it('sin llegada no hay mensaje de estado', async () => {
    await mostrar();
    expect(screen.queryByText('Listo, confirmamos tu correo.')).not.toBeOnTheScreen();
  });

  it('«Cerrar sesión» cierra la sesión en el API, borra el token del Keystore y vuelve a PN-60', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(204));
    const navegacion = await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(aEntrar));
    expect(pedidos[0]?.init.method).toBe('DELETE');
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/sesiones/actual');
    expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer token-real');
    expect(almacen.guardado.has('sesion')).toBe(false);
  });

  it('si la sesión ya no existía (401) igual sale', async () => {
    instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
    const navegacion = await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(aEntrar));
    expect(almacen.guardado.has('sesion')).toBe(false);
  });

  it('sin conexión se queda, conserva el token y dice «Sin conexión…»', async () => {
    instalarFetchFalso(new TypeError('Network request failed'));
    const navegacion = await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(
      await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
    ).toBeOnTheScreen();
    expect(navegacion.dispatch).not.toHaveBeenCalled();
    expect(almacen.guardado.get('sesion')).toBe('token-real');
  });
});
