import { pedir } from './cliente';

// Rutas del formulario de registro (api/README.md, «Registro de movimientos»). El API no manda textos: manda ids,
// claves del catálogo y códigos de error, y cada campo del cuerpo que falla vuelve con su código en `campos`.
export const PERIODICIDADES = ['semanal', 'quincenal', 'mensual', 'semestral', 'anual'] as const;
export type Periodicidad = (typeof PERIODICIDADES)[number];
export type Tipo = 'gasto' | 'ingreso';
export type Medio = 'efectivo' | 'transferencia';

export type CategoriaDelApi = { id: number; nombre: string; general: boolean };
export type CatalogoDeCategorias = Record<Tipo, CategoriaDelApi[]>;

export type Solicitud = {
  tipo: Tipo;
  /** Centavos enteros: un `bigint`, porque el API admite hasta 2^63 − 1 y un `number` no los guarda exactos (D-082). */
  montoCentavos: bigint;
  fecha: string;
  /** `null` solo en el aporte que se corrige: no lleva categoría (E14-PRR PN-02). */
  categoriaId: number | null;
  medio: Medio;
  descripcion: string;
  /** `null`: no se repite. */
  periodicidad: Periodicidad | null;
};

export type ResultadoDelRegistro = {
  /** `null` si solo se guardó la repetición (fecha futura, D-164). */
  movimiento_id: string | null;
  recurrente_id: string | null;
  proximas: string[];
  pendientes: string[];
};

/** Las próximas fechas que calcula el API (E15 5.2, E17-ECO 4.7): el cliente no las calcula, las muestra. */
export type ProximasFechas = { proximas: string[] };

export const obtenerProximas = (periodicidad: Periodicidad, inicio: string) =>
  pedir<ProximasFechas>('GET', `/api/v1/repeticiones/proximas?periodicidad=${periodicidad}&inicio=${inicio}`);

export const obtenerCategorias = () => pedir<CatalogoDeCategorias>('GET', '/api/v1/categorias');

export function guardarMovimiento(s: Solicitud) {
  const resto = JSON.stringify({
    tipo: s.tipo,
    fecha: s.fecha,
    categoria_id: s.categoriaId,
    medio: s.medio,
    ...(s.descripcion.trim() ? { descripcion: s.descripcion.trim() } : {}),
    ...(s.periodicidad ? { repeticion: { periodicidad: s.periodicidad } } : {}),
  });
  // `JSON.stringify` no escribe un `bigint`: los centavos se pegan como dígitos, sin pasar por un `number`.
  return pedir<ResultadoDelRegistro>(
    'POST',
    '/api/v1/movimientos',
    `{"monto_centavos":${s.montoCentavos},${resto.slice(1)}`,
  );
}
