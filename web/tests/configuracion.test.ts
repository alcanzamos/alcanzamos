import { describe, expect, it, vi } from "vitest";
import { pedir } from "../src/api/cliente";
import { cargarConfiguracion } from "../src/configuracion";
import { json, simularApi } from "./ayudas";

const ORIGEN = "https://api.alcanzamos.co";

function configuracion(respuesta: () => Response | Promise<Response>) {
  return simularApi((pedido) =>
    pedido.ruta === "/config.json" ? respuesta() : json(200, {}),
  );
}

/** Lo que `pedir` manda a `fetch`: la URL completa de la primera llamada que no es la de la configuración. */
const urlDelPedido = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([ruta]) => String(ruta))
    .find((ruta) => ruta !== "/config.json");

describe("configuración en tiempo de ejecución (/config.json)", () => {
  it("lee /config.json del mismo origen, sin guardarlo en caché", async () => {
    const pedidos = configuracion(() => json(200, { url_api: ORIGEN }));
    await cargarConfiguracion();
    expect(pedidos).toEqual([
      { metodo: "GET", ruta: "/config.json", cuerpo: undefined },
    ]);
    expect(fetch).toHaveBeenCalledWith("/config.json", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("después de cargarla, todo pedido va al origen del API", async () => {
    configuracion(() => json(200, { url_api: ORIGEN }));
    await cargarConfiguracion();
    await pedir("GET", "/api/v1/categorias");
    expect(urlDelPedido()).toBe(`${ORIGEN}/api/v1/categorias`);
  });

  it.each([
    ["con barra final", `${ORIGEN}/`],
    ["con un puerto", "http://localhost:8080"],
  ])("acepta un origen %s y no duplica la barra", async (_caso, url) => {
    configuracion(() => json(200, { url_api: url }));
    await cargarConfiguracion();
    await pedir("GET", "/api/v1/x");
    expect(urlDelPedido()).toBe(`${new URL(url).origin}/api/v1/x`);
  });

  it.each([
    ["el pedido no llega", () => Promise.reject(new TypeError("sin red"))],
    ["responde 500", () => new Response("", { status: 500 })],
    [
      "responde 404 con la página",
      () => new Response("<html>", { status: 404 }),
    ],
    ["no es JSON", () => new Response("<html>", { status: 200 })],
    ["es JSON sin url_api", () => json(200, {})],
    ["url_api no es texto", () => json(200, { url_api: 8080 })],
    ["url_api está vacía", () => json(200, { url_api: "" })],
    [
      "url_api no es una URL",
      () => json(200, { url_api: "api.alcanzamos.co" }),
    ],
    [
      "url_api no es http(s)",
      () => json(200, { url_api: "javascript:alert(1)" }),
    ],
    ["el JSON no es un objeto", () => json(200, "texto")],
  ])("falla si %s, y no deja un origen a medias", async (_caso, respuesta) => {
    configuracion(respuesta);
    await expect(cargarConfiguracion()).rejects.toThrow();
    // Sin configuración válida el cliente sigue en el mismo origen: nunca queda apuntando a algo que no se validó.
    await pedir("GET", "/api/v1/x");
    expect(urlDelPedido()).toBe("/api/v1/x");
  });
});
