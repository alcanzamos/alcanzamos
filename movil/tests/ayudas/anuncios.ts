import { screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { ESPERA_DEL_ANUNCIO_MS } from '../../src/anuncios';

// ACC-004: TalkBack dice lo que cambia en la región viva de la pantalla o de la hoja (`RegionDeAnuncios`). Las pruebas
// miran esas vistas y su texto. El foco de TalkBack sale del mock de `AccessibilityInfo.sendAccessibilityEvent`. Con
// relojes reales se espera el anuncio; con los falsos, Testing Library los adelanta.

/** Olvida los movimientos de foco de las pruebas anteriores (los anuncios viven en las regiones de cada render). */
export function limpiarAnuncios() {
  jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
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

/** Lo que dicen ahora las regiones vivas de la pantalla y de la hoja abierta: el último anuncio de cada una. */
export const anunciados = () => regionesVivas().map(textoDe).filter(Boolean);

/** Espera a que una región viva diga `texto` (pasada la espera del anuncio) y la devuelve. */
export async function esperarAnuncio(texto: string) {
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

type Vista = { props: Record<string, unknown> };

/** Las vistas a las que se llevó el foco de TalkBack (`sendAccessibilityEvent(vista, 'focus')`), en orden. */
export const focosDeTalkBack = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, evento]) => evento === 'focus')
    .map(([vista]) => vista as unknown as Vista);

/** La primera vista a la que se llevó el foco de TalkBack, o `undefined`. */
export const focoDeTalkBack = (): Vista | undefined => focosDeTalkBack()[0];

/** El nombre que TalkBack lee de una vista: su `accessibilityLabel` o, en un campo de texto, su texto de ejemplo. */
export const nombreDe = (vista: Vista | undefined) =>
  (vista?.props.accessibilityLabel ?? vista?.props.placeholder) as string | undefined;

/** Espera lo que tarda un anuncio y comprueba que ninguna región viva dijo nada (con relojes reales). */
export async function esperarSinAnuncios() {
  await new Promise((listo) => setTimeout(listo, ESPERA_DEL_ANUNCIO_MS + 100));
  expect(anunciados()).toEqual([]);
}
