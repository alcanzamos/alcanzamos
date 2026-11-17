import { Animated } from 'react-native';
import { act } from '@testing-library/react-native';

// Con `useNativeDriver: true` Jest no corre las animaciones de verdad: terminan en el primer cuadro. Para probar qué pasa
// mientras una animación corre (y justo cuando termina) las pruebas la toman a mano: cada `Animated.timing` queda en
// espera hasta que la prueba lo termina con `terminarAnimaciones()`, igual que lo haría el final de la animación.

type Pendiente = { alTerminar?: (resultado: { finished: boolean }) => void };
let pendientes: Pendiente[] = [];

/** Desde aquí, las animaciones esperan a `terminarAnimaciones()`. Se deshace con `jest.restoreAllMocks()`. */
export function animacionesAMano() {
  pendientes = [];
  return jest.spyOn(Animated, 'timing').mockImplementation(() => {
    const pendiente: Pendiente = {};
    pendientes.push(pendiente);
    return {
      start: (alTerminar?: (resultado: { finished: boolean }) => void) => {
        pendiente.alTerminar = alTerminar;
      },
      stop: () => {
        pendientes = pendientes.filter((p) => p !== pendiente);
        pendiente.alTerminar?.({ finished: false });
      },
      reset: () => undefined,
      _startNativeLoop: () => undefined,
      _isUsingNativeDriver: () => true,
    } as unknown as Animated.CompositeAnimation;
  });
}

/** Cuántas animaciones están corriendo. */
export const animacionesEnCurso = () => pendientes.length;

/** Termina todas las animaciones que corren, como el final de la animación de verdad. */
export const terminarAnimaciones = () =>
  act(async () => {
    const terminan = pendientes;
    pendientes = [];
    terminan.forEach((p) => p.alTerminar?.({ finished: true }));
  });
