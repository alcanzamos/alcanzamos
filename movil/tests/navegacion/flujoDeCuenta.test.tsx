import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { Navegacion } from '../../src/navegacion/Navegacion';
import { instalarFetchFalso, respuestaJson } from '../ayudas/fetchFalso';
import type { crearSecureStoreFalso } from '../ayudas/secureStoreFalso';

jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
jest.mock('expo-secure-store', () => jest.requireActual('../ayudas/secureStoreFalso').crearSecureStoreFalso());
const almacen = jest.requireMock('expo-secure-store') as ReturnType<typeof crearSecureStoreFalso>;
const abrir = DateTimePickerAndroid.open as jest.Mock;

const titulo = (nombre: string) => screen.queryByRole('header', { name: nombre });

async function elegirFecha(fecha: Date) {
  await fireEvent.press(screen.getByRole('button', { name: /Fecha de nacimiento/ }));
  await act(async () => {
    abrir.mock.calls.at(-1)[0].onValueChange({ nativeEvent: { timestamp: fecha.getTime(), utcOffset: 0 } }, fecha);
  });
}

// El Atrás de Android: React Navigation se suscribe a `BackHandler` y responde verdadero si lo manejó (volvió a la
// pantalla anterior) o falso si no (la app saldría). Aquí se guarda esa suscripción para tocar el Atrás de verdad.
const suscripciones = new Set<(evento: never) => boolean | null | undefined>();
const atras = (): boolean => [...suscripciones].reverse().some((alTocar) => alTocar(undefined as never));

describe('flujo de crear la cuenta en Android (PN-60 → PN-65 → PN-58 → PN-59)', () => {
  beforeEach(async () => {
    suscripciones.clear();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
      suscripciones.add(alTocar);
      return { remove: () => suscripciones.delete(alTocar) };
    });
    process.env.EXPO_PUBLIC_URL_API = 'http://api.prueba:18090';
    almacen.guardado.clear();
    await AsyncStorage.clear();
    abrir.mockReset();
  });

  it('abre en PN-60 y «Crear una cuenta» lleva a PN-65; el Atrás del sistema vuelve a PN-60', async () => {
    await render(<Navegacion />);
    expect(await screen.findByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear una cuenta' }));
    expect(await screen.findByRole('header', { name: 'Antes de empezar' })).toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(titulo('Antes de empezar')).not.toBeOnTheScreen());
    expect(titulo('Inicia sesión')).toBeOnTheScreen();
  });

  it('una persona adulta llega a PN-58 sin PN-65 detrás; el Atrás vuelve a PN-60 sin la fecha', async () => {
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Crear una cuenta' }));
    await screen.findByRole('header', { name: 'Antes de empezar' });
    await elegirFecha(new Date(1990, 4, 14));
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('header', { name: 'Crea tu cuenta' })).toBeOnTheScreen();
    expect(titulo('Antes de empezar')).not.toBeOnTheScreen();
    await act(async () => {
      expect(atras()).toBe(true);
    });
    await waitFor(() => expect(titulo('Crea tu cuenta')).not.toBeOnTheScreen());
    expect(titulo('Inicia sesión')).toBeOnTheScreen();
    expect(titulo('Antes de empezar')).not.toBeOnTheScreen();
  });

  async function crearHastaPN59(correo = 'laura@ejemplo.com') {
    await fireEvent.press(await screen.findByRole('button', { name: 'Crear una cuenta' }));
    await screen.findByRole('header', { name: 'Antes de empezar' });
    await elegirFecha(new Date(1990, 4, 14));
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('header', { name: 'Crea tu cuenta' });
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), correo);
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
    return screen.findByRole('header', { name: 'Revisa tu correo' });
  }

  it('crear la cuenta con solo el correo lleva a PN-59 sin sesión y desde ahí el Atrás sale de la app', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente' }));
    await render(<Navegacion />);
    expect(await crearHastaPN59()).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Te enviamos un correo a laura@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.',
      ),
    ).toBeOnTheScreen();
    expect(titulo('Crea tu cuenta')).not.toBeOnTheScreen();
    // Ningún pedido lleva la fecha de nacimiento ni la edad, y crear la cuenta no da sesión.
    expect(pedidos).toHaveLength(1);
    expect(JSON.parse(pedidos[0]?.init.body as string)).toEqual({ correo: 'laura@ejemplo.com', mayor_de_edad: true });
    expect(almacen.guardado.has('sesion')).toBe(false);
    await act(async () => {
      expect(atras()).toBe(false);
    });
  });

  it('«Usar otro correo» vuelve a PN-58 con lo escrito, y desde ahí crea la cuenta con la otra dirección', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(202, { estado: 'verificacion_pendiente' }),
      respuestaJson(202, { estado: 'verificacion_pendiente' }),
    );
    await render(<Navegacion />);
    await crearHastaPN59();
    await fireEvent.press(screen.getByRole('button', { name: 'Usar otro correo' }));
    expect(await screen.findByRole('header', { name: 'Crea tu cuenta' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Correo electrónico').props.value).toBe('laura@ejemplo.com');
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'otro@ejemplo.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(
      await screen.findByText(
        'Te enviamos un correo a otro@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.',
      ),
    ).toBeOnTheScreen();
    expect(pedidos).toHaveLength(2);
    expect(JSON.parse(pedidos[1]?.init.body as string)).toEqual({ correo: 'otro@ejemplo.com', mayor_de_edad: true });
  });

  it('«Ya elegí mi contraseña» (D-184) abre PN-60 con el correo escrito y entra con la contraseña elegida en el navegador', async () => {
    const { pedidos } = instalarFetchFalso(
      respuestaJson(202, { estado: 'verificacion_pendiente' }),
      respuestaJson(200, { estado: 'activa', token: 'tk-laura' }),
      respuestaJson(200, { ingreso_anterior: null }),
    );
    await render(<Navegacion />);
    await crearHastaPN59();
    await fireEvent.press(screen.getByRole('button', { name: 'Ya elegí mi contraseña' }));
    expect(await screen.findByRole('header', { name: 'Inicia sesión' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Correo electrónico').props.value).toBe('laura@ejemplo.com');
    expect(titulo('Revisa tu correo')).not.toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'lluvia café tren azul');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(almacen.guardado.get('sesion')).toBe('tk-laura'));
    expect(JSON.parse(pedidos[1]?.init.body as string)).toEqual({
      identificador: 'laura@ejemplo.com',
      contrasena: 'lluvia café tren azul',
    });
  });

  it('una persona menor de 18 se queda en PN-65 con el aviso y no llega a PN-58', async () => {
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Crear una cuenta' }));
    await screen.findByRole('header', { name: 'Antes de empezar' });
    await elegirFecha(new Date(new Date().getFullYear() - 10, 0, 1));
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Esta cuenta la crea una persona adulta.')).toBeOnTheScreen();
    expect(titulo('Crea tu cuenta')).not.toBeOnTheScreen();
  });
});
