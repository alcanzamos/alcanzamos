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

  it('crear la cuenta lleva a PN-59 y desde ahí el Atrás sale de la app (no vuelve al formulario)', async () => {
    const { pedidos } = instalarFetchFalso(respuestaJson(202, { estado: 'verificacion_pendiente', token: 'tk' }));
    await render(<Navegacion />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Crear una cuenta' }));
    await screen.findByRole('header', { name: 'Antes de empezar' });
    await elegirFecha(new Date(1990, 4, 14));
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('header', { name: 'Crea tu cuenta' });
    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'laura@ejemplo.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'lluvia café tren azul');
    await fireEvent.changeText(screen.getByLabelText('Nombre para mostrar'), 'Laura');
    await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('header', { name: 'Revisa tu correo' })).toBeOnTheScreen();
    expect(
      screen.getByText('Te enviamos un enlace a laura@ejemplo.com. Ábrelo para confirmar tu cuenta.'),
    ).toBeOnTheScreen();
    expect(titulo('Crea tu cuenta')).not.toBeOnTheScreen();
    // Ningún pedido lleva la fecha de nacimiento ni la edad.
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.init.body).not.toMatch(/1990|nacimiento|fecha|"edad"/i);
    expect(almacen.guardado.get('sesion')).toBe('tk');
    await act(async () => {
      expect(atras()).toBe(false);
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
