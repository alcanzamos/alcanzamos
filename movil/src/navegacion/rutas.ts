import type { Movimiento } from '../api/movimientos';
import type { FechaPorConfirmar } from '../api/repeticiones';
import type { DatosDeAviso } from '../textos';
import type { Llegada } from './llegada';

// Las pantallas de la pila y los parámetros de cada una. Cada rama de la US-49 suma las suyas.
// `llegada` es el aviso que la pantalla muestra arriba al llegar («Tu sesión se cerró…»): un texto de la lista
// de `llegada.ts`, nunca el texto mismo ni datos de la persona.
export type Rutas = {
  /** PN-60. `correo` viene de «Ya elegí mi contraseña» de PN-59 (D-184, provisional hasta I08). */
  Entrar: { llegada?: Llegada; correo?: string } | undefined;
  /** PN-65: solo se abre desde «Crear una cuenta» de PN-60. */
  Edad: undefined;
  /**
   * PN-58: solo se abre desde PN-65 y con la edad ya comprobada; `mayorDeEdad` solo puede ser verdadero. `correo` es lo
   * que PN-59 devuelve con «Usar otro correo»: solo vive en la memoria, nunca se guarda.
   */
  CrearCuenta: { mayorDeEdad: true; correo?: string };
  /** PN-59, sin sesión: el correo se pasa para mostrarlo y reenviarlo; solo vive en la memoria, nunca se guarda. */
  RevisaTuCorreo: { correo?: string } | undefined;
  /**
   * PN-63. Sin `desdeElMenu`, el primer uso (sin Atrás y con «Continuar»); `llegada` es el mensaje de estado de arriba
   * («Listo, confirmamos tu correo.»). Con `desdeElMenu`, la barra con su título y Atrás, y sin «Continuar»: se apila
   * sobre PN-71 desde su entrada provisional «Cómo cuidamos tus datos» (bug 260) y su Atrás vuelve a PN-71.
   */
  InformacionDePrivacidad: { llegada?: Llegada; desdeElMenu?: true } | undefined;
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
   * guardar («Listo, registramos tu gasto de $45.000.»): solo vive en la memoria, nunca se guarda. `movimiento` es el id
   * de una fecha registrada de PN-08: al cargar la lista abre su PN-02, como la web.
   */
  ListaDeMovimientos: { periodo?: string; categoria?: number; aviso?: DatosDeAviso; movimiento?: string } | undefined;
  /**
   * PN-02 · Detalle de un movimiento (E14-PRR 4.2); se abre desde una fila de PN-01 con el movimiento que ya trae.
   * `noExiste`: el API contestó 404 al corregirlo o borrarlo («Ese movimiento ya no está.»).
   */
  DetalleDeMovimiento: { movimiento: Movimiento; noExiste?: boolean };
  /** «Corregir» de PN-02: los mismos campos del registro, llenos; su Atrás vuelve a PN-02 sin guardar. */
  CorregirMovimiento: { movimiento: Movimiento };
  /**
   * «Confirmar todos» (E14-PRR 4.8), de la sección «Por confirmar» de PN-01 o de PN-08 con más de una fecha; trae las
   * fechas que ya pidió esa pantalla. `periodoDeIngresos` es el periodo de PN-08 cuando viene de ahí. Su Atrás vuelve sin
   * guardar; al guardar vuelve con el aviso (`popTo`).
   */
  ConfirmarTodos: { pendientes: { pendientes: FechaPorConfirmar[] }; periodoDeIngresos?: string };
  /**
   * PN-06 y PN-07 · Presupuesto (E14-PPA 4.1 y 4.2), destino de la entrada provisional «Presupuesto» de PN-71 (L3 de la
   * US-77, punto 3). `aviso` es el mensaje de estado de después de guardar: solo vive en la memoria, nunca se guarda.
   */
  PresupuestoDelMes: { aviso?: DatosDeAviso } | undefined;
  /**
   * PN-08 · Ingresos del periodo (E14-PPA 4.3), desde «Ver mis ingresos» de PN-06 y PN-07; su Atrás vuelve ahí. `periodo`
   * («AAAA-MM», sin él el mes en curso) vive en la ruta; `aviso` es el mensaje de estado de después de confirmar.
   */
  IngresosDelPeriodo: { periodo?: string; aviso?: DatosDeAviso } | undefined;
  /**
   * Formulario de registro (E14-PPN 3.1); se abre desde «Registrar» de PN-01, PN-06 y PN-07 y desde «Registrar un
   * ingreso» de PN-07, y vuelve a PN-01 al guardar (D-164).
   */
  FormularioDeRegistro: undefined;
  /** PN-03: se apila sobre Registrar; su Atrás vuelve al formulario sin cambiar nada. */
  SeRepite: undefined;
  /** PN-73. */
  CambiarContrasena: undefined;
  /** PN-69 · Borrar la cuenta; se abre desde «Borrar mi cuenta» de PN-71 y su Atrás vuelve a PN-71. */
  BorrarCuenta: undefined;
  /** PN-61. Su Atrás vuelve a PN-60. */
  RecuperarAcceso: undefined;
};
