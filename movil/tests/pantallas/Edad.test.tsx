import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Edad } from '../../src/pantallas/Edad';
import { DURACION_DEL_RECUERDO_MS } from '../../src/edad/recuerdo';
import { instalarFetchFalso } from '../ayudas/fetchFalso';
import { navegacionFalsa, propiedades } from '../ayudas/pantalla';
import { fijarHoy } from '../ayudas/reloj';

jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: jest.fn() } }));
const abrir = DateTimePickerAndroid.open as jest.Mock;

const HOY = new Date(2026, 9, 23, 12, 0, 0);

async function mostrar() {
  const navegacion = navegacionFalsa();
  await render(<Edad {...propiedades('Edad', navegacion)} />);
  await screen.findByText('Escribe tu fecha de nacimiento.').catch(() => undefined);
  return navegacion;
}

async function elegir(fecha: Date) {
  await fireEvent.press(screen.getByRole('button', { name: /Fecha de nacimiento/ }));
  await act(async () => {
    abrir.mock.calls.at(-1)[0].onChange({ type: 'set' }, fecha);
  });
}

const continuar = () => fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));

describe('PN-65 · Edad (E14-PCP 4.8)', () => {
  beforeEach(async () => {
    fijarHoy(HOY);
    abrir.mockReset();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('estado «Vacío»: logo, título, frase, campo vacío con su ayuda y «Continuar»', async () => {
    await mostrar();
    expect(screen.getByRole('image', { name: 'Alcanzamos' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Antes de empezar' })).toBeOnTheScreen();
    expect(screen.getByText('Escribe tu fecha de nacimiento.')).toBeOnTheScreen();
    expect(screen.getByText('Fecha de nacimiento')).toBeOnTheScreen();
    expect(screen.getByText('La usamos solo para mostrarte la pantalla que sigue. No la guardamos.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeOnTheScreen();
  });

  it('es neutral: no dice qué edad se necesita ni sugiere un año ni fija fechas máxima o mínima', async () => {
    await mostrar();
    expect(screen.queryByText(/18|años|mayor|menor/)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Fecha de nacimiento' }));
    expect(abrir.mock.calls[0][0]).not.toHaveProperty('maximumDate');
    expect(abrir.mock.calls[0][0]).not.toHaveProperty('minimumDate');
  });

  it('sin fecha, «Continuar» dice «Falta la fecha de nacimiento.» y no sigue', async () => {
    const navegacion = await mostrar();
    await continuar();
    expect(screen.getByText('Falta la fecha de nacimiento.')).toBeOnTheScreen();
    expect(navegacion.replace).not.toHaveBeenCalled();
  });

  it('con una fecha que no ha pasado dice «Falta una fecha que ya haya pasado.» y no sigue', async () => {
    const navegacion = await mostrar();
    await elegir(new Date(2026, 9, 24));
    await continuar();
    expect(screen.getByText('Falta una fecha que ya haya pasado.')).toBeOnTheScreen();
    expect(navegacion.replace).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('edad.resultado')).toBeNull();
  });

  it('elegir otra fecha quita el error', async () => {
    await mostrar();
    await continuar();
    expect(screen.getByText('Falta la fecha de nacimiento.')).toBeOnTheScreen();
    await elegir(new Date(1990, 4, 14));
    expect(screen.queryByText('Falta la fecha de nacimiento.')).not.toBeOnTheScreen();
    expect(screen.getByText('1990')).toBeOnTheScreen();
  });

  it('la fecha elegida se muestra en palabras («14 de mayo de 1990»)', async () => {
    await mostrar();
    await elegir(new Date(1990, 4, 14));
    expect(screen.getByRole('button', { name: 'Fecha de nacimiento, 14 de mayo de 1990' })).toBeOnTheScreen();
  });

  describe('persona adulta', () => {
    it.each([
      ['de 36 años', new Date(1990, 4, 14)],
      ['que cumple 18 hoy', new Date(2008, 9, 23)],
    ])('%s sigue a PN-58 con la edad comprobada, reemplazando PN-65', async (_caso, fecha) => {
      const navegacion = await mostrar();
      await elegir(fecha);
      await continuar();
      expect(navegacion.replace).toHaveBeenCalledWith('CrearCuenta', { mayorDeEdad: true });
    });

    it('no guarda nada: ni resultado, ni fecha, ni edad', async () => {
      await mostrar();
      await elegir(new Date(1990, 4, 14));
      await continuar();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(await AsyncStorage.getAllKeys()).toEqual([]);
    });

    it('no hace ningún pedido a la red', async () => {
      const { fetchFalso } = instalarFetchFalso();
      await mostrar();
      await elegir(new Date(1990, 4, 14));
      await continuar();
      expect(fetchFalso).not.toHaveBeenCalled();
    });
  });

  describe('menos de 18 años (D-090)', () => {
    const elegirMenor = async () => {
      await mostrar();
      await elegir(new Date(2008, 9, 24));
      await continuar();
    };

    it('18 mañana: muestra el aviso, sin campo ni «Continuar», y no sigue', async () => {
      const navegacion = await mostrar();
      await elegir(new Date(2008, 9, 24));
      await continuar();
      expect(screen.getByText('Esta cuenta la crea una persona adulta.')).toBeOnTheScreen();
      expect(
        screen.getByText('Tu mamá, papá o tutor crea tu cuenta desde la suya y te da tu usuario.'),
      ).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: /Fecha de nacimiento/ })).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeOnTheScreen();
      expect(navegacion.replace).not.toHaveBeenCalled();
    });

    it('no muestra «Ya tengo un usuario: iniciar sesión» (D-137): en la US-49 PN-60 no acepta usuario', async () => {
      await elegirMenor();
      expect(screen.queryByText(/Ya tengo un usuario/)).not.toBeOnTheScreen();
      expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    });

    it('recuerda solo el resultado y la hora (24 horas), nunca la fecha ni la edad', async () => {
      await elegirMenor();
      await waitFor(async () => expect(await AsyncStorage.getAllKeys()).toEqual(['edad.resultado']));
      const guardado = JSON.parse((await AsyncStorage.getItem('edad.resultado')) as string);
      expect(guardado).toEqual({ resultado: 'menor', hasta: HOY.getTime() + DURACION_DEL_RECUERDO_MS });
      expect(JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()))).not.toMatch(
        /2008|2026-10|años/,
      );
    });

    it('no hace ningún pedido a la red', async () => {
      const { fetchFalso } = instalarFetchFalso();
      await elegirMenor();
      expect(fetchFalso).not.toHaveBeenCalled();
    });

    it('«Resultado recordado»: al abrirla de nuevo dentro de las 24 horas muestra el aviso, sin campo', async () => {
      await AsyncStorage.setItem(
        'edad.resultado',
        JSON.stringify({ resultado: 'menor', hasta: HOY.getTime() + DURACION_DEL_RECUERDO_MS - 1000 }),
      );
      await render(<Edad {...propiedades('Edad', navegacionFalsa())} />);
      expect(await screen.findByText('Esta cuenta la crea una persona adulta.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: /Fecha de nacimiento/ })).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeOnTheScreen();
    });

    it('pasadas las 24 horas vuelve a abrir en «Vacío»', async () => {
      await AsyncStorage.setItem('edad.resultado', JSON.stringify({ resultado: 'menor', hasta: HOY.getTime() - 1000 }));
      await render(<Edad {...propiedades('Edad', navegacionFalsa())} />);
      expect(await screen.findByRole('button', { name: 'Continuar' })).toBeOnTheScreen();
      expect(screen.queryByText('Esta cuenta la crea una persona adulta.')).not.toBeOnTheScreen();
    });
  });

  it('si la pantalla se cierra antes de leer el recuerdo, no actualiza nada', async () => {
    await render(<Edad {...propiedades('Edad', navegacionFalsa())} />);
    await screen.unmount();
  });
});
