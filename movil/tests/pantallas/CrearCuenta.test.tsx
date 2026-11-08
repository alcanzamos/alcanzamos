import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { CrearCuenta } from '../../src/pantallas/CrearCuenta';
import { anunciados, esperarAnuncio, focoDeTalkBack, limpiarAnuncios } from '../ayudas/anuncios';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

async function mostrar(correo?: string) {
  const navegacion = navegacionFalsa();
  await render(
    <CrearCuenta {...propiedades('CrearCuenta', navegacion, correo ? { mayorDeEdad: true, correo } : { mayorDeEdad: true })} />,
  );
  return navegacion;
}

async function llenar(correo = 'laura@ejemplo.com') {
  await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), correo);
}

const crear = () => fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));

describe('PN-58 · Crear la cuenta, Android (E14-PCP 4.1)', () => {
  beforeEach(async () => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('muestra los textos de E14 con solo el correo, sin casilla de edad', async () => {
    await mostrar();
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Crea tu cuenta' })).toBeOnTheScreen();
    expect(screen.getByText('Empecemos por tu correo.')).toBeOnTheScreen();
    expect(screen.getByText('Correo electrónico')).toBeOnTheScreen();
    expect(screen.getByText('Te enviaremos un enlace para confirmarlo y elegir tu contraseña.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ya tengo una cuenta' })).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Después de confirmar tu correo elegirás tu contraseña, verás cómo cuidamos tus datos y decidirás si los autorizas.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
    expect(screen.queryByText(/mayor de edad|nacimiento/i)).not.toBeOnTheScreen();
  });

  it('USA-005 el formulario pide solo el correo: sin contraseña, nombre, casilla de edad ni otro campo', async () => {
    await mostrar();
    expect(screen.getAllByDisplayValue(/^/)).toHaveLength(1);
    expect(screen.getByLabelText('Correo electrónico')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Contraseña')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Nombre para mostrar')).not.toBeOnTheScreen();
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
  });

  it('el campo pide el autocompletado de Android: email', async () => {
    await mostrar();
    expect(screen.getByLabelText('Correo electrónico').props.autoComplete).toBe('email');
  });

  it('con el correo que trae PN-59 («Usar otro correo») el campo viene con lo escrito', async () => {
    await mostrar('laura@ejemplo.com');
    expect(screen.getByLabelText('Correo electrónico').props.value).toBe('laura@ejemplo.com');
  });

  it('«Ya tengo una cuenta» vuelve a PN-60', async () => {
    const navegacion = await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Ya tengo una cuenta' }));
    expect(navegacion.navigate).toHaveBeenCalledWith('Entrar');
  });

  describe('sin la edad comprobada en PN-65', () => {
    it('no se puede usar: vuelve a PN-60 y no hace ningún pedido', async () => {
      const { fetchFalso } = instalarFetchFalso();
      const navegacion = navegacionFalsa();
      await render(<CrearCuenta {...propiedades('CrearCuenta', navegacion)} />);
      expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar'));
      await crear();
      expect(fetchFalso).not.toHaveBeenCalled();
    });
  });

  describe('crear', () => {
    it('manda solo el correo y mayor_de_edad: true, sin sesión (sin fecha, edad, contraseña ni nombre)', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
      await mostrar();
      await llenar();
      await crear();
      await waitFor(() => expect(pedidos).toHaveLength(1));
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas');
      expect(pedidos[0]?.init.method).toBe('POST');
      expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({
        correo: 'laura@ejemplo.com',
        mayor_de_edad: true,
      });
      const cabeceras = pedidos[0]?.init.headers as Record<string, string>;
      expect(cabeceras['X-Alcanzamos-Cliente']).toBe('android');
      expect(Object.keys(cabeceras).map((c) => c.toLowerCase())).not.toContain('origin');
    });

    it('no guarda ningún token: crear la cuenta no da sesión (D-172), ni en el Keystore ni en AsyncStorage', async () => {
      instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
      const navegacion = await mostrar();
      await llenar();
      await crear();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
      expect(almacen.setItemAsync).not.toHaveBeenCalled();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(await AsyncStorage.getAllKeys()).toEqual([]);
    });

    it('con éxito sigue a PN-59 con el correo, como la única pantalla de la pila', async () => {
      instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
      const navegacion = await mostrar();
      await llenar();
      await crear();
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('RevisaTuCorreo', { correo: 'laura@ejemplo.com' })),
      );
    });

    it('un segundo toque mientras envía no repite el pedido y deja el botón deshabilitado', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const fetchFalso = jest.fn(() => new Promise<Response>((resolver) => (responder = resolver)));
      global.fetch = fetchFalso as unknown as typeof fetch;
      await mostrar();
      await llenar();
      await crear();
      await crear();
      expect(fetchFalso).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Crear cuenta', disabled: true })).toBeOnTheScreen();
      await act(async () => responder(respuestaJson(202, { estado: 'verificacion_pendiente' })));
    });
  });

  describe('errores de campo (422)', () => {
    it.each([
      ['correo_vacio', 'Falta el correo electrónico.'],
      ['correo_invalido', 'Falta completar el correo. Por ejemplo, nombre@correo.com.'],
    ])('correo %s → «%s», conserva lo escrito y lleva el foco al campo', async (codigo, texto) => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { correo: codigo } }));
      await mostrar();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await llenar('mal');
      await crear();
      expect(await screen.findByText(texto)).toBeOnTheScreen();
      expect(screen.queryByText('No pudimos crear la cuenta.')).not.toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico').props.value).toBe('mal');
      expect(foco).toHaveBeenCalledTimes(1);
      expect(foco.mock.contexts[0].props.accessibilityLabel).toBe('Correo electrónico');
    });

    it('ACC-004 (bug 226): «Crear cuenta» vacío anuncia «Falta el correo electrónico.» y el foco de TalkBack va al campo', async () => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { correo: 'correo_vacio' } }));
      await mostrar();
      limpiarAnuncios();
      await crear();
      await esperarAnuncio('Falta el correo electrónico.');
      expect(anunciados()).toEqual(['Falta el correo electrónico.']);
      expect(focoDeTalkBack()?.props.accessibilityLabel).toBe('Correo electrónico');
    });

    it('un código de campo sin texto muestra el aviso general y no inventa un texto', async () => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { correo: 'codigo_nuevo' } }));
      await mostrar();
      await llenar();
      await crear();
      expect(await screen.findByText('No pudimos crear la cuenta.')).toBeOnTheScreen();
    });

    it('un campo que la pantalla no tiene (mayor_de_edad) tampoco inventa nada', async () => {
      instalarFetchFalso(
        respuestaJson(422, { error: 'validacion', campos: { mayor_de_edad: 'mayor_de_edad_requerido' } }),
      );
      await mostrar();
      await llenar();
      await crear();
      expect(await screen.findByText('No pudimos crear la cuenta.')).toBeOnTheScreen();
    });
  });

  describe('otros fallos', () => {
    it('un 500 muestra «No pudimos crear la cuenta.» con «Intentar de nuevo», que repite el pedido', async () => {
      const { fetchFalso } = instalarFetchFalso(respuestaJson(500), respuestaJson(202, { estado: 'verificacion_pendiente' }));
      const navegacion = await mostrar();
      await llenar();
      await crear();
      expect(await screen.findByText('No pudimos crear la cuenta.')).toBeOnTheScreen();
      expect(screen.getByText('Tus datos no se perdieron. Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico').props.value).toBe('laura@ejemplo.com');
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
    });

    it('un 429 muestra «Hiciste muchos intentos…» y no ofrece reintentar', async () => {
      instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
      await mostrar();
      await llenar();
      await crear();
      expect(
        await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.'),
      ).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).not.toBeOnTheScreen();
    });

    it('un 400 (solicitud_invalida, por ejemplo con cabeceras de navegador) muestra el aviso general', async () => {
      instalarFetchFalso(respuestaJson(400, { error: 'solicitud_invalida' }));
      await mostrar();
      await llenar();
      await crear();
      expect(await screen.findByText('No pudimos crear la cuenta.')).toBeOnTheScreen();
    });

    it('sin conexión muestra el aviso de T10 y conserva lo escrito', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      await mostrar();
      await llenar();
      await crear();
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico').props.value).toBe('laura@ejemplo.com');
    });

    it('sin la dirección del API muestra «Sin conexión…» y no hace pedidos', async () => {
      delete process.env.EXPO_PUBLIC_URL_API;
      const { fetchFalso } = instalarFetchFalso();
      await mostrar();
      await llenar();
      await crear();
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
      expect(fetchFalso).not.toHaveBeenCalled();
    });
  });
});
