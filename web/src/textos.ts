import { SIN_CONEXION, type Respuesta } from "./api/cliente";

// Todos los textos que ve la persona y la tabla de códigos del API a texto, en un solo módulo.
// Salen palabra por palabra de E14-PCP (pantallas de cuenta y privacidad, §4.16 para los de la web de la US-49).
// El API no manda textos. Cada texto lleva al lado su referencia en E14-PCP.
export type TipoAviso = "informacion" | "atencion" | "logro";
export type DatosDeAviso = {
  tipo: TipoAviso;
  titulo: string;
  mensaje?: string;
};

export const avisos = {
  // E14-PCP 4.16 T10 (PN-58, PN-60, PN-64, PN-69 y PN-73)
  sinConexion: {
    tipo: "informacion",
    titulo: "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
  },
  // E14-PCP 4.16 T1 (D-136; PN-58, «Cambiar el correo» de PN-59, PN-60 y PN-61)
  demasiadosIntentos: {
    tipo: "informacion",
    titulo: "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
  },
} satisfies Record<string, DatosDeAviso>;

// E14-PCP 4.1 (errores de campo de PN-58): el campo del correo es el mismo en PN-58, en «Cambiar el correo» de PN-59
// (4.16 T3) y en PN-61.
const correo = {
  correo_vacio: "Falta el correo electrónico.",
  correo_invalido: "Falta completar el correo. Por ejemplo, nombre@correo.com.",
};

/**
 * Errores de campo por pantalla, según el código de `422 validacion` (el API no manda textos).
 * Cada pantalla suma el suyo.
 */
const erroresDeCampo = { correo } satisfies Record<
  string,
  Record<string, string>
>;

export const textoDeErrorDeCampo = (
  codigo: string,
  pantalla: keyof typeof erroresDeCampo = "correo",
): string | undefined =>
  (erroresDeCampo[pantalla] as Record<string, string>)[codigo];

/** El aviso que corresponde a un fallo que no es de campo; `generico` es el de la pantalla para lo demás. */
export function avisoDeFallo(
  respuesta: Extract<Respuesta<unknown>, { ok: false }>,
  generico: DatosDeAviso,
): DatosDeAviso {
  if (respuesta.codigo === SIN_CONEXION) return avisos.sinConexion;
  if (respuesta.estado === 429) return avisos.demasiadosIntentos;
  return generico;
}
