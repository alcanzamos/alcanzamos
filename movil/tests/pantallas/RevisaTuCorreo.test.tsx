import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';
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

const ACEPTADO = { estado: 'verificacion_pendiente' };

describe('PN-59 · Revisa tu correo, Android (E14-PCP 4.2, D-172, D-184)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  describe('textos', () => {
    it('con el correo: título, explicación con la dirección, «no llegó», el plazo de 7 días y los tres botones', async () => {
      await mostrar();
      expect(screen.getByRole('header', { name: 'Revisa tu correo' })).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Te enviamos un correo a laura@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.',
        ),
      ).toBeOnTheScreen();
      expect(screen.getByText('¿No llegó? Mira también en el correo no deseado.')).toBeOnTheScreen();
      expect(screen.getByText('Si no lo confirmas en 7 días, borramos esta cuenta.')).toBeOnTheScreen();
      expect(boton('Reenviar el correo')).toBeOnTheScreen();
      expect(boton('Ya elegí mi contraseña')).toBeOnTheScreen();
      expect(boton('Usar otro correo')).toBeOnTheScreen();
    });

    it('sin la dirección dice «Te enviamos un correo.» sin la dirección', async () => {
      await mostrar(null);
      expect(
        screen.getByText(
          'Te enviamos un correo. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.',
        ),
      ).toBeOnTheScreen();
    });

    it('no tiene «Ya lo confirmé» ni «Cambiar el correo» (D-172 (4)) ni abre nada del enlace (D-155)', async () => {
      await mostrar();
      expect(screen.queryByRole('button', { name: 'Ya lo confirmé' })).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Cambiar el correo' })).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: /abrir|verificar/i })).not.toBeOnTheScreen();
      expect(screen.queryByRole('link')).not.toBeOnTheScreen();
    });

    it('«Reenviar el correo» es secundario y «Ya elegí mi contraseña» y «Usar otro correo» son botones de texto', async () => {
      await mostrar();
      expect(boton('Reenviar el correo')).not.toHaveStyle({ backgroundColor: '#1F5C55' });
      expect(boton('Ya elegí mi contraseña')).toHaveStyle({ backgroundColor: 'transparent' });
      expect(boton('Usar otro correo')).toHaveStyle({ backgroundColor: 'transparent' });
    });

    it('no consulta al API al abrirse: no hay sesión', async () => {
      const { fetchFalso } = instalarFetchFalso();
      await mostrar();
      expect(fetchFalso).not.toHaveBeenCalled();
    });
  });

  describe('«Ya elegí mi contraseña» (D-184, provisional hasta I08)', () => {
    it('abre PN-60 con el correo ya escrito, como la única pantalla de la pila', async () => {
      const navegacion = await mostrar();
      await fireEvent.press(boton('Ya elegí mi contraseña'));
      expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { correo: 'laura@ejemplo.com' }));
    });

    it('sin la dirección abre PN-60 con el campo vacío', async () => {
      const navegacion = await mostrar(null);
      await fireEvent.press(boton('Ya elegí mi contraseña'));
      expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', undefined));
    });

    it('está siempre visible y no consulta al API (no revela si el correo tiene cuenta)', async () => {
      const { fetchFalso } = instalarFetchFalso();
      await mostrar();
      await fireEvent.press(boton('Ya elegí mi contraseña'));
      expect(fetchFalso).not.toHaveBeenCalled();
    });

    it('sigue visible durante la espera de un reenvío', async () => {
      instalarFetchFalso(respuestaJson(202, ACEPTADO));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      await screen.findByText('Te enviamos otro correo.');
      expect(boton('Ya elegí mi contraseña')).toBeOnTheScreen();
    });
  });

  describe('«Usar otro correo»', () => {
    it('vuelve a PN-58 con lo escrito y la edad ya comprobada, como la única pantalla de la pila', async () => {
      const navegacion = await mostrar();
      await fireEvent.press(boton('Usar otro correo'));
      expect(navegacion.dispatch).toHaveBeenCalledWith(
        reinicio('CrearCuenta', { mayorDeEdad: true, correo: 'laura@ejemplo.com' }),
      );
    });

    it('sin la dirección vuelve a PN-58 con el campo vacío', async () => {
      const navegacion = await mostrar(null);
      await fireEvent.press(boton('Usar otro correo'));
      expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('CrearCuenta', { mayorDeEdad: true }));
    });

    it('no hace ningún pedido', async () => {
      const { fetchFalso } = instalarFetchFalso();
      await mostrar();
      await fireEvent.press(boton('Usar otro correo'));
      expect(fetchFalso).not.toHaveBeenCalled();
    });
  });

  describe('«Reenviar el correo» (público, con la dirección)', () => {
    it('manda el correo al reenvío público sin Authorization, dice «Te enviamos otro correo.» y espera 30 segundos', async () => {
      jest.useFakeTimers();
      almacen.guardado.set('sesion', 'token-que-no-debe-salir');
      const { pedidos } = instalarFetchFalso(respuestaJson(202, ACEPTADO));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('Te enviamos otro correo.')).toBeOnTheScreen();
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas/verificacion/reenvio');
      expect(pedidos[0]?.init.method).toBe('POST');
      expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'laura@ejemplo.com' });
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

    it('un 429 (espera corta o límite de la hora) dice «Hiciste muchos intentos…» y pone la espera', async () => {
      instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(
        await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.'),
      ).toBeOnTheScreen();
      expect(screen.getByText('Puedes pedir otro en un momento.')).toBeOnTheScreen();
      expect(boton('Reenviar el correo', { disabled: true })).toBeOnTheScreen();
      expect(screen.queryByText('Te enviamos otro correo.')).not.toBeOnTheScreen();
    });

    it('un 500 dice «No pudimos enviar el correo.» y deja reintentar', async () => {
      instalarFetchFalso(respuestaJson(500));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('No pudimos enviar el correo.')).toBeOnTheScreen();
      expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
      expect(boton('Reenviar el correo', { disabled: false })).toBeOnTheScreen();
    });

    it('sin conexión dice «Sin conexión…»', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
    });

    it('un 401 no lleva a PN-60: la pantalla no tiene sesión', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
      const navegacion = await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('No pudimos enviar el correo.')).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
    });

    it('un toque mientras envía no repite el pedido', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const fetchFalso = jest.fn(() => new Promise<Response>((resolver) => (responder = resolver)));
      global.fetch = fetchFalso as unknown as typeof fetch;
      await mostrar();
      await fireEvent.press(boton('Reenviar el correo'));
      await fireEvent.press(boton('Reenviar el correo', { disabled: true }));
      expect(fetchFalso).toHaveBeenCalledTimes(1);
      await act(async () => responder(respuestaJson(202, ACEPTADO)));
    });

    it('al salir de la pantalla la espera ya no actualiza nada', async () => {
      jest.useFakeTimers();
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      instalarFetchFalso(respuestaJson(202, ACEPTADO));
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

  describe('sin la dirección (la pantalla se abrió de nuevo): formulario de T3', () => {
    const abrirFormulario = async () => {
      const navegacion = await mostrar(null);
      await fireEvent.press(boton('Reenviar el correo'));
      return navegacion;
    };

    it('«Reenviar el correo» pide el correo en la misma pantalla, sin hacer pedidos', async () => {
      const { fetchFalso } = instalarFetchFalso();
      await abrirFormulario();
      expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen();
      expect(screen.getByText('Te enviaremos un enlace para confirmarlo y elegir tu contraseña.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico').props.autoComplete).toBe('email');
      expect(boton('Reenviar el correo')).toHaveStyle({ backgroundColor: '#1F5C55' });
      expect(fetchFalso).not.toHaveBeenCalled();
    });

    it('manda el correo escrito, lo muestra, vuelve a poner la espera y dice «Te enviamos otro correo.»', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(202, ACEPTADO));
      await abrirFormulario();
      await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'otro@ejemplo.com');
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('Te enviamos otro correo.')).toBeOnTheScreen();
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas/verificacion/reenvio');
      expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'otro@ejemplo.com' });
      expect(
        screen.getByText(
          'Te enviamos un correo a otro@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.',
        ),
      ).toBeOnTheScreen();
      expect(screen.queryByLabelText('Correo electrónico')).not.toBeOnTheScreen();
      expect(boton('Reenviar el correo', { disabled: true })).toBeOnTheScreen();
    });

    it('con la dirección escrita, «Ya elegí mi contraseña» y «Usar otro correo» la llevan', async () => {
      instalarFetchFalso(respuestaJson(202, ACEPTADO));
      const navegacion = await abrirFormulario();
      await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'otro@ejemplo.com');
      await fireEvent.press(boton('Reenviar el correo'));
      await screen.findByText('Te enviamos otro correo.');
      await fireEvent.press(boton('Ya elegí mi contraseña'));
      expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { correo: 'otro@ejemplo.com' }));
    });

    it.each([
      ['correo_vacio', 'Falta el correo electrónico.'],
      ['correo_invalido', 'Falta completar el correo. Por ejemplo, nombre@correo.com.'],
    ])('el error %s dice «%s» en el campo y lleva el foco', async (codigo, texto) => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { correo: codigo } }));
      await abrirFormulario();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText(texto)).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen();
      expect(foco.mock.contexts.at(-1).props.accessibilityLabel).toBe('Correo electrónico');
    });

    it('un 429 dice «Hiciste muchos intentos…» y deja el campo', async () => {
      instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
      await abrirFormulario();
      await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'otro@ejemplo.com');
      await fireEvent.press(boton('Reenviar el correo'));
      expect(
        await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico').props.value).toBe('otro@ejemplo.com');
    });

    it('un 500 dice «No pudimos enviar el correo.»', async () => {
      instalarFetchFalso(respuestaJson(500));
      await abrirFormulario();
      await fireEvent.press(boton('Reenviar el correo'));
      expect(await screen.findByText('No pudimos enviar el correo.')).toBeOnTheScreen();
      await waitFor(() => expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen());
    });
  });
});
