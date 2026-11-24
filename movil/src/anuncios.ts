import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, type HostInstance } from 'react-native';
import type { ControlDePantalla } from './componentes/Pantalla';
import { cuandoNoHayHojas, hayHojaVisible } from './estadoDeHojas';

// Lo que TalkBack dice sin que la persona mueva el foco (ACC-004, bugs 225 y 226), sin funciones obsoletas de Android
// (L2 y L6 del dueño, sesión 4 del celular):
// - Los avisos de estado pasan por la región viva de la pantalla o de la hoja (`RegionDeAnuncios`, en una vista que
//   React Native no aplana). En el celular se oyeron después de lo que TalkBack dice al llegar a la pantalla.
// - Los errores de un formulario no se anuncian: los dice el campo, que los lleva en su nombre, cuando el foco llega a
//   él (`useAvisarErrores`).
// Todo aviso sale pasada una espera, para que llegue después de lo que TalkBack dice al mover el foco: al llegar a otra
// pantalla (el foco va a la barra), cuando el botón tocado desaparece (PN-61) o al volver de la hoja de compartir.

/** La espera antes de anunciar. Cubre la transición de la pantalla y la lectura del foco nuevo. */
export const ESPERA_DEL_ANUNCIO_MS = 1000;

type Region = (texto: string) => void;
const regiones: Region[] = [];

/**
 * `RegionDeAnuncios` se registra al montarse. Lo dice la última montada que siga en pie: la de la hoja abierta (otra
 * ventana en Android) o la de la pantalla de arriba de la pila. Devuelve la función que la quita.
 */
export function registrarRegion(region: Region): () => void {
  regiones.push(region);
  return () => {
    const i = regiones.lastIndexOf(region);
    if (i >= 0) regiones.splice(i, 1);
  };
}

/**
 * Anuncia `texto` en la región viva pasada la espera. La región se busca al final de la espera: si la pantalla cambió
 * mientras tanto, lo dice la nueva. Devuelve la función que lo cancela.
 */
export function anunciar(texto: string): () => void {
  const espera = setTimeout(() => regiones[regiones.length - 1]?.(texto), ESPERA_DEL_ANUNCIO_MS);
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
 * la vez»). Devuelve `avisarErrores`: el foco va al primer campo con error, el de entrada (`focus()`) y el de TalkBack
 * (`sendAccessibilityEvent(campo, 'focus')`), y el campo lee su error porque lo lleva en su nombre («Monto, Falta el
 * monto.»). No hay anuncio aparte. El foco se mueve después de que la pantalla dibuja los errores, para que TalkBack
 * lea el campo ya con el suyo, y se vuelve a mover en cada intento, aunque los errores sean los mismos (así se lee de
 * nuevo). Un primer error sin `campo` no mueve el foco. Con `pantalla` (la referencia de `Pantalla`, bug 304) primero
 * se desplaza la pantalla hasta el campo y el foco se pide cuando ya está a la vista: una casilla fuera de la ventana
 * (PN-64) no recibía el foco donde la persona lo veía.
 */
export function useAvisarErrores(pantalla?: RefObject<ControlDePantalla | null>) {
  const [pedido, setPedido] = useState<{ campo: RefObject<HostInstance | null> }>();
  useEffect(() => {
    const campo = pedido?.campo.current;
    if (!campo) return;
    let vigente = true;
    const enfocar = () => {
      if (!vigente) return;
      campo.focus();
      AccessibilityInfo.sendAccessibilityEvent(campo, 'focus');
    };
    if (pantalla?.current) pantalla.current.desplazarHasta(campo, enfocar);
    else enfocar();
    return () => {
      vigente = false;
    };
  }, [pedido, pantalla]);
  return useCallback((errores: ErrorDeCampo[]) => {
    const campo = errores.find((e) => e.error)?.campo;
    // Un objeto nuevo en cada intento: el efecto corre otra vez aunque el campo sea el mismo.
    if (campo) setPedido({ campo });
  }, []);
}

/**
 * El foco de TalkBack después de una acción que cambia la pantalla (E14-SDD v2.5, 5.12; bugs 303 y 304): devuelve
 * `llevarFoco(vista)`, que lo lleva a esa vista con `sendAccessibilityEvent(vista, 'focus')`. Al cancelar una hoja, al
 * botón que la abrió; después de guardar o confirmar, a un título que sigue ahí; con un aviso que la persona tiene que
 * leer, al aviso. Si la vista ya no está (el botón se fue al recargar), el foco no se mueve.
 *
 * Se pide cuando pasaron los dos eventos de los que depende, no tras una espera: (1) no hay ninguna hoja en pantalla,
 * ni abierta ni saliendo (`HojaInferior`; con una hoja saliendo, Android todavía tiene su ventana encima y TalkBack
 * mandaba el foco a «Navegar hacia arriba»; una salida interrumpida porque la hoja se abrió de nuevo no cuenta como
 * terminada); (2) el cuadro siguiente al dibujo, cuando la pantalla ya tiene lo nuevo con su diseño
 * (`requestAnimationFrame` es el cuadro, no un retraso; `InteractionManager` está obsoleto en React Native 0.88). Justo
 * antes de enviar el foco se vuelve a mirar que no haya hojas: si se abrió una en ese cuadro, se espera a que se cierre.
 * Un pedido nuevo reemplaza al anterior, y si la pantalla se va antes, el foco no se pide.
 */
export function useLlevarFoco() {
  const [pedido, setPedido] = useState<{ vista: RefObject<HostInstance | null> }>();
  useEffect(() => {
    if (!pedido) return;
    let cuadro: number | undefined;
    let cancelarEspera = () => {};
    const pedir = () => {
      cancelarEspera = cuandoNoHayHojas(() => {
        cuadro = requestAnimationFrame(() => {
          if (hayHojaVisible()) return pedir();
          const vista = pedido.vista.current;
          if (vista) AccessibilityInfo.sendAccessibilityEvent(vista, 'focus');
        });
      });
    };
    pedir();
    return () => {
      cancelarEspera();
      if (cuadro !== undefined) cancelAnimationFrame(cuadro);
    };
  }, [pedido]);
  // Un objeto nuevo en cada pedido: el efecto corre otra vez aunque la vista sea la misma.
  return useCallback((vista: RefObject<HostInstance | null>) => setPedido({ vista }), []);
}
