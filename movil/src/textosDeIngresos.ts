import type { IngresoDelPeriodo } from './api/presupuesto';
import { diaEnPalabras } from './fechas';
import type { DatosDeAviso } from './textos';
import { mediosEnPalabras } from './textosDeMovimientos';
import { pesosHablados } from './textosDePresupuesto';
import { formatear, textos } from './textos/es.generated';

// Los textos de PN-08 (E14-PPA 4.3) que se arman con datos del API, los mismos de la web. La fecha va en palabras
// (D-090) y lo que dice TalkBack lleva el monto en pesos (ACC-004, D-187).
const i = textos.ingresos;

export const avisoErrorAlCargarIngresos: DatosDeAviso = {
  tipo: 'informacion',
  titulo: i.avisos.errorAlCargar.titulo,
  mensaje: i.avisos.errorAlCargar.mensaje,
};

const marcas = {
  registrado: i.marca.registrado,
  esperado: i.marca.esperado,
  por_confirmar: textos.porConfirmar.marca,
};

/**
 * Las líneas de una fecha de PN-08 (E14-PPA 4.3, «Cómo se arma cada fila») y `etiqueta`, lo que TalkBack lee de la fila
 * entera: la fecha, el apoyo, la marca y el monto en pesos.
 */
export function textosDeIngreso(ingreso: IngresoDelPeriodo) {
  const medio = mediosEnPalabras[ingreso.medio];
  const fecha = diaEnPalabras(ingreso.fecha) ?? ingreso.fecha;
  const marca = marcas[ingreso.marca];
  return {
    fecha,
    apoyo: ingreso.descripcion
      ? formatear(i.apoyoConDescripcion, { medio, descripcion: ingreso.descripcion })
      : medio,
    marca,
    etiqueta: [fecha, medio, ingreso.descripcion, marca, pesosHablados(ingreso.monto_centavos)].filter(Boolean).join(', '),
  };
}
