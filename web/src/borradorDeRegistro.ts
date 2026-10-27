import { useSyncExternalStore } from "react";
import type { Medio, Periodicidad, Tipo } from "./api/registro";

// Lo que la persona lleva escrito en el formulario de registro (PN-01) mientras elige «Se repite» en PN-03, que es otra
// pantalla. Vive en memoria: no se guarda en el navegador y se pierde al recargar (son datos financieros).
// Regla (L10): solo existe mientras la persona está en PN-01 o PN-03. En cualquier otra pantalla se vacía (`App`), así
// que abrir el formulario desde PN-71 empieza vacío y cerrar la sesión, por la salida que sea, no deja nada escrito.
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
