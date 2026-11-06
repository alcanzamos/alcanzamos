import { pedir, SIN_CONEXION, type Respuesta } from "./cliente";

// Rutas de cuenta y sesión (api/README.md, «Cuenta (US-49, US-61)»). Cada función es un pedido; el API valida.
// Crear una cuenta verifica primero (D-172): PN-58 y PN-59 no tienen sesión; la contraseña y el nombre se mandan
// con el token del enlace (PN-74) y ahí empieza la sesión.

/** PN-58: pide la verificación del correo. Responde siempre igual, con o sin cuenta, y nunca da sesión. */
export const crearCuenta = (datos: {
  correo: string;
  mayor_de_edad: boolean;
}) => pedir("POST", "/api/v1/cuentas", datos);

/** PN-59, «Reenviar el correo»: público, por la dirección escrita; el API no crea cuentas aquí. */
export const reenviarCorreo = (correo: string) =>
  pedir("POST", "/api/v1/cuentas/verificacion/reenvio", { correo });

/** PN-74: completa la cuenta con el token del enlace y empieza la sesión (cookie). El enlace sirve una vez. */
export const completarCuenta = (datos: {
  token: string;
  contrasena: string;
  nombre: string;
}) => pedir<{ estado: string }>("POST", "/api/v1/cuentas/verificacion", datos);

export const cerrarSesion = () => pedir("DELETE", "/api/v1/sesiones/actual");

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

// PN-69: lo que cambia en la pantalla según el hogar y los menores, y el borrado mismo (api/README.md, «Borrar la cuenta»).
export const resumenDeBorrado = () =>
  pedir<ResumenDeBorrado>("GET", "/api/v1/cuenta/borrado");

export const borrarLaCuenta = (datos: {
  contrasena: string;
  confirma_menores: boolean;
  menores: string[];
}) => pedir("POST", "/api/v1/cuenta/borrado", datos);

export type DescargaDeDatos =
  | { ok: true; cuerpo: Blob; nombre: string }
  | Extract<Respuesta<never>, { ok: false }>;

const NOMBRE_NEUTRO = "alcanzamos-mis-datos.zip";

/**
 * «Descargar mis datos» de PN-69 (D-102, D-180): el ZIP que arma el API al pedirlo. No pasa por `pedir`, que lee JSON.
 * El nombre sale de `Content-Disposition` y, sin él, es uno neutro. Un fallo trae el estado y el código del API.
 */
export async function descargarMisDatos(): Promise<DescargaDeDatos> {
  let respuesta: Response;
  try {
    respuesta = await fetch("/api/v1/cuenta/datos", {
      credentials: "same-origin",
      headers: { Accept: "application/zip" },
    });
  } catch {
    return { ok: false, estado: 0, codigo: SIN_CONEXION, campos: {} };
  }
  if (respuesta.ok) {
    try {
      const nombre = /filename="([^"]+)"/.exec(
        respuesta.headers.get("Content-Disposition") ?? "",
      )?.[1];
      return {
        ok: true,
        cuerpo: await respuesta.blob(),
        nombre: nombre ?? NOMBRE_NEUTRO,
      };
    } catch {
      // El ZIP se cortó a la mitad: no es un fallo de conexión de antes de pedir, es un archivo que no sirve.
      return {
        ok: false,
        estado: respuesta.status,
        codigo: "archivo_incompleto",
        campos: {},
      };
    }
  }
  const cuerpo: unknown = await respuesta.json().catch(() => ({}));
  const codigo =
    typeof cuerpo === "object" && cuerpo !== null
      ? (cuerpo as { error?: unknown }).error
      : undefined;
  return {
    ok: false,
    estado: respuesta.status,
    codigo: typeof codigo === "string" ? codigo : "desconocido",
    campos: {},
  };
}
