import type { CategoriaDelPresupuesto, PresupuestoDelPeriodo } from '../../src/api/presupuesto';
import { listado } from './movimientosFalsos';

// El presupuesto de mentira con la forma del API (api/README.md, «Presupuesto del periodo»): el escenario de E14-PPA 2.2
// (Laura, 2 de noviembre de 2026, caso F) y el caso P de 2.3 (PN-07). Los montos van como texto (D-082).
export const BASE = 'http://api.prueba:18090';

export const fila = (parcial: Partial<CategoriaDelPresupuesto> & { categoria_id: number }): CategoriaDelPresupuesto => ({
  oculta: false,
  presupuesto: null,
  gastado_centavos: '0',
  estado: null,
  quedan_centavos: null,
  ...parcial,
});
export const sinPresupuesto = (id: number, gastado: string) => fila({ categoria_id: id, gastado_centavos: gastado });
export const transporte = fila({
  categoria_id: 8,
  presupuesto: { id: 'p8', monto_centavos: '4000000' },
  gastado_centavos: '4000000',
  estado: 'usado_todo',
});

type Resumen = PresupuestoDelPeriodo['resumen'];
export const datos = (
  resumen: Partial<Resumen> & Pick<Resumen, 'modo'>,
  categorias: CategoriaDelPresupuesto[],
  llegaDespues: PresupuestoDelPeriodo['llega_despues'] = [],
  parcial: Partial<PresupuestoDelPeriodo> = {},
): PresupuestoDelPeriodo => ({
  periodo_actual: '2026-11',
  periodo: '2026-11',
  editable: true,
  resumen: {
    en_cero: false,
    ingreso_registrado_centavos: '0',
    asignado_centavos: '0',
    sin_asignar_centavos: null,
    asignado_supera_por_centavos: null,
    llega_despues_centavos: '0',
    ...resumen,
  },
  llega_despues: llegaDespues,
  categorias,
  ...parcial,
});

// El salario del 16 de noviembre de 2026: esperado, no cuenta en «Sin asignar» (D-094, P-1).
export const salarioEsperado = {
  recurrente_id: 'r-salario',
  fecha: '2026-11-16',
  categoria_id: 17,
  monto_centavos: '120000000',
  marca: 'esperado' as const,
};

export const laura = datos(
  {
    modo: 'normal',
    ingreso_registrado_centavos: '120000000',
    asignado_centavos: '4000000',
    sin_asignar_centavos: '116000000',
    llega_despues_centavos: '120000000',
  },
  [
    transporte,
    sinPresupuesto(4, '65000000'),
    sinPresupuesto(1, '12000000'),
    sinPresupuesto(13, '2500000'),
    sinPresupuesto(11, '1500000'),
  ],
  [salarioEsperado],
);

export const nulo = (enCero = false, categorias: CategoriaDelPresupuesto[] = []) =>
  datos({ modo: 'ingreso_nulo', en_cero: enCero }, categorias);

export const bajo = datos(
  {
    modo: 'ingreso_bajo',
    ingreso_registrado_centavos: '15000000',
    asignado_centavos: '16000000',
    asignado_supera_por_centavos: '1000000',
  },
  [
    fila({
      categoria_id: 1,
      presupuesto: { id: 'p1', monto_centavos: '10000000' },
      estado: 'quedan',
      quedan_centavos: '10000000',
    }),
    fila({
      categoria_id: 8,
      presupuesto: { id: 'p8', monto_centavos: '6000000' },
      estado: 'quedan',
      quedan_centavos: '6000000',
    }),
  ],
);

const catalogo = {
  gasto: [1, 4, 5, 8, 11, 13, 16].map((id) => ({ id, nombre: 'x', general: id === 16 })),
  ingreso: [{ id: 17, nombre: 'x', general: false }, { id: 18, nombre: 'x', general: false }],
};

export type Pedido = { metodo: string; ruta: string; cuerpo?: string };
type Respuesta = (estado: number, cuerpo?: unknown) => Response;
type Contesta = () => Response | Promise<Response>;

/**
 * PN-71, las categorías, el presupuesto y lo que piden PN-01 y el formulario. `presupuesto` es lo que contesta el GET
 * (una función, si cambia con cada pedido); `poner`, `corregir`, `quitar` y `enCero` contestan el POST, el PUT, el
 * DELETE y el POST de la marca (por defecto `201`, `200`, `204` y `204`). Devuelve los pedidos, en orden.
 */
export function apiDelPresupuesto(
  respuestaJson: Respuesta,
  opciones: {
    presupuesto?: PresupuestoDelPeriodo | (() => PresupuestoDelPeriodo | Response);
    poner?: Contesta;
    corregir?: Contesta;
    quitar?: Contesta;
    enCero?: Contesta;
  } = {},
) {
  const pedidos: Pedido[] = [];
  const presupuesto = opciones.presupuesto ?? laura;
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const ruta = url.replace(BASE, '');
    const metodo = String(init.method);
    pedidos.push({ metodo, ruta, cuerpo: init.body as string | undefined });
    if (ruta.startsWith('/api/v1/cuenta/seguridad')) return respuestaJson(200, { ingreso_anterior: null });
    if (ruta === '/api/v1/categorias') return respuestaJson(200, catalogo);
    if (ruta === '/api/v1/repeticiones/pendientes')
      return respuestaJson(200, { pendientes: [], resumen: { total: 0, ingresos: 0, gastos: 0 } });
    if (ruta.startsWith('/api/v1/movimientos')) return respuestaJson(200, listado());
    if (ruta === '/api/v1/presupuestos/en-cero') return opciones.enCero?.() ?? respuestaJson(204);
    if (ruta === '/api/v1/presupuestos' && metodo === 'GET') {
      const actual = typeof presupuesto === 'function' ? presupuesto() : presupuesto;
      return actual instanceof Object && 'status' in actual ? actual : respuestaJson(200, actual);
    }
    if (metodo === 'POST') return opciones.poner?.() ?? respuestaJson(201, {});
    if (metodo === 'PUT') return opciones.corregir?.() ?? respuestaJson(200, {});
    if (metodo === 'DELETE') return opciones.quitar?.() ?? respuestaJson(204);
    throw new Error(`ruta sin respuesta: ${metodo} ${ruta}`);
  }) as unknown as typeof fetch;
  return pedidos;
}
