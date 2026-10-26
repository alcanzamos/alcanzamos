import { CommonActions } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { cambiarBorrador, useBorrador } from '../../src/borradorDeRegistro';
import { SeguridadDeLaCuenta } from '../../src/pantallas/SeguridadDeLaCuenta';
import type { DatosDeAviso } from '../../src/textos';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
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

    it('403 verificacion_pendiente → PN-59', async () => {
      instalarFetchFalso(respuestaJson(403, { error: 'verificacion_pendiente' }));
      const navegacion = await mostrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('RevisaTuCorreo')));
    });

    it('403 autorizacion_pendiente → PN-63', async () => {
      instalarFetchFalso(respuestaJson(403, { error: 'autorizacion_pendiente' }));
      const navegacion = await mostrar();
      await waitFor(() => expect(navegacion.dispatch).toHaveBeenCalledWith(reinicio('InformacionDePrivacidad')));
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

  describe('«Registrar un movimiento» (US-51, D-164: botón provisional hasta que exista PN-01)', () => {
    it('abre el formulario con un borrador vacío', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      cambiarBorrador({ monto: '45.000', periodicidad: 'mensual' });
      let monto = '';
      function Espia() {
        monto = useBorrador().monto;
        return null;
      }
      const navegacion = navegacionFalsa();
      await render(
        <>
          <SeguridadDeLaCuenta {...propiedades('SeguridadDeLaCuenta', navegacion)} />
          <Espia />
        </>,
      );
      await screen.findByText('Este es tu primer ingreso.');
      expect(monto).toBe('45.000');
      await fireEvent.press(screen.getByRole('button', { name: 'Registrar un movimiento' }));
      expect(navegacion.navigate).toHaveBeenCalledWith('FormularioDeRegistro');
      expect(monto).toBe('');
    });

    it('el aviso de después de guardar llega arriba como mensaje de estado, que TalkBack anuncia', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      await mostrar(undefined, { tipo: 'informacion', titulo: 'Listo, registramos tu gasto de $45.000.' });
      expect(await screen.findByText('Listo, registramos tu gasto de $45.000.')).toBeOnTheScreen();
      expect(JSON.stringify(screen.toJSON())).toContain('"accessibilityLiveRegion":"polite"');
    });

    it('el aviso del registro gana sobre una llegada de las de siempre', async () => {
      instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
      await mostrar('contrasena_cambiada', { tipo: 'informacion', titulo: 'Listo, registramos tu ingreso de $1.000.' });
      expect(await screen.findByText('Listo, registramos tu ingreso de $1.000.')).toBeOnTheScreen();
      expect(screen.queryByText('Listo, cambiamos tu contraseña.')).not.toBeOnTheScreen();
    });
  });
});
