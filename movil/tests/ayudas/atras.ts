import { act } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

// El Atrás de Android: la pila lo escucha con `BackHandler`. `atras()` devuelve verdadero si la pila lo manejó y falso si
// la app saldría (nadie lo manejó).
const suscripciones = new Set<(evento: never) => boolean | null | undefined>();

export function instalarAtras() {
  suscripciones.clear();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_evento, alTocar) => {
    suscripciones.add(alTocar);
    return { remove: () => suscripciones.delete(alTocar) };
  });
}

export async function atras(): Promise<boolean> {
  let manejado = false;
  await act(async () => {
    manejado = [...suscripciones].reverse().some((alTocar) => alTocar(undefined as never));
  });
  return manejado;
}
