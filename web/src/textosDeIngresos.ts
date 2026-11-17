import type { IngresoDelPeriodo } from "./api/presupuesto";
import { diaEnPalabras } from "./fechas";
import type { DatosDeAviso } from "./textos";
import { mediosEnPalabras } from "./textosDeMovimientos";
import { formatear, textos } from "./textos/es.generated";

// Los textos de PN-08 (E14-PPA 4.3) que se arman con datos del API. La fecha va en palabras (D-090).
const i = textos.ingresos;

export const avisoErrorAlCargarIngresos: DatosDeAviso = {
  tipo: "informacion",
  titulo: i.avisos.errorAlCargar.titulo,
  mensaje: i.avisos.errorAlCargar.mensaje,
};

const marcas = {
  registrado: i.marca.registrado,
  esperado: i.marca.esperado,
  por_confirmar: textos.porConfirmar.marca,
};

/** Las líneas de una fecha de PN-08 (E14-PPA 4.3, «Cómo se arma cada fila»). */
export function textosDeIngreso(ingreso: IngresoDelPeriodo) {
  const medio = mediosEnPalabras[ingreso.medio];
  return {
    fecha: diaEnPalabras(ingreso.fecha) ?? ingreso.fecha,
    apoyo: ingreso.descripcion
      ? formatear(i.apoyoConDescripcion, {
          medio,
          descripcion: ingreso.descripcion,
        })
      : medio,
    marca: marcas[ingreso.marca],
  };
}
