import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ESPERA_MS, RevisaTuCorreo } from '../../src/pantallas/RevisaTuCorreo';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

async function mostrar(correo: string | null = 'laura@ejemplo.com') {
  const navegacion = navegacionFalsa();
  await render(<RevisaTuCorreo {...propiedades('RevisaTuCorreo', navegacion, correo ? { correo } : undefined)} />);
  return navegacion;
}

const boton = (nombre: string, extra: { disabled?: boolean } = {}) =>
  screen.getByRole('button', { name: nombre, ...extra });

describe('PN-59 · Verificar el correo, Android (E14-PCP 4.2)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'token-limitado');
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  describe('textos', () => {
    it('con el correo: título, explicación con la dirección, «no llegó», el plazo de 7 días y los tres botones', async () => {
      await mostrar();
      expect(screen.getByRole('header', { name: 'Revisa tu correo' })).toBeOnTheScreen();
      expect(
        screen.getByText('Te enviamos un enlace a laura@ejemplo.com. Ábrelo para confirmar tu cuenta.'),
      ).toBeOnTheScreen();
      expect(screen.getByText('¿No llegó? Mira también en el correo no deseado.')).toBeOnTheScreen();
      expect(screen.getByText('Si no lo confirmas en 7 días, borramos esta cuenta.')).toBeOnTheScreen();
      expect(boton('Ya lo confirmé')).toBeOnTheScreen();
      expect(boton('Reenviar el correo')).toBeOnTheScreen();
      expect(boton('Cambiar el correo')).toBeOnTheScreen();
    });

    it('sin la dirección (T4) dice «tu correo»', async () => {
      await mostrar(null);
      expect(screen.getByText('Te enviamos un enlace a tu correo. Ábrelo para confirmar tu cuenta.')).toBeOnTheScreen();
    });

    it('no dice nada del enlace de la web (D-155): sin botones de abrir correo ni de verificar', async () => {
      await mostrar();
      expect(screen.queryByRole('button', { name: /abrir|verificar|enlace/i })).not.toBeOnTheScreen();
      expect(screen.queryByRole('link')).not.toBeOnTheScreen();
    });

    it('el botón principal es «Ya lo confirmé»', async () => {
      await mostrar();
      expect(boton('Ya lo confirmé')).toHaveStyle({ backgroundColor: '#1F5C55' });
    });
  });

  describe('«Ya lo confirmé»', () => {
    it('con el correo confirmado sigue a la pantalla provisional con «Listo, confirmamos tu correo.»', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(200, { verificada: true }));
      const navegacion = await mostrar();
      await fireEvent.press(boton('Ya lo confirmé'));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SinAutorizacion', { llegada: 'correo_confirmado' })),
      );
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas/estado');
      expect(pedidos[0]?.init.method).toBe('GET');
      expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer token-limitado');
    });

    it('si todavía no confirmó, avisa «Todavía no confirmaste tu correo.» y se queda', async () => {
      instalarFetchFalso(respuestaJson(200, { verificada: false }));
      const navegacion = await mostrar();
      await fireEvent.press(boton('Ya lo confirmé'));
      expect(await screen.findByText('Todavía no confirmaste tu correo.')).toBeOnTheScreen();
      expect(screen.getByText('Abre el enlace que te enviamos.')).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
    });

    it('un 500 dice «No pudimos revisar si confirmaste tu correo.» (T8)', async () => {
      instalarFetchFalso(respuestaJson(500));
      await mostrar();
      await fireEvent.press(boton('Ya lo confirmé'));
      expect(await screen.findByText('No pudimos revisar si confirmaste tu correo.')).toBeOnTheScreen();
      expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
    });

    it('sin conexión dice «Sin conexión…»', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      await mostrar();
      await fireEvent.press(boton('Ya lo confirmé'));
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
    });

    it('un 401 (sin sesión) lleva a PN-60 con «Tu sesión se cerró» y borra el token', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
      const navegacion = await mostrar();
      await fireEvent.press(boton('Ya lo confirmé'));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
      );
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('un 403 autorizacion_pendiente lleva a la pantalla provisional', async () => {
      instalarFetchFalso(respuestaJson(403, { error: 'autorizacion_pendiente' }));
      const navegacion = await mostrar();
      await fireEvent.press(boton('Ya lo confirmé'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SinAutorizacion', undefined)));
    });

    it('un toque mientras revisa no repite el pedido', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const fetchFalso = jest.fn(() => new Promise<Response>((resolver) => (responder = resolver)));
      global.fetch = fetchFalso as unknown as typeof fetch;
      await mostrar();
      await fireEvent.press(boton('Ya lo confirmé'));
      await fireEvent.press(boton('Ya lo confirmé', { disabled: true }));
      expect(fetchFalso).toHaveBeenCalledTimes(1);
      await act(async () => responder(respuestaJson(200, { verificada: false })));
    });
  });

  describe('«Reenviar el correo»', () => {
    it('al reenviar dice «Te enviamos otro correo.», se deshabilita 30 segundos y explica la espera', async () => {
      jest.useFakeTimers();
      const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('Te enviamos otro correo.')).toBeOnTheScreen();
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas/verificacion/reenvio');
      expect(pedidos[0]?.init.method).toBe('POST');
      expect(boton('Reenviar el correo', { disabled: true })).toBeOnTheScreen();
      expect(screen.getByText('Puedes pedir otro en un momento.')).toBeOnTheScreen();
      expect(ESPERA_MS).toBe(30_000);
      await act(async () => {
        jest.advanceTimersByTime(ESPERA_MS - 1);
      });
      expect(boton('Reenviar el correo', { disabled: true })).toBeOnTheScreen();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.getByRole('button', { name: 'Reenviar el correo', disabled: false })).toBeOnTheScreen();
      expect(screen.queryByText('Puedes pedir otro en un momento.')).not.toBeOnTheScreen();
    });

    it('un 429 (espera corta o límite de la hora) pone la espera con el mismo texto y sin aviso', async () => {
      instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('Puedes pedir otro en un momento.')).toBeOnTheScreen();
      expect(boton('Reenviar el correo', { disabled: true })).toBeOnTheScreen();
      expect(screen.queryByText('Te enviamos otro correo.')).not.toBeOnTheScreen();
    });

    it('un 500 dice «No pudimos enviar el correo.»', async () => {
      instalarFetchFalso(respuestaJson(500));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('No pudimos enviar el correo.')).toBeOnTheScreen();
      expect(boton('Reenviar el correo', { disabled: false })).toBeOnTheScreen();
    });

    it('si la cuenta ya estaba verificada (409 ya_verificada) sigue a la pantalla provisional', async () => {
      instalarFetchFalso(respuestaJson(409, { error: 'ya_verificada' }));
      const navegacion = await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SinAutorizacion', { llegada: 'correo_confirmado' })),
      );
    });

    it('al salir de la pantalla la espera ya no actualiza nada', async () => {
      jest.useFakeTimers();
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      instalarFetchFalso(respuestaJson(202, {}));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      await screen.unmount();
      await act(async () => {
        jest.advanceTimersByTime(ESPERA_MS);
      });
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe('«Cambiar el correo» (T3)', () => {
    const abrirCambio = async () => fireEvent.press(boton('Cambiar el correo'));

    it('abre en la misma pantalla un campo con la etiqueta y la ayuda de PN-58 y el botón primario «Cambiar el correo»', async () => {
      await mostrar();
      await abrirCambio();
      expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen();
      expect(screen.getByText('Te enviaremos un enlace para confirmarlo.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico').props.autoComplete).toBe('email');
      expect(boton('Cambiar el correo')).toHaveStyle({ backgroundColor: '#1F5C55' });
    });

    it('manda el correo nuevo, lo muestra, vuelve a poner la espera y dice «Te enviamos otro correo.»', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(202, {}));
      await mostrar();
      await abrirCambio();
      await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'otro@ejemplo.com');
      await fireEvent.press(boton('Cambiar el correo'));
      expect(await screen.findByText('Te enviamos otro correo.')).toBeOnTheScreen();
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas/correo');
      expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'otro@ejemplo.com' });
      expect(
        screen.getByText('Te enviamos un enlace a otro@ejemplo.com. Ábrelo para confirmar tu cuenta.'),
      ).toBeOnTheScreen();
      expect(screen.queryByLabelText('Correo electrónico')).not.toBeOnTheScreen();
      expect(boton('Reenviar el correo', { disabled: true })).toBeOnTheScreen();
    });

    it.each([
      ['correo_vacio', 'Falta el correo electrónico.'],
      ['correo_invalido', 'Falta completar el correo. Por ejemplo, nombre@correo.com.'],
    ])('el error %s dice «%s» en el campo', async (codigo, texto) => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { correo: codigo } }));
      await mostrar();
      await abrirCambio();
      await fireEvent.press(boton('Cambiar el correo'));
      expect(await screen.findByText(texto)).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen();
    });

    it('un 429 dice «Hiciste muchos intentos…» (T1) y deja el campo', async () => {
      instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
      await mostrar();
      await abrirCambio();
      await fireEvent.press(boton('Cambiar el correo'));
      expect(
        await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen();
    });

    it('un 500 dice «No pudimos enviar el correo.»', async () => {
      instalarFetchFalso(respuestaJson(500));
      await mostrar();
      await abrirCambio();
      await fireEvent.press(boton('Cambiar el correo'));
      expect(await screen.findByText('No pudimos enviar el correo.')).toBeOnTheScreen();
    });

    it('un 401 lleva a PN-60', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
      const navegacion = await mostrar();
      await abrirCambio();
      await fireEvent.press(boton('Cambiar el correo'));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
      );
    });
  });
});
