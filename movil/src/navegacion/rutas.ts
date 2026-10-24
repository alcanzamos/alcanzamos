import type { Llegada } from './llegada';

// Las pantallas de la pila y los parámetros de cada una. Cada rama de la US-49 suma las suyas.
// `llegada` es el aviso que la pantalla muestra arriba al llegar («Tu sesión se cerró…»): un texto de la lista
// de `llegada.ts`, nunca el texto mismo ni datos de la persona.
export type Rutas = {
  Entrar: { llegada?: Llegada } | undefined;
};
