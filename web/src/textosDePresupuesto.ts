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

const fraseDeUnaFecha = {
  esperado: t.resumen.seSumaCuandoLlegue,
  por_confirmar: t.resumen.seSumaCuandoLoConfirmes,
};

/**
 * La frase de una sola fecha, por cada marca (L14 de la US-77, punto 3): «Salario del 16 de noviembre de 2026 se suma
 * cuando llegue.» si hay una sola fecha esperada y «… se suma cuando lo confirmes.» si hay una sola por confirmar; con
 * más fechas de una marca, su línea («Llega después» o «Por confirmar») basta. Primero la esperada; sin ninguna, `null`.
 */
export function seSumaCuando(fechas: FechaQueLlegaDespues[]) {
  const frases = (["esperado", "por_confirmar"] as const).flatMap((marca) => {
    const grupo = fechas.filter((f) => f.marca === marca);
    const [unica] = grupo;
    if (!unica || grupo.length > 1) return [];
    return [
      formatear(fraseDeUnaFecha[marca], {
        nombre: nombreDeCategoria(unica.categoria_id),
        fecha: diaEnPalabras(unica.fecha) ?? unica.fecha,
      }),
    ];
  });
  return frases.length > 0 ? frases.join(" ") : null;
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
