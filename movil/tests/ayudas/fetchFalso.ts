// Un fetch que no sale a la red: responde con lo que la prueba le da, en orden, y guarda cada pedido.
export type PedidoGuardado = { url: string; init: RequestInit };

export function respuestaJson(estado: number, cuerpo?: unknown): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    // El cliente lee el texto y lo pasa por JSON.parse (los `*_centavos` de 64 bits no pasan por un `number`).
    text: async () => {
      if (cuerpo === undefined) throw new Error('sin cuerpo');
      return typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    },
  } as Response;
}

export function instalarFetchFalso(...respuestas: (Response | Error)[]) {
  const pedidos: PedidoGuardado[] = [];
  const cola = [...respuestas];
  const fetchFalso = jest.fn(async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    const siguiente = cola.shift();
    if (siguiente === undefined) throw new Error('fetch sin respuesta preparada');
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  });
  global.fetch = fetchFalso as unknown as typeof fetch;
  return { pedidos, fetchFalso };
}
