import {
  corregirPresupuesto,
  dejarEnCero,
  fechasPorConfirmar,
  leerPresupuesto,
  listarIngresos,
  ponerPresupuesto,
  quitarPresupuesto,
} from '../../src/api/presupuesto';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';

// `respuestaJson` entrega el cuerpo como texto: aquí se mira el texto que viaja, con los centavos como dígitos (D-082).
describe('API del presupuesto del periodo (US-77, PN-06 a PN-08)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
  });

  it('lee el presupuesto del mes en curso con GET, sin periodo ni cuerpo, con la cabecera de Android y el Bearer', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    expect(await leerPresupuesto()).toMatchObject({ ok: true, estado: 200 });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/presupuestos`);
    expect(pedidos[0]?.init.method).toBe('GET');
    expect(pedidos[0]?.init.body).toBeUndefined();
    expect(pedidos[0]?.init.headers).toMatchObject({
      'X-Alcanzamos-Cliente': 'android',
      Authorization: 'Bearer tk-activa',
    });
  });

  it('los montos llegan exactos: un entero que no cabe en number sigue como texto (RNF-002)', async () => {
    instalarFetchFalso(
      respuestaJson(
        200,
        '{"resumen":{"ingreso_registrado_centavos":18446744073709551616,"sin_asignar_centavos":null},"categorias":[{"gastado_centavos":9223372036854775807}]}',
      ),
    );
    expect(await leerPresupuesto()).toMatchObject({
      ok: true,
      cuerpo: {
        resumen: { ingreso_registrado_centavos: '18446744073709551616', sin_asignar_centavos: null },
        categorias: [{ gastado_centavos: '9223372036854775807' }],
      },
    });
  });

  it('«Poner presupuesto» manda el periodo, la categoría y los centavos como entero exacto, con Content-Type JSON', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
    await ponerPresupuesto('2026-11', 5, 9223372036854775807n);
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/presupuestos`);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(pedidos[0]?.init.body).toBe('{"periodo":"2026-11","categoria_id":5,"monto_centavos":9223372036854775807}');
    expect(pedidos[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('«Corregir» manda solo el monto con PUT; el id va codificado en la ruta', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    await corregirPresupuesto('p 8/x', 4000000n);
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/presupuestos/p%208%2Fx`);
    expect(pedidos[0]?.init.method).toBe('PUT');
    expect(pedidos[0]?.init.body).toBe('{"monto_centavos":4000000}');
  });

  it('«Quitar presupuesto» es un DELETE sin cuerpo, con Content-Type JSON (D-194)', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(204));
    expect(await quitarPresupuesto('p8')).toMatchObject({ ok: true, estado: 204 });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/presupuestos/p8`);
    expect(pedidos[0]?.init.method).toBe('DELETE');
    expect(pedidos[0]?.init.body).toBeUndefined();
    expect(pedidos[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('«Dejar el presupuesto en cero» manda el periodo a la ruta de la marca (L6 (5) de la US-77)', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(204));
    expect(await dejarEnCero('2026-11')).toMatchObject({ ok: true, estado: 204 });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/presupuestos/en-cero`);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(pedidos[0]?.init.body).toBe('{"periodo":"2026-11"}');
  });

  it('un 422 del monto vuelve con su código de campo', async () => {
    instalarFetchFalso(respuestaJson(422, { error: 'datos_invalidos', campos: { monto_centavos: 'monto_no_positivo' } }));
    expect(await ponerPresupuesto('2026-11', 5, 1n)).toEqual({
      ok: false,
      estado: 422,
      codigo: 'datos_invalidos',
      campos: { monto_centavos: 'monto_no_positivo' },
    });
  });

  it('PN-08: sin periodo pide el mes en curso; con periodo lo manda en la consulta', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}), respuestaJson(200, {}));
    await listarIngresos(null);
    await listarIngresos('2026-10');
    expect(pedidos.map((p) => [p.init.method, p.url])).toEqual([
      ['GET', `${BASE}/api/v1/ingresos`],
      ['GET', `${BASE}/api/v1/ingresos?periodo=2026-10`],
    ]);
  });

  it('PN-08: los totales y los montos de cada fecha llegan exactos (RNF-002)', async () => {
    instalarFetchFalso(
      respuestaJson(
        200,
        '{"total":{"entran_centavos":18446744073709551616,"por_confirmar":2},"fuentes":[{"total_centavos":1,"ingresos":[{"monto_centavos":9223372036854775807}]}]}',
      ),
    );
    expect(await listarIngresos(null)).toMatchObject({
      cuerpo: {
        total: { entran_centavos: '18446744073709551616', por_confirmar: 2 },
        fuentes: [{ total_centavos: '1', ingresos: [{ monto_centavos: '9223372036854775807' }] }],
      },
    });
  });

  it('las fechas por confirmar de PN-08 salen con lo que piden «Confirmar» y «Confirmar todos» de la US-60', () => {
    const fecha = { fecha: '2026-11-16', monto_centavos: '120000000', medio: 'transferencia' as const, descripcion: null };
    expect(
      fechasPorConfirmar({
        periodo_actual: '2026-11',
        periodo: '2026-11',
        meses: [],
        total: { entran_centavos: '0', registrado_centavos: '0', esperado_centavos: '0', por_confirmar: 1 },
        fuentes: [
          {
            categoria_id: 17,
            oculta: false,
            total_centavos: '0',
            ingresos: [
              { ...fecha, marca: 'registrado', movimiento_id: 'm1', recurrente_id: null },
              { ...fecha, marca: 'esperado', movimiento_id: null, recurrente_id: 'r1' },
              { ...fecha, marca: 'por_confirmar', movimiento_id: null, recurrente_id: 'r2' },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        recurrente_id: 'r2',
        fecha: '2026-11-16',
        tipo: 'ingreso',
        categoria_id: 17,
        medio: 'transferencia',
        monto_habitual_centavos: '120000000',
      },
    ]);
  });
});
