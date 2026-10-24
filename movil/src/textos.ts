import { SIN_CONEXION, SIN_CONFIGURACION, type Respuesta } from './api/cliente';

// Todos los textos que ve la persona y la tabla de códigos del API a texto, en un solo módulo.
// Salen palabra por palabra de E14-PCP (pantallas de cuenta y privacidad, §4.16 para los de la US-49). Son los mismos
// que los de web/src/textos.ts, copiados: movil/ no importa nada de otra carpeta.
// El API no manda textos. Cada texto lleva al lado su referencia en E14-PCP.
export type TipoAviso = 'informacion' | 'atencion' | 'logro';
export type DatosDeAviso = {
  tipo: TipoAviso;
  titulo: string;
  mensaje?: string;
};

export const avisos = {
  // E14-PCP 4.16 T10 (PN-58, PN-60, PN-64, PN-69 y PN-73)
  sinConexion: {
    tipo: 'informacion',
    titulo: 'Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.',
  },
  // E14-PCP 4.16 T1 (D-136; PN-58, «Cambiar el correo» de PN-59, PN-60 y PN-61)
  demasiadosIntentos: {
    tipo: 'informacion',
    titulo: 'Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.',
  },
  // E14-PCP 4.1, estado «Error de envío» de PN-58 y 4.16 T6
  errorAlCrearCuenta: {
    tipo: 'informacion',
    titulo: 'No pudimos crear la cuenta.',
    mensaje: 'Tus datos no se perdieron. Intenta de nuevo.',
  },
  // E14-PCP 4.2, estado «Error» de PN-59 (reenviar y cambiar el correo)
  errorAlEnviarCorreo: {
    tipo: 'informacion',
    titulo: 'No pudimos enviar el correo.',
    mensaje: 'Intenta de nuevo.',
  },
  // E14-PCP 4.16 T8: «Ya lo confirmé» no pudo revisar el estado (5xx)
  errorAlRevisarElCorreo: {
    tipo: 'informacion',
    titulo: 'No pudimos revisar si confirmaste tu correo.',
    mensaje: 'Intenta de nuevo.',
  },
  // E14-PCP 4.16 T9: el enlace de verificación falló del lado del servidor (5xx), distinto del enlace vencido
  errorAlConfirmarElCorreo: {
    tipo: 'informacion',
    titulo: 'No pudimos confirmar tu correo.',
    mensaje: 'Intenta de nuevo.',
  },
  // E14-PCP 4.2, «Ya lo confirmé» sin confirmar
  sinConfirmarTodavia: {
    tipo: 'informacion',
    titulo: 'Todavía no confirmaste tu correo.',
    mensaje: 'Abre el enlace que te enviamos.',
  },
  // E14-PCP 4.2, estado «Reenviado»
  correoReenviado: { tipo: 'informacion', titulo: 'Te enviamos otro correo.' },
  // E14-PCP 4.2, estado «Confirmado», y 4.16 T11: se muestra arriba de la pantalla a la que se llega
  correoConfirmado: {
    tipo: 'logro',
    titulo: 'Listo, confirmamos tu correo.',
  },
  // E14-PCP 4.2, estado «Enlace vencido»
  enlaceVencido: {
    tipo: 'atencion',
    titulo: 'Ese enlace ya no sirve.',
    mensaje: 'Pide uno nuevo.',
  },
  // E14-PCP 4.3, estado «Error» de PN-60 con credenciales que no coinciden (401)
  datosNoCoinciden: {
    tipo: 'atencion',
    titulo: 'No pudimos entrar con esos datos.',
    mensaje: 'Revisa lo que escribiste e intenta de nuevo.',
  },
  // E14-PCP 4.16 T7 (D-153): error del servidor (5xx) en PN-60; nunca dice que los datos están mal (RNF-017)
  errorAlIniciarSesion: {
    tipo: 'informacion',
    titulo: 'No pudimos iniciar tu sesión.',
    mensaje: 'El problema es de nuestro lado. Intenta de nuevo en un momento.',
  },
  // E14-PCP 4.15, estado «Error» de PN-73
  errorAlCambiarContrasena: {
    tipo: 'informacion',
    titulo: 'No pudimos guardar tu contraseña.',
    mensaje: 'Tu contraseña de ahora sigue igual. Intenta de nuevo.',
  },
  // E14-PCP 4.15, estado «Guardada» de PN-73 (llega a PN-71)
  contrasenaCambiada: {
    tipo: 'logro',
    titulo: 'Listo, cambiamos tu contraseña.',
    mensaje: 'Cerramos tus otras sesiones. Esta sigue abierta.',
  },
  // E14-PCP 4.14, estado «Error» de PN-71
  errorAlCargarIngreso: {
    tipo: 'informacion',
    titulo: 'No pudimos cargar tu último ingreso.',
  },
  // E14-PCP 4.14, PN-71
  noReconoceElIngreso: {
    tipo: 'informacion',
    titulo: '¿No reconoces este ingreso?',
    mensaje: 'Cambia tu contraseña y cerramos tus otras sesiones.',
  },
  // E14-PCP 4.4, estado «Enlace enviado» de PN-61: es el mismo con o sin cuenta
  enlaceDeRecuperacionEnviado: {
    tipo: 'informacion',
    titulo: 'Si ese correo tiene una cuenta, te enviamos un enlace.',
    mensaje: 'Revisa también el correo no deseado.',
  },
  // E14-PCP 4.4, estado «Error» de PN-61
  errorAlEnviarEnlace: {
    tipo: 'informacion',
    titulo: 'No pudimos enviar el enlace.',
    mensaje: 'Intenta de nuevo.',
  },
  // E14-PCP 4.5, estado «Error» de PN-62
  errorAlGuardarContrasena: {
    tipo: 'informacion',
    titulo: 'No pudimos guardar tu contraseña.',
    mensaje: 'Intenta de nuevo.',
  },
  // E14-PCP 4.5, estado «Guardada» de PN-62 (llega a PN-60)
  contrasenaRecuperada: {
    tipo: 'logro',
    titulo: 'Listo, cambiaste tu contraseña.',
  },
  // E14-PCP 4.3, PN-60 (se llega a ella cuando el API niega el paso por falta de sesión)
  sesionCerrada: {
    tipo: 'informacion',
    titulo: 'Tu sesión se cerró. Entra de nuevo.',
  },
} satisfies Record<string, DatosDeAviso>;

// E14-PCP 4.1 (errores de campo de PN-58): el campo del correo es el mismo en PN-58, en «Cambiar el correo» de PN-59
// (4.16 T3) y en PN-61.
const correo = {
  correo_vacio: 'Falta el correo electrónico.',
  correo_invalido: 'Falta completar el correo. Por ejemplo, nombre@correo.com.',
};

// E14-PCP 4.1 (PN-58). La contraseña nueva tiene los mismos errores en PN-62 y PN-73.
const contrasenaNueva = {
  contrasena_corta: 'Falta que la contraseña tenga al menos 15 caracteres.',
  contrasena_comun: 'Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.',
  contrasena_personal: 'Falta una contraseña que no incluya tu correo ni el nombre de la app.',
};

/**
 * Errores de campo por pantalla, según el código de `422 validacion` (el API no manda textos).
 * Cada pantalla suma el suyo.
 */
const erroresDeCampo = {
  correo,
  entrar: {
    identificador_vacio: 'Falta el correo electrónico.',
    contrasena_vacia: 'Falta la contraseña.',
  },
  contrasenaNueva: {
    contrasena_vacia: 'Falta la contraseña nueva.',
    ...contrasenaNueva,
  },
  contrasenaDeAhora: {
    contrasena_vacia: 'Falta tu contraseña de ahora.',
    contrasena_actual_incorrecta: 'No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.',
  },
  crearCuenta: {
    ...correo,
    contrasena_vacia: 'Falta la contraseña.',
    ...contrasenaNueva,
    nombre_vacio: 'Falta el nombre para mostrar.',
    // E14-PCP 4.16 T5 (D-153)
    nombre_largo: 'Escribe un nombre de hasta 60 caracteres.',
  },
} satisfies Record<string, Record<string, string>>;

// E14-PCP 4.5: la repetición solo existe en la pantalla de PN-62
export const textosDeRepeticion = {
  vacia: 'Falta repetir la contraseña.',
  distinta: 'Falta que las dos contraseñas sean iguales.',
};

export const textoDeErrorDeCampo = (
  codigo: string,
  pantalla: keyof typeof erroresDeCampo = 'crearCuenta',
): string | undefined => (erroresDeCampo[pantalla] as Record<string, string>)[codigo];

/** El aviso que corresponde a un fallo que no es de campo; `generico` es el de la pantalla para lo demás. */
export function avisoDeFallo(
  respuesta: Extract<Respuesta<unknown>, { ok: false }>,
  generico: DatosDeAviso,
): DatosDeAviso {
  if (respuesta.codigo === SIN_CONEXION || respuesta.codigo === SIN_CONFIGURACION) return avisos.sinConexion;
  if (respuesta.estado === 429) return avisos.demasiadosIntentos;
  return generico;
}
