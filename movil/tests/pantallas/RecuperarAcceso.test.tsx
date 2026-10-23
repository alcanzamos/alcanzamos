import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { RecuperarAcceso } from '../../src/pantallas/RecuperarAcceso';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';

async function mostrar() {
  const navegacion = navegacionFalsa();
  await render(<RecuperarAcceso {...propiedades('RecuperarAcceso', navegacion)} />);
  return navegacion;
}

const enviar = () => fireEvent.press(screen.getByRole('button', { name: 'Enviar el enlace' }));
const escribir = (correo: string) => fireEvent.changeText(screen.getByLabelText('Correo electrónico'), correo);

describe('PN-61 · Recuperar el acceso: pedir el enlace (E14-PCP 4.4)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    jest.clearAllMocks();
  });

  it('muestra la explicación, el campo del correo y «Enviar el enlace»', async () => {
    await mostrar();
    expect(
      screen.getByText('Escribe el correo de tu cuenta. Te enviamos un enlace para elegir una contraseña nueva.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Correo electrónico')).toBeOnTheScreen();
    expect(screen.getByLabelText('Correo electrónico').props.autoComplete).toBe('email');
    expect(screen.getByRole('button', { name: 'Enviar el enlace' })).toBeOnTheScreen();
  });

  it('lleva la nota del menor de la fila 5, solo Android', async () => {
    await mostrar();
    expect(
      screen.getByText('¿Entras con nombre de usuario? Pide a tu tutor que restablezca tu acceso.'),
    ).toBeOnTheScreen();
  });

  it('pide el enlace con el correo y sin sesión, con las cabeceras de la app', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'enlace_enviado' }));
    await mostrar();
    await escribir('laura@ejemplo.com');
    await enviar();
    await screen.findByText('Si ese correo tiene una cuenta, te enviamos un enlace.');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/recuperacion');
    expect(pedidos[0]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'laura@ejemplo.com' });
    const cabeceras = pedidos[0]?.init.headers as Record<string, string>;
    expect(cabeceras['X-Alcanzamos-Cliente']).toBe('android');
    expect(cabeceras).not.toHaveProperty('Authorization');
  });

  it('«Enlace enviado»: el mismo aviso con o sin cuenta, sin el formulario y con «Volver a iniciar sesión»', async () => {
    instalarFetchFalso(respuestaJson(202, { estado: 'enlace_enviado' }));
    const navegacion = await mostrar();
    await escribir('nadie@ejemplo.com');
    await enviar();
    expect(await screen.findByText('Si ese correo tiene una cuenta, te enviamos un enlace.')).toBeOnTheScreen();
    expect(screen.getByText('Revisa también el correo no deseado.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Correo electrónico')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Enviar el enlace' })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver a iniciar sesión' }));
    expect(navegacion.goBack).toHaveBeenCalled();
  });

  it('no dice nada del enlace de la web ni ofrece abrir el correo (D-155)', async () => {
    instalarFetchFalso(respuestaJson(202, { estado: 'enlace_enviado' }));
    await mostrar();
    await escribir('laura@ejemplo.com');
    await enviar();
    await screen.findByText('Revisa también el correo no deseado.');
    expect(screen.queryByRole('link')).not.toBeOnTheScreen();
    expect(screen.queryByText(/navegador|abrir/i)).not.toBeOnTheScreen();
  });

  it.each([
    ['correo_vacio', 'Falta el correo electrónico.'],
    ['correo_invalido', 'Falta completar el correo. Por ejemplo, nombre@correo.com.'],
  ])('el error %s dice «%s» y lleva el foco al campo', async (codigo, texto) => {
    instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { correo: codigo } }));
    await mostrar();
    const foco = TextInput.prototype.focus as jest.Mock;
    foco.mockClear();
    await escribir('mal');
    await enviar();
    expect(await screen.findByText(texto)).toBeOnTheScreen();
    expect(foco.mock.contexts[0].props.accessibilityLabel).toBe('Correo electrónico');
    expect(screen.getByLabelText('Correo electrónico').props.value).toBe('mal');
    expect(screen.queryByText('No pudimos enviar el enlace.')).not.toBeOnTheScreen();
  });

  it('un 429 dice «Hiciste muchos intentos…», con el mismo texto exista o no la cuenta, y conserva el campo', async () => {
    instalarFetchFalso(respuestaJson(429, { error: 'demasiados_intentos' }));
    await mostrar();
    await escribir('laura@ejemplo.com');
    await enviar();
    expect(
      await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Correo electrónico').props.value).toBe('laura@ejemplo.com');
  });

  it('un 500 dice «No pudimos enviar el enlace.» «Intenta de nuevo.» y se puede reintentar', async () => {
    const { fetchFalso } = instalarFetchFalso(respuestaJson(500), respuestaJson(202, {}));
    await mostrar();
    await escribir('laura@ejemplo.com');
    await enviar();
    expect(await screen.findByText('No pudimos enviar el enlace.')).toBeOnTheScreen();
    expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
    await enviar();
    expect(await screen.findByText('Si ese correo tiene una cuenta, te enviamos un enlace.')).toBeOnTheScreen();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('un código de campo sin texto muestra el aviso general y no inventa uno', async () => {
    instalarFetchFalso(respuestaJson(422, { error: 'validacion', campos: { correo: 'codigo_nuevo' } }));
    await mostrar();
    await enviar();
    expect(await screen.findByText('No pudimos enviar el enlace.')).toBeOnTheScreen();
  });

  it('sin conexión dice «Sin conexión…»', async () => {
    instalarFetchFalso(new TypeError('Network request failed'));
    await mostrar();
    await escribir('laura@ejemplo.com');
    await enviar();
    expect(
      await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
    ).toBeOnTheScreen();
  });

  it('un segundo toque mientras envía no repite el pedido', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    const fetchFalso = jest.fn(() => new Promise<Response>((r) => (responder = r)));
    global.fetch = fetchFalso as unknown as typeof fetch;
    await mostrar();
    await escribir('laura@ejemplo.com');
    await enviar();
    await enviar();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    await act(async () => responder(respuestaJson(202, {})));
  });
});
