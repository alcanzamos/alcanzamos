import { borrarToken } from '../sesion/token';
import { pedir } from './cliente';

// Rutas de cuenta y sesión (api/README.md, «Cuenta (US-49, US-61)»). Cada función es un pedido; el API valida.
// Crear una cuenta verifica primero (D-172): PN-58 y PN-59 no tienen sesión, así que ningún pedido de aquí lleva ni
// guarda un token. La contraseña y el nombre se piden en PN-74, que hasta I08 se abre en el navegador del teléfono (D-155).
// `mayor_de_edad: true` solo se manda después de PN-65. La fecha de nacimiento no existe en ningún pedido.

/** PN-58: pide la verificación del correo. Responde siempre igual, con o sin cuenta, y nunca da sesión. */
export const crearCuenta = (datos: { correo: string; mayor_de_edad: true }) => pedir('POST', '/api/v1/cuentas', datos);

/** PN-59, «Reenviar el correo»: público, por la dirección escrita; el API no crea cuentas aquí. */
export const reenviarCorreo = (correo: string) => pedir('POST', '/api/v1/cuentas/verificacion/reenvio', { correo });

/**
 * Cierra la sesión en el API y borra el token del Keystore. Solo la falta de conexión deja el token y la sesión:
 * ahí no se pudo avisar al API y la persona sigue dentro. Con cualquier otra respuesta (incluso un 401, que es que
 * la sesión ya no existía) el token se borra y la persona sale.
 */
export async function cerrarSesion() {
  const respuesta = await pedir('DELETE', '/api/v1/sesiones/actual');
  if (respuesta.ok || respuesta.estado !== 0) await borrarToken();
  return respuesta;
}

export type ResumenDeBorrado = {
  hogar: {
    nombre: string | null;
    es_administradora: boolean;
    unica_adulta: boolean;
    nuevo_administrador: string | null;
  } | null;
  /** Quienes dependen solo de la persona. El borrado devuelve sus `id`: confirma a los que se mostraron. */
  menores: { id: string; nombre: string }[];
};

// PN-69: lo que cambia en la pantalla según el hogar y los menores (api/README.md, «Borrar la cuenta»).
export const resumenDeBorrado = () => pedir<ResumenDeBorrado>('GET', '/api/v1/cuenta/borrado');

/**
 * Borra la cuenta y, con ella, el token del Keystore: la sesión ya no existe en el API (las borró todas) y el token no
 * sirve para nada. Con cualquier otra respuesta el token se queda: la cuenta sigue y la persona puede volver a intentar.
 */
export async function borrarLaCuenta(datos: { contrasena: string; confirma_menores: boolean; menores: string[] }) {
  const respuesta = await pedir('POST', '/api/v1/cuenta/borrado', datos);
  if (respuesta.ok) await borrarToken();
  return respuesta;
}
