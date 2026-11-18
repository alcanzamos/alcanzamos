import { fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pedir } from "../src/api/cliente";
import { arrancar } from "../src/arranque";
import { json } from "./ayudas";

const ORIGEN = "https://api.alcanzamos.co";

let raiz: HTMLElement;
function nuevaRaiz() {
  raiz = document.createElement("div");
  raiz.id = "raiz";
  document.body.append(raiz);
  return raiz;
}
afterEach(() => raiz?.remove());

describe("arranque de la web", () => {
  it("lee /config.json antes de montar la app y desde ahí los pedidos van al API", async () => {
    const pedidos: string[] = [];
    let liberar: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((ruta: string) => {
        pedidos.push(ruta);
        return ruta === "/config.json"
          ? new Promise<Response>((resolver) => (liberar = resolver))
          : Promise.resolve(json(200, {}));
      }),
    );
    const listo = arrancar(nuevaRaiz());
    expect(pedidos).toEqual(["/config.json"]);
    expect(raiz).toBeEmptyDOMElement();

    liberar(json(200, { url_api: ORIGEN }));
    await listo;
    expect(
      await within(raiz).findByRole("heading", {
        level: 1,
        name: "Inicia sesión",
      }),
    ).toBeInTheDocument();

    await pedir("GET", "/api/v1/cuenta/seguridad");
    expect(pedidos).toEqual([
      "/config.json",
      `${ORIGEN}/api/v1/cuenta/seguridad`,
    ]);
  });

  it("si no puede leer la configuración falla a la vista, con el foco en el título y sin llamar al API", async () => {
    const pedidos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((ruta: string) => {
        pedidos.push(ruta);
        return Promise.resolve(new Response("", { status: 502 }));
      }),
    );
    await arrancar(nuevaRaiz());
    const titulo = await within(raiz).findByRole("heading", { level: 1 });
    expect(titulo).toHaveTextContent(
      "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
    );
    expect(titulo).toHaveFocus();
    expect(within(raiz).getByRole("main")).toBeInTheDocument();
    expect(
      within(raiz).queryByRole("heading", { name: "Inicia sesión" }),
    ).toBeNull();
    expect(pedidos).toEqual(["/config.json"]);
  });

  it("«Intentar de nuevo» vuelve a leer la configuración y, si llega, monta la app", async () => {
    let intento = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((ruta: string) =>
        Promise.resolve(
          ruta === "/config.json" && ++intento === 1
            ? new Response("", { status: 502 })
            : ruta === "/config.json"
              ? json(200, { url_api: ORIGEN })
              : json(200, {}),
        ),
      ),
    );
    await arrancar(nuevaRaiz());
    fireEvent.click(
      await within(raiz).findByRole("button", { name: "Intentar de nuevo" }),
    );
    expect(
      await within(raiz).findByRole("heading", { name: "Inicia sesión" }),
    ).toBeInTheDocument();
    expect(intento).toBe(2);
  });
});
