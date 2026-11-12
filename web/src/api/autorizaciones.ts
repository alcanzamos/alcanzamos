import { pedir } from "./cliente";

// Rutas de PN-64 (api/README.md, «Autorización»). El API no manda textos: cada finalidad llega por su `codigo`.
export type FinalidadDelApi = {
  codigo: string;
  tipo: string;
  otorgada: boolean;
};

export type CatalogoDelApi = {
  version: { numero: string; fecha: string };
  /**
   * `completo`: todo lo que se le ofrece a la persona. `falta_una_aceptacion`: la cuenta ya autorizó antes y solo le falta
   * una necesaria nueva (SC-E21-25, sección 5); `finalidades` trae solo esa.
   */
  modo: string;
  finalidades: FinalidadDelApi[];
};

export const obtenerCatalogo = () =>
  pedir<CatalogoDelApi>("GET", "/api/v1/autorizaciones");

export const autorizar = (finalidades: string[], version: string) =>
  pedir("POST", "/api/v1/autorizaciones", { finalidades, version });

/**
 * «No autorizo»: el API borra la cuenta recién creada y cierra la sesión. Una cuenta que ya autorizó algo antes no se
 * borra por aquí: responde `403 cuenta_con_historial` y la persona decide en la hoja de PN-54.
 */
export const rechazar = () => pedir("POST", "/api/v1/autorizaciones/rechazo");
