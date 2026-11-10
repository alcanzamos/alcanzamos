import type {
  CategoriaDelPresupuesto,
  FechaQueLlegaDespues,
} from "./api/presupuesto";
import { formatearPesos } from "./dinero";
import { diaEnPalabras, mesEnPalabras } from "./fechas";
import { nombresDeCategoria, type DatosDeAviso } from "./textos";
import { formatear, textos } from "./textos/es.generated";

// Los textos de PN-06 y PN-07 (E14-PPA 4.1 y 4.2) que se arman con datos del API. El texto sale de es.json;
// el monto, de `formatearPesos`, y las fechas, en palabras (D-090).
const t = textos.presupuesto;

export const nombreDeCategoria = (id: number) =>
  nombresDeCategoria[`c${id}`] ?? "";

/** «noviembre», como lo dicen «Presupuesto de noviembre» y «Monto para noviembre». */
export const mesEnMinuscula = (periodo: string) =>
  (mesEnPalabras(periodo) ?? periodo).toLowerCase();

const pesos = (centavos: string) => formatearPesos(BigInt(centavos));

/** Las líneas de una fila de «Por categoría» y los nombres accesibles de sus botones (E14-PPA 4.1). */
export function textosDeCategoria(c: CategoriaDelPresupuesto) {
  const categoria = nombreDeCategoria(c.categoria_id);
  const gastado = pesos(c.gastado_centavos);
  const presupuesto = c.presupuesto ? pesos(c.presupuesto.monto_centavos) : "";
  const estados = {
    quedan: formatear(t.categorias.quedan, {
      monto: pesos(c.quedan_centavos ?? "0"),
    }),
    usado_todo: t.categorias.usadoTodo,
    superado: formatear(t.categorias.superado, { gastado, presupuesto }),
  };
  return {
    categoria,
    apoyo: c.presupuesto
      ? formatear(t.categorias.conPresupuesto, { presupuesto, gastado })
      : formatear(t.categorias.sinPresupuesto, { gastado }),
    estado: c.estado ? estados[c.estado] : null,
    nombreDePoner: formatear(t.categorias.nombreDePoner, { categoria }),
    nombreDeCorregir: formatear(t.hoja.tituloCorregir, { categoria }),
    nombreDeQuitar: formatear(t.categorias.nombreDeQuitar, { categoria }),
  };
}

/** «Salario del 16 de noviembre de 2026 se suma cuando llegue.»: solo con una fecha; con más, la fila «Llega después» basta. */
export function seSumaCuandoLlegue(fechas: FechaQueLlegaDespues[]) {
  const [unica] = fechas;
  if (!unica || fechas.length > 1) return null;
  return formatear(t.resumen.seSumaCuandoLlegue, {
    nombre: nombreDeCategoria(unica.categoria_id),
    fecha: diaEnPalabras(unica.fecha) ?? unica.fecha,
  });
}

const informacion = (titulo: string, mensaje?: string): DatosDeAviso => ({
  tipo: "informacion",
  titulo,
  ...(mensaje ? { mensaje } : {}),
});

export const avisosDePresupuesto = {
  guardamos: (categoria: string) =>
    informacion(formatear(t.avisos.guardamos, { categoria })),
  quitamos: (categoria: string) =>
    informacion(formatear(t.avisos.quitamos, { categoria })),
  enCero: (periodo: string) =>
    informacion(formatear(t.avisos.enCero, { mes: mesEnMinuscula(periodo) })),
  errorAlGuardar: informacion(
    t.avisos.errorAlGuardar.titulo,
    t.avisos.errorAlGuardar.mensaje,
  ),
  errorAlCargar: informacion(
    t.avisos.errorAlCargar.titulo,
    t.avisos.errorAlCargar.mensaje,
  ),
};
