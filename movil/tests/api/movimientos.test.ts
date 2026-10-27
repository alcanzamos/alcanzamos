import { listarMovimientos } from '../../src/api/movimientos';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';

describe('API de movimientos: la lista (US-52)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
  });

  it.each([
    [null, null, '/api/v1/movimientos?'],
    ['2026-10', null, '/api/v1/movimientos?periodo=2026-10'],
    [null, 8, '/api/v1/movimientos?categoria=8'],
    ['2026-10', 8, '/api/v1/movimientos?periodo=2026-10&categoria=8'],
  ])('con periodo %s y categoría %s pide %s, con GET y sin cuerpo', async (periodo, categoria, ruta) => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    expect(await listarMovimientos(periodo, categoria)).toMatchObject({ ok: true });
    expect(pedidos[0]?.url).toBe(`${BASE}${ruta}`);
    expect(pedidos[0]?.init.method).toBe('GET');
    expect(pedidos[0]?.init.body).toBeUndefined();
  });

  it('un fallo llega con su código y sin adivinar nada', async () => {
    instalarFetchFalso(respuestaJson(422, { error: 'datos_invalidos', campos: { periodo: 'periodo_invalido' } }));
    expect(await listarMovimientos('2026-13', null)).toEqual({
      ok: false,
      estado: 422,
      codigo: 'datos_invalidos',
      campos: { periodo: 'periodo_invalido' },
    });
  });

  it('los `*_centavos` llegan como texto, con todos sus dígitos (D-082)', async () => {
    instalarFetchFalso(
      respuestaJson(
        200,
        '{"resumen":{"total_centavos":9223372036854775807},"movimientos":[{"monto_centavos":9007199254740993}]}',
      ),
    );
    const respuesta = await listarMovimientos(null, null);
    expect(respuesta).toMatchObject({
      ok: true,
      cuerpo: { resumen: { total_centavos: '9223372036854775807' }, movimientos: [{ monto_centavos: '9007199254740993' }] },
    });
  });

  it('una descripción que trae «monto_centavos» escrito no se toca', async () => {
    instalarFetchFalso(respuestaJson(200, JSON.stringify({ descripcion: '"monto_centavos":5', total_centavos: null })));
    expect(await listarMovimientos(null, null)).toMatchObject({
      ok: true,
      cuerpo: { descripcion: '"monto_centavos":5', total_centavos: null },
    });
  });
});
