// PN-68 · Política de tratamiento (E14-PCP 4.11): lo que no es texto de la pantalla.

/**
 * La versión del texto de la política que lleva esta web. Es la `autorizacion.VersionActual` del API (RF-063): una
 * política nueva cambia las dos a la vez, y `tests/politica.test.ts` lee el archivo de Go y falla si no coinciden.
 */
export const VERSION_DE_LA_POLITICA = {
  numero: "1.1",
  fecha: "2026-11-12",
} as const;

/**
 * Las pantallas desde las que se abre PN-68 y qué hacen con ella (E14-PCP 4.11, «Con la versión que se vio» y «Estados»):
 * Atrás vuelve a la que la abrió y la Navegación lateral solo está donde hay sesión. La cookie de sesión no se lee desde
 * la página, así que la pantalla de origen lo dice. Lista cerrada: nada que venga en la dirección se usa como destino.
 */
const ORIGENES = {
  "/entrar": { lateral: false },
  "/crear-cuenta": { lateral: false },
  "/privacidad": { lateral: false },
  "/autorizacion": { lateral: false },
  "/cuenta/privacidad": { lateral: true },
  "/cuenta/seguridad": { lateral: true },
} as const;

export type Origen = keyof typeof ORIGENES;

const sinOrigen = { atras: "/entrar", lateral: false } as const;

/** La dirección de PN-68 desde una pantalla de la lista de arriba. */
export const enlaceALaPolitica = (desde: Origen) =>
  `/politica?desde=${encodeURIComponent(desde)}`;

/** A dónde vuelve Atrás y si lleva la barra lateral, según `?desde=`; sin un origen permitido, PN-60 y sin barra. */
export function origenDeLaPolitica(parametros: URLSearchParams): {
  atras: string;
  lateral: boolean;
} {
  const todos = parametros.getAll("desde");
  const desde = todos.length === 1 ? todos[0] : undefined;
  return desde !== undefined && Object.hasOwn(ORIGENES, desde)
    ? { atras: desde, lateral: ORIGENES[desde as Origen].lateral }
    : sinOrigen;
}
