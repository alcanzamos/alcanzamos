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
