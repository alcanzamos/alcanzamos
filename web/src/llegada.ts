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

/** Como `irConAviso`, con un aviso que lleva datos de la persona («Listo, registramos tu gasto de $45.000.»). */
export const irConMensaje = (destino: string, aviso: DatosDeAviso) =>
  navegar(destino, true, { aviso });

const TIPOS_DE_AVISO = ["informacion", "atencion", "logro"];

function esAviso(valor: unknown): valor is DatosDeAviso {
  if (typeof valor !== "object" || valor === null) return false;
  const { tipo, titulo, mensaje } = valor as Record<string, unknown>;
  return (
    typeof tipo === "string" &&
    TIPOS_DE_AVISO.includes(tipo) &&
    typeof titulo === "string" &&
    (mensaje === undefined || typeof mensaje === "string")
  );
}

export function avisoDeLlegada(): DatosDeAviso | null {
  const estado: unknown = window.history.state;
  if (typeof estado !== "object" || estado === null) return null;
  const { aviso } = estado as { aviso?: unknown };
  if (esAviso(aviso)) return aviso;
  const llegada = (estado as { llegada?: unknown }).llegada;
  return typeof llegada === "string" && llegada in porLlegada
    ? porLlegada[llegada as Llegada]
    : null;
}
