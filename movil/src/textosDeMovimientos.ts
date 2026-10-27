import type { Movimiento } from './api/movimientos';
import type { Medio } from './api/registro';
import { diaEnPalabras, relativoDelDia } from './fechas';
import { nombresDeCategoria } from './textos';
import { formatear, textos } from './textos/es.generated';

// Los textos de PN-01 que se arman con datos del movimiento (E14-PRR 4.1). El texto sale de es.json y las fechas, de
// las funciones comunes de `fechas.ts`; el monto lo pone quien dibuja la fila.
const mv = textos.movimientos;

export const nombreDeCategoria = (id: number | null) => nombresDeCategoria[`c${id}`] ?? '';

export const mediosEnPalabras: Record<Medio, string> = {
  efectivo: textos.registro.medio.efectivo,
  transferencia: textos.registro.medio.transferencia,
};

/** El tipo de una fila en palabras: un retiro de una meta es un aporte con sentido de salida. */
function tipoEnPalabras(m: Movimiento): string {
  if (m.tipo === 'gasto') return textos.registro.tipo.gasto;
  if (m.tipo === 'ingreso') return textos.registro.tipo.ingreso;
  return m.sentido === 'salida' ? mv.fila.retiro : mv.fila.aporte;
}

/** Las dos líneas de una fila de PN-01 (E14-PRR 4.1, «Cómo se arma cada fila»): un aporte lleva su meta, no categoría. */
export function textosDeFila(m: Movimiento) {
  const nombre = m.tipo === 'aporte' ? (m.meta?.nombre ?? '') : nombreDeCategoria(m.categoria_id);
  return {
    principal: m.descripcion ? formatear(mv.fila.conDescripcion, { nombre, descripcion: m.descripcion }) : nombre,
    apoyo: formatear(mv.fila.apoyo, { tipo: tipoEnPalabras(m), medio: mediosEnPalabras[m.medio] }),
  };
}

/** «Hoy, 2 de noviembre de 2026», «Ayer, 1 de noviembre de 2026» o «5 de octubre de 2026». */
export function tituloDelDia(fecha: string, hoy: string): string {
  const enPalabras = diaEnPalabras(fecha) ?? fecha;
  const dia = relativoDelDia(fecha, hoy);
  if (dia === null) return enPalabras;
  return formatear(mv.dia.conFecha, { dia: dia === 'hoy' ? textos.registro.fecha.hoy : mv.dia.ayer, fecha: enPalabras });
}
