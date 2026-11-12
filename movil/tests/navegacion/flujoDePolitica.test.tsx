import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { buscarCampo, campo } from '../ayudas/campos';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const abrirFecha = DateTimePickerAndroid.open as jest.Mock;
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;

// El Atrás de Android, como en flujoDeAutorizacion.test.tsx: verdadero si la pila lo manejó, falso si la app saldría.
const suscripciones = new Set<(evento: never) => boolean | null | undefined>();
const atras = (): boolean => [...suscripciones].reverse().some((alTocar) => alTocar(undefined as never));

const NECESARIAS = 'Autorizo el uso de mis datos para estas finalidades necesarias.';
const TRANSMISION =
  'Acepto que mis datos se envíen a estos servicios en México, Francia y Estados Unidos para guardarlos y procesarlos como se explica arriba.';
const catalogo = {
  version: { numero: '1.1', fecha: '2026-11-12' },
  modo: 'completo',
  finalidades: [
    { codigo: 'cuenta_y_acceso', tipo: 'necesaria', otorgada: false },
    { codigo: 'funciones_financieras', tipo: 'necesaria', otorgada: false },
    { codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false },
    { codigo: 'avisos', tipo: 'accesoria', otorgada: false },
    { codigo: 'horas_de_vida', tipo: 'accesoria', otorgada: false },
  ],
};
const catalogoLimitado = {
  ...catalogo,
  modo: 'falta_una_aceptacion',
  finalidades: [{ codigo: 'transmision_a_encargados', tipo: 'necesaria', otorgada: false }],
};

async function elegirFecha(fecha: Date) {
  await fireEvent.press(screen.getByRole('button', { name: /Fecha de nacimiento/ }));
  await act(async () => {
    abrirFecha.mock.calls.at(-1)[0].onValueChange({ nativeEvent: { timestamp: fecha.getTime(), utcOffset: 0 } }, fecha);
  });
}

const titulo = (nombre: string) => screen.queryByRole('header', { name: nombre });
const url = (p: { url: string }) => p.url.replace('http://api.prueba:18090', '');

describe('PN-68 · Política de tratamiento, con sus entradas (D-195, SC-E21-25)', () => {
  beforeEach(() => {
    suscripciones.clear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
      suscripciones.add(alTocar);
      return { remove: () => suscripciones.delete(alTocar) };
    });
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
  });

  it('sin sesión: PN-60 la abre, no pide nada al API, lleva su título en la barra y su Atrás vuelve a PN-60', async () => {
    const { fetchFalso } = instalarFetchFalso();
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Política de tratamiento y consultas' }));
    expect(await screen.findByText('Quién responde por tus datos')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).toContain('"title":"Política de tratamiento"');
    expect(screen.getByText(/^Versión/)).toHaveTextContent('Versión 1.1 del 12 de noviembre de 2026.', { exact: true });
    expect(fetchFalso).not.toHaveBeenCalled();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(titulo('Inicia sesión')).toBeOnTheScreen());
    expect(titulo('Quién responde por tus datos')).not.toBeOnTheScreen();
  });

  it('PN-58 la abre sin perder el correo escrito, y su Atrás vuelve a PN-58', async () => {
    instalarFetchFalso();
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Crear una cuenta' }));
    await screen.findByRole('header', { name: 'Antes de empezar' });
    await elegirFecha(new Date(1990, 4, 14));
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await fireEvent.changeText(await buscarCampo('Correo electrónico'), 'laura@ejemplo.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Política de tratamiento de datos' }));
    expect(await screen.findByText('Quién responde por tus datos')).toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(campo('Correo electrónico').props.value).toBe('laura@ejemplo.com'));
  });

  it('PN-63 en el primer uso la abre y su Atrás vuelve a PN-63; no se pierde «Continuar»', async () => {
    instalarFetchFalso(
      respuestaJson(200, { estado: 'ok', token: 'tk' }),
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogo),
    );
    await render(<Navegacion />);
    await fireEvent.changeText(await buscarCampo('Correo electrónico'), 'laura@ejemplo.com');
    await fireEvent.changeText(campo('Contraseña'), 'lluvia café tren azul');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await screen.findByRole('header', { name: 'Cómo cuidamos tus datos' });
    await fireEvent.press(screen.getByRole('button', { name: 'Leer la política completa' }));
    expect(await screen.findByText('Quién responde por tus datos')).toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(titulo('Cómo cuidamos tus datos')).toBeOnTheScreen());
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeOnTheScreen();
  });

  it('PN-64 la abre y, al volver, las casillas están como estaban y no se vuelve a pedir el catálogo', async () => {
    // El catálogo se pide dos veces: el acceso negado lo lee para elegir entre PN-63 y PN-64, y PN-64 lo pide al abrirse.
    const { pedidos } = instalarFetchFalso(
      respuestaJson(200, { estado: 'ok', token: 'tk' }),
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogo),
      respuestaJson(200, catalogo),
    );
    await render(<Navegacion />);
    await fireEvent.changeText(await buscarCampo('Correo electrónico'), 'laura@ejemplo.com');
    await fireEvent.changeText(campo('Contraseña'), 'lluvia café tren azul');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Continuar' }));
    await fireEvent.press(await screen.findByLabelText(NECESARIAS));
    await fireEvent.press(screen.getByLabelText(TRANSMISION));
    await fireEvent.press(screen.getByRole('button', { name: 'Leer la política completa' }));
    expect(await screen.findByText('Quién responde por tus datos')).toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: NECESARIAS, checked: true })).toBeOnTheScreen());
    expect(screen.getByRole('checkbox', { name: TRANSMISION, checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Autorizo los avisos con la app cerrada.', checked: false })).toBeOnTheScreen();
    expect(pedidos.map(url)).toEqual([
      '/api/v1/sesiones',
      '/api/v1/cuenta/seguridad',
      '/api/v1/autorizaciones',
      '/api/v1/autorizaciones',
    ]);
  });

  it('PN-71 la abre con sesión y su Atrás vuelve a PN-71', async () => {
    almacen.guardado.set('sesion', 'tk-activa');
    instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Política de tratamiento y consultas' }));
    expect(await screen.findByText('Quién responde por tus datos')).toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(screen.getByText('Este es tu primer ingreso.')).toBeOnTheScreen());
  });

  it('PN-63 desde el menú (PN-71) la abre y su Atrás vuelve a PN-63 y de ahí a PN-71', async () => {
    almacen.guardado.set('sesion', 'tk-activa');
    instalarFetchFalso(respuestaJson(200, { ingreso_anterior: null }));
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Cómo cuidamos tus datos' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Leer la política completa' }));
    expect(await screen.findByText('Quién responde por tus datos')).toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leer la política completa' })).toBeOnTheScreen());
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(screen.getByText('Este es tu primer ingreso.')).toBeOnTheScreen());
  });
});

// SC-E21-25 sección 5: la cuenta de antes del cambio entra, el API le niega todo menos PN-63 y PN-64, y la app la lleva
// a PN-64 con solo la tarjeta que le falta; al aceptar llega a PN-71 con todos sus datos (criterio 6).
describe('la cuenta de antes del cambio (SC-E21-25, sección 5)', () => {
  beforeEach(() => {
    suscripciones.clear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
      suscripciones.add(alTocar);
      return { remove: () => suscripciones.delete(alTocar) };
    });
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    almacen.guardado.set('sesion', 'tk-de-antes');
  });

  it('con la sesión abierta, el 403 la lleva a PN-64 en el modo limitado; al aceptar manda solo la transmisión y llega a PN-71', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogoLimitado),
      respuestaJson(200, catalogoLimitado),
      respuestaJson(200, { estado: 'autorizada' }),
      respuestaJson(200, { ingreso_anterior: '2026-11-10T14:00:00Z' }),
    );
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByLabelText(TRANSMISION));
    expect(titulo('Cómo cuidamos tus datos')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(NECESARIAS)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Autorizar y continuar' }));
    expect(await screen.findByText('Tu último ingreso')).toBeOnTheScreen();
    expect(pedidos.map((p) => `${p.init.method} ${url(p)}`)).toEqual([
      'GET /api/v1/cuenta/seguridad',
      'GET /api/v1/autorizaciones',
      'GET /api/v1/autorizaciones',
      'POST /api/v1/autorizaciones',
      'GET /api/v1/cuenta/seguridad',
    ]);
    expect(JSON.parse(String(pedidos[3]?.init.body))).toEqual({ finalidades: ['transmision_a_encargados'], version: '1.1' });
    expect(almacen.guardado.get('sesion')).toBe('tk-de-antes');
    // Después de aceptar, el Atrás no vuelve a PN-64: sale de la app.
    await act(async () => {
      expect(atras()).toBe(false);
    });
  });

  it('«No autorizo» abre la hoja de PN-54 y «Volver y decidir» la cierra: la cuenta y la sesión no cambian', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(403, { error: 'autorizacion_pendiente' }),
      respuestaJson(200, catalogoLimitado),
      respuestaJson(200, catalogoLimitado),
      respuestaJson(200, { hogar: null, menores: [] }),
    );
    await render(<Navegacion />);
    await screen.findByLabelText(TRANSMISION);
    await fireEvent.press(screen.getByRole('button', { name: 'No autorizo' }));
    expect(await screen.findByRole('header', { name: '¿No autorizas?' })).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Borrar mi cuenta' }));
    expect(await screen.findByText('Falta tu contraseña para borrar la cuenta.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver y decidir' }));
    await waitFor(() => expect(titulo('¿No autorizas?')).not.toBeOnTheScreen());
    expect(screen.getByLabelText(TRANSMISION)).toBeOnTheScreen();
    expect(pedidos.map((p) => `${p.init.method} ${url(p)}`)).toEqual([
      'GET /api/v1/cuenta/seguridad',
      'GET /api/v1/autorizaciones',
      'GET /api/v1/autorizaciones',
      'GET /api/v1/cuenta/borrado',
    ]);
    expect(almacen.guardado.get('sesion')).toBe('tk-de-antes');
  });
});
