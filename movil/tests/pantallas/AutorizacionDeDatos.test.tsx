import { CommonActions } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AutorizacionDeDatos } from '../../src/pantallas/AutorizacionDeDatos';
import {
  esperarAnuncio,
  esperarSinAnuncios,
  focoDeTalkBack,
  focosDeTalkBack,
  limpiarAnuncios,
  nombreDe,
} from '../ayudas/anuncios';
import { campo } from '../ayudas/campos';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

const descarga = { resultado: { ok: true } as { ok: boolean; estado?: number; codigo?: string; campos?: object }, llamadas: 0 };
jest.mock('../../src/api/descarga', () => ({
  descargarMisDatos: async () => {
    descarga.llamadas++;
    return descarga.resultado;
  },
}));
jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

// El catálogo del API desde la US-67: versión 1.1, el `modo` y la aceptación de la transmisión (api/README.md, «Autorización»).
const catalogo = (cambios: object = {}) => ({
  version: { numero: '1.1', fecha: '2026-11-12' },
  modo: 'completo',
  finalidades: [
    { codigo: 'cuenta_y_acceso', tipo: 'necesaria', otorgada: false },
    { codigo: 'funciones_financieras', tipo: 'necesaria', otorgada: false },
    { codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false },
    { codigo: 'avisos', tipo: 'accesoria', otorgada: false },
    { codigo: 'horas_de_vida', tipo: 'accesoria', otorgada: false },
  ],
  ...cambios,
});
/** La cuenta de antes del cambio: solo la necesaria que le falta (SC-E21-25, sección 5). */
const catalogoLimitado = (cambios: object = {}) =>
  catalogo({
    modo: 'falta_una_aceptacion',
    finalidades: [{ codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false }],
    ...cambios,
  });

const NECESARIAS = 'Autorizo el uso de mis datos para estas finalidades necesarias.';
const AVISOS = 'Autorizo los avisos con la app cerrada.';
const HORAS = 'Autorizo mostrar el costo de un gasto en horas de vida.';
const TRANSMISION =
  'Acepto que mis datos se envíen a estos servicios en México, Francia y Estados Unidos para guardarlos y procesarlos como se explica arriba.';
const ERROR_NECESARIAS = 'Falta tu autorización para lo necesario.';
const ERROR_TRANSMISION = 'Falta que aceptes dónde guardamos tus datos.';
const FRASE_DE_AVISOS =
  'Si activas los avisos con la app cerrada, el código de tu teléfono o de tu navegador y un aviso que solo dice «Tienes un aviso en Alcanzamos.» pasan por el servicio de notificaciones de Google (Firebase Cloud Messaging) en Android, o por el de la empresa que hace tu navegador en la web. Esas empresas no dicen en qué país los procesan.';

async function mostrar(...respuestas: (Response | Error)[]) {
  const falso = instalarFetchFalso(respuestaJson(200, catalogo()), ...respuestas);
  const navegacion = navegacionFalsa();
  await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
  await screen.findByText('Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.');
  return { ...falso, navegacion };
}

type Nodo = { type: string; children?: (Nodo | string)[] | null };
const textoPlano = (nodo: Nodo | string): string =>
  typeof nodo === 'string' ? nodo : (nodo.children ?? []).map(textoPlano).join('');
/** Lo que dice cada `Text` de la pantalla, en el orden en que se dibuja (las cifras en Figtree quedan dentro de su texto). */
function textosEnOrden(nodo: unknown, salida: string[] = []): string[] {
  if (Array.isArray(nodo)) for (const hijo of nodo) textosEnOrden(hijo, salida);
  else if (nodo && typeof nodo === 'object') {
    const { type, children } = nodo as Nodo;
    if (type === 'Text') salida.push(textoPlano(nodo as Nodo));
    else for (const hijo of children ?? []) textosEnOrden(hijo, salida);
  }
  return salida;
}
/** El texto de los hijos de una vista (elementos de React), para nombrar el botón que recibió el foco. */
const textoDeHijos = (hijos: unknown): string => {
  if (typeof hijos === 'string' || typeof hijos === 'number') return String(hijos);
  if (Array.isArray(hijos)) return hijos.map(textoDeHijos).join('');
  if (hijos && typeof hijos === 'object' && 'props' in hijos)
    return textoDeHijos((hijos as { props: { children?: unknown } }).props.children);
  return '';
};
const textoDeBoton = (vista?: { props: Record<string, unknown> }) => textoDeHijos(vista?.props.children);
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });
/** Las dos casillas necesarias: la de lo necesario y la de «Dónde guardamos tus datos» (SC-E21-25 3.6). */
const marcarLasNecesarias = async () => {
  await fireEvent.press(screen.getByLabelText(NECESARIAS));
  await fireEvent.press(screen.getByLabelText(TRANSMISION));
};
const cuerpoDe = (pedido?: { init: RequestInit }) => JSON.parse(String(pedido?.init.body));

describe('PN-64 · Autorización de datos (E14-PCP 4.7)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-limitada');
    jest.clearAllMocks();
  });

  describe('al llegar', () => {
    it('pide el catálogo con el token y muestra tres tarjetas, en el orden de E14: lo necesario, «Dónde guardamos tus datos» y lo que se puede elegir', async () => {
      const { pedidos } = await mostrar();
      expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/autorizaciones');
      expect(pedidos[0]?.init.method).toBe('GET');
      expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-limitada');
      const titulos = ['Lo necesario para usar la app', 'Dónde guardamos tus datos', 'Lo que puedes elegir'];
      for (const titulo of titulos) {
        expect(screen.getByRole('header', { name: titulo })).toBeOnTheScreen();
      }
      expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(titulos);
      for (const nombre of ['Cuenta y acceso', 'Funciones financieras', 'Avisos con la app cerrada', 'Horas de vida']) {
        expect(screen.getByText(nombre)).toBeOnTheScreen();
      }
      expect(screen.getByText(/^Usamos tu correo, tu contraseña y tu nombre/)).toBeOnTheScreen();
      expect(screen.getByText(/^Sin esta autorización no podemos darte la cuenta\./)).toBeOnTheScreen();
      expect(screen.getByText('Puedes decir que no. La app funciona igual. Lo cambias cuando quieras en Preferencias.')).toBeOnTheScreen();
    });

    it('la transmisión a los encargados no es una fila de «Lo necesario»: tiene su tarjeta', async () => {
      await mostrar();
      expect(screen.queryByText('transmision_a_encargados')).not.toBeOnTheScreen();
      expect(screen.getAllByText(/^(Cuenta y acceso|Funciones financieras)$/)).toHaveLength(2);
    });

    it('ninguna casilla viene marcada (RF-063): lo necesario, la transmisión y una por cada accesoria', async () => {
      await mostrar();
      expect(screen.getAllByRole('checkbox')).toHaveLength(4);
      expect(screen.getAllByRole('checkbox', { checked: false })).toHaveLength(4);
      expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual([NECESARIAS, TRANSMISION, AVISOS, HORAS]);
    });

    it('la tarjeta «Dónde guardamos tus datos» lleva la explicación, su casilla y su nota, aprobadas (SC-E21-25 3.6)', async () => {
      await mostrar();
      expect(
        screen.getByText(
          'Para que la app funcione, tus datos se guardan y se procesan en la nube de otras empresas, que los tratan por cuenta de Alcanzamos y solo para lo que les pedimos: Microsoft Azure, en México, guarda tu cuenta y lo que registras; Azure Communication Services, en Francia, envía los correos de la app; y Zoho Mail, en Estados Unidos, recibe lo que escribes a privacidad@alcanzamos.co. Los detalles están en la política.',
        ),
      ).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: TRANSMISION })).toBeOnTheScreen();
      expect(
        screen.getByText('Sin esta aceptación no podemos darte la cuenta, porque la app guarda tus datos en esos servicios.'),
      ).toBeOnTheScreen();
      // Los avisos con la app cerrada no van en la tarjeta obligatoria (D-202): Firebase solo sale en la frase de su casilla.
      expect(screen.getAllByText(/Firebase/)).toHaveLength(1);
    });

    it('la frase de los avisos va bajo su casilla, es su pista de accesibilidad y no está bajo «Horas de vida»', async () => {
      await mostrar();
      const avisos = screen.getByRole('checkbox', { name: AVISOS });
      expect(avisos.props.accessibilityHint).toBe(FRASE_DE_AVISOS);
      expect(screen.getByText(FRASE_DE_AVISOS)).toBeOnTheScreen();
      // En el orden de la pantalla: la casilla de avisos, su frase y después la casilla de horas de vida.
      const orden = textosEnOrden(screen.toJSON());
      expect(orden.indexOf(AVISOS)).toBeGreaterThan(-1);
      expect(orden.indexOf(FRASE_DE_AVISOS)).toBe(orden.indexOf(AVISOS) + 1);
      expect(orden.indexOf(HORAS)).toBe(orden.indexOf(FRASE_DE_AVISOS) + 1);
      expect(screen.getByRole('checkbox', { name: HORAS }).props.accessibilityHint).toBeUndefined();
      expect(screen.getByRole('checkbox', { name: NECESARIAS }).props.accessibilityHint).toBeUndefined();
      expect(screen.getByRole('checkbox', { name: TRANSMISION }).props.accessibilityHint).toBeUndefined();
    });

    it('la versión sale del API y la fecha va en palabras (D-090)', async () => {
      await mostrar();
      expect(screen.getByText(/Texto versión/)).toHaveTextContent('Texto versión 1.1 del 12 de noviembre de 2026.', {
        exact: true,
      });
    });

    it('otra versión del API cambia la frase', async () => {
      instalarFetchFalso(respuestaJson(200, catalogo({ version: { numero: '1.2', fecha: '2026-11-15' } })));
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacionFalsa())} />);
      expect(await screen.findByText(/Texto versión/)).toHaveTextContent('Texto versión 1.2 del 15 de noviembre de 2026.', {
        exact: true,
      });
    });
  });

  // PN-68 (D-195): «Leer la política completa» es un botón de texto, después de la versión y antes de «Autorizar y
  // continuar». La pantalla de PN-64 sigue en la pila debajo de PN-68: al volver, las casillas están como estaban.
  describe('«Leer la política completa» (PN-68)', () => {
    it('es un botón de texto, después de la versión y antes de «Autorizar y continuar»', async () => {
      await mostrar();
      const politica = boton('Leer la política completa');
      expect(politica).toBeOnTheScreen();
      expect(politica).toHaveStyle({ alignSelf: 'flex-start' });
      const orden = textosEnOrden(screen.toJSON());
      const version = orden.findIndex((t) => t.startsWith('Texto versión'));
      expect(version).toBeGreaterThan(-1);
      expect(orden.indexOf('Leer la política completa')).toBe(version + 1);
      expect(orden.indexOf('Autorizar y continuar')).toBe(version + 2);
    });

    it('abre PN-68 sin tocar el API ni lo marcado', async () => {
      const { pedidos, navegacion } = await mostrar();
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      await fireEvent.press(boton('Leer la política completa'));
      expect(navegacion.navigate).toHaveBeenCalledWith('Politica');
      expect(pedidos).toHaveLength(1);
      expect(screen.getByRole('checkbox', { name: NECESARIAS, checked: true })).toBeOnTheScreen();
    });
  });

  describe('«Autorizar y continuar»', () => {
    it('sin nada marcado muestra los dos errores, cada uno junto a su casilla, y no pide nada (SC-E21-25 3.6)', async () => {
      const { pedidos } = await mostrar();
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText(ERROR_NECESARIAS)).toBeOnTheScreen();
      expect(screen.getByText(ERROR_TRANSMISION)).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: `${NECESARIAS}, ${ERROR_NECESARIAS}` })).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: `${TRANSMISION}, ${ERROR_TRANSMISION}` })).toBeOnTheScreen();
      expect(pedidos).toHaveLength(1);
      expect(boton('Autorizar y continuar')).toBeEnabled();
    });

    it('con lo necesario marcado y sin «Dónde guardamos tus datos»: solo el error de la transmisión, con el foco ahí, y no se guarda nada', async () => {
      const { pedidos } = await mostrar();
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      limpiarAnuncios();
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText(ERROR_TRANSMISION)).toBeOnTheScreen();
      expect(screen.queryByText(ERROR_NECESARIAS)).not.toBeOnTheScreen();
      await waitFor(() => expect(nombreDe(focoDeTalkBack())).toBe(`${TRANSMISION}, ${ERROR_TRANSMISION}`));
      expect(pedidos).toHaveLength(1);
    });

    it('con «Dónde guardamos tus datos» marcada y sin lo necesario: solo el error de lo necesario', async () => {
      const { pedidos } = await mostrar();
      await fireEvent.press(screen.getByLabelText(TRANSMISION));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText(ERROR_NECESARIAS)).toBeOnTheScreen();
      expect(screen.queryByText(ERROR_TRANSMISION)).not.toBeOnTheScreen();
      expect(pedidos).toHaveLength(1);
    });

    it('el botón no se deshabilita con el error y cada error se va al marcar su casilla', async () => {
      await mostrar();
      await fireEvent.press(boton('Autorizar y continuar'));
      await screen.findByText(ERROR_TRANSMISION);
      await fireEvent.press(screen.getByLabelText(`${TRANSMISION}, ${ERROR_TRANSMISION}`));
      expect(screen.queryByText(ERROR_TRANSMISION)).not.toBeOnTheScreen();
      expect(screen.getByText(ERROR_NECESARIAS)).toBeOnTheScreen();
      expect(boton('Autorizar y continuar')).toBeEnabled();
    });

    it('marcar solo una accesoria no basta: sigue pidiendo lo necesario', async () => {
      const { pedidos } = await mostrar();
      await fireEvent.press(screen.getByLabelText(AVISOS));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText(ERROR_NECESARIAS)).toBeOnTheScreen();
      expect(pedidos).toHaveLength(1);
    });

    it('ACC-004 (bug 226): sin nada marcado, el foco de TalkBack va a la primera casilla con error, que lee su error; no hay anuncio aparte', async () => {
      await mostrar();
      limpiarAnuncios();
      await fireEvent.press(boton('Autorizar y continuar'));
      await screen.findByText('Falta tu autorización para lo necesario.');
      expect(nombreDe(focoDeTalkBack())).toBe(`${NECESARIAS}, Falta tu autorización para lo necesario.`);
      expect(focosDeTalkBack()).toHaveLength(1);
      await esperarSinAnuncios();
    });

    it('marcar lo necesario quita el error; desmarcarlo no lo vuelve a poner', async () => {
      await mostrar();
      await fireEvent.press(boton('Autorizar y continuar'));
      await screen.findByText('Falta tu autorización para lo necesario.');
      await fireEvent.press(screen.getByLabelText(`${NECESARIAS}, Falta tu autorización para lo necesario.`));
      expect(screen.queryByText('Falta tu autorización para lo necesario.')).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByLabelText(NECESARIAS));
      expect(screen.queryByText('Falta tu autorización para lo necesario.')).not.toBeOnTheScreen();
      // El error de la transmisión es de su casilla: marcar lo necesario no lo quita.
      expect(screen.getByText(ERROR_TRANSMISION)).toBeOnTheScreen();
    });

    it('con las dos casillas manda las tres necesarias y la versión del catálogo, sin accesorias; sigue a PN-71 sin volver a entrar', async () => {
      const { pedidos, navegacion } = await mostrar(respuestaJson(200, { estado: 'autorizada' }));
      await marcarLasNecesarias();
      await fireEvent.press(boton('Autorizar y continuar'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SeguridadDeLaCuenta')));
      expect(pedidos).toHaveLength(2);
      expect(pedidos[1]?.url).toBe('http://api.prueba:18090/api/v1/autorizaciones');
      expect(pedidos[1]?.init.method).toBe('POST');
      expect((pedidos[1]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-limitada');
      expect(cuerpoDe(pedidos[1])).toEqual({
        finalidades: ['cuenta_y_acceso', 'funciones_financieras', 'transmision_a_encargados'],
        version: '1.1',
      });
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it('suma solo las accesorias marcadas; marcar una dos veces la quita', async () => {
      const { pedidos, navegacion } = await mostrar(respuestaJson(200, { estado: 'autorizada' }));
      await marcarLasNecesarias();
      await fireEvent.press(screen.getByLabelText(AVISOS));
      await fireEvent.press(screen.getByLabelText(HORAS));
      await fireEvent.press(screen.getByLabelText(HORAS));
      expect(screen.getByRole('checkbox', { name: AVISOS, checked: true })).toBeOnTheScreen();
      await fireEvent.press(boton('Autorizar y continuar'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
      expect(cuerpoDe(pedidos[1]).finalidades).toEqual([
        'cuenta_y_acceso',
        'funciones_financieras',
        'transmision_a_encargados',
        'avisos',
      ]);
    });

    it('un toque mientras envía no repite el pedido', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const catalogoListo = respuestaJson(200, catalogo());
      let n = 0;
      global.fetch = jest.fn(() => (n++ === 0 ? Promise.resolve(catalogoListo) : new Promise<Response>((r) => (responder = r)))) as unknown as typeof fetch;
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacionFalsa())} />);
      await screen.findByText(NECESARIAS);
      await marcarLasNecesarias();
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
      await marcarLasNecesarias();
      await fireEvent.press(screen.getByLabelText(AVISOS));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText('No pudimos guardar tu autorización.')).toBeOnTheScreen();
      expect(screen.getByText('Intenta de nuevo.')).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: NECESARIAS, checked: true })).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: TRANSMISION, checked: true })).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: AVISOS, checked: true })).toBeOnTheScreen();
    });

    it('409 version_desactualizada muestra el error de envío y vuelve a pedir el catálogo, conservando lo marcado', async () => {
      const { pedidos } = await mostrar(
        respuestaJson(409, { error: 'version_desactualizada' }),
        respuestaJson(200, catalogo({ version: { numero: '1.2', fecha: '2026-11-15' } })),
      );
      await marcarLasNecesarias();
      await fireEvent.press(screen.getByLabelText(AVISOS));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText('No pudimos guardar tu autorización.')).toBeOnTheScreen();
      expect(await screen.findByText(/Texto versión/)).toHaveTextContent('Texto versión 1.2 del 15 de noviembre de 2026.', {
        exact: true,
      });
      expect(pedidos.map((p) => p.init.method)).toEqual(['GET', 'POST', 'GET']);
      expect(screen.getByRole('checkbox', { name: AVISOS, checked: true })).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: TRANSMISION, checked: true })).toBeOnTheScreen();
    });

    it('429 y sin conexión usan los avisos de siempre y conservan lo marcado', async () => {
      await mostrar(respuestaJson(429, { error: 'demasiados_intentos' }), new TypeError('Network request failed'));
      await marcarLasNecesarias();
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
    ])('un %s lleva a la pantalla que corresponde', async (estado, cuerpo, accion) => {
      const { navegacion } = await mostrar(respuestaJson(estado, cuerpo));
      await marcarLasNecesarias();
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
      ['la transmisión como accesoria', catalogo({ finalidades: [{ codigo: 'transmision_a_encargados', tipo: 'accesoria', otorgada: false }] })],
      ['la transmisión repetida', catalogo({ finalidades: [
        { codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false },
        { codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false },
      ] })],
      ['un modo que no conoce', catalogo({ modo: 'otro' })],
      ['sin modo', catalogo({ modo: undefined })],
      ['una fecha que no se puede escribir', catalogo({ version: { numero: '1.1', fecha: 'pronto' } })],
      ['sin número de versión', catalogo({ version: { fecha: '2026-11-12' } })],
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

  });

  // SC-E21-25 sección 5, pasos 2 y 3: la cuenta de antes del cambio ve PN-64 solo con la tarjeta que le falta y, con
  // «No autorizo», no se borra sin preguntar: se abre la hoja de PN-54.
  describe('el modo «falta una aceptación»', () => {
    async function mostrarLimitada(...respuestas: (Response | Error)[]) {
      const falso = instalarFetchFalso(respuestaJson(200, catalogoLimitado()), ...respuestas);
      const navegacion = navegacionFalsa();
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
      await screen.findByRole('checkbox', { name: TRANSMISION });
      return { ...falso, navegacion };
    }

    it('muestra solo la tarjeta «Dónde guardamos tus datos», su casilla sin marcar, la versión, la política y los dos botones', async () => {
      await mostrarLimitada();
      expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(['Dónde guardamos tus datos']);
      const casillas = screen.getAllByRole('checkbox');
      expect(casillas.map((c) => c.props.accessibilityLabel)).toEqual([TRANSMISION]);
      expect(casillas[0]).toHaveProp('accessibilityState', { checked: false, disabled: false });
      expect(
        screen.getByText('Sin esta aceptación no podemos darte la cuenta, porque la app guarda tus datos en esos servicios.'),
      ).toBeOnTheScreen();
      expect(screen.getByText(/Texto versión/)).toHaveTextContent('Texto versión 1.1 del 12 de noviembre de 2026.', {
        exact: true,
      });
      expect(boton('Leer la política completa')).toBeOnTheScreen();
      expect(boton('Autorizar y continuar')).toBeOnTheScreen();
      expect(boton('No autorizo')).toBeOnTheScreen();
    });

    it('no vuelve a pedir lo que ya autorizó: ni lo necesario, ni lo opcional, ni la explicación de la pantalla completa', async () => {
      await mostrarLimitada();
      for (const texto of [
        'Lo necesario para usar la app',
        'Lo que puedes elegir',
        'Cuenta y acceso',
        'Funciones financieras',
        'Avisos con la app cerrada',
        'Horas de vida',
        'Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.',
        'Puedes decir que no. La app funciona igual. Lo cambias cuando quieras en Preferencias.',
        // La nota de la pantalla completa habla de borrar el correo: aquí no es cierto.
        'Sin esta autorización no podemos darte la cuenta. Si no autorizas, borramos al momento el correo que nos diste.',
        FRASE_DE_AVISOS,
      ])
        expect(screen.queryByText(texto)).not.toBeOnTheScreen();
      expect(screen.queryByRole('checkbox', { name: AVISOS })).not.toBeOnTheScreen();
    });

    it('«Autorizar y continuar» sin marcar da el error de E14, le lleva el foco y no guarda nada', async () => {
      const { pedidos, navegacion } = await mostrarLimitada();
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText(ERROR_TRANSMISION)).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: `${TRANSMISION}, ${ERROR_TRANSMISION}` })).toBeOnTheScreen();
      await waitFor(() => expect(nombreDe(focoDeTalkBack())).toBe(`${TRANSMISION}, ${ERROR_TRANSMISION}`));
      expect(pedidos).toHaveLength(1);
      expect(navegacion.dispatch).not.toHaveBeenCalled();
    });

    it('al aceptar manda solo transmision_a_encargados con la versión del catálogo y llega a Inicio (PN-71)', async () => {
      const { pedidos, navegacion } = await mostrarLimitada(respuestaJson(200, { estado: 'autorizada' }));
      await fireEvent.press(screen.getByLabelText(TRANSMISION));
      await fireEvent.press(boton('Autorizar y continuar'));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('SeguridadDeLaCuenta')));
      expect(pedidos.map((p) => `${p.init.method} ${p.url}`)).toEqual([
        'GET http://api.prueba:18090/api/v1/autorizaciones',
        'POST http://api.prueba:18090/api/v1/autorizaciones',
      ]);
      expect(cuerpoDe(pedidos[1])).toEqual({ finalidades: ['transmision_a_encargados'], version: '1.1' });
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it('409 version_desactualizada: vuelve a pedir el catálogo y conserva la casilla', async () => {
      const { pedidos } = await mostrarLimitada(
        respuestaJson(409, { error: 'version_desactualizada' }),
        respuestaJson(200, catalogoLimitado({ version: { numero: '1.2', fecha: '2026-11-15' } })),
      );
      await fireEvent.press(screen.getByLabelText(TRANSMISION));
      await fireEvent.press(boton('Autorizar y continuar'));
      expect(await screen.findByText('No pudimos guardar tu autorización.')).toBeOnTheScreen();
      expect(await screen.findByText(/Texto versión/)).toHaveTextContent('Texto versión 1.2 del 15 de noviembre de 2026.', {
        exact: true,
      });
      expect(pedidos.map((p) => p.init.method)).toEqual(['GET', 'POST', 'GET']);
      expect(screen.getByRole('checkbox', { name: TRANSMISION, checked: true })).toBeOnTheScreen();
    });
  });

  // La hoja «¿No autorizas?» de PN-54 (E14-PME 4.11, D-102, D-103): la usa PN-64 cuando «No autorizo» no puede borrar de un
  // toque. Hoja inferior (E14-SDD 5.12) con su región viva; el foco vuelve a «No autorizo» al cerrarla.
  describe('la hoja «¿No autorizas?» (PN-54 y modo «falta una aceptación»)', () => {
    type Pedido = { metodo: string; ruta: string; cuerpo?: Record<string, unknown> };
    const sinHogar = { hogar: null, menores: [] };
    type Opciones = {
      catalogoDelApi?: object;
      resumen?: () => Response | Error;
      borrar?: () => Response | Error;
      rechazo?: () => Response | Error;
    };

    /** El API de la cuenta de antes: el catálogo, el resumen del borrado, el borrado y el rechazo. */
    function apiDeLaHoja({
      catalogoDelApi = catalogoLimitado(),
      resumen = () => respuestaJson(200, sinHogar),
      borrar = () => respuestaJson(200, { estado: 'cuenta_borrada' }),
      rechazo = () => respuestaJson(403, { error: 'cuenta_con_historial' }),
    }: Opciones = {}) {
      const pedidos: Pedido[] = [];
      global.fetch = jest.fn(async (url: string, init: RequestInit) => {
        const ruta = url.replace('http://api.prueba:18090', '');
        const metodo = String(init.method);
        pedidos.push({ metodo, ruta, cuerpo: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
        const respuesta =
          ruta === '/api/v1/autorizaciones' && metodo === 'GET'
            ? respuestaJson(200, catalogoDelApi)
            : ruta === '/api/v1/autorizaciones/rechazo'
              ? rechazo()
              : ruta === '/api/v1/cuenta/borrado'
                ? metodo === 'GET'
                  ? resumen()
                  : borrar()
                : new Error(`pedido no previsto: ${metodo} ${ruta}`);
        if (respuesta instanceof Error) throw respuesta;
        return respuesta;
      }) as unknown as typeof fetch;
      return pedidos;
    }

    const hoja = () => screen.getByRole('header', { name: '¿No autorizas?' });
    const borrar = () => screen.getByRole('button', { name: 'Borrar mi cuenta' });
    const escribir = (clave = 'lluvia café tren azul') => fireEvent.changeText(campo('Tu contraseña'), clave);

    async function abrirLaHoja(opciones?: Opciones) {
      const pedidos = apiDeLaHoja(opciones);
      const navegacion = navegacionFalsa();
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
      await screen.findByRole('checkbox', { name: TRANSMISION });
      await fireEvent.press(boton('No autorizo'));
      await screen.findByRole('header', { name: '¿No autorizas?' });
      await waitFor(() => expect(borrar()).toBeEnabled());
      return { pedidos, navegacion };
    }

    beforeEach(() => {
      descarga.resultado = { ok: true };
      descarga.llamadas = 0;
    });

    it('«No autorizo» abre la hoja sin llamar al rechazo que borra', async () => {
      const { pedidos, navegacion } = await abrirLaHoja();
      expect(hoja()).toBeOnTheScreen();
      expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual(['GET /api/v1/autorizaciones', 'GET /api/v1/cuenta/borrado']);
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it('trae los textos de E14-PME: explicación, aviso de la descarga, contraseña, «Volver y decidir» (Primario) y «Borrar mi cuenta» (Destructivo)', async () => {
      await abrirLaHoja();
      expect(screen.getByText('Si no autorizas, borramos tu cuenta y tu historial.')).toBeOnTheScreen();
      expect(screen.getByText('Antes puedes descargar tus datos.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Descargar mis datos' })).toBeOnTheScreen();
      expect(
        screen.getByText('Un archivo ZIP con tus movimientos, metas, deudas y presupuestos en CSV. Solo trae lo tuyo.'),
      ).toBeOnTheScreen();
      expect(screen.getByText('Tu contraseña')).toBeOnTheScreen();
      expect(screen.getByText('La pedimos para confirmar que eres tú.')).toBeOnTheScreen();
      expect(campo('Tu contraseña').props.autoComplete).toBe('current-password');
      expect(boton('Volver y decidir')).toBeOnTheScreen();
      expect(borrar()).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Cerrar' })).toBeOnTheScreen();
    });

    it('sin menores que dependan de la persona no pide confirmar nada más', async () => {
      await abrirLaHoja();
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    });

    it('«Volver y decidir» la cierra, la cuenta no cambia, y el foco de TalkBack vuelve a «No autorizo»', async () => {
      const { navegacion } = await abrirLaHoja();
      await escribir();
      limpiarAnuncios();
      await fireEvent.press(boton('Volver y decidir'));
      expect(screen.queryByRole('header', { name: '¿No autorizas?' })).not.toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: TRANSMISION })).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(textoDeBoton(focosDeTalkBack().at(-1))).toBe('No autorizo');
    });

    it('el ícono Cerrar y el Atrás del sistema también la cierran y llevan el foco a «No autorizo»', async () => {
      await abrirLaHoja();
      limpiarAnuncios();
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
      expect(screen.queryByRole('header', { name: '¿No autorizas?' })).not.toBeOnTheScreen();
      expect(textoDeBoton(focosDeTalkBack().at(-1))).toBe('No autorizo');
      // Se puede abrir otra vez y el Atrás del sistema (requestClose) la cierra.
      await fireEvent.press(boton('No autorizo'));
      await screen.findByRole('header', { name: '¿No autorizas?' });
      limpiarAnuncios();
      await fireEvent(screen.getByRole('header', { name: '¿No autorizas?' }), 'requestClose');
      await waitFor(() => expect(screen.queryByRole('header', { name: '¿No autorizas?' })).not.toBeOnTheScreen());
      expect(textoDeBoton(focosDeTalkBack().at(-1))).toBe('No autorizo');
    });

    it('«Borrar mi cuenta» manda la contraseña, sin menores que confirmar, y va a PN-60 con «Borramos tu cuenta.»', async () => {
      const { pedidos, navegacion } = await abrirLaHoja();
      await escribir();
      await fireEvent.press(borrar());
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'tu_cuenta_borrada' })),
      );
      const borrado = pedidos.find((p) => p.metodo === 'POST' && p.ruta === '/api/v1/cuenta/borrado');
      expect(borrado?.cuerpo).toEqual({ contrasena: 'lluvia café tren azul', confirma_menores: false, menores: [] });
      expect(pedidos.some((p) => p.ruta === '/api/v1/autorizaciones/rechazo')).toBe(false);
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('sin la contraseña dice «Falta tu contraseña para borrar la cuenta.» junto al campo, con el foco ahí, y no pide nada', async () => {
      const { pedidos, navegacion } = await abrirLaHoja();
      limpiarAnuncios();
      await fireEvent.press(borrar());
      expect(await screen.findByText('Falta tu contraseña para borrar la cuenta.')).toBeOnTheScreen();
      await waitFor(() => expect(nombreDe(focoDeTalkBack())).toBe('Tu contraseña, Falta tu contraseña para borrar la cuenta.'));
      expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(0);
      expect(navegacion.dispatch).not.toHaveBeenCalled();
    });

    it('una contraseña que no coincide da el texto de PN-69 y la hoja sigue abierta con la cuenta intacta', async () => {
      const { navegacion } = await abrirLaHoja({
        borrar: () => respuestaJson(400, { error: 'contrasena_incorrecta' }),
      });
      await escribir('otra clave');
      await fireEvent.press(borrar());
      expect(await screen.findByText('No pudimos confirmar tu contraseña. Escríbela de nuevo.')).toBeOnTheScreen();
      expect(hoja()).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
    });

    it.each([
      [500, { error: 'interno' }, 'No pudimos borrar tu cuenta.', 'Tus datos siguen ahí. Intenta de nuevo.'],
      [429, { error: 'demasiados_intentos' }, 'Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.', undefined],
    ])('un %s al borrar: el aviso dentro de la hoja, que lo anuncia por su región viva, y la cuenta sigue', async (estado, cuerpo, titulo, mensaje) => {
      const { navegacion } = await abrirLaHoja({ borrar: () => respuestaJson(estado, cuerpo) });
      await escribir();
      await fireEvent.press(borrar());
      expect(await screen.findByText(titulo)).toBeOnTheScreen();
      if (mensaje) expect(screen.getByText(mensaje)).toBeOnTheScreen();
      await esperarAnuncio(mensaje ? `${titulo} ${mensaje}` : titulo);
      expect(hoja()).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
    });

    it('sin conexión al borrar dice «Sin conexión…» y se puede intentar de nuevo', async () => {
      await abrirLaHoja({ borrar: () => new TypeError('Network request failed') });
      await escribir();
      await fireEvent.press(borrar());
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
      expect(borrar()).toBeEnabled();
    });

    it('401 al borrar lleva a PN-60 («Tu sesión se cerró»)', async () => {
      const { navegacion } = await abrirLaHoja({ borrar: () => respuestaJson(401, { error: 'sin_sesion' }) });
      await escribir();
      await fireEvent.press(borrar());
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
      );
    });

    it('no manda dos borrados si se toca dos veces mientras envía', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      const pedidos = apiDeLaHoja();
      const normal = global.fetch;
      let enviados = 0;
      global.fetch = jest.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/cuenta/borrado') && init.method === 'POST') {
          enviados++;
          return new Promise<Response>((r) => (responder = r));
        }
        return normal(url, init);
      }) as unknown as typeof fetch;
      const navegacion = navegacionFalsa();
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
      await screen.findByRole('checkbox', { name: TRANSMISION });
      await fireEvent.press(boton('No autorizo'));
      await screen.findByRole('header', { name: '¿No autorizas?' });
      await waitFor(() => expect(borrar()).toBeEnabled());
      await escribir();
      await fireEvent.press(borrar());
      await fireEvent.press(screen.getByRole('button', { name: 'Borrar mi cuenta', disabled: true }));
      expect(enviados).toBe(1);
      responder(respuestaJson(200, { estado: 'cuenta_borrada' }));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
      expect(pedidos.length).toBeGreaterThan(0);
    });

    describe('«Descargar mis datos»', () => {
      it('abre la hoja de compartir, avisa dentro de la hoja que el archivo quedó listo, y no borra ni cierra', async () => {
        const { pedidos, navegacion } = await abrirLaHoja();
        await fireEvent.press(screen.getByRole('button', { name: 'Descargar mis datos' }));
        expect(await screen.findByText('Listo, descargamos tus datos.')).toBeOnTheScreen();
        expect(screen.getByText('El archivo queda en tu teléfono. Guárdalo en un lugar seguro.')).toBeOnTheScreen();
        expect(descarga.llamadas).toBe(1);
        await esperarAnuncio('Listo, descargamos tus datos. El archivo queda en tu teléfono. Guárdalo en un lugar seguro.');
        expect(hoja()).toBeOnTheScreen();
        expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
        expect(navegacion.dispatch).not.toHaveBeenCalled();
      });

      it('mientras prepara queda deshabilitado con «Preparando tu archivo…» y «Borrar mi cuenta» sigue disponible', async () => {
        let terminar: (resultado: { ok: boolean }) => void = () => undefined;
        await abrirLaHoja();
        descarga.resultado = new Promise((r) => (terminar = r)) as never;
        await fireEvent.press(screen.getByRole('button', { name: 'Descargar mis datos' }));
        expect(await screen.findByRole('button', { name: 'Preparando tu archivo…', disabled: true })).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Preparando tu archivo…', disabled: true }));
        expect(descarga.llamadas).toBe(1);
        expect(borrar()).toBeEnabled();
        terminar({ ok: true });
        expect(await screen.findByRole('button', { name: 'Descargar mis datos' })).toBeOnTheScreen();
      });

      it('si falla: «No pudimos preparar tu archivo.», «Tu cuenta sigue igual.» y se puede borrar igual', async () => {
        await abrirLaHoja();
        descarga.resultado = { ok: false, estado: 500, codigo: 'interno', campos: {} };
        await fireEvent.press(screen.getByRole('button', { name: 'Descargar mis datos' }));
        expect(await screen.findByText('No pudimos preparar tu archivo.')).toBeOnTheScreen();
        expect(screen.getByText('Tu cuenta sigue igual. Intenta de nuevo.')).toBeOnTheScreen();
        expect(borrar()).toBeEnabled();
      });

      it('401 al descargar lleva a PN-60', async () => {
        const { navegacion } = await abrirLaHoja();
        descarga.resultado = { ok: false, estado: 401, codigo: 'sin_sesion', campos: {} };
        await fireEvent.press(screen.getByRole('button', { name: 'Descargar mis datos' }));
        await waitFor(() =>
          expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
        );
      });
    });

    describe('con menores que dependen solo de la persona (RN-006)', () => {
      const conMenor = { hogar: null, menores: [{ id: 'id-Mateo', nombre: 'Mateo' }] };
      const CONFIRMA = 'Entiendo que también se borra la cuenta de Mateo.';

      it('pide confirmar lo del menor, como PN-69, y manda su id', async () => {
        const { pedidos, navegacion } = await abrirLaHoja({ resumen: () => respuestaJson(200, conMenor) });
        expect(screen.getByText('Mateo depende solo de ti. Su cuenta y sus datos también se borran.')).toBeOnTheScreen();
        await escribir();
        await fireEvent.press(screen.getByRole('checkbox', { name: CONFIRMA }));
        await fireEvent.press(borrar());
        await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
        const borrado = pedidos.find((p) => p.metodo === 'POST' && p.ruta === '/api/v1/cuenta/borrado');
        expect(borrado?.cuerpo).toEqual({
          contrasena: 'lluvia café tren azul',
          confirma_menores: true,
          menores: ['id-Mateo'],
        });
      });

      it('sin marcar la casilla, el error de PN-69 con el foco en la casilla, y no se borra', async () => {
        const { navegacion } = await abrirLaHoja({
          resumen: () => respuestaJson(200, conMenor),
          borrar: () => respuestaJson(422, { error: 'validacion', campos: { confirma_menores: 'confirmacion_requerida' } }),
        });
        await escribir();
        limpiarAnuncios();
        await fireEvent.press(borrar());
        expect(await screen.findByText('Falta confirmar lo de Mateo.')).toBeOnTheScreen();
        await waitFor(() => expect(nombreDe(focoDeTalkBack())).toBe(`${CONFIRMA}, Falta confirmar lo de Mateo.`));
        expect(navegacion.dispatch).not.toHaveBeenCalled();
      });

      it('409 menores_cambiaron: vuelve a leer el resumen, pide confirmar de nuevo y avisa que no se borró nada', async () => {
        let lecturas = 0;
        await abrirLaHoja({
          resumen: () => respuestaJson(200, lecturas++ === 0 ? conMenor : { hogar: null, menores: [{ id: 'id-Sofía', nombre: 'Sofía' }] }),
          borrar: () => respuestaJson(409, { error: 'menores_cambiaron' }),
        });
        await escribir();
        await fireEvent.press(screen.getByRole('checkbox', { name: CONFIRMA }));
        await fireEvent.press(borrar());
        expect(await screen.findByText('Sofía depende solo de ti. Su cuenta y sus datos también se borran.')).toBeOnTheScreen();
        expect(screen.getByText('No pudimos borrar tu cuenta.')).toBeOnTheScreen();
        expect(screen.getByRole('checkbox', { name: 'Entiendo que también se borra la cuenta de Sofía.', checked: false })).toBeOnTheScreen();
      });
    });

    describe('si no se puede leer el resumen del borrado', () => {
      it('dice «No pudimos cargar tus datos.», no deja borrar y «Intentar de nuevo» lo vuelve a pedir', async () => {
        const pedidos = apiDeLaHoja({ resumen: () => respuestaJson(500, { error: 'interno' }) });
        const navegacion = navegacionFalsa();
        await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
        await screen.findByRole('checkbox', { name: TRANSMISION });
        await fireEvent.press(boton('No autorizo'));
        expect(await screen.findByText('No pudimos cargar tus datos.')).toBeOnTheScreen();
        expect(screen.queryByRole('button', { name: 'Borrar mi cuenta' })).not.toBeOnTheScreen();
        expect(boton('Volver y decidir')).toBeOnTheScreen();
        // Sin el resumen no se pide la contraseña: no hay con qué borrar.
        expect(screen.queryByText('Tu contraseña')).not.toBeOnTheScreen();
        global.fetch = jest.fn(async () => respuestaJson(200, sinHogar)) as unknown as typeof fetch;
        // El aviso de la hoja y el del catálogo no son el mismo: el de la hoja trae el «Intentar de nuevo» de la hoja.
        const botones = screen.getAllByRole('button', { name: 'Intentar de nuevo' });
        await fireEvent.press(botones[botones.length - 1]!);
        await waitFor(() => expect(borrar()).toBeOnTheScreen());
        expect(pedidos.length).toBeGreaterThan(0);
      });

      it('401 lleva a PN-60', async () => {
        apiDeLaHoja({ resumen: () => respuestaJson(401, { error: 'sin_sesion' }) });
        const navegacion = navegacionFalsa();
        await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
        await screen.findByRole('checkbox', { name: TRANSMISION });
        await fireEvent.press(boton('No autorizo'));
        await waitFor(() =>
          expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
        );
      });
    });

    it('en el modo completo, un 403 cuenta_con_historial del rechazo abre la misma hoja y no borra nada', async () => {
      const pedidos = apiDeLaHoja({ catalogoDelApi: catalogo() });
      const navegacion = navegacionFalsa();
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
      await screen.findByText(NECESARIAS);
      await fireEvent.press(boton('No autorizo'));
      await screen.findByRole('header', { name: '¿No autorizas?' });
      expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
        'GET /api/v1/autorizaciones',
        'POST /api/v1/autorizaciones/rechazo',
        'GET /api/v1/cuenta/borrado',
      ]);
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(almacen.guardado.get('sesion')).toBe('tk-limitada');
      expect(screen.queryByText('Todavía no pudimos borrar tu correo. Intenta de nuevo.')).not.toBeOnTheScreen();
    });

    it('en el modo completo, sin historial el «No autorizo» sigue sin hoja y sin pedir el resumen', async () => {
      const pedidos = apiDeLaHoja({ catalogoDelApi: catalogo(), rechazo: () => respuestaJson(204) });
      const navegacion = navegacionFalsa();
      await render(<AutorizacionDeDatos {...propiedades('AutorizacionDeDatos', navegacion)} />);
      await screen.findByText(NECESARIAS);
      await fireEvent.press(boton('No autorizo'));
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'cuenta_borrada' })),
      );
      expect(screen.queryByRole('header', { name: '¿No autorizas?' })).not.toBeOnTheScreen();
      expect(pedidos.some((p) => p.ruta === '/api/v1/cuenta/borrado')).toBe(false);
    });
  });
});
