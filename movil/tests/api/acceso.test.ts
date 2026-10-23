import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { cambiarContrasena, ingresoAnterior, iniciarSesion } from '../../src/api/acceso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

describe('API de acceso', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
  });

  it('iniciarSesion manda un identificador genérico y la contraseña, y guarda el token en el Keystore', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { estado: 'activa', token: 'tk-sesion' }));
    const respuesta = await iniciarSesion({ identificador: 'laura@ejemplo.com', contrasena: 'lluvia café tren azul' });
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/sesiones');
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({
      identificador: 'laura@ejemplo.com',
      contrasena: 'lluvia café tren azul',
    });
    expect(almacen.guardado.get('sesion')).toBe('tk-sesion');
    expect(respuesta).toEqual({ ok: true, estado: 200, cuerpo: { estado: 'activa' } });
  });

  it('ingresoAnterior pide GET con el Bearer', async () => {
    almacen.guardado.set('sesion', 'tk-sesion');
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
    expect(await ingresoAnterior()).toMatchObject({ ok: true, cuerpo: { ingreso_anterior: null } });
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/seguridad');
    expect(pedidos[0]?.init.method).toBe('GET');
    expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-sesion');
  });

  it('cambiarContrasena manda las dos contraseñas', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { estado: 'contrasena_cambiada' }));
    await cambiarContrasena({ contrasena_actual: 'a', contrasena_nueva: 'b' });
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/contrasena');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ contrasena_actual: 'a', contrasena_nueva: 'b' });
  });
});
