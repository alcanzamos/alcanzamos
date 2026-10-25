import { navegar } from "./enrutador";
import { avisos, type DatosDeAviso } from "./textos";

// Un aviso que la pantalla de destino muestra arriba al llegar (E14-PCP: «Tu sesión se cerró…», «Listo, confirmamos
// tu correo.» en 4.16 T11). Viaja en el estado del historial: no se manda a ningún lado y no hace falta una variable global.
const porLlegada = {
  sesion_cerrada: avisos.sesionCerrada,
  correo_confirmado: avisos.correoConfirmado,
  contrasena_recuperada: avisos.contrasenaRecuperada,
  contrasena_cambiada: avisos.contrasenaCambiada,
  cuenta_borrada: avisos.correoBorrado,
} satisfies Record<string, DatosDeAviso>;

export type Llegada = keyof typeof porLlegada;

export const irConAviso = (destino: string, llegada: Llegada) =>
  navegar(destino, true, { llegada });

export function avisoDeLlegada(): DatosDeAviso | null {
  const estado: unknown = window.history.state;
  if (typeof estado !== "object" || estado === null) return null;
  const llegada = (estado as { llegada?: unknown }).llegada;
  return typeof llegada === "string" && llegada in porLlegada
    ? porLlegada[llegada as Llegada]
    : null;
}
