import type { NavigationProp } from '@react-navigation/native';
import { obtenerCatalogo } from '../api/autorizaciones';
import type { Respuesta } from '../api/cliente';
import { reemplazarPila } from './llegada';
import type { Rutas } from './rutas';

// SC-E21-25, sección 5, paso 2: a la cuenta de antes del cambio, a la que solo le falta una aceptación, la app la lleva a
// PN-64 en ese modo; a la persona nueva, a PN-63 (RNF-011). El modo lo dice el catálogo (`GET /autorizaciones`, que una
// cuenta sin autorizar sí puede pedir). Cualquier otra respuesta —un error, otro modo, sin conexión— deja el camino de
// siempre: PN-63.
async function irAAutorizar(navegacion: NavigationProp<Rutas>) {
  const respuesta = await obtenerCatalogo();
  if (!respuesta.ok && respuesta.estado === 401) reemplazarPila(navegacion, 'Entrar', { llegada: 'sesion_cerrada' });
  else if (respuesta.ok && respuesta.cuerpo.modo === 'falta_una_aceptacion')
    reemplazarPila(navegacion, 'AutorizacionDeDatos');
  else reemplazarPila(navegacion, 'InformacionDePrivacidad');
}

/**
 * Lo que hace toda pantalla de dentro cuando el API le niega el paso: sin sesión va a PN-60 («Tu sesión se cerró»); sin
 * autorización, a PN-63 (la información de privacidad, antes de PN-64) o, si solo falta una aceptación nueva, a PN-64
 * (esa decisión llega un momento después, cuando el API contesta el modo). Una cuenta sin verificar no tiene sesión
 * (D-172): `verificacion_pendiente` ya no lleva a PN-59. Devuelve verdadero si ya llevó a la persona a otra pantalla o
 * lo hará enseguida.
 */
export function seguirPorAccesoNegado(
  navegacion: NavigationProp<Rutas>,
  respuesta: Extract<Respuesta<unknown>, { ok: false }>,
): boolean {
  if (respuesta.estado === 401) reemplazarPila(navegacion, 'Entrar', { llegada: 'sesion_cerrada' });
  else if (respuesta.estado === 403 && respuesta.codigo === 'autorizacion_pendiente') void irAAutorizar(navegacion);
  else return false;
  return true;
}
