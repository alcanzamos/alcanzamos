import { useSyncExternalStore } from "react";
import type { Movimiento } from "./api/movimientos";
import type { Medio, Periodicidad, Tipo } from "./api/registro";
import { formatearPesos } from "./dinero";

// Lo que la persona lleva escrito en el formulario de registro mientras elige «Se repite» en PN-03, que es otra
// pantalla. Vive en memoria: no se guarda en el navegador y se pierde al recargar (son datos financieros).
// Regla (L10): solo existe mientras la persona está en el formulario o en PN-03. En cualquier otra pantalla se vacía
// (`App`), así que abrir el formulario desde PN-01 (D-164) empieza vacío y cerrar la sesión, por la salida que sea, no
// deja nada escrito. «Corregir» (PN-02) no lo usa: lleva su propio estado, para que corregir no deje nada en el borrador.
export const RUTAS_DEL_BORRADOR = ["/registrar", "/registrar/se-repite"];
export type Borrador = {
  tipo: Tipo;
  /** El texto del campo, tal como lo escribió la persona. */
  monto: string;
  /** `null` es «Hoy»; la cadena vacía es un campo sin fecha. */
  fecha: string | null;
  categoriaId: number | null;
  medio: Medio | null;
  descripcion: string;
  /** `null`: «No se repite». */
  periodicidad: Periodicidad | null;
};

const vacio: Borrador = {
  tipo: "gasto",
  monto: "",
  fecha: null,
  categoriaId: null,
  medio: null,
  descripcion: "",
  periodicidad: null,
};

/** Los campos de «Corregir» de PN-02, llenos con lo que ya tiene el movimiento (E14-PRR 4.2). */
export const borradorDeMovimiento = (m: Movimiento): Borrador => ({
  tipo: m.tipo === "aporte" ? "gasto" : m.tipo,
  monto: formatearPesos(BigInt(m.monto_centavos)),
  fecha: m.fecha,
  categoriaId: m.categoria_id,
  medio: m.medio,
  descripcion: m.descripcion ?? "",
  periodicidad: null,
});

let actual = vacio;
const oyentes = new Set<() => void>();

const suscribir = (oyente: () => void) => {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
};

export function cambiarBorrador(cambio: Partial<Borrador>) {
  actual = { ...actual, ...cambio };
  oyentes.forEach((oyente) => oyente());
}

export const reiniciarBorrador = () => cambiarBorrador({ ...vacio });

export const useBorrador = () => useSyncExternalStore(suscribir, () => actual);
