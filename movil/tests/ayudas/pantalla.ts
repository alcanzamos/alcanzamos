import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Rutas } from '../../src/navegacion/rutas';

/** Un `navigation` falso (cada método es un `jest.fn`) para probar una pantalla sin la pila de verdad. */
export function navegacionFalsa() {
  return {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    popTo: jest.fn(),
    setParams: jest.fn(),
    setOptions: jest.fn(),
  };
}

/** Las propiedades que la pila le pasa a una pantalla. */
export function propiedades<N extends keyof Rutas>(
  nombre: N,
  navegacion: ReturnType<typeof navegacionFalsa>,
  params?: Rutas[N],
): NativeStackScreenProps<Rutas, N> {
  return { navigation: navegacion, route: { key: nombre, name: nombre, params } } as unknown as NativeStackScreenProps<
    Rutas,
    N
  >;
}
