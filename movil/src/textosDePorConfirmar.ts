import type { Movimiento } from './api/movimientos';
import type { Pendiente } from './api/repeticiones';
import { formatearPesos } from './dinero';
import { diaEnPalabras } from './fechas';
import { mediosEnPalabras } from './textosDeMovimientos';
import { nombresDeCategoria, type DatosDeAviso } from './textos';
import { formatear, textos } from './textos/es.generated';

// Los textos de «Por confirmar» (E14-PRR 4.1 y 4.8) que se arman con datos de la fecha pendiente. El texto sale de
// es.json; el monto, de `formatearPesos`, y la fecha, en palabras (D-090).
const p = textos.porConfirmar;

const tipoEnPalabras = {
  gasto: textos.registro.tipo.gasto,
  ingreso: textos.registro.tipo.ingreso,
};

/** Las líneas de una fila «Por confirmar»; la repetición no tiene nombre: la fila se titula con su categoría. */
export function textosDeFilaPorConfirmar(fila: Pendiente) {
  const principal = nombresDeCategoria[`c${fila.categoria_id}`] ?? '';
  const fecha = diaEnPalabras(fila.fecha) ?? fila.fecha;
  const tipo = tipoEnPalabras[fila.tipo];
  return {
    principal,
    fecha,
    apoyo: formatear(p.apoyoConMedio, {
      tipo,
      medio: mediosEnPalabras[fila.medio],
      fecha,
    }),
    nombreDeConfirmar: formatear(p.nombreDeConfirmar, {
      nombre: principal,
      fecha,
    }),
    nombreDeMas: formatear(p.nombreDeMas, { nombre: principal, fecha }),
    tituloDeLaHoja: formatear(p.hoja.titulo, { nombre: principal, fecha }),
    tituloDelMonto: fila.tipo === 'ingreso' ? p.hoja.tituloDeIngreso : p.hoja.tituloDeGasto,
  };
}

const informacion = (titulo: string, mensaje?: string): DatosDeAviso => ({
  tipo: 'informacion',
  titulo,
  ...(mensaje ? { mensaje } : {}),
});

const a = p.avisos;

export const avisosDePorConfirmar = {
  yaNoContamos: informacion(a.yaNoContamos),
  errorAlConfirmar: informacion(a.errorAlConfirmar.titulo, a.errorAlConfirmar.mensaje),
  errorAlOmitir: informacion(a.errorAlOmitir.titulo, a.errorAlOmitir.mensaje),
};

/** «Listo, confirmamos tu ingreso de $1.200.000.»: el tipo y el monto son los del movimiento que guardó el API. */
export function avisoDeConfirmado(movimiento: Movimiento): DatosDeAviso {
  const texto = movimiento.tipo === 'ingreso' ? a.confirmamosIngreso : a.confirmamosGasto;
  return informacion(
    formatear(texto, {
      monto: formatearPesos(BigInt(movimiento.monto_centavos)),
    }),
  );
}
