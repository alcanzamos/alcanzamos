import type { Respuesta } from "./api/cliente";
import { irConAviso } from "./llegada";
import { navegar } from "./enrutador";

/**
 * Lo que hace toda pantalla de dentro cuando el API le niega el paso: sin sesión va a PN-60 («Tu sesión se cerró»);
 * con la cuenta sin verificar, a PN-59; sin autorización, a la pantalla provisional (PN-63 y PN-64 llegan con la US-50).
 * Devuelve verdadero si ya llevó a la persona a otra pantalla.
 */
export function seguirPorAccesoNegado(
  respuesta: Extract<Respuesta<unknown>, { ok: false }>,
): boolean {
  if (respuesta.estado === 401) irConAviso("/entrar", "sesion_cerrada");
  else if (
    respuesta.estado === 403 &&
    respuesta.codigo === "verificacion_pendiente"
  )
    navegar("/revisa-tu-correo", true);
  else if (
    respuesta.estado === 403 &&
    respuesta.codigo === "autorizacion_pendiente"
  )
    navegar("/sin-autorizacion", true);
  else return false;
  return true;
}
