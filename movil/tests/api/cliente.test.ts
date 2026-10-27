import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { cabeceras, pedir, SIN_CONEXION, SIN_CONFIGURACION } from '../../src/api/cliente';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';
const prohibidas = ['origin', 'sec-fetch-site'];

describe('cliente del API', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.llamadas.length = 0;
  });

  describe('cabeceras', () => {
    it('manda X-Alcanzamos-Cliente: android en todo pedido y nunca Origin ni Sec-Fetch-Site', () => {
      for (const token of [null, 'abc']) {
        for (const conCuerpo of [true, false]) {
          const hechas = cabeceras(token, conCuerpo);
          expect(hechas['X-Alcanzamos-Cliente']).toBe('android');
          const nombres = Object.keys(hechas).map((n) => n.toLowerCase());
          for (const prohibida of prohibidas) expect(nombres).not.toContain(prohibida);
        }
      }
    });

    it('manda Authorization: Bearer solo si hay sesión y Content-Type solo con cuerpo', () => {
      expect(cabeceras(null, false)).not.toHaveProperty('Authorization');
      expect(cabeceras(null, false)).not.toHaveProperty('Content-Type');
      expect(cabeceras('abc', true)).toMatchObject({
        Authorization: 'Bearer abc',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('pedir', () => {
    it('usa la dirección de la configuración y las cabeceras de la app (sin Origin ni Sec-Fetch-Site)', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(200, { verificada: false }));
      const respuesta = await pedir('GET', '/api/v1/cuentas/estado');
      expect(respuesta).toEqual({ ok: true, estado: 200, cuerpo: { verificada: false } });
      expect(pedidos).toHaveLength(1);
      expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/cuentas/estado`);
      const enviadas = pedidos[0]?.init.headers as Record<string, string>;
      expect(enviadas['X-Alcanzamos-Cliente']).toBe('android');
      expect(Object.keys(enviadas).map((n) => n.toLowerCase())).not.toEqual(expect.arrayContaining(prohibidas));
      expect(pedidos[0]?.init.method).toBe('GET');
      expect(pedidos[0]?.init.body).toBeUndefined();
    });

    it('manda el token del Keystore como Bearer', async () => {
      almacen.guardado.set('sesion', 'token-guardado');
      const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
      await pedir('GET', '/api/v1/cuenta/seguridad');
      expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer token-guardado');
    });

    it('manda el cuerpo como JSON', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'enlace_enviado' }));
      await pedir('POST', '/api/v1/recuperacion', { correo: 'laura@ejemplo.com' });
      expect(pedidos[0]?.init.body).toBe('{"correo":"laura@ejemplo.com"}');
      expect((pedidos[0]?.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('un cuerpo que ya es texto JSON se manda tal cual, sin volver a escribirlo', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
      await pedir('POST', '/api/v1/movimientos', '{"monto_centavos":9223372036854775807}');
      expect(pedidos[0]?.init.body).toBe('{"monto_centavos":9223372036854775807}');
      expect((pedidos[0]?.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('guarda el token del cuerpo solo en SecureStore y no se lo pasa a la pantalla', async () => {
      instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente', token: 'token-nuevo' }));
      const respuesta = await pedir('POST', '/api/v1/cuentas', { correo: 'a@b.co' });
      expect(almacen.setItemAsync).toHaveBeenCalledWith('sesion', 'token-nuevo');
      expect(almacen.guardado.get('sesion')).toBe('token-nuevo');
      expect(respuesta).toEqual({ ok: true, estado: 202, cuerpo: { estado: 'verificacion_pendiente' } });
    });

    it('un cuerpo vacío (204) es un éxito sin datos', async () => {
      instalarFetchFalso(respuestaJson(204));
      expect(await pedir('DELETE', '/api/v1/sesiones/actual')).toEqual({ ok: true, estado: 204, cuerpo: {} });
    });

    it('devuelve el código y los errores de campo del API', async () => {
      instalarFetchFalso(
        respuestaJson(422, { error: 'validacion', campos: { correo: 'correo_vacio', raro: 5, nulo: null } }),
      );
      expect(await pedir('POST', '/api/v1/cuentas', {})).toEqual({
        ok: false,
        estado: 422,
        codigo: 'validacion',
        campos: { correo: 'correo_vacio' },
      });
    });

    it('un fallo sin cuerpo conocido da el código «desconocido»; campos que no son un objeto se ignoran', async () => {
      instalarFetchFalso(respuestaJson(500), respuestaJson(500, ['x']), respuestaJson(500, { campos: 'x' }));
      for (let i = 0; i < 3; i++) {
        expect(await pedir('GET', '/api/v1/x')).toEqual({ ok: false, estado: 500, codigo: 'desconocido', campos: {} });
      }
    });

    it('401 sin_sesion borra el token del Keystore; otros 401 no', async () => {
      almacen.guardado.set('sesion', 'viejo');
      instalarFetchFalso(
        respuestaJson(401, { error: 'credenciales_invalidas' }),
        respuestaJson(401, { error: 'sin_sesion' }),
      );
      await pedir('POST', '/api/v1/sesiones', {});
      expect(almacen.guardado.get('sesion')).toBe('viejo');
      await pedir('GET', '/api/v1/cuentas/estado');
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('sin red devuelve sin_conexion y no toca el token', async () => {
      almacen.guardado.set('sesion', 'viejo');
      instalarFetchFalso(new TypeError('Network request failed'));
      expect(await pedir('GET', '/api/v1/cuentas/estado')).toEqual({
        ok: false,
        estado: 0,
        codigo: SIN_CONEXION,
        campos: {},
      });
      expect(almacen.guardado.get('sesion')).toBe('viejo');
    });

    it('sin dirección del API no hace ningún pedido', async () => {
      delete process.env.EXPO_PUBLIC_URL_API;
      const { fetchFalso } = instalarFetchFalso();
      expect(await pedir('GET', '/api/v1/cuentas/estado')).toMatchObject({ ok: false, codigo: SIN_CONFIGURACION });
      expect(fetchFalso).not.toHaveBeenCalled();
    });
  });
});
