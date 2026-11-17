import { CommonActions } from '@react-navigation/native';
import { waitFor } from '@testing-library/react-native';
import { seguirPorAccesoNegado } from '../../src/navegacion/accesoNegado';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';

const fallo = (estado: number, codigo: string) => ({ ok: false as const, estado, codigo, campos: {} });
const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

describe('seguirPorAccesoNegado (api/README.md, «las de /api/ que piden sesión»)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
  });

  it('401 sin_sesion lleva a PN-60 con «Tu sesión se cerró», sin pedir nada', () => {
    const { pedidos } = instalarFetchFalso();
    const dispatch = jest.fn();
    expect(seguirPorAccesoNegado({ dispatch } as never, fallo(401, 'sin_sesion'))).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' }));
    expect(pedidos).toHaveLength(0);
  });

  // SC-E21-25 sección 5, paso 2: la cuenta de antes del cambio ve PN-64 con la tarjeta que le falta; la persona nueva ve
  // primero PN-63 (RNF-011). El modo lo dice el catálogo (`GET /autorizaciones`, que una cuenta sin autorizar sí puede
  // pedir). La función sigue devolviendo verdadero de inmediato: la pantalla de destino llega un momento después.
  describe('403 autorizacion_pendiente', () => {
    const catalogo = (modo: string) => ({
      version: { numero: '1.1', fecha: '2026-11-12' },
      modo,
      finalidades: [{ codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false }],
    });
    const pendiente = fallo(403, 'autorizacion_pendiente');

    it('con el modo falta_una_aceptacion va directo a PN-64', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(200, catalogo('falta_una_aceptacion')));
      const dispatch = jest.fn();
      expect(seguirPorAccesoNegado({ dispatch } as never, pendiente)).toBe(true);
      await waitFor(() => expect(dispatch).toHaveBeenCalledWith(reinicio('AutorizacionDeDatos')));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(pedidos.map((p) => `${p.init.method} ${p.url}`)).toEqual(['GET http://api.prueba:18090/api/v1/autorizaciones']);
    });

    it('con el modo completo lleva a PN-63', async () => {
      instalarFetchFalso(respuestaJson(200, catalogo('completo')));
      const dispatch = jest.fn();
      expect(seguirPorAccesoNegado({ dispatch } as never, pendiente)).toBe(true);
      await waitFor(() => expect(dispatch).toHaveBeenCalledWith(reinicio('InformacionDePrivacidad', undefined)));
    });

    it.each([
      ['un modo que no conoce', () => respuestaJson(200, catalogo('otro'))],
      ['un catálogo sin modo', () => respuestaJson(200, { finalidades: [] })],
      ['un 500', () => respuestaJson(500, { error: 'interno' })],
      ['un 403', () => respuestaJson(403, { error: 'autorizacion_pendiente' })],
      ['sin conexión', () => new TypeError('Network request failed')],
    ])('%s: lleva a PN-63, como siempre', async (_caso, respuesta) => {
      instalarFetchFalso(respuesta());
      const dispatch = jest.fn();
      expect(seguirPorAccesoNegado({ dispatch } as never, pendiente)).toBe(true);
      await waitFor(() => expect(dispatch).toHaveBeenCalledWith(reinicio('InformacionDePrivacidad', undefined)));
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('si la sesión ya no existe (401) lleva a PN-60 con «Tu sesión se cerró»', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
      const dispatch = jest.fn();
      expect(seguirPorAccesoNegado({ dispatch } as never, pendiente)).toBe(true);
      await waitFor(() => expect(dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })));
    });
  });

  it.each([
    [400, 'solicitud_invalida'],
    [403, 'otro_codigo'],
    [403, 'verificacion_pendiente'],
    [422, 'validacion'],
    [429, 'demasiados_intentos'],
    [500, 'desconocido'],
    [0, 'sin_conexion'],
  ])('%s %s no cambia de pantalla ni pide nada', (estado, codigo) => {
    const { pedidos } = instalarFetchFalso();
    const dispatch = jest.fn();
    expect(seguirPorAccesoNegado({ dispatch } as never, fallo(estado, codigo))).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(pedidos).toHaveLength(0);
  });
});
