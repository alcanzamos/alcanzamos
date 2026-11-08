import { waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { ESPERA_DEL_ANUNCIO_MS } from '../../src/anuncios';

// ACC-004: lo que TalkBack anuncia sale de `AccessibilityInfo.announceForAccessibility` (un mock de jest en las
// pruebas). Con relojes reales se espera el anuncio; con los falsos, Testing Library los adelanta.

/** Olvida los anuncios y los movimientos de foco de las pruebas anteriores. */
export function limpiarAnuncios() {
  jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
}

/** Los textos anunciados hasta ahora, en orden. */
export const anunciados = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([texto]) => texto);

/** Espera a que TalkBack reciba `texto` como anuncio (pasada la espera del anuncio). */
export async function esperarAnuncio(texto: string) {
  await waitFor(() => expect(anunciados()).toContain(texto), { timeout: ESPERA_DEL_ANUNCIO_MS + 1000 });
}

/** La vista a la que se llevó el foco de TalkBack (`sendAccessibilityEvent(vista, 'focus')`), o `undefined`. */
export function focoDeTalkBack() {
  const llamadas = jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls;
  return llamadas.filter(([, evento]) => evento === 'focus').map(([vista]) => vista)[0] as unknown as
    | { props: Record<string, unknown> }
    | undefined;
}
