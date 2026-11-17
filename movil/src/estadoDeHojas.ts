import { useSyncExternalStore } from 'react';

// Qué hojas inferiores hay en pantalla (ACC-004, bugs 303 y 304). `HojaInferior` lo dice; lo leen `Pantalla` (para que
// TalkBack no lea lo de atrás mientras una hoja está abierta) y `useLlevarFoco` (para no pedir el foco mientras haya una
// hoja en pantalla: abierta, o saliendo, o con la salida interrumpida porque la persona la abrió de nuevo). Es un estado
// de toda la app, como las regiones vivas de `anuncios.ts`: la hoja es otra ventana en Android y no sabe qué pantalla
// tiene debajo.
let visibles = 0;
const oyentes = new Set<() => void>();
const avisar = () => [...oyentes].forEach((oyente) => oyente());

/** Una hoja se dibuja (abierta o saliendo). Devuelve la función que dice que ya no. */
export function hojaVisible(): () => void {
  visibles++;
  avisar();
  let hecho = false;
  return () => {
    if (hecho) return;
    hecho = true;
    visibles--;
    avisar();
  };
}

const suscribir = (oyente: () => void) => {
  oyentes.add(oyente);
  return () => void oyentes.delete(oyente);
};

/** Si hay una hoja en pantalla, abierta o saliendo: `Pantalla` oculta su contenido a TalkBack mientras tanto. */
export const useHayHojaVisible = () => useSyncExternalStore(suscribir, () => visibles > 0);

/** Si hay una hoja en pantalla ahora mismo, abierta o saliendo. */
export const hayHojaVisible = () => visibles > 0;

/** Llama a `hacer` cuando no hay ninguna hoja en pantalla (ya, si no hay ninguna). Devuelve la función que lo cancela. */
export function cuandoNoHayHojas(hacer: () => void): () => void {
  if (visibles === 0) {
    hacer();
    return () => undefined;
  }
  const oyente = () => {
    if (visibles !== 0) return;
    oyentes.delete(oyente);
    hacer();
  };
  oyentes.add(oyente);
  return () => void oyentes.delete(oyente);
}
