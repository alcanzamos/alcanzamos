import type { Movimiento } from '../api/movimientos';
import type { DatosDeAviso } from '../textos';
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
  /**
   * PN-71, la pantalla de inicio provisional de quien entra con autorización. `aviso` es el mensaje de estado que lleva
   * datos de la persona («Listo, registramos tu gasto de $45.000.»): solo vive en la memoria, nunca se guarda.
   */
  SeguridadDeLaCuenta: { llegada?: Llegada; aviso?: DatosDeAviso } | undefined;
  /**
   * PN-01 · Movimientos (E14-PRR 4.1), destino de «Movimientos» de PN-71. Los filtros viven en la ruta (`periodo`
   * «AAAA-MM» y `categoria`), así sobreviven a abrir un movimiento. `aviso` es el mensaje de estado de después de
   * guardar («Listo, registramos tu gasto de $45.000.»): solo vive en la memoria, nunca se guarda.
   */
  ListaDeMovimientos: { periodo?: string; categoria?: number; aviso?: DatosDeAviso } | undefined;
  /**
   * PN-02 · Detalle de un movimiento (E14-PRR 4.2); se abre desde una fila de PN-01 con el movimiento que ya trae.
   * `noExiste`: el API contestó 404 al corregirlo o borrarlo («Ese movimiento ya no está.»).
   */
  DetalleDeMovimiento: { movimiento: Movimiento; noExiste?: boolean };
  /** «Corregir» de PN-02: los mismos campos del registro, llenos; su Atrás vuelve a PN-02 sin guardar. */
  CorregirMovimiento: { movimiento: Movimiento };
  /** Formulario de registro (E14-PPN 3.1); se abre desde «Registrar» de PN-01 y vuelve a PN-01 al guardar (D-164). */
  FormularioDeRegistro: undefined;
  /** PN-03: se apila sobre Registrar; su Atrás vuelve al formulario sin cambiar nada. */
  SeRepite: undefined;
  /** PN-73. */
  CambiarContrasena: undefined;
  /** PN-61. Su Atrás vuelve a PN-60. */
  RecuperarAcceso: undefined;
};
