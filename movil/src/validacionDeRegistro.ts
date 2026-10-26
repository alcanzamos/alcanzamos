import type { Solicitud } from './api/registro';
import type { Borrador } from './borradorDeRegistro';
import { formatearPesos, leerMonto, type LecturaDeMonto } from './dinero';
import { esFechaDeMovimiento, hoyEnColombia } from './fechas';
import { formatear, textos } from './textos/es.generated';

// Los campos del formulario en el orden de la pantalla: el foco va al primero con error (E14-PPN 3.1).
export const CAMPOS = ['tipo', 'monto', 'fecha', 'categoria', 'medio', 'descripcion', 'repeticion'] as const;
export type Campo = (typeof CAMPOS)[number];
export type Errores = Partial<Record<Campo, string>>;

/** El campo del cuerpo del API a su campo en la pantalla. */
export const campoDeApi: Record<string, Campo> = {
  tipo: 'tipo',
  monto_centavos: 'monto',
  fecha: 'fecha',
  categoria_id: 'categoria',
  medio: 'medio',
  descripcion: 'descripcion',
  repeticion: 'repeticion',
};

const e = textos.registro.errores;

function textoDelMonto(m: Extract<LecturaDeMonto, { ok: false }>): string {
  switch (m.motivo) {
    case 'vacio':
      return e.montoVacio;
    case 'cero':
      return e.montoCero;
    case 'decimales':
      return e.montoDecimales;
    case 'ilegible':
      return e.montoIlegible;
    case 'grande':
      return e.montoGrande;
    case 'ambiguo':
      return formatear(e.montoAmbiguo, { miles: formatearPesos(m.miles), decimal: formatearPesos(m.decimal) });
  }
}

/** Revisa el formulario con los textos de E14-PPN 3.1 antes de mandarlo; el API vuelve a validar todo. */
export function validarRegistro(
  b: Borrador,
  categoriaId: number | null,
  hoy = hoyEnColombia(),
): { solicitud: Solicitud } | { errores: Errores } {
  const errores: Errores = {};
  const monto = leerMonto(b.monto);
  if (!monto.ok) errores.monto = textoDelMonto(monto);
  const fecha = b.fecha ?? hoy;
  if (!esFechaDeMovimiento(fecha)) errores.fecha = e.fecha;
  if (categoriaId === null) errores.categoria = e.categoria;
  if (b.medio === null) errores.medio = e.medio;
  if (!monto.ok || categoriaId === null || b.medio === null || errores.fecha) return { errores };
  return {
    solicitud: {
      tipo: b.tipo,
      montoCentavos: monto.centavos,
      fecha,
      categoriaId,
      medio: b.medio,
      descripcion: b.descripcion,
      periodicidad: b.periodicidad,
    },
  };
}
