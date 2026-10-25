import type { NavigationProp } from '@react-navigation/native';
import type { Respuesta } from '../api/cliente';
import { reemplazarPila } from './llegada';
import type { Rutas } from './rutas';

/**
 * Lo que hace toda pantalla de dentro cuando el API le niega el paso: sin sesión va a PN-60 («Tu sesión se cerró»);
 * con la cuenta sin verificar, a PN-59; sin autorización, a PN-63 (la información de privacidad, antes de PN-64).
 * Devuelve verdadero si ya llevó a la persona a otra pantalla.
 */
export function seguirPorAccesoNegado(
  navegacion: NavigationProp<Rutas>,
  respuesta: Extract<Respuesta<unknown>, { ok: false }>,
): boolean {
  if (respuesta.estado === 401) reemplazarPila(navegacion, 'Entrar', { llegada: 'sesion_cerrada' });
  else if (respuesta.estado === 403 && respuesta.codigo === 'verificacion_pendiente')
    reemplazarPila(navegacion, 'RevisaTuCorreo');
  else if (respuesta.estado === 403 && respuesta.codigo === 'autorizacion_pendiente')
    reemplazarPila(navegacion, 'InformacionDePrivacidad');
  else return false;
  return true;
}
