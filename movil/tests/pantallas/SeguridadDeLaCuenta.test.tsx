import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SeguridadDeLaCuenta } from '../../src/pantallas/SeguridadDeLaCuenta';
import type { DatosDeAviso } from '../../src/textos';
import { anunciados, esperarAnuncio } from '../ayudas/anuncios';
import { comprobarOcupado } from '../ayudas/ocupado';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import { tokens } from '../../src/tokens/tokens.generated';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const reinicio = (nombre: string, params?: object) =>
  CommonActions.reset({ index: 0, routes: [{ name: nombre, params }] });

async function mostrar(llegada?: 'contrasena_cambiada', aviso?: DatosDeAviso) {
  const navegacion = navegacionFalsa();
  const params = llegada || aviso ? { llegada, aviso } : undefined;
  await render(<SeguridadDeLaCuenta {...propiedades('SeguridadDeLaCuenta', navegacion, params)} />);
  return navegacion;
}

describe('PN-71 · Seguridad de la cuenta (E14-PCP 4.14)', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-activa');
    jest.clearAllMocks();
  });

  describe('con ingreso anterior', () => {
    beforeEach(() => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: '2026-11-02T02:40:00Z' }));
    });

    it('muestra «Tu último ingreso» con la fecha en palabras y en la hora de Colombia', async () => {
      await mostrar();
      expect(await screen.findByText('Tu último ingreso')).toBeOnTheScreen();
      expect(screen.getByText(/Tu ingreso anterior fue el /)).toBeOnTheScreen();
      expect(screen.getByRole('alert', {})).toBeOnTheScreen();
      expect(screen.getByText('Es la fecha de tu ingreso anterior, no la de ahora.')).toBeOnTheScreen();
    });

    it('las cifras de la fecha van en Figtree con cifras tabulares y sin ss02 (D-123)', async () => {
      await mostrar();
      await screen.findByText('Tu último ingreso');
      for (const numero of ['1', '2026', '9:40']) {
        expect(screen.getByText(numero)).toHaveStyle({ fontFamily: 'Figtree-SemiBold', fontVariant: ['tabular-nums'] });
      }
      expect(JSON.stringify(screen.toJSON())).not.toMatch(/stylistic|ss02/);
    });

    it('el texto completo es el de E14, sin punto de más después de «p. m.»', async () => {
      await mostrar();
      const tarjeta = await screen.findByText(/Tu ingreso anterior fue/);
      expect(tarjeta).toHaveTextContent('Tu ingreso anterior fue el 1 de noviembre de 2026, a las 9:40 p. m.', {
        exact: true,
      });
    });

    it('avisa «¿No reconoces este ingreso?» y ofrece «Cambiar mi contraseña», que abre PN-73', async () => {
      const navegacion = await mostrar();
      expect(await screen.findByText('¿No reconoces este ingreso?')).toBeOnTheScreen();
      expect(screen.getByText('Cambia tu contraseña y cerramos tus otras sesiones.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Cambiar mi contraseña' }));
      expect(navegacion.navigate).toHaveBeenCalledWith('CambiarContrasena');
    });

    it('nunca muestra la contraseña ni el token', async () => {
      await mostrar();
      await screen.findByText('Tu último ingreso');
      expect(JSON.stringify(screen.toJSON())).not.toContain('tk-activa');
    });
  });

  it('el primer ingreso dice «Este es tu primer ingreso.» sin fecha y sin las filas 3 y 4', async () => {
    instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
    await mostrar();
    expect(await screen.findByText('Este es tu primer ingreso.')).toBeOnTheScreen();
    expect(screen.queryByText('¿No reconoces este ingreso?')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cambiar mi contraseña' })).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeOnTheScreen();
  });

  it('una fecha que no se puede leer es un error de carga', async () => {
    instalarFetchFalso(respuestaJson(200, { ingreso_anterior: 'ayer' }));
    await mostrar();
    expect(await screen.findByText('No pudimos cargar tu último ingreso.')).toBeOnTheScreen();
  });

  it('con la llegada de PN-73 muestra arriba «Listo, cambiamos tu contraseña.» «Cerramos tus otras sesiones. Esta sigue abierta.»', async () => {
    instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
    await mostrar('contrasena_cambiada');
    expect(await screen.findByText('Listo, cambiamos tu contraseña.')).toBeOnTheScreen();
    expect(screen.getByText('Cerramos tus otras sesiones. Esta sigue abierta.')).toBeOnTheScreen();
  });

  it('ACC-004 (bug 225): al volver de PN-73 TalkBack anuncia «Listo, cambiamos tu contraseña.» y no la tarjeta de siempre', async () => {
    instalarFetchFalso(respuestaJson(200, { ingreso_anterior: '2026-11-02T02:40:00Z' }));
    await mostrar('contrasena_cambiada');
    await screen.findByText('¿No reconoces este ingreso?');
    await esperarAnuncio('Listo, cambiamos tu contraseña. Cerramos tus otras sesiones. Esta sigue abierta.');
    await new Promise((listo) => setTimeout(listo, 1100));
    expect(anunciados()).toEqual(['Listo, cambiamos tu contraseña. Cerramos tus otras sesiones. Esta sigue abierta.']);
  });

  describe('errores y rutas del API', () => {
    it('un 500 dice «No pudimos cargar tu último ingreso.» y «Intentar de nuevo» vuelve a pedir', async () => {
      const { fetchFalso } = instalarFetchFalso(respuestaJson(500), respuestaJson(200, { ingreso_anterior: null }));
      await mostrar();
      expect(await screen.findByText('No pudimos cargar tu último ingreso.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
      expect(await screen.findByText('Este es tu primer ingreso.')).toBeOnTheScreen();
      expect(fetchFalso).toHaveBeenCalledTimes(2);
    });

    it('sin conexión dice «Sin conexión…»', async () => {
      instalarFetchFalso(new TypeError('Network request failed'));
      await mostrar();
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
    });

    it('401 → PN-60 con «Tu sesión se cerró» y el token borrado', async () => {
      instalarFetchFalso(respuestaJson(401, { error: 'sin_sesion' }));
      const navegacion = await mostrar();
      await waitFor(() =>
        expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar', { llegada: 'sesion_cerrada' })),
      );
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('403 autorizacion_pendiente → PN-63', async () => {
      instalarFetchFalso(
        respuestaJson(403, { error: 'autorizacion_pendiente' }),
        respuestaJson(200, { version: { numero: '1.2', fecha: '2026-11-17' }, modo: 'completo', finalidades: [] }),
      );
      const navegacion = await mostrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('InformacionDePrivacidad')));
    });

    // SC-E21-25, sección 5, paso 2: la cuenta de antes del cambio va directo a PN-64, con la tarjeta que le falta.
    it('403 autorizacion_pendiente con el modo falta_una_aceptacion → PN-64', async () => {
      const { pedidos } = instalarFetchFalso(
        respuestaJson(403, { error: 'autorizacion_pendiente' }),
        respuestaJson(200, {
          version: { numero: '1.2', fecha: '2026-11-17' },
          modo: 'falta_una_aceptacion',
          finalidades: [{ codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false }],
        }),
      );
      const navegacion = await mostrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('AutorizacionDeDatos')));
      expect(pedidos.map((p) => p.url.replace('http://api.prueba:18090', ''))).toEqual([
        '/api/v1/cuenta/seguridad',
        '/api/v1/autorizaciones',
      ]);
    });

    it('si se sale de la pantalla antes de que conteste el API, no actualiza nada', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      global.fetch = jest.fn(() => new Promise<Response>((r) => (responder = r))) as unknown as typeof fetch;
      await mostrar();
      await screen.unmount();
      await act(async () => responder(respuestaJson(200, { ingreso_anterior: null })));
    });
  });

  describe('«Cerrar sesión» (T2)', () => {
    it('borra la sesión en el API y el token del Keystore, y vuelve a PN-60', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }), respuestaJson(204));
      const navegacion = await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar')));
      expect(pedidos[1]?.init.method).toBe('DELETE');
      expect(pedidos[1]?.url).toBe('http://api.prueba:18090/api/v1/sesiones/actual');
      expect(almacen.guardado.has('sesion')).toBe(false);
    });

    it('sin conexión se queda, conserva el token y avisa', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }), new TypeError('Network request failed'));
      const navegacion = await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
      expect(
        await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.'),
      ).toBeOnTheScreen();
      expect(navegacion.dispatch).not.toHaveBeenCalled();
      expect(almacen.guardado.get('sesion')).toBe('tk-activa');
    });
  });

  // Bug 303 (ACC-004, L8.2): «Cerrar sesión» manda un DELETE; mientras espera queda ocupado (se ve como deshabilitado, sigue
  // habilitado para TalkBack con `busy`) y un segundo toque no manda otro pedido.
  describe('«Cerrar sesión» mientras envía (bug 303)', () => {
    function fetchConDeleteEnEspera() {
      const pedidos: { url: string; init: RequestInit }[] = [];
      let responder: (respuesta: Response | Error) => void = () => undefined;
      global.fetch = jest.fn(async (url: string, init: RequestInit) => {
        pedidos.push({ url, init });
        if (init.method !== 'DELETE') return respuestaJson(200, { ingreso_anterior: null });
        const respuesta = await new Promise<Response | Error>((r) => (responder = r));
        if (respuesta instanceof Error) throw respuesta;
        return respuesta;
      }) as unknown as typeof fetch;
      return { responder: (r: Response | Error) => act(async () => responder(r)), borrados: () => pedidos.filter((p) => p.init.method === 'DELETE') };
    }

    it('queda ocupado y habilitado para TalkBack, se ve como deshabilitado y el segundo toque no manda otro DELETE', async () => {
      const { responder, borrados } = fetchConDeleteEnEspera();
      const navegacion = await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));

      comprobarOcupado({ name: 'Cerrar sesión' });
      expect(screen.getByText('Cerrar sesión')).toHaveStyle({ color: tokens.color.accion.deshabilitada.texto });
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
      expect(borrados()).toHaveLength(1);
      expect(navegacion.dispatch).not.toHaveBeenCalled();

      await responder(respuestaJson(204));
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('Entrar')));
      expect(borrados()).toHaveLength(1);
    });

    it('sin conexión vuelve a quedar libre: sin «ocupado» y se puede intentar otra vez', async () => {
      const { responder, borrados } = fetchConDeleteEnEspera();
      await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
      comprobarOcupado({ name: 'Cerrar sesión' });

      await responder(new TypeError('Network request failed'));
      expect(await screen.findByText('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Cerrar sesión' }).props.accessibilityState).toEqual({ disabled: false });
      await fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
      expect(borrados()).toHaveLength(2);
    });
  });

  describe('«Borrar mi cuenta» (US-53)', () => {
    it('es un botón de texto debajo de «Cerrar sesión» que abre PN-69', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      const navegacion = await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      const botones = screen.getAllByRole('button');
      const lugar = (nombre: string) => botones.indexOf(screen.getByRole('button', { name: nombre }));
      expect(lugar('Borrar mi cuenta')).toBe(lugar('Cerrar sesión') + 1);
      await fireEvent.press(screen.getByRole('button', { name: 'Borrar mi cuenta' }));
      expect(navegacion.navigate).toHaveBeenCalledWith('BorrarCuenta');
    });
  });

  // E14-PCP 4.14, nota del 2026-11-08 (bug 260, USA-003) y 4.16 T2 ter: mientras no exista PN-66, la entrada provisional a
  // PN-63 desde el menú va arriba de «Cerrar sesión», y «Borrar mi cuenta» queda última, como en PN-66.
  describe('«Cómo cuidamos tus datos» (bug 260)', () => {
    it('es un botón con ese nombre accesible que abre PN-63 desde el menú', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      const navegacion = await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      await fireEvent.press(screen.getByRole('button', { name: 'Cómo cuidamos tus datos' }));
      expect(navegacion.navigate).toHaveBeenCalledWith('InformacionDePrivacidad', { desdeElMenu: true });
    });

    it('orden: «Movimientos», «Presupuesto» (E14-SDD v2.4), «Cómo cuidamos tus datos», «Cerrar sesión» y, última, «Borrar mi cuenta»', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      const botones = screen.getAllByRole('button');
      const orden = [
        'Movimientos',
        'Presupuesto',
        'Cómo cuidamos tus datos',
        'Política de tratamiento y consultas',
        'Cerrar sesión',
        'Borrar mi cuenta',
      ];
      expect(botones).toHaveLength(orden.length);
      orden.forEach((nombre, i) => expect(botones[i]).toBe(screen.getByRole('button', { name: nombre })));
    });

    it('también está con el error de carga', async () => {
      instalarFetchFalso(respuestaJson(500));
      await mostrar();
      await screen.findByText('No pudimos cargar tu último ingreso.');
      expect(screen.getByRole('button', { name: 'Cómo cuidamos tus datos' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Política de tratamiento y consultas' })).toBeOnTheScreen();
    });
  });

  // D-195 (E14-PCP 4.14 y 4.16 T2 ter): mientras no exista PN-66, la entrada provisional a PN-68 va a un lado de la de PN-63.
  describe('«Política de tratamiento y consultas» (D-195)', () => {
    it('es un botón de texto que abre PN-68 y no pide nada más al API', async () => {
      const { pedidos } = instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      const navegacion = await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      const politica = screen.getByRole('button', { name: 'Política de tratamiento y consultas' });
      expect(politica).toHaveStyle({ alignSelf: 'flex-start' });
      await fireEvent.press(politica);
      expect(navegacion.navigate).toHaveBeenCalledWith('Politica');
      expect(pedidos).toHaveLength(1);
    });
  });

  describe('«Movimientos» (US-52, D-164: la entrada a PN-01 donde estaba el botón provisional)', () => {
    it('abre PN-01 y ya no hay un botón para registrar', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      const navegacion = await mostrar();
      await screen.findByText('Este es tu primer ingreso.');
      expect(screen.queryByRole('button', { name: 'Registrar un movimiento' })).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Movimientos' }));
      expect(navegacion.navigate).toHaveBeenCalledWith('ListaDeMovimientos');
    });

    it('el aviso de después de guardar llega arriba como mensaje de estado, que TalkBack anuncia', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      await mostrar(undefined, { tipo: 'informacion', titulo: 'Listo, registramos tu gasto de $45.000.' });
      expect(await screen.findByText('Listo, registramos tu gasto de $45.000.')).toBeOnTheScreen();
      await esperarAnuncio('Listo, registramos tu gasto de $45.000.');
    });

    it('el aviso del registro gana sobre una llegada de las de siempre', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      await mostrar('contrasena_cambiada', { tipo: 'informacion', titulo: 'Listo, registramos tu ingreso de $1.000.' });
      expect(await screen.findByText('Listo, registramos tu ingreso de $1.000.')).toBeOnTheScreen();
      expect(screen.queryByText('Listo, cambiamos tu contraseña.')).not.toBeOnTheScreen();
    });
  });
});
