import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { Entrar } from '../../src/pantallas/Entrar';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { esperarSinAnuncios, focoDeTalkBack, nombreDe, regionesVivas } from '../ayudas/anuncios';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';
import { campo } from '../ayudas/campos';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

async function mostrar(llegada?: 'sesion_cerrada' | 'correo_confirmado' | 'contrasena_recuperada', correo?: string) {
  const navegacion = navegacionFalsa();
  await render(
    <Entrar {...propiedades('Entrar', navegacion, llegada || correo ? { llegada, correo } : undefined)} />,
  );
  return navegacion;
}

async function llenar(correo = 'laura@ejemplo.com', contrasena = 'lluvia café tren azul') {
  await fireEvent.changeText(campo('Correo electrónico'), correo);
  await fireEvent.changeText(campo('Contraseña'), contrasena);
}

const entrar = () => fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));

describe('PN-60 · Iniciar sesión, Android (E14-PCP 4.3)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    jest.clearAllMocks();
  });

  it('muestra logo, título, correo, contraseña, «Iniciar sesión» y «Crear una cuenta»', async () => {
    await mostrar();
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(screen.getByText('Correo electrónico')).toBeOnTheScreen();
    expect(screen.getByText('Contraseña')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Crear una cuenta' })).toBeOnTheScreen();
    expect(campo('Correo electrónico').props.autoComplete).toBe('email');
    expect(campo('Contraseña').props.autoComplete).toBe('current-password');
  });

  it('en la US-49 no ofrece el ingreso con nombre de usuario (D-137)', async () => {
    await mostrar();
    expect(screen.queryByText(/nombre de usuario/i)).not.toBeOnTheScreen();
    expect(screen.queryByText('Entro con mi nombre de usuario')).not.toBeOnTheScreen();
  });

  it('«¿Olvidaste tu contraseña?» abre PN-61 y está antes de «Iniciar sesión»', async () => {
    const navegacion = await mostrar();
    expect(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    expect(navegacion.navigate).toHaveBeenCalledWith('RecuperarAcceso');
  });

  it('«Crear una cuenta» abre PN-65, el único camino a esa pantalla', async () => {
    const navegacion = await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear una cuenta' }));
    expect(navegacion.navigate).toHaveBeenCalledWith('Edad');
  });

  // D-195 (E14-PCP 4.3, fila 9): «Política de tratamiento y consultas» abre PN-68 sin necesidad de una cuenta.
  it('«Política de tratamiento y consultas» es un botón de texto, después de «Crear una cuenta», que abre PN-68', async () => {
    const navegacion = await mostrar();
    const politica = screen.getByRole('button', { name: 'Política de tratamiento y consultas' });
    expect(screen.getAllByRole('button').at(-1)).toBe(politica);
    expect(politica).toHaveStyle({ alignSelf: 'flex-start' });
    await fireEvent.press(politica);
    expect(navegacion.navigate).toHaveBeenCalledWith('Politica');
  });

  describe('con el correo que trae PN-59 («Ya elegí mi contraseña», D-184)', () => {
    it('el campo del correo viene escrito y la contraseña vacía', async () => {
      await mostrar(undefined, 'laura@ejemplo.com');
      expect(campo('Correo electrónico').props.value).toBe('laura@ejemplo.com');
      expect(campo('Contraseña').props.value).toBe('');
    });

    it('sin correo el campo viene vacío', async () => {
      await mostrar();
      expect(campo('Correo electrónico').props.value).toBe('');
    });
  });

  describe('mensaje de estado de la llegada', () => {
    it.each([
      ['sesion_cerrada', 'Tu sesión se cerró. Entra de nuevo.'],
      ['correo_confirmado', 'Listo, confirmamos tu correo.'],
      ['contrasena_recuperada', 'Listo, cambiaste tu contraseña.'],
    ] as const)('%s → «%s»', async (llegada, texto) => {
      await mostrar(llegada);
      expect(await screen.findByText(texto)).toBeOnTheScreen();
    });

    it('sin llegada no hay mensaje', async () => {
      await mostrar();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByText('Tu sesión se cerró. Entra de nuevo.')).not.toBeOnTheScreen();
    });
  });

  describe('entrar', () => {
    it('manda el correo como identificador y la contraseña, con las cabeceras de la app', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(200, { estado: 'activa', token: 'tk' }));
      await mostrar();
      await llenar();
      await entrar();
      await waitFor(() => expect(pedidos).toHaveLength(1));
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/sesiones');
      expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({
        identificador: 'laura@ejemplo.com',
        contrasena: 'lluvia café tren azul',
      });
      const cabeceras = pedidos[0]?.init.headers as Record<string, string>;
      expect(cabeceras['X-Alcanzamos-Cliente']).toBe('android');
      expect(Object.keys(cabeceras).map((c) => c.toLowerCase())).not.toEqual(expect.arrayContaining(['origin']));
    });

    it('con la cuenta activa guarda el token en el Keystore y sigue a PN-71 como única pantalla', async () => {
      instalarFetchFalso(respuestaJson(200, { estado: 'activa', token: 'tk-activa' }));
      const navegacion = await mostrar();
      await llenar();
      await entrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SeguridadDeLaCuenta')));
      expect(almacen.guardado.get('sesion')).toBe('tk-activa');
    });

    it('una cuenta sin verificar no entra: el 401 es el de una contraseña errónea, sin decir que falta confirmar el correo (D-172)', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'credenciales_invalidas' }));
      const navegacion = await mostrar();
      await llenar();
      await entrar();
      expect(await screen.findByText('No pudimos entrar con esos datos.')).toBeOnTheScreen();
      expect(screen.getByText('Revisa lo que escribiste e intenta de nuevo.')).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('ya no hay sesión limitada: un 200 con otro estado igual sigue a PN-71 y no a PN-59', async () => {
      instalarFetchFalso(respuestaJson(200, { estado: 'verificacion_pendiente', token: 'tk' }));
      const navegacion = await mostrar();
      await llenar();
      await entrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SeguridadDeLaCuenta')));
    });

    it('un segundo toque mientras envía no repite el pedido', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const fetchFalso = jest.fn(() => new Promise<Response>((resolver) => (responder = resolver)));
      global.fetch = fetchFalso as unknown as typeof fetch;
      await mostrar();
      await llenar();
      await entrar();
      await entrar();
      expect(fetchFalso).toHaveBeenCalledTimes(1);
      await act(async () => responder(respuestaJson(200, { estado: 'activa', token: 'x' })));
    });
  });

  describe('errores', () => {
    it.each([
      ['identificador', 'identificador_vacio', 'Falta el correo electrónico.'],
      ['contrasena', 'contrasena_vacia', 'Falta la contraseña.'],
    ])('el campo %s con %s dice «%s»', async (campo, codigo, texto) => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { [campo]: codigo } }));
      await mostrar();
      await entrar();
      expect(await screen.findByText(texto)).toBeOnTheScreen();
      expect(screen.queryByText('No pudimos entrar con esos datos.')).not.toBeOnTheScreen();
    });

    it('con los dos campos vacíos muestra los dos errores y lleva el foco al correo', async () => {
      instalarFetchFalso(
        respuestaJson(422, {
          error: 'validacion',
          campos: { identificador: 'identificador_vacio', contrasena: 'contrasena_vacia' },
        }),
      );
      await mostrar();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await entrar();
      expect(await screen.findByText('Falta el correo electrónico.')).toBeOnTheScreen();
      expect(screen.getByText('Falta la contraseña.')).toBeOnTheScreen();
      expect(foco).toHaveBeenCalledTimes(1);
      expect(nombreDe(foco.mock.contexts[0])).toBe('Correo electrónico, Falta el correo electrónico.');
    });

    it('ACC-004 (bug 226): vacío, el foco de TalkBack va al correo, que lee su error; la región viva no anuncia los errores', async () => {
      instalarFetchFalso(
        respuestaJson(422, {
          error: 'validacion',
          campos: { identificador: 'identificador_vacio', contrasena: 'contrasena_vacia' },
        }),
      );
      await mostrar();
      await entrar();
      await screen.findByText('Falta el correo electrónico.');
      expect(nombreDe(focoDeTalkBack())).toBe('Correo electrónico, Falta el correo electrónico.');
      expect(campo('Contraseña').props.placeholder).toBe('Contraseña, Falta la contraseña.');
      expect(regionesVivas()).toHaveLength(1);
      await esperarSinAnuncios();
    });

    it('si solo falta la contraseña, el foco va a la contraseña', async () => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { contrasena: 'contrasena_vacia' } }));
      await mostrar();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await entrar();
      await screen.findByText('Falta la contraseña.');
      expect(nombreDe(foco.mock.contexts[0])).toBe('Contraseña, Falta la contraseña.');
    });

    it('un 401 dice «No pudimos entrar con esos datos.» sin decir cuál falló, y conserva lo escrito', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'credenciales_invalidas' }));
      await mostrar();
      await llenar();
      await entrar();
      expect(await screen.findByText('No pudimos entrar con esos datos.')).toBeOnTheScreen();
      expect(screen.getByText('Revisa lo que escribiste e intenta de nuevo.')).toBeOnTheScreen();
      expect(campo('Correo electrónico').props.value).toBe('laura@ejemplo.com');
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('un 429 dice «Hiciste muchos intentos…», con el mismo texto exista o no la cuenta', async () => {
      instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
      await mostrar();
      await llenar();
      await entrar();
      expect(
        await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.'),
      ).toBeOnTheScreen();
      expect(campo('Contraseña').props.value).toBe('lluvia café tren azul');
    });

    it('un 500 (T7) nunca dice que los datos están mal', async () => {
      instalarFetchFalso(respuestaJson(500));
      await mostrar();
      await llenar();
      await entrar();
      expect(await screen.findByText('No pudimos iniciar tu sesión.')).toBeOnTheScreen();
      expect(screen.getByText('El problema es de nuestro lado. Intenta de nuevo en un momento.')).toBeOnTheScreen();
      expect(screen.queryByText('No pudimos entrar con esos datos.')).not.toBeOnTheScreen();
    });

    it('un 400 (solicitud_invalida) muestra el aviso de datos que no coinciden: no hay otro texto aprobado', async () => {
      instalarFetchFalso(respuestaJson(400, { error: 'solicitud_invalida' }));
      await mostrar();
      await llenar();
      await entrar();
      expect(await screen.findByText('No pudimos entrar con esos datos.')).toBeOnTheScreen();
    });

    it('sin conexión dice «Sin conexión…»', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      await mostrar();
      await llenar();
      await entrar();
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
    });

    it('un código de campo sin texto no inventa uno: muestra el aviso de datos que no coinciden', async () => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { identificador: 'codigo_nuevo' } }));
      await mostrar();
      await entrar();
      expect(await screen.findByText('No pudimos entrar con esos datos.')).toBeOnTheScreen();
    });
  });
});
