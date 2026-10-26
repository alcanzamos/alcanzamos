import { borrarToken } from '../sesion/token';
import { pedir } from './cliente';

// Rutas de PN-64 (api/README.md, «Autorización»). El API no manda textos: cada finalidad llega por su `codigo`.
// Todo el cuerpo de `GET` es opcional en el tipo: la pantalla lo valida, no se confía en lo que llegó.
export type FinalidadDelApi = {
  codigo: string;
  tipo: string;
  otorgada: boolean;
};

export type CatalogoDelApi = {
  version?: { numero?: string; fecha?: string };
  finalidades?: FinalidadDelApi[];
};

export const obtenerCatalogo = () => pedir<CatalogoDelApi>('GET', '/api/v1/autorizaciones');

export const autorizar = (finalidades: string[], version: string) =>
  pedir('POST', '/api/v1/autorizaciones', { finalidades, version });

/**
 * «No autorizo» (RF-031): el API borra la cuenta recién creada y su sesión; con la respuesta correcta el token se
 * borra del Keystore. Con cualquier otra respuesta (sin conexión, 403 `ya_autorizada`) la sesión sigue y el token también.
 */
export async function rechazar() {
  const respuesta = await pedir('POST', '/api/v1/autorizaciones/rechazo');
  if (respuesta.ok) await borrarToken();
  return respuesta;
}
