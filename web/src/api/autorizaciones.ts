import { pedir } from "./cliente";

// Rutas de PN-64 (api/README.md, «Autorización»). El API no manda textos: cada finalidad llega por su `codigo`.
export type FinalidadDelApi = {
  codigo: string;
  tipo: string;
  otorgada: boolean;
};

export type CatalogoDelApi = {
  version: { numero: string; fecha: string };
  finalidades: FinalidadDelApi[];
};

export const obtenerCatalogo = () =>
  pedir<CatalogoDelApi>("GET", "/api/v1/autorizaciones");

export const autorizar = (finalidades: string[], version: string) =>
  pedir("POST", "/api/v1/autorizaciones", { finalidades, version });

/** «No autorizo»: el API borra la cuenta recién creada y cierra la sesión. */
export const rechazar = () => pedir("POST", "/api/v1/autorizaciones/rechazo");
