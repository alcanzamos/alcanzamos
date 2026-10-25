import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

const titulo = (nombre: string) => screen.queryByRole('header', { name: nombre });

// El Atrás de Android, como en flujoDeCuenta.test.tsx: verdadero si la pila lo manejó, falso si la app saldría.
const suscripciones = new Set<(evento: never) => boolean | null | undefined>();
const atras = (): boolean => [...suscripciones].reverse().some((alTocar) => alTocar(undefined as never));

const catalogo = {
  version: { numero: '1.0', fecha: '2026-10-30' },
  finalidades: [
    { codigo: 'cuenta_y_acceso', tipo: 'necesaria', otorgada: false },
    { codigo: 'funciones_financieras', tipo: 'necesaria', otorgada: false },
    { codigo: 'avisos', tipo: 'accesoria', otorgada: false },
    { codigo: 'horas_de_vida', tipo: 'accesoria', otorgada: false },
  ],
};
const NECESARIAS = 'Autorizo el uso de mis datos para estas finalidades necesarias.';

async function entrarSinAutorizacion() {
  await fireEvent.changeText(await screen.findByLabelText('Correo electrónico'), 'laura@ejemplo.com');
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'lluvia café tren azul');
  await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
  await screen.findByRole('header', { name: 'Cómo cuidamos tus datos' });
}

const bearer = (pedido?: { init: RequestInit }) => (pedido?.init.headers as Record<string, string>).Authorization;

describe('flujo de autorizar los datos en Android (PN-60 → PN-63 → PN-64 → PN-71)', () => {
  beforeEach(() => {
    suscripciones.clear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
      suscripciones.add(alTocar);
      return { remove: () => suscripciones.delete(alTocar) };
    });
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
  });

  // S2 (dueño, 2026-10-24): «una persona nueva que entra, autoriza en PN-64 y llega a PN-71 en la misma sesión debe ver
  // «Este es tu primer ingreso.».»
  it('S2: una persona nueva que entra, autoriza en PN-64 y llega a PN-71 en la misma sesión ve «Este es tu primer ingreso.»', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(200, { estado: 'ok', token: 'tk-unico' }),
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogo),
      respuestaJson(200, { estado: 'autorizada' }),
      respuestaJson(200, { ingreso_anterior: null }),
    );
    await render(<Navegacion />);
    await entrarSinAutorizacion();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText('Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.');
    await fireEvent.press(screen.getByLabelText(NECESARIAS));
    await fireEvent.press(screen.getByRole('button', { name: 'Autorizar y continuar' }));
    expect(await screen.findByText('Este es tu primer ingreso.')).toBeOnTheScreen();

    // Una sola vez se inició sesión: autorizar sube de nivel la misma sesión, no vuelve a entrar.
    expect(pedidos.filter((p) => p.url.endsWith('/api/v1/sesiones') && p.init.method === 'POST')).toHaveLength(1);
    expect(pedidos.map((p) => `${p.init.method} ${p.url.replace('http://api.prueba:18090', '')}`)).toEqual([
      'POST /api/v1/sesiones',
      'GET /api/v1/cuenta/seguridad',
      'GET /api/v1/autorizaciones',
      'POST /api/v1/autorizaciones',
      'GET /api/v1/cuenta/seguridad',
    ]);
    // El pedido de autorizar y el de PN-71 llevan el mismo token que dio el inicio de sesión.
    expect(bearer(pedidos[3])).toBe('Bearer tk-unico');
    expect(bearer(pedidos[4])).toBe('Bearer tk-unico');
    expect(almacen.guardado.get('sesion')).toBe('tk-unico');
  });

  it('PN-63 es la primera de su pila: el Atrás del sistema sale de la app; PN-64 se apila y su Atrás vuelve a PN-63', async () => {
    instalarFetchFalso(
      respuestaJson(200, { estado: 'ok', token: 'tk' }),
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogo),
    );
    await render(<Navegacion />);
    await entrarSinAutorizacion();
    await act(async () => {
      expect(atras()).toBe(false);
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText(NECESARIAS);
    // El título «Tu autorización» es el de la barra nativa (Atrás del sistema), no un encabezado de la pantalla.
    expect(JSON.stringify(screen.toJSON())).toContain('"title":"Tu autorización"');
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText(NECESARIAS)).not.toBeOnTheScreen());
    expect(titulo('Cómo cuidamos tus datos')).toBeOnTheScreen();
  });

  it('tras autorizar, el Atrás no vuelve a PN-64 ni a PN-63: sale de la app', async () => {
    instalarFetchFalso(
      respuestaJson(200, { estado: 'ok', token: 'tk' }),
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogo),
      respuestaJson(200, { estado: 'autorizada' }),
      respuestaJson(200, { ingreso_anterior: null }),
    );
    await render(<Navegacion />);
    await entrarSinAutorizacion();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText(NECESARIAS);
    await fireEvent.press(screen.getByLabelText(NECESARIAS));
    await fireEvent.press(screen.getByRole('button', { name: 'Autorizar y continuar' }));
    await screen.findByText('Este es tu primer ingreso.');
    expect(screen.queryByText(NECESARIAS)).not.toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(false);
    });
  });

  it('«No autorizo» borra el token, lleva a PN-60 con «Borramos el correo que nos diste.» y el Atrás sale de la app', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(200, { estado: 'ok', token: 'tk' }),
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogo),
      respuestaJson(204),
    );
    await render(<Navegacion />);
    await entrarSinAutorizacion();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText(NECESARIAS);
    await fireEvent.press(screen.getByRole('button', { name: 'No autorizo' }));
    expect(await screen.findByText('Borramos el correo que nos diste.')).toBeOnTheScreen();
    expect(screen.getByText('Sin tu autorización no creamos la cuenta. Puedes empezar de nuevo cuando quieras.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(almacen.guardado.has('sesion')).toBe(false);
    expect(pedidos.at(-1)?.url).toBe('http://api.prueba:18090/api/v1/autorizaciones/rechazo');
    await act(async () => {
      expect(atras()).toBe(false);
    });
    expect(screen.queryByText(NECESARIAS)).not.toBeOnTheScreen();
  });
});
