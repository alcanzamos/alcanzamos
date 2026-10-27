import { SIN_CONEXION, SIN_CONFIGURACION, type Respuesta } from './api/cliente';
import type { Periodicidad, Tipo } from './api/registro';
import { formatearPesos } from './dinero';
import { diaEnPalabras } from './fechas';
import { formatear, plural, textos } from './textos/es.generated';

// Los textos que ve la persona salen de diseno/textos/es.json (D-160), palabra por palabra de E14, y llegan aquí por
// el módulo generado `textos/es.generated.ts` (`npm run textos`). Este módulo solo guarda lo que no es texto: el tipo
// de cada aviso y la tabla de códigos del API a texto. El API no manda textos.
export type TipoAviso = 'informacion' | 'atencion' | 'logro';
export type DatosDeAviso = {
  tipo: TipoAviso;
  titulo: string;
  mensaje?: string;
};

const a = textos.avisos;

export const avisos = {
  sinConexion: { tipo: 'informacion', titulo: a.sinConexion.titulo },
  demasiadosIntentos: {
    tipo: 'informacion',
    titulo: a.demasiadosIntentos.titulo,
  },
  errorAlCrearCuenta: {
    tipo: 'informacion',
    titulo: a.errorAlCrearCuenta.titulo,
    mensaje: a.errorAlCrearCuenta.mensaje,
  },
  errorAlEnviarCorreo: {
    tipo: 'informacion',
    titulo: a.errorAlEnviarCorreo.titulo,
    mensaje: a.errorAlEnviarCorreo.mensaje,
  },
  errorAlRevisarElCorreo: {
    tipo: 'informacion',
    titulo: a.errorAlRevisarElCorreo.titulo,
    mensaje: a.errorAlRevisarElCorreo.mensaje,
  },
  errorAlConfirmarElCorreo: {
    tipo: 'informacion',
    titulo: a.errorAlConfirmarElCorreo.titulo,
    mensaje: a.errorAlConfirmarElCorreo.mensaje,
  },
  sinConfirmarTodavia: {
    tipo: 'informacion',
    titulo: a.sinConfirmarTodavia.titulo,
    mensaje: a.sinConfirmarTodavia.mensaje,
  },
  correoReenviado: { tipo: 'informacion', titulo: a.correoReenviado.titulo },
  correoConfirmado: { tipo: 'logro', titulo: a.correoConfirmado.titulo },
  enlaceVencido: {
    tipo: 'atencion',
    titulo: a.enlaceVencido.titulo,
    mensaje: a.enlaceVencido.mensaje,
  },
  datosNoCoinciden: {
    tipo: 'atencion',
    titulo: a.datosNoCoinciden.titulo,
    mensaje: a.datosNoCoinciden.mensaje,
  },
  errorAlIniciarSesion: {
    tipo: 'informacion',
    titulo: a.errorAlIniciarSesion.titulo,
    mensaje: a.errorAlIniciarSesion.mensaje,
  },
  errorAlCambiarContrasena: {
    tipo: 'informacion',
    titulo: a.errorAlCambiarContrasena.titulo,
    mensaje: a.errorAlCambiarContrasena.mensaje,
  },
  contrasenaCambiada: {
    tipo: 'logro',
    titulo: a.contrasenaCambiada.titulo,
    mensaje: a.contrasenaCambiada.mensaje,
  },
  errorAlCargarIngreso: {
    tipo: 'informacion',
    titulo: a.errorAlCargarIngreso.titulo,
  },
  noReconoceElIngreso: {
    tipo: 'informacion',
    titulo: a.noReconoceElIngreso.titulo,
    mensaje: a.noReconoceElIngreso.mensaje,
  },
  enlaceDeRecuperacionEnviado: {
    tipo: 'informacion',
    titulo: a.enlaceDeRecuperacionEnviado.titulo,
    mensaje: a.enlaceDeRecuperacionEnviado.mensaje,
  },
  errorAlEnviarEnlace: {
    tipo: 'informacion',
    titulo: a.errorAlEnviarEnlace.titulo,
    mensaje: a.errorAlEnviarEnlace.mensaje,
  },
  errorAlGuardarContrasena: {
    tipo: 'informacion',
    titulo: a.errorAlGuardarContrasena.titulo,
    mensaje: a.errorAlGuardarContrasena.mensaje,
  },
  contrasenaRecuperada: {
    tipo: 'logro',
    titulo: a.contrasenaRecuperada.titulo,
  },
  sesionCerrada: { tipo: 'informacion', titulo: a.sesionCerrada.titulo },
  menorDeEdad: {
    tipo: 'informacion',
    titulo: a.menorDeEdad.titulo,
    mensaje: a.menorDeEdad.mensaje,
  },
  errorAlCargarInformacion: {
    tipo: 'informacion',
    titulo: a.errorAlCargarInformacion.titulo,
  },
  errorAlGuardarAutorizacion: {
    tipo: 'informacion',
    titulo: a.errorAlGuardarAutorizacion.titulo,
    mensaje: a.errorAlGuardarAutorizacion.mensaje,
  },
  errorAlBorrarElCorreo: {
    tipo: 'informacion',
    titulo: a.errorAlBorrarElCorreo.titulo,
  },
  correoBorrado: {
    tipo: 'informacion',
    titulo: a.correoBorrado.titulo,
    mensaje: a.correoBorrado.mensaje,
  },
  cambiosGuardados: { tipo: 'informacion', titulo: a.cambiosGuardados.titulo },
  movimientoNoExiste: { tipo: 'informacion', titulo: a.movimientoNoExiste.titulo },
  errorAlGuardarCambios: {
    tipo: 'informacion',
    titulo: a.errorAlGuardarCambios.titulo,
    mensaje: a.errorAlGuardarCambios.mensaje,
  },
  errorAlBorrar: {
    tipo: 'informacion',
    titulo: a.errorAlBorrar.titulo,
    mensaje: a.errorAlBorrar.mensaje,
  },
  errorAlCargarMovimientos: {
    tipo: 'informacion',
    titulo: a.errorAlCargarMovimientos.titulo,
    mensaje: a.errorAlCargarMovimientos.mensaje,
  },
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

// E14-PCP 1.19 (D-163): lo que dice App.tsx al arrancar en Android, mientras cargan las fuentes y si fallan
export const textosDeArranque = textos.arranque;

// E14-PCP 4.8: los dos errores de la fecha de nacimiento de PN-65. La fecha nunca sale del teléfono: se revisa aquí.
export const textosDeEdad = textos.textosDeEdad;

/** Lo que PN-64 muestra de cada finalidad que el API entrega por su `codigo` (E14-PCP 5); el API no manda textos. */
export const finalidadesDeE14: Record<string, { nombre: string; descripcion: string; casilla?: string }> =
  textos.finalidades;

export const textoDeErrorDeCampo = (
  codigo: string,
  pantalla: keyof typeof erroresDeCampo = 'crearCuenta',
): string | undefined =>
  (erroresDeCampo[pantalla] as Record<string, string>)[codigo];

/** El aviso que corresponde a un fallo que no es de campo; `generico` es el de la pantalla para lo demás. */
export function avisoDeFallo(
  respuesta: Extract<Respuesta<unknown>, { ok: false }>,
  generico: DatosDeAviso,
): DatosDeAviso {
  if (respuesta.codigo === SIN_CONEXION || respuesta.codigo === SIN_CONFIGURACION)
    return avisos.sinConexion;
  if (respuesta.estado === 429) return avisos.demasiadosIntentos;
  return generico;
}

/**
 * El resumen de PN-72 (D-093, D-163, E14-PRR 1.6). Con los dos tipos: «13 por confirmar: 2 ingresos y 11 gastos». Con
 * un solo tipo, sin el cero y sin repetir el número: «13 gastos por confirmar», «1 ingreso por confirmar». Los recuentos
 * usan la convención de plurales de US-59 (`one` y `other`). E14 no tiene texto para total 0 (PN-72 solo muestra el
 * resumen cuando hay fechas por confirmar): con 0 y 0 lanza un error, para que un llamado equivocado no pinte un texto
 * inventado. PN-72 todavía no se construye: la llamará.
 */
export function resumenPorConfirmar(ingresos: number, gastos: number): string {
  if (ingresos === 0 && gastos === 0) {
    throw new Error('resumenPorConfirmar: no hay nada por confirmar y E14 no tiene texto para eso.');
  }
  if (gastos === 0) return plural(textos.porConfirmar.soloIngresos, ingresos);
  if (ingresos === 0) return plural(textos.porConfirmar.soloGastos, gastos);
  return formatear(textos.porConfirmar.resumen, {
    total: String(ingresos + gastos),
    ingresos: plural(textos.porConfirmar.ingresos, ingresos),
    gastos: plural(textos.porConfirmar.gastos, gastos),
  });
}

export type OpcionDePeriodicidad = 'no_se_repite' | Periodicidad;
export const etiquetasDePeriodicidad: Record<OpcionDePeriodicidad, string> = textos.periodicidad.opciones;
export const explicacionesDePeriodicidad: Record<OpcionDePeriodicidad, string> = textos.periodicidad.explicaciones;

/** Los nombres de las categorías de E09 por `id` del API («c1»…): el API manda el `id`, la pantalla pone el texto de E14. */
export const nombresDeCategoria: Record<string, string> = textos.registro.categorias;

/** Los códigos de error de campo del API al texto de E14-PPN 3.1 y E14-PRR (PN-03); un código sin texto da el aviso. */
export const textosDeErrorDeRegistro: Record<string, string> = {
  tipo_requerido: textos.registro.errores.tipo,
  monto_requerido: textos.registro.errores.montoVacio,
  monto_no_positivo: textos.registro.errores.montoCero,
  monto_invalido: textos.registro.errores.montoIlegible,
  fecha_requerida: textos.registro.errores.fecha,
  fecha_invalida: textos.registro.errores.fecha,
  categoria_requerida: textos.registro.errores.categoria,
  medio_requerido: textos.registro.errores.medio,
  periodicidad_requerida: textos.periodicidad.errores.sinPeriodicidad,
};

/**
 * El aviso de después de guardar (E14-PPN 1.11, D-165; el monto sigue la regla de E14-SDD 5.5). Si solo se guardó la
 * repetición (fecha futura, D-091) el movimiento todavía no pasó: «queda por confirmar el {fecha}», en palabras.
 */
export function avisoDeRegistro(tipo: Tipo, fecha: string, seRegistro: boolean, centavos: bigint): DatosDeAviso {
  const monto = formatearPesos(centavos);
  const gasto = tipo === 'gasto';
  const titulo = seRegistro
    ? formatear(gasto ? textos.registro.avisos.registramosGasto : textos.registro.avisos.registramosIngreso, { monto })
    : formatear(
        gasto ? textos.registro.avisos.quedaPorConfirmarGasto : textos.registro.avisos.quedaPorConfirmarIngreso,
        { monto, fecha: diaEnPalabras(fecha) ?? fecha },
      );
  return { tipo: 'informacion', titulo };
}

export const avisoErrorAlGuardarMovimiento = (tipo: Tipo): DatosDeAviso => ({
  tipo: 'informacion',
  titulo: tipo === 'gasto' ? textos.registro.avisos.errorAlGuardarGasto : textos.registro.avisos.errorAlGuardarIngreso,
  mensaje: textos.registro.avisos.errorAlGuardarMensaje,
});
