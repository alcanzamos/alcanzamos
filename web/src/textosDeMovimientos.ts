import type { Movimiento } from "./api/movimientos";
import type { Medio } from "./api/registro";
import { formatearPesos } from "./dinero";
import { diaEnPalabras, relativoDelDia } from "./fechas";
import { nombresDeCategoria, type DatosDeAviso } from "./textos";
import { formatear, textos } from "./textos/es.generated";

// Los textos de PN-01 y PN-02 que se arman con datos del movimiento (E14-PRR 4.1 y 4.2). El texto sale de es.json;
// el monto, de `formatearPesos`, y las fechas, de las funciones comunes de `fechas.ts`.
const mv = textos.movimientos;

const nombreDeCategoria = (id: number | null) =>
  nombresDeCategoria[`c${id}`] ?? "";

export const mediosEnPalabras: Record<Medio, string> = {
  efectivo: textos.registro.medio.efectivo,
  transferencia: textos.registro.medio.transferencia,
};

const montoDe = (m: Movimiento) => formatearPesos(BigInt(m.monto_centavos));
const metaDe = (m: Movimiento) => m.meta?.nombre ?? "";

/** El tipo de una fila en palabras: un retiro de una meta es un aporte con sentido de salida. */
function tipoEnPalabras(m: Movimiento): string {
  if (m.tipo === "gasto") return textos.registro.tipo.gasto;
  if (m.tipo === "ingreso") return textos.registro.tipo.ingreso;
  return m.sentido === "salida" ? mv.fila.retiro : mv.fila.aporte;
}

/** Las dos líneas de una fila de PN-01 (E14-PRR 4.1, «Cómo se arma cada fila»): un aporte lleva su meta, no categoría. */
export function textosDeFila(m: Movimiento) {
  const nombre =
    m.tipo === "aporte" ? metaDe(m) : nombreDeCategoria(m.categoria_id);
  return {
    principal: m.descripcion
      ? formatear(mv.fila.conDescripcion, {
          nombre,
          descripcion: m.descripcion,
        })
      : nombre,
    apoyo: formatear(mv.fila.apoyo, {
      tipo: tipoEnPalabras(m),
      medio: mediosEnPalabras[m.medio],
    }),
  };
}

const relativo = (fecha: string, hoy: string) => {
  const dia = relativoDelDia(fecha, hoy);
  if (dia === null) return null;
  return dia === "hoy" ? textos.registro.fecha.hoy : mv.dia.ayer;
};

/** «Hoy, 2 de noviembre de 2026», «Ayer, 1 de noviembre de 2026» o «5 de octubre de 2026». */
export function tituloDelDia(fecha: string, hoy: string): string {
  const enPalabras = diaEnPalabras(fecha) ?? fecha;
  const dia = relativo(fecha, hoy);
  return dia
    ? formatear(mv.dia.conFecha, { dia, fecha: enPalabras })
    : enPalabras;
}

/** El resumen bajo el monto de PN-02: «Gasto en Alimentación», «Ingreso por Salario» o «Aporte a «Arriendo de enero»». */
export function resumenDelDetalle(m: Movimiento): string {
  if (m.tipo === "aporte") {
    const textoDeMeta =
      m.sentido === "salida" ? mv.detalle.retiroDe : mv.detalle.aporteA;
    return formatear(textoDeMeta, { meta: metaDe(m) });
  }
  const categoria = nombreDeCategoria(m.categoria_id);
  return formatear(
    m.tipo === "gasto" ? mv.detalle.gastoEn : mv.detalle.ingresoPor,
    {
      categoria,
    },
  );
}

/** «Gasto de $45.000 en Alimentación, Ayer.»: lo que se borra, en la hoja de PN-02. */
export function queSeBorra(m: Movimiento, hoy: string): string {
  const monto = montoDe(m);
  const dia = relativo(m.fecha, hoy) ?? diaEnPalabras(m.fecha) ?? m.fecha;
  const categoria = nombreDeCategoria(m.categoria_id);
  return formatear(m.tipo === "gasto" ? mv.borrar.gasto : mv.borrar.ingreso, {
    monto,
    categoria,
    dia,
  });
}

/** El aviso de después de borrar (E14-PRR 4.2, «Tras borrar»); el monto sigue la regla de E14-SDD 5.5. Un aporte o un retiro no se borra (D-170). */
export function avisoDeBorrado(m: Movimiento): DatosDeAviso {
  const t = textos.avisos;
  const titulo =
    m.tipo === "ingreso" ? t.borramosIngreso.titulo : t.borramosGasto.titulo;
  return {
    tipo: "informacion",
    titulo: formatear(titulo, { monto: montoDe(m) }),
  };
}
