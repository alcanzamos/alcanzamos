import { screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { configuracionDeAnuncios, ESPERA_DEL_ANUNCIO_MS, type Mecanismo } from '../../src/anuncios';

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

// Variante `region` (EXPO_PUBLIC_ANUNCIOS, temporal): TalkBack dice lo que cambia en la región viva de la pantalla o de
// la hoja (`RegionDeAnuncios`). Las pruebas miran esas vistas y su texto.

/** Las pruebas del `describe` donde se llama usan `mecanismo`; las demás, `anuncio` (lo fija `preparar.ts`). */
export function usarMecanismo(mecanismo: Mecanismo) {
  let reemplazo: { restore(): void } | undefined;
  beforeEach(() => {
    reemplazo = jest.replaceProperty(configuracionDeAnuncios, 'mecanismo', mecanismo);
  });
  afterEach(() => reemplazo?.restore());
}

/** Las vistas con una región viva, en el orden del árbol. */
export const regionesVivas = () =>
  screen.container.queryAll((vista) => vista.props.accessibilityLiveRegion !== undefined);

/** Los textos dentro de una vista (la región viva tiene uno). */
export const textosDe = (vista: TestInstance) => vista.queryAll((hijo) => hijo.type === 'Text');

/** Lo que dice una región viva. */
export const textoDe = (region: TestInstance) =>
  textosDe(region)
    .flatMap((texto) => texto.children)
    .join('');

/** Espera a que una región viva diga `texto` (pasada la espera del anuncio) y la devuelve. */
export async function esperarRegion(texto: string) {
  let region: TestInstance | undefined;
  await waitFor(
    () => {
      region = regionesVivas().find((r) => textoDe(r) === texto);
      expect(region).toBeDefined();
    },
    { timeout: ESPERA_DEL_ANUNCIO_MS + 1000 },
  );
  return region!;
}
