import { pedir } from './cliente';
import type { Medio } from './registro';
import type { FechaPorConfirmar } from './repeticiones';

// Rutas de PN-06, PN-07 y PN-08 (api/README.md, «Presupuesto del periodo»). Las reglas viven en el API (E17-ECO 4.7): el modo
// de la pantalla, las sumas, los estados y el orden. El API no manda textos: ids, claves y códigos. Los montos llegan
// como texto (enteros de 64 bits, D-082) y se mandan armando el JSON a mano, sin pasar por `number`.

/** Qué tarjeta de resumen se muestra (D-094, P-3): PN-06 con `normal`; PN-07 con los otros dos. */
export type ModoDelPresupuesto = 'normal' | 'ingreso_bajo' | 'ingreso_nulo';

export type CategoriaDelPresupuesto = {
  categoria_id: number;
  /** Una oculta con presupuesto sigue en la lista (RN-011). */
  oculta: boolean;
  presupuesto: { id: string; monto_centavos: string } | null;
  gastado_centavos: string;
  /** Solo con presupuesto. */
  estado: 'quedan' | 'usado_todo' | 'superado' | null;
  quedan_centavos: string | null;
};

/**
 * Una fecha pendiente de una repetición de ingreso: no cuenta en «Sin asignar» (D-094, P-1). La marca dice si todavía
 * no llega (`esperado`) o si ya pasó y falta confirmarla (`por_confirmar`, US-60).
 */
export type FechaQueLlegaDespues = {
  recurrente_id: string;
  fecha: string;
  categoria_id: number;
  monto_centavos: string;
  marca: 'esperado' | 'por_confirmar';
};

export type PresupuestoDelPeriodo = {
  periodo_actual: string;
  periodo: string;
  /** Solo el mes en curso se pone, corrige y quita (D-094, SC-E21-13). */
  editable: boolean;
  resumen: {
    modo: ModoDelPresupuesto;
    /** Se dejó en cero y sigue en cero: el botón no vuelve a salir. */
    en_cero: boolean;
    ingreso_registrado_centavos: string;
    asignado_centavos: string;
    sin_asignar_centavos: string | null;
    asignado_supera_por_centavos: string | null;
    /** Solo lo esperado: «Llega después: $X (esperado)». */
    llega_despues_centavos: string;
    /** Solo lo por confirmar: la línea aparte «Por confirmar: $Y» (L14 de la US-77). */
    por_confirmar_centavos: string;
  };
  llega_despues: FechaQueLlegaDespues[];
  /** Primero las que tienen presupuesto y después las demás, en el orden que manda el API. */
  categorias: CategoriaDelPresupuesto[];
};

export type MarcaDeIngreso = 'registrado' | 'esperado' | 'por_confirmar';

export type IngresoDelPeriodo = {
  fecha: string;
  marca: MarcaDeIngreso;
  monto_centavos: string;
  medio: Medio;
  descripcion: string | null;
  /** Lo registrado: el movimiento de PN-02. */
  movimiento_id: string | null;
  /** Lo esperado y lo por confirmar: la repetición de la US-60. */
  recurrente_id: string | null;
};

export type FuenteDeIngreso = {
  categoria_id: number;
  oculta: boolean;
  total_centavos: string;
  ingresos: IngresoDelPeriodo[];
};

export type IngresosDelPeriodo = {
  periodo_actual: string;
  periodo: string;
  /** Los meses con ingresos registrados, del más reciente al más antiguo («Otro mes»). */
  meses: string[];
  total: {
    entran_centavos: string;
    registrado_centavos: string;
    esperado_centavos: string;
    /** Con dos o más, «Confirmar todos» (D-093). */
    por_confirmar: number;
  };
  /** De mayor a menor total. */
  fuentes: FuenteDeIngreso[];
};

const PRESUPUESTOS = '/api/v1/presupuestos';

/** PN-06 y PN-07 muestran el mes en curso (D-094): el API lo elige. */
export const leerPresupuesto = () => pedir<PresupuestoDelPeriodo>('GET', PRESUPUESTOS);

/** «Poner presupuesto» del mes en curso; si la categoría ya tenía, el API lo corrige. */
export const ponerPresupuesto = (periodo: string, categoriaId: number, montoCentavos: bigint) =>
  pedir(
    'POST',
    PRESUPUESTOS,
    `{"periodo":${JSON.stringify(periodo)},"categoria_id":${categoriaId},"monto_centavos":${montoCentavos}}`,
  );

export const corregirPresupuesto = (id: string, montoCentavos: bigint) =>
  pedir('PUT', `${PRESUPUESTOS}/${encodeURIComponent(id)}`, `{"monto_centavos":${montoCentavos}}`);

/** «Quitar presupuesto»: ningún gasto cambia. */
export const quitarPresupuesto = (id: string) => pedir('DELETE', `${PRESUPUESTOS}/${encodeURIComponent(id)}`);

/** «Dejar el presupuesto en cero» (CU-10 2a): guarda la marca del mes. */
export const dejarEnCero = (periodo: string) => pedir('POST', `${PRESUPUESTOS}/en-cero`, { periodo });

/** PN-08: sin periodo, el mes en curso. Sin `URLSearchParams`: en React Native no implementa `set`. */
export const listarIngresos = (periodo: string | null) =>
  pedir<IngresosDelPeriodo>('GET', periodo ? `/api/v1/ingresos?periodo=${encodeURIComponent(periodo)}` : '/api/v1/ingresos');

/** Una fecha por confirmar de PN-08 con lo que piden «Confirmar», «Más» y «Confirmar todos» de la US-60. */
export const porConfirmarDe = (fuente: FuenteDeIngreso, ingreso: IngresoDelPeriodo): FechaPorConfirmar | null =>
  ingreso.marca === 'por_confirmar' && ingreso.recurrente_id
    ? {
        recurrente_id: ingreso.recurrente_id,
        fecha: ingreso.fecha,
        tipo: 'ingreso',
        categoria_id: fuente.categoria_id,
        medio: ingreso.medio,
        monto_habitual_centavos: ingreso.monto_centavos,
      }
    : null;

/** Las fechas por confirmar del periodo, en el orden de la pantalla. */
export const fechasPorConfirmar = (datos: IngresosDelPeriodo): FechaPorConfirmar[] =>
  datos.fuentes.flatMap((f) => f.ingresos.flatMap((i) => porConfirmarDe(f, i) ?? []));
