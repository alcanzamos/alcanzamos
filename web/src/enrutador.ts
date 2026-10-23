import { useSyncExternalStore, type MouseEvent } from "react";

// Enrutador mínimo para una app de una página servida por el API (mismo origen, History API).
// Son pocas rutas y ninguna anidada: una dependencia más (con su licencia y su auditoría) no se justifica.
const EVENTO = "alcanzamos:navegacion";

let huboNavegacion = false;

function suscribir(avisar: () => void) {
  window.addEventListener("popstate", avisar);
  window.addEventListener(EVENTO, avisar);
  return () => {
    window.removeEventListener("popstate", avisar);
    window.removeEventListener(EVENTO, avisar);
  };
}

const instantanea = () => window.location.pathname + window.location.search;

/** Ruta y parámetros de la dirección actual. */
export function useUbicacion() {
  const actual = useSyncExternalStore(suscribir, instantanea);
  const [ruta = "/", busqueda = ""] = actual.split("?");
  return { ruta, parametros: new URLSearchParams(busqueda) };
}

/** Lleva a otra pantalla sin recargar la página. `reemplazar` no deja la anterior en el historial. */
export function navegar(
  destino: string,
  reemplazar = false,
  estado: unknown = null,
) {
  huboNavegacion = true;
  if (reemplazar) window.history.replaceState(estado, "", destino);
  else window.history.pushState(estado, "", destino);
  window.dispatchEvent(new Event(EVENTO));
}

/** Verdadero cuando la pantalla apareció por una navegación (no en la carga inicial): ahí se mueve el foco al título. */
export const llegoNavegando = () => huboNavegacion;

/** Para un `<a href>`: un clic normal navega sin recargar; Ctrl, Mayús, Cmd o el botón del medio dejan al navegador. */
export const alTocarEnlace = (href: string) => (evento: MouseEvent) => {
  if (
    evento.button !== 0 ||
    evento.metaKey ||
    evento.ctrlKey ||
    evento.shiftKey
  )
    return;
  evento.preventDefault();
  navegar(href);
};
