import { CommonActions, type NavigationProp } from '@react-navigation/native';
import { avisos, type DatosDeAviso } from '../textos';
import type { Rutas } from './rutas';

// Un aviso que la pantalla de destino muestra arriba al llegar (E14-PCP: «Tu sesión se cerró…», «Listo, confirmamos
// tu correo.» en 4.16 T11). Viaja como parámetro de la ruta: no se manda a ningún lado ni se guarda.
const porLlegada = {
  sesion_cerrada: avisos.sesionCerrada,
  correo_confirmado: avisos.correoConfirmado,
  contrasena_recuperada: avisos.contrasenaRecuperada,
  contrasena_cambiada: avisos.contrasenaCambiada,
  cuenta_borrada: avisos.correoBorrado,
} satisfies Record<string, DatosDeAviso>;

export type Llegada = keyof typeof porLlegada;

export const avisoDeLlegada = (llegada?: Llegada): DatosDeAviso | null =>
  llegada ? (porLlegada[llegada] ?? null) : null;

type Navegacion = NavigationProp<Rutas>;

/**
 * Cambia a otra pantalla dejándola como la única de la pila: el Atrás del sistema no vuelve a la anterior (por
 * ejemplo, desde PN-59 no se vuelve a PN-58 con el formulario, y tras cerrar sesión no se vuelve a la sesión).
 */
export function reemplazarPila<R extends keyof Rutas>(navegacion: Navegacion, nombre: R, params?: Rutas[R]): void {
  navegacion.dispatch(CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] }));
}
