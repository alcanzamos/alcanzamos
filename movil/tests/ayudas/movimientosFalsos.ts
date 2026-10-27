import type { Listado, Movimiento } from '../../src/api/movimientos';

// Movimientos y listas de mentira con la forma del API (api/README.md, «Movimientos»). Los montos van como texto: el
// cliente los lee así (D-082).
export const movimiento = (parcial: Partial<Movimiento> = {}): Movimiento => ({
  id: 'm1',
  tipo: 'gasto',
  monto_centavos: '4500000',
  fecha: '2026-11-01',
  categoria_id: 1,
  medio: 'efectivo',
  descripcion: null,
  compartido: false,
  meta: null,
  sentido: null,
  recurrente: null,
  ...parcial,
});

export const listado = (parcial: Partial<Listado> = {}): Listado => ({
  periodo_actual: '2026-11',
  periodo: '2026-11',
  resumen: { movimientos: parcial.movimientos?.length ?? 0, total_centavos: null },
  meses: ['2026-11', '2026-10'],
  categorias: [],
  movimientos: [],
  ...parcial,
});

// El escenario de E14-PRR 2.2 que importa aquí: hoy es el 2 de noviembre de 2026.
export const gastoDeHoy = movimiento({ id: 'm-hoy', monto_centavos: '1500000', fecha: '2026-11-02', categoria_id: 8 });
export const gastoDeAyer = movimiento({ id: 'm-ayer', descripcion: 'Mercado' });
// SEG-002 (NC-E16-40): el aporte compartido a «Arriendo de enero», fila 7 de E14-PRR 2.2.
export const arriendoDeEnero = movimiento({
  id: 'm-arriendo',
  tipo: 'aporte',
  monto_centavos: '10000000',
  categoria_id: null,
  medio: 'transferencia',
  compartido: true,
  meta: { id: 'meta-1', nombre: 'Arriendo de enero' },
  sentido: 'entrada',
  fecha: '2026-10-30',
});

// ——— El API de mentira de PN-01 y PN-02 ———
export const BASE = 'http://api.prueba:18090';
export type Pedido = { metodo: string; ruta: string; cuerpo?: string };

const catalogo = {
  gasto: [
    { id: 1, nombre: 'x', general: false },
    { id: 4, nombre: 'x', general: false },
    { id: 8, nombre: 'x', general: false },
    { id: 16, nombre: 'x', general: true },
  ],
  ingreso: [{ id: 17, nombre: 'x', general: false }],
};

/**
 * PN-71, las categorías, la lista, `PUT` y `DELETE`. `lista` es lo que contesta la lista (una función, si cambia con cada
 * pedido); `corregir` y `borrar` son lo que contestan el `PUT` y el `DELETE` (por defecto `200` y `204`). Devuelve los
 * pedidos, en orden, para revisarlos.
 */
export function apiFalsa(
  respuestaJson: (estado: number, cuerpo?: unknown) => Response,
  opciones: {
    lista?: Listado | (() => Listado);
    corregir?: () => Response | Promise<Response>;
    borrar?: () => Response | Promise<Response>;
  } = {},
) {
  const pedidos: Pedido[] = [];
  const lista = opciones.lista ?? listado();
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const ruta = url.replace(BASE, '');
    const metodo = String(init.method);
    pedidos.push({ metodo, ruta, cuerpo: init.body as string | undefined });
    if (ruta.startsWith('/api/v1/cuenta/seguridad')) return respuestaJson(200, { ingreso_anterior: null });
    if (ruta === '/api/v1/categorias') return respuestaJson(200, catalogo);
    if (metodo === 'PUT') return opciones.corregir ? opciones.corregir() : respuestaJson(200, {});
    if (metodo === 'DELETE') return opciones.borrar ? opciones.borrar() : respuestaJson(204);
    return respuestaJson(200, typeof lista === 'function' ? lista() : lista);
  }) as unknown as typeof fetch;
  return pedidos;
}
