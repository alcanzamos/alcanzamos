import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { atras, instalarAtras } from '../ayudas/atras';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const PN71 = 'Este es tu primer ingreso.';
const ENTRADA = 'Antes de seguir, esto es lo que hacemos con tu información.';

// USA-003 (RNF-011, RF-059; E14-PCP 4.6 y nota del 2026-11-08 de 4.14, bug 260), con la pila de verdad: mientras no
// exista PN-66, PN-71 es el inicio y su entrada «Cómo cuidamos tus datos» abre PN-63 desde el menú, con la barra nativa
// (título y Atrás) y sin «Continuar». El Atrás vuelve a PN-71.
describe('PN-63 desde el menú en Android: a un toque de PN-71', () => {
  beforeEach(() => {
    instalarAtras();
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
  });

  it('USA-003 la información de privacidad está a un toque del inicio', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
    await render(<Navegacion />);
    await screen.findByText(PN71);
    await fireEvent.press(screen.getByRole('button', { name: 'Cómo cuidamos tus datos' }));

    expect(await screen.findByText(ENTRADA)).toBeOnTheScreen();
    // El título «Cómo cuidamos tus datos» es el de la barra nativa (con el Atrás del sistema), no un encabezado de la pantalla.
    expect(JSON.stringify(screen.toJSON())).toContain('"title":"Cómo cuidamos tus datos"');
    expect(screen.queryByRole('header', { name: 'Cómo cuidamos tus datos' })).not.toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Dónde se guardan' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeOnTheScreen();
    // PN-63 no le pide nada al API.
    expect(pedidos).toHaveLength(1);

    expect(await atras()).toBe(true);
    await waitFor(() => expect(screen.queryByText(ENTRADA)).not.toBeOnTheScreen());
    expect(screen.getByText(PN71)).toBeOnTheScreen();
    expect(await atras()).toBe(false);
  });
});
