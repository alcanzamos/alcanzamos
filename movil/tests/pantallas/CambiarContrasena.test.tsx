import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { CambiarContrasena } from '../../src/pantallas/CambiarContrasena';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

async function mostrar() {
  const navegacion = navegacionFalsa();
  await render(<CambiarContrasena {...propiedades('CambiarContrasena', navegacion)} />);
  return navegacion;
}

async function llenar(actual = 'la de ahora', nueva = 'lluvia café tren azul') {
  await fireEvent.changeText(screen.getByLabelText('Tu contraseña de ahora'), actual);
  await fireEvent.changeText(screen.getByLabelText('Tu contraseña nueva'), nueva);
}

const guardar = () => fireEvent.press(screen.getByRole('button', { name: 'Guardar la contraseña' }));

describe('PN-73 · Cambiar la contraseña (E14-PCP 4.15)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    jest.clearAllMocks();
  });

  it('muestra la explicación, los dos campos con Ver y Ocultar, «Guardar la contraseña» y «Ahora no»', async () => {
    await mostrar();
    expect(screen.getByText('Escribe tu contraseña de ahora y la nueva.')).toBeOnTheScreen();
    expect(screen.getByText('Tu contraseña de ahora')).toBeOnTheScreen();
    expect(screen.getByText('Tu contraseña nueva')).toBeOnTheScreen();
    expect(screen.getByText('Usa una frase de tres o cuatro palabras.')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Mostrar la contraseña' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Guardar la contraseña' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Tu contraseña de ahora').props.autoComplete).toBe('current-password');
    expect(screen.getByLabelText('Tu contraseña nueva').props.autoComplete).toBe('new-password');
  });

  it('solo son dos campos: no hay «Repite la contraseña» ni la nota del menor', async () => {
    await mostrar();
    expect(screen.queryByText(/Repite/)).not.toBeOnTheScreen();
    expect(screen.queryByText('Cambia la contraseña que conocía tu tutor.')).not.toBeOnTheScreen();
  });

  it('«Ahora no» vuelve a PN-71', async () => {
    const navegacion = await mostrar();
    await fireEvent.press(screen.getByRole('button', { name: 'Ahora no' }));
    expect(navegacion.goBack).toHaveBeenCalled();
  });

  it('guarda: manda las dos contraseñas con el Bearer y vuelve a PN-71 con «Listo, cambiamos tu contraseña.»', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(200, { estado: 'contrasena_cambiada' }));
    const navegacion = await mostrar();
    await llenar();
    await guardar();
    await waitFor(() =>
      expect(navegacion.dispatch).toHaveBeenCalledWith(
        reinicio('SeguridadDeLaCuenta', { llegada: 'contrasena_cambiada' }),
      ),
    );
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/contrasena');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({
      contrasena_actual: 'la de ahora',
      contrasena_nueva: 'lluvia café tren azul',
    });
    expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-activa');
    // La sesión de ahora sigue abierta: el token no se toca.
    expect(almacen.guardado.get('sesion')).toBe('tk-activa');
  });

  describe('errores de campo', () => {
    it.each([
      ['contrasena_actual', 'contrasena_vacia', 'Falta tu contraseña de ahora.'],
      ['contrasena_nueva', 'contrasena_vacia', 'Falta la contraseña nueva.'],
      ['contrasena_nueva', 'contrasena_corta', 'Falta que la contraseña tenga al menos 15 caracteres.'],
      [
        'contrasena_nueva',
        'contrasena_comun',
        'Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.',
      ],
      [
        'contrasena_nueva',
        'contrasena_personal',
        'Falta una contraseña que no incluya tu correo ni el nombre de la app.',
      ],
    ])('%s %s → «%s»', async (campo, codigo, texto) => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { [campo]: codigo } }));
      await mostrar();
      await llenar();
      await guardar();
      expect(await screen.findByText(texto)).toBeOnTheScreen();
      expect(screen.queryByText('No pudimos guardar tu contraseña.')).not.toBeOnTheScreen();
    });

    it('la contraseña de ahora incorrecta dice «No pudimos confirmar tu contraseña de ahora…» y lleva el foco ahí', async () => {
      instalarFetchFalso(respuestaJson(400, { error: 'contrasena_actual_incorrecta' }));
      await mostrar();
      await llenar();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await guardar();
      expect(
        await screen.findByText('No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.'),
      ).toBeOnTheScreen();
      expect(foco.mock.contexts[0].props.accessibilityLabel).toBe('Tu contraseña de ahora');
      expect(screen.getByLabelText('Tu contraseña nueva').props.value).toBe('lluvia café tren azul');
    });

    it('con los dos errores los muestra a la vez y el foco va al primero', async () => {
      instalarFetchFalso(
        respuestaJson(422, {
          error: 'validacion',
          campos: { contrasena_actual: 'contrasena_vacia', contrasena_nueva: 'contrasena_corta' },
        }),
      );
      await mostrar();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await guardar();
      expect(await screen.findByText('Falta tu contraseña de ahora.')).toBeOnTheScreen();
      expect(screen.getByText('Falta que la contraseña tenga al menos 15 caracteres.')).toBeOnTheScreen();
      expect(foco).toHaveBeenCalledTimes(1);
      expect(foco.mock.contexts[0].props.accessibilityLabel).toBe('Tu contraseña de ahora');
    });

    it('un error solo de la nueva lleva el foco a la nueva', async () => {
      instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { contrasena_nueva: 'contrasena_corta' } }));
      await mostrar();
      const foco = TextInput.prototype.focus as jest.Mock;
      foco.mockClear();
      await guardar();
      await screen.findByText('Falta que la contraseña tenga al menos 15 caracteres.');
      expect(foco.mock.contexts[0].props.accessibilityLabel).toBe('Tu contraseña nueva');
    });
  });

  describe('otros fallos', () => {
    it('un 500 dice «No pudimos guardar tu contraseña.» «Tu contraseña de ahora sigue igual…»', async () => {
      instalarFetchFalso(respuestaJson(500));
      await mostrar();
      await llenar();
      await guardar();
      expect(await screen.findByText('No pudimos guardar tu contraseña.')).toBeOnTheScreen();
      expect(screen.getByText('Tu contraseña de ahora sigue igual. Intenta de nuevo.')).toBeOnTheScreen();
    });

    it('un 429 dice «Hiciste muchos intentos…»', async () => {
      instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
      await mostrar();
      await llenar();
      await guardar();
      expect(
        await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.'),
      ).toBeOnTheScreen();
    });

    it('sin conexión dice «Sin conexión…» y conserva lo escrito', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      await mostrar();
      await llenar();
      await guardar();
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Tu contraseña de ahora').props.value).toBe('la de ahora');
    });

    it.each([
      [401, 'sin_sesion', reinicio('Entrar', { llegada: 'sesion_cerrada' })],
      [403, 'verificacion_pendiente', reinicio('RevisaTuCorreo')],
      [403, 'autorizacion_pendiente', reinicio('SinAutorizacion')],
    ])('%s %s sigue a la pantalla que corresponde', async (estado, codigo, accion) => {
      instalarFetchFalso(respuestaJson(estado, { error: codigo }));
      const navegacion = await mostrar();
      await llenar();
      await guardar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(accion));
    });

    it('un segundo toque mientras guarda no repite el pedido', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const fetchFalso = jest.fn(() => new Promise<Response>((r) => (responder = r)));
      global.fetch = fetchFalso as unknown as typeof fetch;
      await mostrar();
      await llenar();
      await guardar();
      await guardar();
      expect(fetchFalso).toHaveBeenCalledTimes(1);
      await act(async () => responder(respuestaJson(200, { estado: 'contrasena_cambiada' })));
    });
  });
});
