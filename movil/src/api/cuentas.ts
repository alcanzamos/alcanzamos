import { borrarToken } from '../sesion/token';
import { pedir } from './cliente';

// Rutas de cuenta y sesión (api/README.md, «Cuenta (US-49)»). Cada función es un pedido; el API valida.
// `crearCuenta` guarda el token del cuerpo en el Keystore (cliente.ts); la pantalla no lo ve.
// `mayor_de_edad: true` solo se manda después de PN-65. La fecha de nacimiento no existe en ningún pedido.
export const crearCuenta = (datos: { correo: string; contrasena: string; nombre: string; mayor_de_edad: true }) =>
  pedir('POST', '/api/v1/cuentas', datos);

export const estadoDeLaCuenta = () => pedir<{ verificada: boolean }>('GET', '/api/v1/cuentas/estado');

export const reenviarCorreo = () => pedir('POST', '/api/v1/cuentas/verificacion/reenvio');

export const cambiarCorreo = (correo: string) => pedir('POST', '/api/v1/cuentas/correo', { correo });

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
