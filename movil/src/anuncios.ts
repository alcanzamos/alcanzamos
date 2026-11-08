import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo, type HostInstance } from 'react-native';

// Anuncios del lector de pantalla (ACC-004, bugs 225 y 226). En Android no se usa `accessibilityLiveRegion`:
// - una vista que solo lleva la región viva (sin `accessible`, fondo ni borde) la aplana React Native (Fabric) y no
//   llega a Android, así que su texto nunca se anuncia (los errores de campo y `MensajeDeEstado`);
// - la región viva que sí llega se anuncia en cola, y TalkBack la corta cuando el foco se mueve: al llegar a otra
//   pantalla (el foco va a la barra), cuando el botón tocado desaparece (PN-61) o al volver de la hoja de compartir.
// Por eso se anuncia con `announceForAccessibility`, pasada una espera para que el anuncio llegue después de lo que
// TalkBack dice al mover el foco.

/** La espera antes de anunciar. Cubre la transición de la pantalla y la lectura del foco nuevo. */
export const ESPERA_DEL_ANUNCIO_MS = 1000;

/** Anuncia `texto` pasada la espera. Devuelve la función que lo cancela. */
export function anunciar(texto: string): () => void {
  const espera = setTimeout(() => AccessibilityInfo.announceForAccessibility(texto), ESPERA_DEL_ANUNCIO_MS);
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
