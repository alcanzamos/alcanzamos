import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { CrearCuenta } from '../../src/pantallas/CrearCuenta';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

async function mostrar() {
  const navegacion = navegacionFalsa();
  await render(<CrearCuenta {...propiedades('CrearCuenta', navegacion, { mayorDeEdad: true })} />);
  return navegacion;
}

async function llenar(correo = 'laura@ejemplo.com', contrasena = 'lluvia café tren azul', nombre = 'Laura') {
  await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), correo);
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), contrasena);
  await fireEvent.changeText(screen.getByLabelText('Nombre para mostrar'), nombre);
}

const crear = () => fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));

describe('PN-58 · Crear la cuenta, Android (E14-PCP 4.1)', () => {
  beforeEach(async () => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('muestra los textos de E14 y solo tres datos, sin casilla de edad', async () => {
    await mostrar();
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Crea tu cuenta' })).toBeOnTheScreen();
    expect(screen.getByText('Solo necesitamos tres datos.')).toBeOnTheScreen();
    expect(screen.getByText('Correo electrónico')).toBeOnTheScreen();
    expect(screen.getByText('Te enviaremos un enlace para confirmarlo.')).toBeOnTheScreen();
    expect(screen.getByText('Contraseña')).toBeOnTheScreen();
    expect(screen.getByText('Usa una frase de tres o cuatro palabras.')).toBeOnTheScreen();
    expect(screen.getByText('Nombre para mostrar')).toBeOnTheScreen();
    expect(screen.getByText('Es el nombre que verás en la app. Puede ser un apodo.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ya tengo una cuenta' })).toBeOnTheScreen();
    expect(
      screen.getByText('Después de confirmar tu correo verás cómo cuidamos tus datos y decidirás si los autorizas.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
    expect(screen.queryByText(/mayor de edad|nacimiento/i)).not.toBeOnTheScreen();
  });

  it('los campos piden el autocompletado de Android: email, new-password y name', async () => {
    await mostrar();
    expect(screen.getByLabelText('Correo electrónico').props.autoComplete).toBe('email');
    expect(screen.getByLabelText('Contraseña').props.autoComplete).toBe('new-password');
    expect(screen.getByLabelText('Nombre para mostrar').props.autoComplete).toBe('name');
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
    it('manda correo, contraseña, nombre y mayor_de_edad: true, y nada más (sin fecha ni edad)', async () => {
      const { pedidos } = instalarFetchFalso(
        respuestaJson(202, { estado: 'verificacion_pendiente', token: 'token-de-prueba' }),
      );
      await mostrar();
      await llenar();
      await crear();
      await waitFor(() => expect(pedidos).toHaveLength(1));
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuentas');
      expect(pedidos[0]?.init.method).toBe('POST');
      expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({
        correo: 'laura@ejemplo.com',
        contrasena: 'lluvia café tren azul',
        nombre: 'Laura',
        mayor_de_edad: true,
      });
      const cabeceras = pedidos[0]?.init.headers as Record<string, string>;
      expect(cabeceras['X-Alcanzamos-Cliente']).toBe('android');
      expect(Object.keys(cabeceras).map((c) => c.toLowerCase())).not.toContain('origin');
    });

    it('guarda el token solo en el Keystore (SecureStore) y nunca en AsyncStorage', async () => {
      instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente', token: 'token-de-prueba' }));
      await mostrar();
      await llenar();
      await crear();
      await waitFor(() => expect(almacen.setItemAsync).toHaveBeenCalledWith('sesion', 'token-de-prueba'));
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
      expect(await AsyncStorage.getAllKeys()).toEqual([]);
    });

    it('con éxito sigue a PN-59 con el correo, como la única pantalla de la pila', async () => {
      instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente', token: 'x' }));
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
      await act(async () => responder(respuestaJson(202, { token: 'x' })));
    });
  });

  describe('errores de campo (422)', () => {
    it.each([
      ['correo', 'correo_vacio', 'Falta el correo electrónico.'],
      ['correo', 'correo_invalido', 'Falta completar el correo. Por ejemplo, nombre@correo.com.'],
      ['contrasena', 'contrasena_vacia', 'Falta la contraseña.'],
      ['contrasena', 'contrasena_corta', 'Falta que la contraseña tenga al menos 15 caracteres.'],
      [
        'contrasena',
        'contrasena_comun',
        'Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.',
      ],
      ['contrasena', 'contrasena_personal', 'Falta una contraseña que no incluya tu correo ni el nombre de la app.'],
      ['nombre', 'nombre_vacio', 'Falta el nombre para mostrar.'],
      ['nombre', 'nombre_largo', 'Escribe un nombre de hasta 60 caracteres.'],
    ])('%s %s → «%s»', async (campo, codigo, texto) => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { [campo]: codigo } }));
      await mostrar();
      await llenar();
      await crear();
      expect(await screen.findByText(texto)).toBeOnTheScreen();
      expect(screen.queryByText('No pudimos crear la cuenta.')).not.toBeOnTheScreen();
    });

    it('con varios errores los muestra todos a la vez, conserva lo escrito y lleva el foco al primero', async () => {
      instalarFetchFalso(
        respuestaJson(422, {
          error: 'validacion',
          campos: { nombre: 'nombre_vacio', correo: 'correo_invalido', contrasena: 'contrasena_corta' },
        }),
      );
      await mostrar();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await llenar('mal', 'corta', '');
      await crear();
      expect(await screen.findByText('Falta completar el correo. Por ejemplo, nombre@correo.com.')).toBeOnTheScreen();
      expect(screen.getByText('Falta que la contraseña tenga al menos 15 caracteres.')).toBeOnTheScreen();
      expect(screen.getByText('Falta el nombre para mostrar.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Correo electrónico').props.value).toBe('mal');
      expect(screen.getByLabelText('Contraseña').props.value).toBe('corta');
      expect(foco).toHaveBeenCalledTimes(1);
      expect(foco.mock.contexts[0].props.accessibilityLabel).toBe('Correo electrónico');
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
      const { fetchFalso } = instalarFetchFalso(respuestaJson(500), respuestaJson(202, { token: 'x' }));
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
      expect(screen.getByLabelText('Contraseña').props.value).toBe('lluvia café tren azul');
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
