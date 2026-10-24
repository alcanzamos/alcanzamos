import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

// El Atrás de Android: ver flujoDeCuenta.test.tsx.
const suscripciones = new Set<(evento: never) => boolean | null | undefined>();
const atras = (): boolean => [...suscripciones].reverse().some((alTocar) => alTocar(undefined as never));

const FECHA = 'el 1 de noviembre de 2026, a las 9:40 p. m.';

async function entrarConLaura() {
  await fireEvent.changeText(await screen.findByLabelText('Correo electrónico'), 'laura@ejemplo.com');
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'lluvia café tren azul');
  await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
}

describe('flujo de entrar, ver la seguridad, cambiar la contraseña y salir', () => {
  beforeEach(() => {
    suscripciones.clear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
      suscripciones.add(alTocar);
      return { remove: () => suscripciones.delete(alTocar) };
    });
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    jest.clearAllMocks();
  });

  it('entra, ve su último ingreso (el Atrás sale de la app), cambia la contraseña y sale', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(200, { estado: 'activa', token: 'tk-laura' }),
      respuestaJson(200, { ingreso_anterior: '2026-11-02T02:40:00Z' }),
      respuestaJson(200, { estado: 'contrasena_cambiada' }),
      respuestaJson(200, { ingreso_anterior: '2026-11-02T02:40:00Z' }),
      respuestaJson(204),
    );
    await render(<Navegacion />);
    await entrarConLaura();

    // PN-71: el ingreso anterior, con el token en el Keystore y nunca en el texto.
    expect(await screen.findByText('Tu último ingreso')).toBeOnTheScreen();
    expect(screen.getByText(/Tu ingreso anterior fue el/)).toHaveTextContent(`Tu ingreso anterior fue ${FECHA}`);
    expect(almacen.guardado.get('sesion')).toBe('tk-laura');
    expect((pedidos[1]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-laura');
    // Es la única pantalla: el Atrás no vuelve al formulario de entrar.
    await act(async () => {
      expect(atras()).toBe(false);
    });

    // PN-73 y de vuelta.
    await fireEvent.press(screen.getByRole('button', { name: 'Cambiar mi contraseña' }));
    await fireEvent.changeText(await screen.findByLabelText('Tu contraseña de ahora'), 'lluvia café tren azul');
    await fireEvent.changeText(screen.getByLabelText('Tu contraseña nueva'), 'otra frase de cuatro palabras');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar la contraseña' }));
    expect(await screen.findByText('Listo, cambiamos tu contraseña.')).toBeOnTheScreen();
    expect(screen.getByText('Cerramos tus otras sesiones. Esta sigue abierta.')).toBeOnTheScreen();
    expect(almacen.guardado.get('sesion')).toBe('tk-laura');

    // Cerrar sesión: DELETE, token borrado y de vuelta a PN-60 como única pantalla.
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(pedidos[4]?.init.method).toBe('DELETE');
    expect(almacen.guardado.has('sesion')).toBe(false);
    await act(async () => {
      expect(atras()).toBe(false);
    });
  });

  it('desde PN-73 el Atrás vuelve a PN-71', async () => {
    instalarFetchFalso(
      respuestaJson(200, { estado: 'activa', token: 'tk-laura' }),
      respuestaJson(200, { ingreso_anterior: '2026-11-02T02:40:00Z' }),
    );
    await render(<Navegacion />);
    await entrarConLaura();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cambiar mi contraseña' }));
    await screen.findByLabelText('Tu contraseña de ahora');
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(screen.queryByLabelText('Tu contraseña de ahora')).not.toBeOnTheScreen());
    expect(screen.getByText('Tu último ingreso')).toBeOnTheScreen();
  });

  it('una cuenta sin verificar entra a PN-59 y de ahí el Atrás sale de la app', async () => {
    instalarFetchFalso(respuestaJson(200, { estado: 'verificacion_pendiente', token: 'tk-limitada' }));
    await render(<Navegacion />);
    await entrarConLaura();
    expect(
      await screen.findByText('Te enviamos un enlace a laura@ejemplo.com. Ábrelo para confirmar tu cuenta.'),
    ).toBeOnTheScreen();
    expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    await act(async () => {
      expect(atras()).toBe(false);
    });
  });

  it('una sesión que se vence mientras se usa lleva a PN-60 con «Tu sesión se cerró»', async () => {
    instalarFetchFalso(
      respuestaJson(200, { estado: 'activa', token: 'tk-laura' }),
      respuestaJson(200, { ingreso_anterior: '2026-11-02T02:40:00Z' }),
      respuestaJson(401, { error: 'sin_sesion' }),
    );
    await render(<Navegacion />);
    await entrarConLaura();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cambiar mi contraseña' }));
    await fireEvent.changeText(await screen.findByLabelText('Tu contraseña de ahora'), 'x');
    await fireEvent.changeText(screen.getByLabelText('Tu contraseña nueva'), 'y');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar la contraseña' }));
    expect(await screen.findByText('Tu sesión se cerró. Entra de nuevo.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(almacen.guardado.has('sesion')).toBe(false);
  });

  it('«¿Olvidaste tu contraseña?» abre PN-61, que pide el enlace; Atrás vuelve a PN-60', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'enlace_enviado' }));
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    await fireEvent.changeText(await screen.findByLabelText('Correo electrónico'), 'laura@ejemplo.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Enviar el enlace' }));
    expect(await screen.findByText('Si ese correo tiene una cuenta, te enviamos un enlace.')).toBeOnTheScreen();
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/recuperacion');
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByText('Si ese correo tiene una cuenta, te enviamos un enlace.')).not.toBeOnTheScreen(),
    );
    expect(screen.getByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
  });
});
