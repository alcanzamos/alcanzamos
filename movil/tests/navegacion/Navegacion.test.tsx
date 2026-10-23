import { render, screen } from '@testing-library/react-native';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

describe('Navegacion: la primera pantalla', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    jest.clearAllMocks();
  });

  it('sin sesión es PN-60: la edad nunca se pregunta antes de iniciar sesión', async () => {
    const { fetchFalso } = instalarFetchFalso();
    await render(<Navegacion />);
    expect(await screen.findByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(screen.queryByText('Antes de empezar')).not.toBeOnTheScreen();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('con una sesión guardada en el Keystore es PN-71, que le pregunta al API si sigue valiendo', async () => {
    almacen.guardado.set('sesion', 'tk-guardado');
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
    await render(<Navegacion />);
    expect(await screen.findByText('Este es tu primer ingreso.')).toBeOnTheScreen();
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/seguridad');
    expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-guardado');
  });

  it('con una sesión que el API ya no reconoce (401) cae en PN-60 con «Tu sesión se cerró» y borra el token', async () => {
    almacen.guardado.set('sesion', 'tk-vencido');
    instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
    await render(<Navegacion />);
    expect(await screen.findByText('Tu sesión se cerró. Entra de nuevo.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(almacen.guardado.has('sesion')).toBe(false);
  });

  it('con una cuenta sin verificar cae en PN-59, sin la dirección (T4)', async () => {
    almacen.guardado.set('sesion', 'tk-limitada');
    instalarFetchFalso(respuestaJson(403, { error: 'verificacion_pendiente' }));
    await render(<Navegacion />);
    expect(
      await screen.findByText('Te enviamos un enlace a tu correo. Ábrelo para confirmar tu cuenta.'),
    ).toBeOnTheScreen();
  });

  it('con una cuenta sin autorización cae en la pantalla provisional', async () => {
    almacen.guardado.set('sesion', 'tk-sin-autorizacion');
    instalarFetchFalso(respuestaJson(403, { error: 'autorizacion_pendiente' }));
    await render(<Navegacion />);
    expect(
      await screen.findByRole('header', { name: 'Sin esta autorización no podemos darte la cuenta.' }),
    ).toBeOnTheScreen();
  });

  it('si el Keystore falla, empieza en PN-60', async () => {
    almacen.getItemAsync.mockRejectedValueOnce(new Error('Keystore no disponible'));
    await render(<Navegacion />);
    expect(await screen.findByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
  });
});
