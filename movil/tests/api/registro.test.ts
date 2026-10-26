import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { guardarMovimiento, obtenerCategorias, obtenerProximas, type Solicitud } from '../../src/api/registro';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const BASE = 'http://api.prueba:18090';
const base: Solicitud = {
  tipo: 'gasto',
  montoCentavos: 4500000n,
  fecha: '2026-10-26',
  categoriaId: 1,
  medio: 'efectivo',
  descripcion: '',
  periodicidad: null,
};

// El cuerpo crudo que viaja: se mira el texto, no el objeto, para ver todos los dígitos de los centavos.
const cuerpoDe = (pedidos: { init: RequestInit }[]) => String(pedidos.at(-1)?.init.body);

describe('API del registro (US-51)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
  });

  it('pide las categorías', async () => {
    const catalogo = { gasto: [], ingreso: [] };
    const { pedidos } = instalarFetchFalso(respuestaJson(200, catalogo));
    expect(await obtenerCategorias()).toMatchObject({ ok: true, cuerpo: catalogo });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/categorias`);
    expect(pedidos[0]?.init.method).toBe('GET');
    expect(pedidos[0]?.init.body).toBeUndefined();
  });

  it('pide las próximas fechas con la periodicidad y el inicio, y no las calcula', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(200, { proximas: ['2026-11-15', '2026-12-15', '2027-01-15'] }),
    );
    expect(await obtenerProximas('mensual', '2026-08-15')).toMatchObject({
      ok: true,
      cuerpo: { proximas: ['2026-11-15', '2026-12-15', '2027-01-15'] },
    });
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/repeticiones/proximas?periodicidad=mensual&inicio=2026-08-15`);
    expect(pedidos[0]?.init.method).toBe('GET');
  });

  it('manda los centavos enteros, la fecha y los ids, sin descripción ni repetición', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
    await guardarMovimiento(base);
    expect(pedidos[0]?.url).toBe(`${BASE}/api/v1/movimientos`);
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(cuerpoDe(pedidos))).toEqual({
      monto_centavos: 4500000,
      tipo: 'gasto',
      fecha: '2026-10-26',
      categoria_id: 1,
      medio: 'efectivo',
    });
  });

  it('manda la descripción recortada y la periodicidad', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
    await guardarMovimiento({
      ...base,
      tipo: 'ingreso',
      medio: 'transferencia',
      descripcion: '  Arriendo  ',
      periodicidad: 'mensual',
    });
    expect(JSON.parse(cuerpoDe(pedidos))).toEqual({
      monto_centavos: 4500000,
      tipo: 'ingreso',
      fecha: '2026-10-26',
      categoria_id: 1,
      medio: 'transferencia',
      descripcion: 'Arriendo',
      repeticion: { periodicidad: 'mensual' },
    });
  });

  it('una descripción de solo espacios no se manda', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
    await guardarMovimiento({ ...base, descripcion: '   ' });
    expect(JSON.parse(cuerpoDe(pedidos))).not.toHaveProperty('descripcion');
  });

  it('escribe un monto de 64 bits con todos sus dígitos (EXA-001)', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}), respuestaJson(201, {}));
    await guardarMovimiento({ ...base, montoCentavos: 9223372036854775807n });
    expect(cuerpoDe(pedidos)).toContain('"monto_centavos":9223372036854775807,');
    await guardarMovimiento({ ...base, montoCentavos: 9007199254740993n });
    expect(cuerpoDe(pedidos)).toContain('"monto_centavos":9007199254740993,');
    // Sigue siendo un JSON válido y viaja con su tipo.
    expect(() => JSON.parse(cuerpoDe(pedidos))).not.toThrow();
    expect((pedidos[1]?.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('una descripción que parece JSON no rompe el cuerpo', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(201, {}));
    await guardarMovimiento({ ...base, descripcion: '"},"monto_centavos":1,"' });
    const cuerpo = JSON.parse(cuerpoDe(pedidos)) as Record<string, unknown>;
    expect(cuerpo.monto_centavos).toBe(4500000);
    expect(cuerpo.descripcion).toBe('"},"monto_centavos":1,"');
  });
});
