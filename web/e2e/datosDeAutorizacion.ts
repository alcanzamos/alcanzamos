// El catálogo de PN-64 que el API simulado entrega (api/README.md, «Autorización»): la versión 1.1 del 12 de noviembre de
// 2026 (SC-E21-25) y el modo. Lo usan las pruebas de PN-64, PN-68, el acceso y las pantallas.
const finalidad = (codigo: string, tipo: "necesaria" | "accesoria") => ({
  codigo,
  tipo,
  otorgada: false,
});

const version = { numero: "1.1", fecha: "2026-11-12" };

/** La persona nueva: todo lo que se ofrece. */
export const catalogoCompleto = {
  version,
  modo: "completo",
  finalidades: [
    finalidad("cuenta_y_acceso", "necesaria"),
    finalidad("funciones_financieras", "necesaria"),
    finalidad("transmision_a_encargados", "necesaria"),
    finalidad("avisos", "accesoria"),
    finalidad("horas_de_vida", "accesoria"),
  ],
};

/** La cuenta de antes del cambio: solo la aceptación que le falta (SC-E21-25, sección 5). */
export const catalogoLimitado = {
  version,
  modo: "falta_una_aceptacion",
  finalidades: [finalidad("transmision_a_encargados", "necesaria")],
};

export const NECESARIAS =
  "Autorizo el uso de mis datos para estas finalidades necesarias.";
export const TRANSMISION =
  "Acepto que mis datos se envíen a estos servicios en México, Francia y Estados Unidos para guardarlos y procesarlos como se explica arriba.";
export const AVISOS = "Autorizo los avisos con la app cerrada.";
