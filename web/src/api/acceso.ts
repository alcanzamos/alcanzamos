import { pedir } from "./cliente";

// Rutas de entrar, recuperar el acceso y PN-71/PN-73 (api/README.md, «Entrar y salir»).
export const iniciarSesion = (datos: {
  identificador: string;
  contrasena: string;
}) => pedir<{ estado: string }>("POST", "/api/v1/sesiones", datos);

export const pedirRecuperacion = (correo: string) =>
  pedir("POST", "/api/v1/recuperacion", { correo });

export const elegirContrasena = (token: string, contrasena: string) =>
  pedir("POST", "/api/v1/recuperacion/contrasena", { token, contrasena });

export const ingresoAnterior = () =>
  pedir<{ ingreso_anterior: string | null }>("GET", "/api/v1/cuenta/seguridad");

export const cambiarContrasena = (datos: {
  contrasena_actual: string;
  contrasena_nueva: string;
}) => pedir("POST", "/api/v1/cuenta/contrasena", datos);
