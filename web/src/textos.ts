import { SIN_CONEXION, type Respuesta } from "./api/cliente";
import { formatear, plural, textos } from "./textos/es.generated";

// Los textos que ve la persona salen de diseno/textos/es.json (D-160), palabra por palabra de E14, y llegan aquí por
// el módulo generado `textos/es.generated.ts` (`npm run textos`). Este módulo solo guarda lo que no es texto: el tipo
// de cada aviso y la tabla de códigos del API a texto. El API no manda textos.
export type TipoAviso = "informacion" | "atencion" | "logro";
export type DatosDeAviso = {
  tipo: TipoAviso;
  titulo: string;
  mensaje?: string;
};

const a = textos.avisos;

export const avisos = {
  sinConexion: { tipo: "informacion", titulo: a.sinConexion.titulo },
  demasiadosIntentos: {
    tipo: "informacion",
    titulo: a.demasiadosIntentos.titulo,
  },
  errorAlCrearCuenta: {
    tipo: "informacion",
    titulo: a.errorAlCrearCuenta.titulo,
    mensaje: a.errorAlCrearCuenta.mensaje,
  },
  errorAlEnviarCorreo: {
    tipo: "informacion",
    titulo: a.errorAlEnviarCorreo.titulo,
    mensaje: a.errorAlEnviarCorreo.mensaje,
  },
  errorAlRevisarElCorreo: {
    tipo: "informacion",
    titulo: a.errorAlRevisarElCorreo.titulo,
    mensaje: a.errorAlRevisarElCorreo.mensaje,
  },
  errorAlConfirmarElCorreo: {
    tipo: "informacion",
    titulo: a.errorAlConfirmarElCorreo.titulo,
    mensaje: a.errorAlConfirmarElCorreo.mensaje,
  },
  sinConfirmarTodavia: {
    tipo: "informacion",
    titulo: a.sinConfirmarTodavia.titulo,
    mensaje: a.sinConfirmarTodavia.mensaje,
  },
  correoReenviado: { tipo: "informacion", titulo: a.correoReenviado.titulo },
  correoConfirmado: { tipo: "logro", titulo: a.correoConfirmado.titulo },
  enlaceVencido: {
    tipo: "atencion",
    titulo: a.enlaceVencido.titulo,
    mensaje: a.enlaceVencido.mensaje,
  },
  datosNoCoinciden: {
    tipo: "atencion",
    titulo: a.datosNoCoinciden.titulo,
    mensaje: a.datosNoCoinciden.mensaje,
  },
  errorAlIniciarSesion: {
    tipo: "informacion",
    titulo: a.errorAlIniciarSesion.titulo,
    mensaje: a.errorAlIniciarSesion.mensaje,
  },
  errorAlCambiarContrasena: {
    tipo: "informacion",
    titulo: a.errorAlCambiarContrasena.titulo,
    mensaje: a.errorAlCambiarContrasena.mensaje,
  },
  contrasenaCambiada: {
    tipo: "logro",
    titulo: a.contrasenaCambiada.titulo,
    mensaje: a.contrasenaCambiada.mensaje,
  },
  errorAlCargarIngreso: {
    tipo: "informacion",
    titulo: a.errorAlCargarIngreso.titulo,
  },
  noReconoceElIngreso: {
    tipo: "informacion",
    titulo: a.noReconoceElIngreso.titulo,
    mensaje: a.noReconoceElIngreso.mensaje,
  },
  enlaceDeRecuperacionEnviado: {
    tipo: "informacion",
    titulo: a.enlaceDeRecuperacionEnviado.titulo,
    mensaje: a.enlaceDeRecuperacionEnviado.mensaje,
  },
  errorAlEnviarEnlace: {
    tipo: "informacion",
    titulo: a.errorAlEnviarEnlace.titulo,
    mensaje: a.errorAlEnviarEnlace.mensaje,
  },
  errorAlGuardarContrasena: {
    tipo: "informacion",
    titulo: a.errorAlGuardarContrasena.titulo,
    mensaje: a.errorAlGuardarContrasena.mensaje,
  },
  contrasenaRecuperada: {
    tipo: "logro",
    titulo: a.contrasenaRecuperada.titulo,
  },
  sesionCerrada: { tipo: "informacion", titulo: a.sesionCerrada.titulo },
} satisfies Record<string, DatosDeAviso>;

/**
 * Errores de campo por pantalla, según el código de `422 validacion` (el API no manda textos).
 * El campo del correo (PN-58, «Cambiar el correo» de PN-59 y PN-61) y la contraseña nueva (PN-58, PN-62 y PN-73)
 * son los mismos en varias pantallas; cada pantalla suma el suyo.
 */
const erroresDeCampo = {
  correo: textos.correo,
  entrar: textos.erroresDeCampo.entrar,
  contrasenaNueva: {
    ...textos.erroresDeCampo.contrasenaNueva,
    ...textos.contrasenaNueva,
  },
  contrasenaDeAhora: textos.erroresDeCampo.contrasenaDeAhora,
  crearCuenta: {
    ...textos.correo,
    ...textos.erroresDeCampo.crearCuenta,
    ...textos.contrasenaNueva,
  },
} satisfies Record<string, Record<string, string>>;

// E14-PCP 4.5: la repetición solo existe en la pantalla de PN-62
export const textosDeRepeticion = textos.textosDeRepeticion;

export const textoDeErrorDeCampo = (
  codigo: string,
  pantalla: keyof typeof erroresDeCampo = "crearCuenta",
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

/**
 * El resumen de PN-72 (D-093, E14-PRR 4.7): «13 por confirmar: 2 ingresos y 11 gastos». El total es la suma; los
 * recuentos usan la convención de plurales de US-59 (`one` y `other`). PN-72 todavía no se construye: la llamará.
 */
export function resumenPorConfirmar(ingresos: number, gastos: number): string {
  return formatear(textos.porConfirmar.resumen, {
    total: String(ingresos + gastos),
    ingresos: plural(textos.porConfirmar.ingresos, ingresos),
    gastos: plural(textos.porConfirmar.gastos, gastos),
  });
}
