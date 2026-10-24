import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { cambiarCorreo, cerrarSesion, crearCuenta, estadoDeLaCuenta, reenviarCorreo } from '../../src/api/cuentas';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

describe('API de cuenta', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'token-actual');
  });

  it('crearCuenta manda correo, contraseña, nombre y mayor_de_edad: true, y nada más (sin fecha ni edad)', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente', token: 'nuevo' }));
    await crearCuenta({
      correo: 'laura@ejemplo.com',
      contrasena: 'lluvia café tren azul',
      nombre: 'Laura',
      mayor_de_edad: true,
    });
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas');
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({
      correo: 'laura@ejemplo.com',
      contrasena: 'lluvia café tren azul',
      nombre: 'Laura',
      mayor_de_edad: true,
    });
    expect(almacen.guardado.get('sesion')).toBe('nuevo');
  });

  it.each([
    ['estadoDeLaCuenta', estadoDeLaCuenta, 'GET', '/api/v1/cuentas/estado'],
    ['reenviarCorreo', reenviarCorreo, 'POST', '/api/v1/cuentas/verificacion/reenvio'],
  ] as const)('%s pide %s %s', async (_nombre, funcion, metodo, ruta) => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    await funcion();
    expect(pedidos[0]?.init.method).toBe(metodo);
    expect(pedidos[0]?.url).toBe(`http://api.prueba:18090${ruta}`);
  });

  it('cambiarCorreo manda solo el correo', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(202, {}));
    await cambiarCorreo('otro@ejemplo.com');
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas/correo');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'otro@ejemplo.com' });
  });

  describe('cerrarSesion', () => {
    it('borra la sesión del API y el token del Keystore', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(204));
      expect((await cerrarSesion()).ok).toBe(true);
      expect(pedidos[0]?.init.method).toBe('DELETE');
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/sesiones/actual');
      expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer token-actual');
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('con un 401 (la sesión ya no existía) o un 500 igual borra el token', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
      await cerrarSesion();
      expect(almacen.guardado.has('sesion')).toBe(false);
      almacen.guardado.set('sesion', 'token-actual');
      instalarFetchFalso(respuestaJson(500));
      await cerrarSesion();
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('sin conexión no borra el token: la sesión sigue abierta', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      expect((await cerrarSesion()).ok).toBe(false);
      expect(almacen.guardado.get('sesion')).toBe('token-actual');
    });
  });
});
