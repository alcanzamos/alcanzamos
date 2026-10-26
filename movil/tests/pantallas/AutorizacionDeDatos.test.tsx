import { CommonActions } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AutorizacionDeDatos } from '../../src/pantallas/AutorizacionDeDatos';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

const catalogo = (cambios: object = {}) => ({
  version: { numero: '1.0', fecha: '2026-10-30' },
  finalidades: [
    { codigo: 'cuenta_y_acceso', tipo: 'necesaria', otorgada: false },
    { codigo: 'funciones_financieras', tipo: 'necesaria', otorgada: false },
    { codigo: 'avisos', tipo: 'accesoria', otorgada: false },
    { codigo: 'horas_de_vida', tipo: 'accesoria', otorgada: false },
  ],
  ...cambios,
});

const NECESARIAS = 'Autorizo el uso de mis datos para estas finalidades necesarias.';
const AVISOS = 'Autorizo los avisos con la app cerrada.';
const HORAS = 'Autorizo mostrar el costo de un gasto en horas de vida.';

async function mostrar(...respuestas: (Response | Error)[]) {
  const falso = instalarFetchFalso(respuestaJson(200, catalogo()), ...respuestas);
  const navegacion = navegacionFalsa();
  await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
  await screen.findByText('Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.');
  return { ...falso, navegacion };
}

const boton = (nombre: string) => screen.getByRole('button', { name: nombre });
const cuerpoDe = (pedido?: { init: RequestInit }) => JSON.parse(String(pedido?.init.body));

describe('PN-64 · Autorización de datos (E14-PCP 4.7)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-limitada');
    jest.clearAllMocks();
  });

  describe('al llegar', () => {
    it('pide el catálogo con el token y muestra dos tarjetas con los textos de E14 (sección 5)', async () => {
      const { pedidos } = await mostrar();
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/autorizaciones');
      expect(pedidos[0]?.init.method).toBe('GET');
      expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-limitada');
      for (const titulo of ['Lo necesario para usar la app', 'Lo que puedes elegir']) {
        expect(screen.getByRole('header', { name: titulo })).toBeOnTheScreen();
      }
      for (const nombre of ['Cuenta y acceso', 'Funciones financieras', 'Avisos con la app cerrada', 'Horas de vida']) {
        expect(screen.getByText(nombre)).toBeOnTheScreen();
      }
      expect(screen.getByText(/^Usamos tu correo, tu contraseña y tu nombre/)).toBeOnTheScreen();
      expect(screen.getByText(/^Sin esta autorización no podemos darte la cuenta\./)).toBeOnTheScreen();
      expect(screen.getByText('Puedes decir que no. La app funciona igual. Lo cambias cuando quieras en Preferencias.')).toBeOnTheScreen();
    });

    it('ninguna casilla viene marcada (RF-063)', async () => {
      await mostrar();
      expect(screen.getAllByRole('checkbox')).toHaveLength(3);
      expect(screen.getAllByRole('checkbox', { checked: false })).toHaveLength(3);
    });

    it('la versión sale del API y la fecha va en palabras (D-090)', async () => {
      await mostrar();
      expect(screen.getByText(/Texto versión/)).toHaveTextContent('Texto versión 1.0 del 30 de octubre de 2026.', {
        exact: true,
      });
    });

    it('no ofrece «Leer la política completa» (PN-68 no existe)', async () => {
      await mostrar();
      expect(screen.queryByText('Leer la política completa')).not.toBeOnTheScreen();
    });
  });

  describe('«Autorizar y continuar»', () => {
    it('sin lo necesario muestra el error junto a la casilla y no pide nada', async () => {
      const { pedidos } = await mostrar();
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText('Falta tu autorización para lo necesario.')).toBeOnTheScreen();
      expect(screen.getByLabelText(NECESARIAS)).toHaveProp('accessibilityHint', 'Falta tu autorización para lo necesario.');
      expect(pedidos).toHaveLength(1);
      expect(boton('Autorizar y continuar')).toBeEnabled();
    });

    it('marcar lo necesario quita el error; desmarcarlo no lo vuelve a poner', async () => {
      await mostrar();
      await fireEvent.press(boton('Autorizar y continuar'));
      await screen.findByText('Falta tu autorización para lo necesario.');
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      expect(screen.queryByText('Falta tu autorización para lo necesario.')).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      expect(screen.queryByText('Falta tu autorización para lo necesario.')).not.toBeOnTheScreen();
    });

    it('con lo necesario manda las dos necesarias y la versión del catálogo; sigue a PN-71 sin volver a entrar', async () => {
      const { pedidos, navegacion } = await mostrar(respuestaJson(200, { estado: 'autorizada' }));
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(boton('Autorizar y continuar'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SeguridadDeLaCuenta')));
      expect(pedidos).toHaveLength(2);
      expect(pedidos[1]?.url).toBe('http://api.prueba:18090/api/v1/autorizaciones');
      expect(pedidos[1]?.init.method).toBe('POST');
      expect((pedidos[1]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-limitada');
      expect(cuerpoDe(pedidos[1])).toEqual({
        finalidades: ['cuenta_y_acceso', 'funciones_financieras'],
        version: '1.0',
      });
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it('suma solo las accesorias marcadas; marcar una dos veces la quita', async () => {
      const { pedidos, navegacion } = await mostrar(respuestaJson(200, { estado: 'autorizada' }));
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(screen.getByLabelText(AVISOS));
      await fireEvent.press(screen.getByLabelText(HORAS));
      await fireEvent.press(screen.getByLabelText(HORAS));
      expect(screen.getByRole('checkbox', { name: AVISOS, checked: true })).toBeOnTheScreen();
      await fireEvent.press(boton('Autorizar y continuar'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
      expect(cuerpoDe(pedidos[1]).finalidades).toEqual(['cuenta_y_acceso', 'funciones_financieras', 'avisos']);
    });

    it('un toque mientras envía no repite el pedido', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const catalogoListo = respuestaJson(200, catalogo());
      let n = 0;
      global.fetch = jest.fn(() => (n++ === 0 ? Promise.resolve(catalogoListo) : new Promise<Response>((r) => (responder = r)))) as unknown as typeof fetch;
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacionFalsa())} />);
      await screen.findByText(NECESARIAS);
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(boton('Autorizar y continuar'));
      await fireEvent.press(screen.getByRole('button', { name: 'Autorizar y continuar', disabled: true }));
      await fireEvent.press(screen.getByRole('button', { name: 'No autorizo', disabled: true }));
      expect(global.fetch).toHaveBeenCalledTimes(2);
      responder(respuestaJson(500));
      await screen.findByText('No pudimos guardar tu autorización.');
    });

    it.each([
      [422, { error: 'faltan_necesarias' }],
      [500, { error: 'interno' }],
    ])('un %s muestra «No pudimos guardar tu autorización.» conservando lo marcado', async (estado, cuerpo) => {
      await mostrar(respuestaJson(estado, cuerpo));
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(screen.getByLabelText(AVISOS));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText('No pudimos guardar tu autorización.')).toBeOnTheScreen();
      expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: NECESARIAS, checked: true })).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: AVISOS, checked: true })).toBeOnTheScreen();
    });

    it('409 version_desactualizada muestra el error de envío y vuelve a pedir el catálogo, conservando lo marcado', async () => {
      const { pedidos } = await mostrar(
        respuestaJson(409, { error: 'version_desactualizada' }),
        respuestaJson(200, catalogo({ version: { numero: '1.1', fecha: '2026-11-15' } })),
      );
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(screen.getByLabelText(AVISOS));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText('No pudimos guardar tu autorización.')).toBeOnTheScreen();
      expect(await screen.findByText(/Texto versión/)).toHaveTextContent('Texto versión 1.1 del 15 de noviembre de 2026.', {
        exact: true,
      });
      expect(pedidos.map((p) => p.init.method)).toEqual(['GET', 'POST', 'GET']);
      expect(screen.getByRole('checkbox', { name: AVISOS, checked: true })).toBeOnTheScreen();
    });

    it('429 y sin conexión usan los avisos de siempre y conservan lo marcado', async () => {
      await mostrar(respuestaJson(429, { error: 'demasiados_intentos' }), new TypeError('Network request failed'));
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.')).toBeOnTheScreen();
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: NECESARIAS, checked: true })).toBeOnTheScreen();
    });

    it.each([
      [401, { error: 'sin_sesion' }, reinicio('Entrar', { llegada: 'sesion_cerrada' })],
      [403, { error: 'verificacion_pendiente' }, reinicio('RevisaTuCorreo', undefined)],
    ])('un %s lleva a la pantalla que corresponde', async (estado, cuerpo, accion) => {
      const { navegacion } = await mostrar(respuestaJson(estado, cuerpo));
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(boton('Autorizar y continuar'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(accion));
    });
  });

  describe('«No autorizo»', () => {
    it('borra la cuenta, borra el token del Keystore y va a PN-60 con «Borramos el correo que nos diste.»', async () => {
      const { pedidos, navegacion } = await mostrar(respuestaJson(204));
      await fireEvent.press(boton('No autorizo'));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'cuenta_borrada' })),
      );
      expect(pedidos[1]?.url).toBe('http://api.prueba:18090/api/v1/autorizaciones/rechazo');
      expect(pedidos[1]?.init.method).toBe('POST');
      expect(pedidos[1]?.init.body).toBeUndefined();
      expect((pedidos[1]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-limitada');
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('sin conexión se queda, conserva el token y dice «Todavía no pudimos borrar tu correo. Intenta de nuevo.»', async () => {
      const { navegacion } = await mostrar(new TypeError('Network request failed'));
      await fireEvent.press(boton('No autorizo'));
      expect(await screen.findByText('Todavía no pudimos borrar tu correo. Intenta de nuevo.')).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it('con un error del servidor dice lo mismo; con 429, el aviso de demasiados intentos', async () => {
      await mostrar(respuestaJson(500, { error: 'interno' }), respuestaJson(429, { error: 'demasiados_intentos' }));
      await fireEvent.press(boton('No autorizo'));
      expect(await screen.findByText('Todavía no pudimos borrar tu correo. Intenta de nuevo.')).toBeOnTheScreen();
      await fireEvent.press(boton('No autorizo'));
      expect(await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.')).toBeOnTheScreen();
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it('403 ya_autorizada (otro teléfono ya autorizó): no hay nada que borrar y sigue a PN-71', async () => {
      const { navegacion } = await mostrar(respuestaJson(403, { error: 'ya_autorizada' }));
      await fireEvent.press(boton('No autorizo'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SeguridadDeLaCuenta')));
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it('401 lleva a PN-60 con «Tu sesión se cerró»', async () => {
      const { navegacion } = await mostrar(respuestaJson(401, { error: 'sin_sesion' }));
      await fireEvent.press(boton('No autorizo'));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
      );
    });
  });

  describe('si el catálogo no carga o no se entiende', () => {
    async function mostrarConError(respuesta: Response | Error) {
      const falso = instalarFetchFalso(respuesta);
      const navegacion = navegacionFalsa();
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
      return { ...falso, navegacion };
    }

    it.each([
      ['un código que E14 no tiene', catalogo({ finalidades: [{ codigo: 'cuenta_del_menor', tipo: 'necesaria', otorgada: false }] })],
      ['un tipo desconocido', catalogo({ finalidades: [{ codigo: 'avisos', tipo: 'rara', otorgada: false }] })],
      ['una necesaria con tipo accesoria sin casilla', catalogo({ finalidades: [{ codigo: 'cuenta_y_acceso', tipo: 'accesoria', otorgada: false }] })],
      ['un catálogo sin necesarias', catalogo({ finalidades: [{ codigo: 'avisos', tipo: 'accesoria', otorgada: false }] })],
      ['una fecha que no se puede escribir', catalogo({ version: { numero: '1.0', fecha: 'pronto' } })],
      ['sin número de versión', catalogo({ version: { fecha: '2026-10-30' } })],
      ['sin versión', catalogo({ version: undefined })],
      ['sin lista de finalidades', catalogo({ finalidades: 'x' })],
    ])('%s es un error de carga, no una omisión en silencio', async (_caso, cuerpo) => {
      await mostrarConError(respuestaJson(200, cuerpo));
      expect(await screen.findByText('No pudimos cargar la información.')).toBeOnTheScreen();
      expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
    });

    it('un 500 y la falta de conexión muestran su aviso con «Intentar de nuevo», que vuelve a pedirlo', async () => {
      const { pedidos } = await mostrarConError(respuestaJson(500, { error: 'interno' }));
      expect(await screen.findByText('No pudimos cargar la información.')).toBeOnTheScreen();
      global.fetch = jest.fn(async () => respuestaJson(200, catalogo())) as unknown as typeof fetch;
      await fireEvent.press(boton('Intentar de nuevo'));
      expect(await screen.findByText(NECESARIAS)).toBeOnTheScreen();
      expect(pedidos).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('sin conexión dice «Sin conexión…»', async () => {
      await mostrarConError(new TypeError('Network request failed'));
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
    });

    it('un 401 lleva a PN-60', async () => {
      const { navegacion } = await mostrarConError(respuestaJson(401, { error: 'sin_sesion' }));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
      );
    });

    it('un 403 verificacion_pendiente lleva a PN-59', async () => {
      const { navegacion } = await mostrarConError(respuestaJson(403, { error: 'verificacion_pendiente' }));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('RevisaTuCorreo', undefined)));
    });
  });
});
