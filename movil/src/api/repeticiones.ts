import { pedir } from './cliente';
import type { Movimiento } from './movimientos';
import type { Medio, Periodicidad, Tipo } from './registro';

// Rutas de «Por confirmar» (api/README.md, «Por confirmar: fechas pendientes de una repetición»). El API decide qué
// fecha está pendiente y arma las cuentas (E17-ECO 4.7): el cliente muestra lo que recibe y manda sus decisiones.
// Los montos llegan como texto (enteros de 64 bits, D-082) y se mandan armando el JSON a mano, sin pasar por `number`.
export type Pendiente = {
  recurrente_id: string;
  fecha: string;
  tipo: Tipo;
  /** La repetición no guarda un nombre: la fila se titula con esta categoría. */
  categoria_id: number;
  medio: Medio;
  monto_habitual_centavos: string;
  periodicidad: Periodicidad;
};

/** Lo que usa una fila «Por confirmar» y sus hojas; PN-08 la arma con una fecha de ingreso, que no trae la periodicidad. */
export type FechaPorConfirmar = Omit<Pendiente, 'periodicidad'>;

export type Pendientes = {
  pendientes: Pendiente[];
  resumen: { total: number; ingresos: number; gastos: number };
};

/** Una decisión de «Confirmar todos»: el monto solo si la persona lo cambió; `omitida` es «No pasó». */
export type Decision = {
  recurrenteId: string;
  fecha: string;
  montoCentavos?: bigint;
  omitida?: boolean;
};

export type Decididas = {
  movimientos: Movimiento[];
  omitidas: { recurrente_id: string; fecha: string }[];
  siguen_pendientes: number;
  resumen: { guardados: number; omitidas: number };
};

const ruta = (id: string, accion: string) => `/api/v1/repeticiones/${encodeURIComponent(id)}/${accion}`;

export const listarPendientes = () => pedir<Pendientes>('GET', '/api/v1/repeticiones/pendientes');

/** Confirma una fecha con el monto habitual o, con `montoCentavos`, con otro solo para esa fecha. */
export function confirmarFecha(id: string, fecha: string, montoCentavos?: bigint) {
  const monto = montoCentavos === undefined ? '' : `,"monto_centavos":${montoCentavos}`;
  return pedir<Movimiento>('POST', ruta(id, 'confirmacion'), `{"fecha":${JSON.stringify(fecha)}${monto}}`);
}

/** «No pasó»: guarda la fecha omitida; no crea ningún movimiento. */
export const omitirFecha = (id: string, fecha: string) => pedir('POST', ruta(id, 'omision'), { fecha });

/** «Confirmar todos»: solo las filas marcadas y las «No pasó»; el API guarda todo o nada (D-093). */
export function decidir(decisiones: Decision[]) {
  const cuerpo = decisiones.map((d) => {
    const resto = d.omitida
      ? ',"omitida":true'
      : d.montoCentavos === undefined
        ? ''
        : `,"monto_centavos":${d.montoCentavos}`;
    return `{"recurrente_id":${JSON.stringify(d.recurrenteId)},"fecha":${JSON.stringify(d.fecha)}${resto}}`;
  });
  return pedir<Decididas>('POST', '/api/v1/repeticiones/decisiones', `{"decisiones":[${cuerpo.join(',')}]}`);
}
