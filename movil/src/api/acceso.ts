import { pedir } from './cliente';

// Rutas de entrar y de PN-71 y PN-73 (api/README.md, «Entrar y salir»). `iniciarSesion` guarda el token del cuerpo en el
// Keystore (cliente.ts); la pantalla no lo ve. El «identificador» es genérico: hoy solo un correo, y el nombre de
// usuario de los menores llega en I11 sin cambiar el contrato (D-137).
export const iniciarSesion = (datos: { identificador: string; contrasena: string }) =>
  pedir<{ estado: string }>('POST', '/api/v1/sesiones', datos);

export const ingresoAnterior = () => pedir<{ ingreso_anterior: string | null }>('GET', '/api/v1/cuenta/seguridad');

export const cambiarContrasena = (datos: { contrasena_actual: string; contrasena_nueva: string }) =>
  pedir('POST', '/api/v1/cuenta/contrasena', datos);

// PN-61: pedir el enlace. La respuesta es la misma con o sin cuenta (CU-44 2a). El enlace del correo abre la web (D-155):
// elegir la contraseña nueva (PN-62) no se hace en la app hasta que haya App Links (I08), así que no hay `elegirContrasena`.
export const pedirRecuperacion = (correo: string) => pedir('POST', '/api/v1/recuperacion', { correo });
