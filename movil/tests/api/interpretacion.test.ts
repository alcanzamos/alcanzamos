import { interpretarTexto } from '../../src/api/movimientos';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';

// api/README.md, «Interpretar un texto»: el API no guarda nada y el cliente solo manda el texto y muestra lo que recibe.
describe('API de la interpretación (POST /api/v1/movimientos/interpretacion)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
  });

  it('manda solo el texto, con POST, y devuelve la propuesta con los centavos como texto (D-082)', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(
        200,
        '{"resultado":"propuesta","tipo":"gasto","monto_centavos":9223372036854775807,"categoria":{"id":1,"nombre":"x"},"fecha":"2026-11-01","varios_movimientos":false}',
      ),
    );
    const respuesta = await interpretarTexto('mercado 45 mil ayer');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/movimientos/interpretacion`);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ texto: 'mercado 45 mil ayer' });
    expect(respuesta).toMatchObject({
      ok: true,
      cuerpo: { resultado: 'propuesta', monto_centavos: '9223372036854775807', categoria: { id: 1 } },
    });
  });

  it('un monto ambiguo trae las dos lecturas y ningún monto', async () => {
    instalarFetchFalso(
      respuestaJson(200, {
        resultado: 'monto_ambiguo',
        tipo: 'gasto',
        monto_centavos: null,
        categoria: null,
        fecha: '2026-11-01',
        varios_movimientos: false,
        lecturas_del_monto: { con_punto_de_miles: '12.500', con_coma_decimal: '12,50' },
      }),
    );
    expect(await interpretarTexto('12.5')).toMatchObject({ ok: true, cuerpo: { monto_centavos: null } });
  });

  it('un 422 vuelve con el código del campo texto', async () => {
    instalarFetchFalso(respuestaJson(422, { error: 'datos_invalidos', campos: { texto: 'texto_largo' } }));
    expect(await interpretarTexto('x')).toEqual({
      ok: false,
      estado: 422,
      codigo: 'datos_invalidos',
      campos: { texto: 'texto_largo' },
    });
  });
});
