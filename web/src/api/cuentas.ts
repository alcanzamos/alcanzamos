import { pedir } from "./cliente";

// Rutas de cuenta y sesión (api/README.md, «Cuenta (US-49)»). Cada función es un pedido; el API valida.
export const crearCuenta = (datos: {
  correo: string;
  contrasena: string;
  nombre: string;
  mayor_de_edad: boolean;
}) => pedir("POST", "/api/v1/cuentas", datos);

export const verificarCorreo = (token: string) =>
  pedir<{ estado: string; con_sesion: boolean }>(
    "POST",
    "/api/v1/cuentas/verificacion",
    { token },
  );

export const estadoDeLaCuenta = () =>
  pedir<{ verificada: boolean }>("GET", "/api/v1/cuentas/estado");

export const reenviarCorreo = () =>
  pedir("POST", "/api/v1/cuentas/verificacion/reenvio");

export const cambiarCorreo = (correo: string) =>
  pedir("POST", "/api/v1/cuentas/correo", { correo });

export const cerrarSesion = () => pedir("DELETE", "/api/v1/sesiones/actual");

export type ResumenDeBorrado = {
  hogar: {
    nombre: string | null;
    es_administradora: boolean;
    unica_adulta: boolean;
    nuevo_administrador: string | null;
  } | null;
  menores: string[];
};

// PN-69: lo que cambia en la pantalla según el hogar y los menores, y el borrado mismo (api/README.md, «Borrar la cuenta»).
export const resumenDeBorrado = () =>
  pedir<ResumenDeBorrado>("GET", "/api/v1/cuenta/borrado");

export const borrarLaCuenta = (datos: {
  contrasena: string;
  confirma_menores: boolean;
}) => pedir("POST", "/api/v1/cuenta/borrado", datos);
