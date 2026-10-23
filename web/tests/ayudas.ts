import { vi } from "vitest";

export type Pedido = { metodo: string; ruta: string; cuerpo: unknown };

/** Una respuesta del API simulada: estado y cuerpo JSON (o ninguno). */
export const json = (estado: number, cuerpo?: unknown) =>
  new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Simula `fetch` (la única frontera con el API). `responder` recibe cada pedido y devuelve la respuesta;
 * lanzar un error simula que no hay conexión. Devuelve la lista de pedidos hechos.
 */
export function simularApi(
  responder: (pedido: Pedido) => Response | Promise<Response>,
) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (ruta: string, opciones?: RequestInit) => {
      const pedido = {
        metodo: opciones?.method ?? "GET",
        ruta,
        cuerpo: opciones?.body ? JSON.parse(String(opciones.body)) : undefined,
      };
      pedidos.push(pedido);
      return responder(pedido);
    }),
  );
  return pedidos;
}

/** Para `getByText` con un texto partido en varios nodos (los números van en su propio `span`, D-123). */
export const porTexto =
  (texto: string) => (_contenido: string, elemento: Element | null) =>
    elemento?.textContent === texto &&
    !Array.from(elemento.children).some((hijo) => hijo.textContent === texto);
