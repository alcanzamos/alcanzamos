// Preparación común de las pruebas: los márgenes del sistema (barra de estado, barra de gestos) no existen sin un
// dispositivo, así que se usa el mock oficial de react-native-safe-area-context. Una prueba puede cambiar los
// márgenes con `jest.mocked(useSafeAreaInsets).mockReturnValue(...)`.
jest.mock('react-native-safe-area-context', () => {
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...mock, useSafeAreaInsets: jest.fn(mock.useSafeAreaInsets) };
});

// AsyncStorage no tiene módulo nativo en las pruebas: se usa el mock oficial, en memoria.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);


// Las hojas inferiores se deslizan solas (`HojaInferior`) y con `useNativeDriver: true` Jest termina cada animación en el
// primer cuadro. Para que las pruebas de las pantallas vean la hoja abrirse y cerrarse al instante, como antes, aquí
// toda animación termina al empezar. Las pruebas del foco y de la hoja la toman a mano (`tests/ayudas/animacion.ts`).
import { Animated } from 'react-native';

beforeEach(() => {
  jest.spyOn(Animated, 'timing').mockImplementation(
    () =>
      ({
        start: (alTerminar?: (resultado: { finished: boolean }) => void) => alTerminar?.({ finished: true }),
        stop: () => undefined,
        reset: () => undefined,
      }) as unknown as Animated.CompositeAnimation,
  );
});
