import { useSyncExternalStore } from 'react';

// Qué hojas inferiores hay en pantalla (ACC-004, bugs 303 y 304). `HojaInferior` lo dice; lo leen `Pantalla` (para que
// TalkBack no lea lo de atrás mientras una hoja está abierta) y `useLlevarFoco` (para no pedir el foco mientras una hoja
// termina de cerrarse). Es un estado de toda la app, como las regiones vivas de `anuncios.ts`: la hoja es otra ventana
// en Android y no sabe qué pantalla tiene debajo.
let visibles = 0;
let saliendo = 0;
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

/** Una hoja empieza su animación de cierre. Devuelve la función que dice que terminó (o que se canceló). */
export function hojaSaliendo(): () => void {
  saliendo++;
  let hecho = false;
  return () => {
    if (hecho) return;
    hecho = true;
    saliendo--;
    if (saliendo === 0) avisar();
  };
}

const suscribir = (oyente: () => void) => {
  oyentes.add(oyente);
  return () => void oyentes.delete(oyente);
};

/** Si hay una hoja en pantalla: `Pantalla` oculta su contenido a TalkBack mientras tanto. */
export const useHayHojaVisible = () => useSyncExternalStore(suscribir, () => visibles > 0);

/** Llama a `hacer` cuando ninguna hoja está cerrándose (ya, si no hay ninguna). Devuelve la función que lo cancela. */
export function cuandoNoHayHojasSaliendo(hacer: () => void): () => void {
  if (saliendo === 0) {
    hacer();
    return () => undefined;
  }
  const oyente = () => {
    if (saliendo !== 0) return;
    oyentes.delete(oyente);
    hacer();
  };
  oyentes.add(oyente);
  return () => void oyentes.delete(oyente);
}
