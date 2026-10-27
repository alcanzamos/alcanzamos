import { borrarMovimiento, corregirMovimiento, listarMovimientos } from '../../src/api/movimientos';
import type { Solicitud } from '../../src/api/registro';
import { movimiento } from '../ayudas/movimientosFalsos';
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

const solicitud: Solicitud = {
  tipo: 'gasto',
  montoCentavos: 4000000n,
  fecha: '2026-11-01',
  categoriaId: 1,
  medio: 'efectivo',
  descripcion: '  Mercado  ',
  periodicidad: null,
};
const cuerpoDe = (pedidos: { init: RequestInit }[]) => String(pedidos.at(-1)?.init.body);

describe('API de movimientos: corregir y borrar (US-52)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
  });

  it('corregir es un PUT al movimiento, con todos los campos y los centavos como dígitos', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    expect(await corregirMovimiento(solicitud, movimiento({ id: 'abc' }))).toMatchObject({ ok: true });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/movimientos/abc`);
    expect(pedidos[0]?.init.method).toBe('PUT');
    expect(cuerpoDe(pedidos)).toBe(
      '{"monto_centavos":4000000,"tipo":"gasto","fecha":"2026-11-01","categoria_id":1,"medio":"efectivo","descripcion":"Mercado"}',
    );
  });

  it('un monto de 64 bits viaja exacto', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    await corregirMovimiento({ ...solicitud, montoCentavos: 9223372036854775807n }, movimiento());
    expect(cuerpoDe(pedidos)).toContain('"monto_centavos":9223372036854775807,');
  });

  it('una fecha de un recurrente no manda la fecha (D-168) y una descripción vacía no la manda', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    const recurrente = { recurrente_id: 'r1', fecha_programada: '2026-11-01', periodicidad: 'mensual', vuelve_a_pendiente: true } as const;
    await corregirMovimiento({ ...solicitud, descripcion: ' ' }, movimiento({ recurrente }));
    expect(JSON.parse(cuerpoDe(pedidos))).toEqual({ monto_centavos: 4000000, tipo: 'gasto', categoria_id: 1, medio: 'efectivo' });
  });

  it('un aporte manda «aporte» como tipo, su fecha y ninguna categoría', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, {}));
    await corregirMovimiento({ ...solicitud, categoriaId: null }, movimiento({ tipo: 'aporte', categoria_id: null }));
    expect(JSON.parse(cuerpoDe(pedidos))).toEqual({
      monto_centavos: 4000000,
      tipo: 'aporte',
      fecha: '2026-11-01',
      medio: 'efectivo',
      descripcion: 'Mercado',
    });
  });

  it('un 422 de D-168 llega con su código de campo', async () => {
    instalarFetchFalso(respuestaJson(422, { error: 'datos_invalidos', campos: { fecha: 'fecha_no_editable' } }));
    expect(await corregirMovimiento(solicitud, movimiento())).toMatchObject({
      ok: false,
      estado: 422,
      campos: { fecha: 'fecha_no_editable' },
    });
  });

  it('borrar es un DELETE sin cuerpo y el 204 no trae nada que leer', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(204));
    expect(await borrarMovimiento('abc')).toMatchObject({ ok: true, estado: 204 });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/movimientos/abc`);
    expect(pedidos[0]?.init.method).toBe('DELETE');
    expect(pedidos[0]?.init.body).toBeUndefined();
  });

  it('borrar lo que ya no existe da 404', async () => {
    instalarFetchFalso(respuestaJson(404, { error: 'no_encontrado' }));
    expect(await borrarMovimiento('abc')).toMatchObject({ ok: false, estado: 404, codigo: 'no_encontrado' });
  });
});
