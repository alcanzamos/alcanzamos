import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import * as cuentas from '../../src/api/cuentas';
import {
  borrarLaCuenta,
  cerrarSesion,
  crearCuenta,
  reenviarCorreo,
  resumenDeBorrado,
} from '../../src/api/cuentas';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

describe('API de cuenta', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'token-actual');
  });

  it('crearCuenta manda solo el correo y mayor_de_edad: true (sin contraseña, nombre, fecha ni edad), sin Authorization', async () => {
    almacen.guardado.clear();
    const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
    const respuesta = await crearCuenta({ correo: 'laura@ejemplo.com', mayor_de_edad: true });
    expect(respuesta.ok).toBe(true);
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas');
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'laura@ejemplo.com', mayor_de_edad: true });
    expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(almacen.guardado.has('sesion')).toBe(false);
  });

  it('crearCuenta nunca guarda un token: crear la cuenta no da sesión (D-172)', async () => {
    almacen.guardado.clear();
    almacen.setItemAsync.mockClear();
    instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
    await crearCuenta({ correo: 'laura@ejemplo.com', mayor_de_edad: true });
    expect(almacen.setItemAsync).not.toHaveBeenCalled();
  });

  it('reenviarCorreo manda solo el correo a la ruta pública del reenvío', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
    await reenviarCorreo('laura@ejemplo.com');
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas/verificacion/reenvio');
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'laura@ejemplo.com' });
  });

  it('las rutas retiradas ya no existen en el cliente (GET /cuentas/estado y POST /cuentas/correo)', () => {
    expect('estadoDeLaCuenta' in cuentas).toBe(false);
    expect('cambiarCorreo' in cuentas).toBe(false);
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

describe('API de PN-69', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'token-actual');
  });

  it('resumenDeBorrado pide GET /api/v1/cuenta/borrado', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { hogar: null, menores: [] }));
    await resumenDeBorrado();
    expect(pedidos[0]?.init.method).toBe('GET');
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/borrado');
  });

  it('borrarLaCuenta manda la contraseña y lo del menor, y con el 200 borra el token del Keystore', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { estado: 'cuenta_borrada' }));
    const respuesta = await borrarLaCuenta({ contrasena: 'x', confirma_menores: true, menores: ['id-1'] });
    expect(respuesta.ok).toBe(true);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ contrasena: 'x', confirma_menores: true, menores: ['id-1'] });
    expect(almacen.guardado.has('sesion')).toBe(false);
  });

  it.each([
    [400, { error: 'contrasena_incorrecta' }],
    [422, { error: 'validacion', campos: { confirma_menores: 'confirmacion_requerida' } }],
    [500, { error: 'error_interno' }],
  ])('con un %i el token se queda: la cuenta sigue', async (estado, cuerpo) => {
    instalarFetchFalso(respuestaJson(estado, cuerpo));
    expect((await borrarLaCuenta({ contrasena: 'x', confirma_menores: false, menores: [] })).ok).toBe(false);
    expect(almacen.guardado.get('sesion')).toBe('token-actual');
  });
});
