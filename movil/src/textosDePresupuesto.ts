import type { CategoriaDelPresupuesto, FechaQueLlegaDespues } from './api/presupuesto';
import { formatearPesos } from './dinero';
import { diaEnPalabras, mesEnPalabras } from './fechas';
import { montoHablado } from './montoHablado';
import { nombresDeCategoria, type DatosDeAviso } from './textos';
import { formatear, textos } from './textos/es.generated';

// Los textos de PN-06 y PN-07 (E14-PPA 4.1 y 4.2) que se arman con datos del API, los mismos de la web. El texto sale
// de es.json; el monto, de `formatearPesos` (lo que se ve) o de `montoHablado` (lo que dice TalkBack, ACC-004, D-187),
// y las fechas, en palabras (D-090).
const t = textos.presupuesto;

export const nombreDeCategoria = (id: number) => nombresDeCategoria[`c${id}`] ?? '';

/** «noviembre», como lo dicen «Presupuesto de noviembre» y «Monto para noviembre». */
export const mesEnMinuscula = (periodo: string) => (mesEnPalabras(periodo) ?? periodo).toLowerCase();

/** Un monto que llega como texto, como se ve y como se dice. */
export const pesos = (centavos: string) => formatearPesos(BigInt(centavos));
export const pesosHablados = (centavos: string) => montoHablado(BigInt(centavos));

/** El apoyo y el estado de una fila de «Por categoría», con el monto que se pase (visto o hablado). */
function lineasDeCategoria(c: CategoriaDelPresupuesto, monto: (centavos: string) => string) {
  const gastado = monto(c.gastado_centavos);
  const presupuesto = c.presupuesto ? monto(c.presupuesto.monto_centavos) : '';
  const estados = {
    quedan: formatear(t.categorias.quedan, { monto: monto(c.quedan_centavos ?? '0') }),
    usado_todo: t.categorias.usadoTodo,
    superado: formatear(t.categorias.superado, { gastado, presupuesto }),
  };
  return {
    apoyo: c.presupuesto
      ? formatear(t.categorias.conPresupuesto, { presupuesto, gastado })
      : formatear(t.categorias.sinPresupuesto, { gastado }),
    estado: c.estado ? estados[c.estado] : null,
  };
}

/**
 * Las líneas de una fila de «Por categoría», los nombres accesibles de sus botones (E14-PPA 4.1) y `etiqueta`, lo que
 * TalkBack lee de la fila entera: la categoría, «Oculta», el apoyo y el estado, con los montos en pesos.
 */
export function textosDeCategoria(c: CategoriaDelPresupuesto) {
  const categoria = nombreDeCategoria(c.categoria_id);
  const visto = lineasDeCategoria(c, pesos);
  const hablado = lineasDeCategoria(c, pesosHablados);
  return {
    categoria,
    ...visto,
    etiqueta: [categoria, c.oculta ? textos.movimientos.oculta : null, hablado.apoyo, hablado.estado]
      .filter(Boolean)
      .join(', '),
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
  tipo: 'informacion',
  titulo,
  ...(mensaje ? { mensaje } : {}),
});

// Un aviso nuevo en cada llamada: la pantalla lo anuncia aunque el anterior dijera lo mismo (ACC-004).
export const avisosDePresupuesto = {
  guardamos: (categoria: string) => informacion(formatear(t.avisos.guardamos, { categoria })),
  quitamos: (categoria: string) => informacion(formatear(t.avisos.quitamos, { categoria })),
  enCero: (periodo: string) => informacion(formatear(t.avisos.enCero, { mes: mesEnMinuscula(periodo) })),
  errorAlGuardar: () => informacion(t.avisos.errorAlGuardar.titulo, t.avisos.errorAlGuardar.mensaje),
  errorAlCargar: informacion(t.avisos.errorAlCargar.titulo, t.avisos.errorAlCargar.mensaje),
};
