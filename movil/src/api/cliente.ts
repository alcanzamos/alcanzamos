import { urlDelApi } from '../config';
import { borrarToken, guardarToken, leerToken } from '../sesion/token';

// Único lugar que llama al API (D-129). No decide nada de negocio: devuelve el estado, el código de error y los
// errores de campo que manda el API (api/README.md).
export type Respuesta<T> =
  | { ok: true; estado: number; cuerpo: T }
  | {
      ok: false;
      estado: number;
      codigo: string;
      campos: Record<string, string>;
    };

/** `estado` 0 y este código: el pedido no llegó (sin internet o el servidor no contestó). */
export const SIN_CONEXION = 'sin_conexion';
/** `estado` 0 y este código: la app no tiene la dirección del API (`EXPO_PUBLIC_URL_API`). Se trata como sin conexión. */
export const SIN_CONFIGURACION = 'sin_configuracion';

type Cuerpo = Record<string, unknown>;

/**
 * Las cabeceras de todo pedido. Manda `X-Alcanzamos-Cliente: android`, para que el API entregue el token en el cuerpo
 * (D-143 (3)), y `Authorization: Bearer` si hay sesión. Nunca `Origin` ni `Sec-Fetch-Site`: React Native no las agrega
 * y el API rechaza el modo Android si llegan. Tampoco se agregan aquí.
 */
export function cabeceras(token: string | null, conCuerpo: boolean): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Alcanzamos-Cliente': 'android',
    ...(conCuerpo ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function leerJson(respuesta: Response): Promise<Cuerpo> {
  try {
    const cuerpo: unknown = await respuesta.json();
    return typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Cuerpo) : {};
  } catch {
    return {};
  }
}

function camposDe(cuerpo: Cuerpo): Record<string, string> {
  const campos = cuerpo.campos;
  if (typeof campos !== 'object' || campos === null) return {};
  return Object.fromEntries(
    Object.entries(campos).filter((par): par is [string, string] => typeof par[1] === 'string'),
  );
}

const sinRespuesta = (codigo: string): Respuesta<never> => ({
  ok: false,
  estado: 0,
  codigo,
  campos: {},
});

/**
 * Hace el pedido. Si la respuesta trae un `token` (crear la cuenta e iniciar sesión), lo guarda en el Keystore.
 * Un `401 sin_sesion` es que el token ya no sirve: se borra del Keystore.
 */
export async function pedir<T = Cuerpo>(
  metodo: 'GET' | 'POST' | 'DELETE',
  ruta: string,
  cuerpo?: Cuerpo,
): Promise<Respuesta<T>> {
  const base = urlDelApi();
  if (!base) return sinRespuesta(SIN_CONFIGURACION);
  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: cabeceras(await leerToken(), cuerpo !== undefined),
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    return sinRespuesta(SIN_CONEXION);
  }
  const datos = await leerJson(respuesta);
  if (respuesta.ok) {
    if (typeof datos.token === 'string') {
      await guardarToken(datos.token);
      // Las pantallas nunca ven el token: ya está en el Keystore.
      delete datos.token;
    }
    return { ok: true, estado: respuesta.status, cuerpo: datos as T };
  }
  const codigo = typeof datos.error === 'string' ? datos.error : 'desconocido';
  if (respuesta.status === 401 && codigo === 'sin_sesion') await borrarToken();
  return { ok: false, estado: respuesta.status, codigo, campos: camposDe(datos) };
}
