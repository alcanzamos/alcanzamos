import { pedir } from "./cliente";
import type { Medio, Periodicidad, Tipo } from "./registro";

// Rutas de PN-01 (api/README.md, «Movimientos: lista, detalle, corregir y borrar»). El API no manda textos:
// manda ids, claves y códigos. Los montos llegan como texto (enteros de 64 bits, D-082): se pasan a `bigint`.
export type Recurrente = {
  recurrente_id: string;
  fecha_programada: string;
  periodicidad: Periodicidad;
  /** Al borrar el movimiento su fecha vuelve a «Por confirmar» (D-169, E15 5.2): lo decide el API. */
  vuelve_a_pendiente: boolean;
};

export type Movimiento = {
  id: string;
  tipo: Tipo | "aporte";
  monto_centavos: string;
  fecha: string;
  /** `null` en un aporte: lleva su meta. */
  categoria_id: number | null;
  medio: Medio;
  descripcion: string | null;
  /** La marca «Compartido con el hogar» (NM-05, SEG-002). */
  compartido: boolean;
  meta: { id: string; nombre: string } | null;
  sentido: "entrada" | "salida" | null;
  /** Solo si es una fecha confirmada de una repetición (D-168). */
  recurrente: Recurrente | null;
};

export type Listado = {
  periodo_actual: string;
  periodo: string;
  resumen: { movimientos: number; total_centavos: string | null };
  /** Los meses con movimientos, del más reciente al más antiguo («Otro mes»). */
  meses: string[];
  /** Las del periodo, de más a menos movimientos; incluye las ocultas (RN-011). */
  categorias: { categoria_id: number; movimientos: number; oculta: boolean }[];
  movimientos: Movimiento[];
};

export function listarMovimientos(
  periodo: string | null,
  categoria: number | null,
) {
  const consulta = new URLSearchParams();
  if (periodo) consulta.set("periodo", periodo);
  if (categoria) consulta.set("categoria", String(categoria));
  return pedir<Listado>("GET", `/api/v1/movimientos?${consulta}`);
}
