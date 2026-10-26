import type { Llegada } from './llegada';

// Las pantallas de la pila y los parámetros de cada una. Cada rama de la US-49 suma las suyas.
// `llegada` es el aviso que la pantalla muestra arriba al llegar («Tu sesión se cerró…»): un texto de la lista
// de `llegada.ts`, nunca el texto mismo ni datos de la persona.
export type Rutas = {
  /** PN-60. */
  Entrar: { llegada?: Llegada } | undefined;
  /** PN-65: solo se abre desde «Crear una cuenta» de PN-60. */
  Edad: undefined;
  /** PN-58: solo se abre desde PN-65 y con la edad ya comprobada; `mayorDeEdad` solo puede ser verdadero. */
  CrearCuenta: { mayorDeEdad: true };
  /** PN-59: el correo se pasa para mostrarlo; solo vive en la memoria de la pantalla, nunca se guarda. */
  RevisaTuCorreo: { correo?: string } | undefined;
  /** PN-63, solo el primer uso (sin Atrás); `llegada` es el mensaje de estado de arriba («Listo, confirmamos tu correo.»). */
  InformacionDePrivacidad: { llegada?: Llegada } | undefined;
  /** PN-64: solo se abre desde «Continuar» de PN-63; su Atrás vuelve a PN-63. */
  AutorizacionDeDatos: undefined;
  /** PN-71, la pantalla de inicio provisional de quien entra con autorización. */
  SeguridadDeLaCuenta: { llegada?: Llegada } | undefined;
  /** PN-73. */
  CambiarContrasena: undefined;
  /** PN-61. Su Atrás vuelve a PN-60. */
  RecuperarAcceso: undefined;
};
