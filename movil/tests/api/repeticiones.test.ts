import { confirmarFecha, decidir, listarPendientes, omitirFecha } from '../../src/api/repeticiones';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';

// `respuestaJson` entrega el cuerpo como texto: aquí se mira el texto que viaja, con los centavos como dígitos (D-082).
describe('API de «Por confirmar» (US-60)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
  });

  it('pide las fechas pendientes con GET, sin cuerpo, con la cabecera de Android y el Bearer', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(200, { pendientes: [], resumen: { total: 0, ingresos: 0, gastos: 0 } }),
    );
    expect(await listarPendientes()).toMatchObject({ ok: true, estado: 200 });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/repeticiones/pendientes`);
    expect(pedidos[0]?.init.method).toBe('GET');
    expect(pedidos[0]?.init.body).toBeUndefined();
    expect(pedidos[0]?.init.headers).toMatchObject({
      'X-Alcanzamos-Cliente': 'android',
      Authorization: 'Bearer tk-activa',
    });
  });

  it('el monto habitual llega exacto: un entero de 64 bits no pasa por number', async () => {
    instalarFetchFalso(
      respuestaJson(
        200,
        '{"pendientes":[{"recurrente_id":"r1","fecha":"2026-11-26","monto_habitual_centavos":9223372036854775806}],"resumen":{"total":1,"ingresos":1,"gastos":0}}',
      ),
    );
    expect(await listarPendientes()).toMatchObject({
      ok: true,
      cuerpo: { pendientes: [{ monto_habitual_centavos: '9223372036854775806' }] },
    });
  });

  it('confirmar con el monto habitual manda solo la fecha, con Content-Type JSON', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
    await confirmarFecha('r1', '2026-11-26');
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/repeticiones/r1/confirmacion`);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(pedidos[0]?.init.body).toBe('{"fecha":"2026-11-26"}');
    expect(pedidos[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('confirmar con otro monto manda los centavos como entero exacto (D-082)', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
    await confirmarFecha('r1', '2026-11-26', 9223372036854775807n);
    expect(pedidos[0]?.init.body).toBe('{"fecha":"2026-11-26","monto_centavos":9223372036854775807}');
  });

  it('«No pasó» manda la fecha, sin monto, con Content-Type JSON; el id va codificado en la ruta', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(204), respuestaJson(204));
    expect(await omitirFecha('r1', '2026-11-12')).toMatchObject({ ok: true, estado: 204 });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/repeticiones/r1/omision`);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(pedidos[0]?.init.body).toBe('{"fecha":"2026-11-12"}');
    expect(pedidos[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    await omitirFecha('a/b', '2026-11-12');
    expect(pedidos[1]?.url).toBe(`${BASE}/api/v1/repeticiones/a%2Fb/omision`);
  });

  it('«Confirmar todos» manda cada decisión: el monto solo si cambió y «omitida» solo en «No pasó»', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    await decidir([
      { recurrenteId: 'r1', fecha: '2026-11-05' },
      { recurrenteId: 'r2', fecha: '2026-12-01', montoCentavos: 110000000n },
      { recurrenteId: 'r3', fecha: '2026-11-12', omitida: true },
    ]);
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/repeticiones/decisiones`);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(pedidos[0]?.init.body).toBe(
      '{"decisiones":[{"recurrente_id":"r1","fecha":"2026-11-05"},{"recurrente_id":"r2","fecha":"2026-12-01","monto_centavos":110000000},{"recurrente_id":"r3","fecha":"2026-11-12","omitida":true}]}',
    );
    expect(pedidos[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('un conflicto y una fecha que ya no está pendiente llegan con su código', async () => {
    instalarFetchFalso(
      respuestaJson(409, { error: 'conflicto_concurrente' }),
      respuestaJson(409, { error: 'fecha_no_pendiente' }),
    );
    expect(await decidir([{ recurrenteId: 'r1', fecha: '2026-11-05' }])).toEqual({
      ok: false,
      estado: 409,
      codigo: 'conflicto_concurrente',
      campos: {},
    });
    expect(await confirmarFecha('r1', '2026-11-05')).toMatchObject({ codigo: 'fecha_no_pendiente' });
  });
});
