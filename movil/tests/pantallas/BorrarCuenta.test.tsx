import { CommonActions } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { BorrarCuenta } from '../../src/pantallas/BorrarCuenta';
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

/** Los menores del resumen: cada uno con su id, que el borrado devuelve. */
const m = (nombres: string[]) => nombres.map((nombre) => ({ id: `id-${nombre}`, nombre }));
const sinHogar = { hogar: null, menores: [] };
const conOtraAdulta = {
  hogar: { nombre: 'Nuestro hogar', es_administradora: true, unica_adulta: false, nuevo_administrador: 'Camilo' },
  menores: m(['Mateo']),
};

async function mostrar() {
  const navegacion = navegacionFalsa();
  await render(<BorrarCuenta {...propiedades('BorrarCuenta', navegacion)} />);
  return navegacion;
}

/** Abre la pantalla con el resumen y deja listas las respuestas siguientes. */
async function abrir(resumen: unknown, ...siguientes: (Response | Error)[]) {
  const falso = instalarFetchFalso(respuestaJson(200, resumen), ...siguientes);
  const navegacion = await mostrar();
  await screen.findByRole('button', { name: 'Borrar mi cuenta' });
  return { ...falso, navegacion };
}

const escribir = (clave = 'lluvia café tren azul') => fireEvent.changeText(screen.getByLabelText('Tu contraseña'), clave);
const borrar = () => fireEvent.press(screen.getByRole('button', { name: 'Borrar mi cuenta' }));

describe('PN-69 · Borrar la cuenta (E14-PCP 4.12)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    jest.clearAllMocks();
  });

  it('sin hogar ni menores trae solo lo de E14: aviso, qué se borra, contraseña, borrar y «Ahora no»', async () => {
    const { pedidos } = await abrir(sinHogar);
    expect(pedidos[0]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/borrado');
    expect(pedidos[0]?.init.method).toBe('GET');
    expect((pedidos[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-activa');
    expect(screen.getByText('Vas a borrar tu cuenta')).toBeOnTheScreen();
    expect(screen.getByText('Se borran tus datos y no se pueden recuperar.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Lo que se borra' })).toBeOnTheScreen();
    expect(
      screen.getByText('Tus movimientos, metas, deudas y presupuestos. Tu correo, tu nombre y tus preferencias.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Solo guardamos una prueba mínima de tu autorización, sin tu nombre ni tu correo, durante 3 años.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Tu contraseña')).toBeOnTheScreen();
    expect(screen.getByText('La pedimos para confirmar que eres tú.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Tu contraseña').props.autoComplete).toBe('current-password');
    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeOnTheScreen();
    expect(screen.queryByText('Menores a tu cargo')).not.toBeOnTheScreen();
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
    expect(screen.queryByText(/Eres quien lo administra/)).not.toBeOnTheScreen();
  });

  it('«Ahora no» vuelve a PN-71', async () => {
    const { navegacion } = await abrir(sinHogar);
    await fireEvent.press(screen.getByRole('button', { name: 'Ahora no' }));
    expect(navegacion.goBack).toHaveBeenCalled();
  });

  it('al administrar un hogar con otra persona adulta dice a quién pasa el papel', async () => {
    await abrir({ ...conOtraAdulta, menores: [] });
    expect(screen.getByRole('header', { name: 'Nuestro hogar' })).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Eres quien lo administra. El papel pasa ahora mismo a Camilo. Lo que compartiste sigue en el hogar, sin tu nombre.',
      ),
    ).toBeOnTheScreen();
  });

  it('siendo la única persona adulta dice que el hogar se cierra', async () => {
    await abrir({
      hogar: { nombre: 'Nuestro hogar', es_administradora: true, unica_adulta: true, nuevo_administrador: null },
      menores: [],
    });
    expect(
      screen.getByText(
        'Eres la única persona adulta de «Nuestro hogar». El hogar se cierra y lo que compartiste también se borra.',
      ),
    ).toBeOnTheScreen();
  });

  it('siendo miembro sin el papel solo dice que lo compartido sigue sin su nombre', async () => {
    await abrir({
      hogar: { nombre: 'Nuestro hogar', es_administradora: false, unica_adulta: false, nuevo_administrador: null },
      menores: [],
    });
    expect(screen.getByText('Lo que compartiste sigue en el hogar, sin tu nombre.')).toBeOnTheScreen();
    expect(screen.queryByText(/Eres quien lo administra/)).not.toBeOnTheScreen();
  });

  it('un hogar sin nombre se titula «Nuestro hogar» (D-098)', async () => {
    await abrir({
      hogar: { nombre: null, es_administradora: true, unica_adulta: true, nuevo_administrador: null },
      menores: [],
    });
    expect(screen.getByRole('header', { name: 'Nuestro hogar' })).toBeOnTheScreen();
    expect(screen.getByText(/Eres la única persona adulta de «Nuestro hogar»\./)).toBeOnTheScreen();
  });

  it('la tarjeta del hogar lleva el ícono Hogar junto al nombre (E14-SDD 5.1)', async () => {
    await abrir({ ...conOtraAdulta, menores: [] });
    // El ícono Hogar (dos personas: círculos de radio 3.5 y 2.5) va dentro de la tarjeta del hogar.
    const arbol = JSON.stringify(screen.toJSON());
    expect(arbol).toContain('"r":"3.5"');
    expect(arbol).toContain('"r":"2.5"');
  });

  it('con un menor que depende solo de ella lo nombra y pide la casilla, sin marcar', async () => {
    await abrir(conOtraAdulta);
    expect(screen.getByRole('header', { name: 'Menores a tu cargo' })).toBeOnTheScreen();
    expect(screen.getByText('Mateo depende solo de ti. Su cuenta y sus datos también se borran.')).toBeOnTheScreen();
    const casilla = screen.getByRole('checkbox', { name: 'Entiendo que también se borra la cuenta de Mateo.' });
    expect(casilla.props.accessibilityState).toEqual({ checked: false });
  });

  it.each([
    [
      ['Mateo', 'Sofía'],
      'Mateo y Sofía dependen solo de ti. Sus cuentas y sus datos también se borran.',
      'Entiendo que también se borran las cuentas de Mateo y Sofía.',
    ],
    [
      ['Mateo', 'Sofía', 'Tomás'],
      'Mateo, Sofía y Tomás dependen solo de ti. Sus cuentas y sus datos también se borran.',
      'Entiendo que también se borran las cuentas de Mateo, Sofía y Tomás.',
    ],
  ])('con varios menores (%j) los nombra a todos', async (menores, aviso, casilla) => {
    await abrir({ hogar: null, menores: m(menores) });
    expect(screen.getByText(aviso)).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: casilla })).toBeOnTheScreen();
  });

  it('borra: manda la contraseña con el Bearer, borra el token y va a PN-60 con «Borramos tu cuenta.»', async () => {
    const { pedidos, navegacion } = await abrir(sinHogar, respuestaJson(200, { estado: 'cuenta_borrada' }));
    await escribir();
    await borrar();
    await waitFor(() =>
      expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'tu_cuenta_borrada' })),
    );
    expect(pedidos[1]?.url).toBe('http://api.prueba:18090/api/v1/cuenta/borrado');
    expect(pedidos[1]?.init.method).toBe('POST');
    expect(JSON.parse(pedidos[1]?.init.body as string)).toEqual({
      contrasena: 'lluvia café tren azul',
      confirma_menores: false,
      menores: [],
    });
    expect((pedidos[1]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk-activa');
    expect(almacen.guardado.has('sesion')).toBe(false);
  });

  it('con la casilla marcada manda confirma_menores', async () => {
    const { pedidos, navegacion } = await abrir(conOtraAdulta, respuestaJson(200, {}));
    await escribir();
    await fireEvent.press(screen.getByRole('checkbox'));
    await borrar();
    await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
    expect(JSON.parse(pedidos[1]?.init.body as string)).toEqual({
      contrasena: 'lluvia café tren azul',
      confirma_menores: true,
      menores: ['id-Mateo'],
    });
  });

  it('sin marcar la casilla del menor el API dice 422 y la pantalla pide confirmar lo de Mateo; el token se queda', async () => {
    const { navegacion } = await abrir(
      conOtraAdulta,
      respuestaJson(422, { error: 'validacion', campos: { confirma_menores: 'confirmacion_requerida' } }),
    );
    await escribir();
    await borrar();
    expect(await screen.findByText('Falta confirmar lo de Mateo.')).toBeOnTheScreen();
    expect(navegacion.dispatch).not.toHaveBeenCalled();
    expect(almacen.guardado.get('sesion')).toBe('tk-activa');
  });

  it('con varios menores el error los nombra a todos', async () => {
    await abrir(
      { hogar: null, menores: m(['Mateo', 'Sofía']) },
      respuestaJson(422, { error: 'validacion', campos: { confirma_menores: 'confirmacion_requerida' } }),
    );
    await escribir();
    await borrar();
    expect(await screen.findByText('Falta confirmar lo de Mateo y Sofía.')).toBeOnTheScreen();
  });

  it('si los menores cambiaron (409) no se borró nada: vuelve a leer, muestra a todos con la casilla sin marcar y pide confirmar a cada uno', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(200, { hogar: null, menores: m(['Mateo']) }),
      respuestaJson(409, { error: 'menores_cambiaron' }),
      respuestaJson(200, { hogar: null, menores: m(['Mateo', 'Sofía']) }),
      respuestaJson(200, { estado: 'cuenta_borrada' }),
    );
    const navegacion = await mostrar();
    await screen.findByRole('button', { name: 'Borrar mi cuenta' });
    await escribir();
    await fireEvent.press(screen.getByRole('checkbox'));
    await borrar();
    expect(
      await screen.findByText('Mateo y Sofía dependen solo de ti. Sus cuentas y sus datos también se borran.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('No pudimos borrar tu cuenta.')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByLabelText('Tu contraseña').props.value).toBe('lluvia café tren azul');
    expect(navegacion.dispatch).not.toHaveBeenCalled();
    expect(almacen.guardado.get('sesion')).toBe('tk-activa');
    await fireEvent.press(screen.getByRole('checkbox'));
    await borrar();
    await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
    expect(pedidos.map((p) => p.init.method)).toEqual(['GET', 'POST', 'GET', 'POST']);
    expect(JSON.parse(pedidos[3]?.init.body as string)).toEqual({
      contrasena: 'lluvia café tren azul',
      confirma_menores: true,
      menores: ['id-Mateo', 'id-Sofía'],
    });
  });

  it('la contraseña vacía (422) da «Falta tu contraseña.» y el foco va al campo', async () => {
    await abrir(sinHogar, respuestaJson(422, { error: 'validacion', campos: { contrasena: 'contrasena_vacia' } }));
    const foco = TextInput.prototype.focus as jest.Mock;
    foco.mockClear();
    await borrar();
    expect(await screen.findByText('Falta tu contraseña.')).toBeOnTheScreen();
    expect(foco.mock.contexts[0].props.accessibilityLabel).toBe('Tu contraseña');
  });

  it('una contraseña que no coincide (400) se muestra en su campo y conserva lo escrito', async () => {
    const { navegacion } = await abrir(sinHogar, respuestaJson(400, { error: 'contrasena_incorrecta' }));
    await escribir('la que no es');
    await borrar();
    expect(await screen.findByText('No pudimos confirmar tu contraseña. Escríbela de nuevo.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Tu contraseña').props.value).toBe('la que no es');
    expect(navegacion.dispatch).not.toHaveBeenCalled();
    expect(almacen.guardado.get('sesion')).toBe('tk-activa');
  });

  it('429 dice el texto de espera', async () => {
    await abrir(sinHogar, respuestaJson(429, { error: 'demasiados_intentos' }));
    await escribir();
    await borrar();
    expect(await screen.findByText('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.')).toBeOnTheScreen();
  });

  it.each([
    [500, { error: 'error_interno' }],
    [503, { error: 'ocupado' }],
    [403, { error: 'cuenta_de_menor' }],
  ])('un error (%i) dice que los datos siguen ahí y no toca el token', async (estado, cuerpo) => {
    await abrir(sinHogar, respuestaJson(estado, cuerpo));
    await escribir();
    await borrar();
    expect(await screen.findByText('No pudimos borrar tu cuenta.')).toBeOnTheScreen();
    expect(screen.getByText('Tus datos siguen ahí. Intenta de nuevo.')).toBeOnTheScreen();
    expect(almacen.guardado.get('sesion')).toBe('tk-activa');
  });

  it('sin conexión al borrar lo dice y conserva lo escrito', async () => {
    await abrir(sinHogar, new TypeError('Network request failed'));
    await escribir();
    await borrar();
    expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Tu contraseña').props.value).toBe('lluvia café tren azul');
  });

  it.each([
    [401, { error: 'sin_sesion' }, reinicio('Entrar', { llegada: 'sesion_cerrada' })],
    [403, { error: 'verificacion_pendiente' }, reinicio('RevisaTuCorreo')],
    [403, { error: 'autorizacion_pendiente' }, reinicio('InformacionDePrivacidad')],
  ])('al borrar, %i %j sigue por el acceso negado', async (estado, cuerpo, accion) => {
    const { navegacion } = await abrir(sinHogar, respuestaJson(estado, cuerpo));
    await escribir();
    await borrar();
    await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(accion));
  });

  it('mientras borra no manda un segundo pedido', async () => {
    let soltar: (r: Response) => void = () => {};
    const respuestas: (Response | Error)[] = [respuestaJson(200, sinHogar)];
    const falso = instalarFetchFalso(...respuestas);
    falso.fetchFalso.mockImplementationOnce(async () => respuestaJson(200, sinHogar));
    falso.fetchFalso.mockImplementationOnce(() => new Promise<Response>((r) => (soltar = r)));
    const navegacion = await mostrar();
    await screen.findByRole('button', { name: 'Borrar mi cuenta' });
    await escribir();
    await borrar();
    await borrar();
    await waitFor(() => expect(falso.fetchFalso).toHaveBeenCalledTimes(2));
    await soltar(respuestaJson(200, {}));
    await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
    expect(falso.fetchFalso).toHaveBeenCalledTimes(2);
  });

  describe('«Descargar mis datos» (RF-032, D-102, D-180)', () => {
    beforeEach(() => {
      descarga.resultado = { ok: true };
      descarga.llamadas = 0;
    });
    const descargar = () => fireEvent.press(screen.getByRole('button', { name: 'Descargar mis datos' }));

    it('va antes de «Borrar mi cuenta», con su explicación', async () => {
      await abrir(sinHogar);
      const botones = screen.getAllByRole('button');
      const lugar = (nombre: string) => botones.indexOf(screen.getByRole('button', { name: nombre }));
      expect(lugar('Descargar mis datos')).toBeLessThan(lugar('Borrar mi cuenta'));
      expect(
        screen.getByText('Un archivo ZIP con tus movimientos, metas, deudas y presupuestos en CSV. Solo trae lo tuyo.'),
      ).toBeOnTheScreen();
    });

    it('descarga y avisa «Listo, descargamos tus datos.»; el botón vuelve a estar activo', async () => {
      await abrir(sinHogar);
      await descargar();
      expect(await screen.findByText('Listo, descargamos tus datos.')).toBeOnTheScreen();
      expect(screen.getByText('El archivo queda en tu teléfono. Guárdalo en un lugar seguro.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Descargar mis datos' }).props.accessibilityState).toEqual({
        disabled: false,
      });
    });

    it('mientras prepara, el botón dice «Preparando tu archivo…», está deshabilitado y no pide dos veces', async () => {
      let soltar: (v: { ok: boolean }) => void = () => {};
      descarga.resultado = new Promise((r) => (soltar = r)) as never;
      await abrir(sinHogar);
      await descargar();
      const preparando = await screen.findByRole('button', { name: 'Preparando tu archivo…' });
      expect(preparando.props.accessibilityState).toEqual({ disabled: true });
      expect(screen.getByRole('button', { name: 'Borrar mi cuenta' })).toBeOnTheScreen();
      await fireEvent.press(preparando);
      await soltar({ ok: true });
      await screen.findByText('Listo, descargamos tus datos.');
      expect(descarga.llamadas).toBe(1);
    });

    it('un error dice «No pudimos preparar tu archivo.» y la persona puede borrar igual', async () => {
      descarga.resultado = { ok: false, estado: 500, codigo: 'error_interno', campos: {} };
      const { navegacion } = await abrir(sinHogar, respuestaJson(200, {}));
      await descargar();
      expect(await screen.findByText('No pudimos preparar tu archivo.')).toBeOnTheScreen();
      expect(screen.getByText('Tu cuenta sigue igual. Intenta de nuevo.')).toBeOnTheScreen();
      await escribir();
      await borrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalled());
    });

    it('sin conexión lo dice', async () => {
      descarga.resultado = { ok: false, estado: 0, codigo: 'sin_conexion', campos: {} };
      await abrir(sinHogar);
      await descargar();
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
    });

    it('sin sesión sigue por el acceso negado', async () => {
      descarga.resultado = { ok: false, estado: 401, codigo: 'sin_sesion', campos: {} };
      const { navegacion } = await abrir(sinHogar);
      await descargar();
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
      );
    });
  });

  describe('al abrir', () => {
    it('sin el resumen no se puede borrar: avisa («No pudimos cargar tus datos.», D-180) y deja intentar de nuevo', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(500, { error: 'error_interno' }), respuestaJson(200, sinHogar));
      await mostrar();
      expect(await screen.findByText('No pudimos cargar tus datos.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Borrar mi cuenta' })).not.toBeOnTheScreen();
      expect(screen.queryByText('Tu contraseña')).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Ahora no' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      expect(await screen.findByText('Tu contraseña')).toBeOnTheScreen();
      expect(pedidos.map((p) => p.init.method)).toEqual(['GET', 'GET']);
    });

    it('«Ahora no» del error vuelve a PN-71', async () => {
      instalarFetchFalso(respuestaJson(500, { error: 'error_interno' }));
      const navegacion = await mostrar();
      await fireEvent.press(await screen.findByRole('button', { name: 'Ahora no' }));
      expect(navegacion.goBack).toHaveBeenCalled();
    });

    it('sin conexión lo dice', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      await mostrar();
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Borrar mi cuenta' })).not.toBeOnTheScreen();
    });

    it.each([
      [401, { error: 'sin_sesion' }, reinicio('Entrar', { llegada: 'sesion_cerrada' })],
      [403, { error: 'verificacion_pendiente' }, reinicio('RevisaTuCorreo')],
      [403, { error: 'autorizacion_pendiente' }, reinicio('InformacionDePrivacidad')],
    ])('%i %j sigue por el acceso negado', async (estado, cuerpo, accion) => {
      instalarFetchFalso(respuestaJson(estado, cuerpo));
      const navegacion = await mostrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(accion));
    });

    it('mientras carga no muestra el formulario', async () => {
      const { fetchFalso } = instalarFetchFalso();
      fetchFalso.mockImplementation(() => new Promise<Response>(() => {}));
      await mostrar();
      expect(screen.queryByText('Tu contraseña')).not.toBeOnTheScreen();
    });
  });
});
