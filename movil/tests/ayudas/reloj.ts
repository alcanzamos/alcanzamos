// Fija «hoy» sin parar los temporizadores: solo se falsea `Date`, así Testing Library sigue esperando con normalidad.
export function fijarHoy(hoy: Date) {
  jest.useFakeTimers({
    now: hoy,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}
