import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo, type HostInstance } from 'react-native';

// Anuncios del lector de pantalla (ACC-004, bugs 225 y 226). Todo anuncio sale pasada una espera, para que llegue
// después de lo que TalkBack dice al mover el foco: al llegar a otra pantalla (el foco va a la barra), cuando el botón
// tocado desaparece (PN-61), al volver de la hoja de compartir o al llevar el foco al primer campo con error.
//
// TEMPORAL (US-63, #96): hay dos variantes hasta que el dueño pruebe en su celular, con TalkBack, cuál se oye (L2 de
// la tarea). Se elige al empaquetar con `EXPO_PUBLIC_ANUNCIOS` (ver movil/README.md, «ACC-004 en Android»); después
// se borra la que no sirva, con este interruptor.
// - `region` (por omisión): una región viva (`accessibilityLiveRegion="polite"`) en una vista que React Native no
//   aplana (`collapsable={false}`), montada desde que se abre la pantalla o la hoja, cuyo texto cambia
//   (`RegionDeAnuncios`). Una vista que solo lleva la región viva la aplana Fabric y no llega a Android: por eso antes
//   no se oían los errores de campo ni `MensajeDeEstado`.
// - `anuncio`: `AccessibilityInfo.announceForAccessibility`, que en Android manda un evento `TYPE_ANNOUNCEMENT`, la
//   vía que Android marca como obsoleta (`View.announceForAccessibility`). Queda solo si la región viva no se oye.

export type Mecanismo = 'region' | 'anuncio';

/** El valor de `EXPO_PUBLIC_ANUNCIOS`: `anuncio` o `region`; vacío o sin definir es `region`. */
export function leerMecanismo(valor: string | undefined): Mecanismo {
  const limpio = valor?.trim() ?? '';
  if (limpio === 'anuncio') return 'anuncio';
  if (limpio !== '' && limpio !== 'region') {
    console.warn(`[anuncios] EXPO_PUBLIC_ANUNCIOS="${valor}" no es «region» ni «anuncio»: se usa «region».`);
  }
  return 'region';
}

/**
 * La variante, leída una vez al cargar. Expo reemplaza `process.env.EXPO_PUBLIC_ANUNCIOS` al empaquetar; hay que
 * escribirlo con ese nombre exacto. Las pruebas la cambian con `jest.replaceProperty` (`usarMecanismo`).
 */
export const configuracionDeAnuncios: { mecanismo: Mecanismo } = {
  mecanismo: leerMecanismo(process.env.EXPO_PUBLIC_ANUNCIOS),
};

/** La espera antes de anunciar. Cubre la transición de la pantalla y la lectura del foco nuevo. */
export const ESPERA_DEL_ANUNCIO_MS = 1000;

type Region = (texto: string) => void;
const regiones: Region[] = [];

/**
 * Variante `region`: `RegionDeAnuncios` se registra al montarse. Lo dice la última montada que siga en pie: la de la
 * hoja abierta (otra ventana en Android) o la de la pantalla de arriba de la pila. Devuelve la función que la quita.
 */
export function registrarRegion(region: Region): () => void {
  regiones.push(region);
  return () => {
    const i = regiones.lastIndexOf(region);
    if (i >= 0) regiones.splice(i, 1);
  };
}

/**
 * Anuncia `texto` pasada la espera, con la variante elegida. La región se busca al final de la espera: si la pantalla
 * cambió mientras tanto, lo dice la nueva. Devuelve la función que lo cancela.
 */
export function anunciar(texto: string): () => void {
  const espera = setTimeout(() => {
    if (configuracionDeAnuncios.mecanismo === 'anuncio') AccessibilityInfo.announceForAccessibility(texto);
    else regiones[regiones.length - 1]?.(texto);
  }, ESPERA_DEL_ANUNCIO_MS);
  return () => clearTimeout(espera);
}

/**
 * Anuncia `texto` cuando aparece y cada vez que cambia; un texto vacío no se anuncia. Con `alAparecer` en falso solo se
 * anuncian los cambios (un recuento que ya está al abrir la pantalla no es un mensaje de estado).
 */
export function useAnuncio(texto: string | undefined, { alAparecer = true }: { alAparecer?: boolean } = {}) {
  const inicial = useRef(texto);
  const cambio = useRef(alAparecer);
  useEffect(() => {
    if (!cambio.current && texto === inicial.current) return;
    cambio.current = true;
    // Si el componente se va o el texto cambia antes de la espera, ese anuncio ya no se dice.
    return texto ? anunciar(texto) : undefined;
  }, [texto]);
}

export type ErrorDeCampo = { error?: string; campo?: RefObject<HostInstance | null> };

/**
 * Los errores de un formulario al guardar (E14-PCP: «con varios errores, el foco va al primero y se muestran todos a
 * la vez»). Devuelve `avisarErrores`: el foco va al primer campo con error, el de entrada y el de TalkBack, y TalkBack
 * anuncia todos los errores en el orden de la pantalla. La lectura del campo ya no tapa el error: el anuncio llega
 * después. Se anuncia en cada intento, aunque los errores sean los mismos de antes; un intento nuevo reemplaza el
 * anuncio que no se alcanzó a decir, y si la pantalla se va antes de la espera no se dice. Un primer error sin `campo`
 * no mueve el foco.
 */
export function useAvisarErrores() {
  const cancelar = useRef<() => void>(undefined);
  useEffect(() => () => cancelar.current?.(), []);
  return useCallback((errores: ErrorDeCampo[]) => {
    const conError = errores.filter((e): e is ErrorDeCampo & { error: string } => Boolean(e.error));
    if (conError.length === 0) return;
    const campo = conError[0]!.campo?.current;
    if (campo) {
      campo.focus();
      AccessibilityInfo.sendAccessibilityEvent(campo, 'focus');
    }
    cancelar.current?.();
    cancelar.current = anunciar(conError.map((e) => e.error).join(' '));
  }, []);
}
