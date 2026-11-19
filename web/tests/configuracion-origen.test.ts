import { describe, expect, it, vi } from "vitest";
import { pedir } from "../src/api/cliente";
import { descargarMisDatos } from "../src/api/cuentas";
import { cargarConfiguracion } from "../src/configuracion";
import { json } from "./ayudas";

// De `url_api` solo vale el origen: un `config.json` con usuario, ruta, consulta o fragmento no puede mandar la cookie
// de sesión ni el ZIP a otro lado que el origen del API (E11-INF 2.16).
describe("origen del API tomado de /config.json", () => {
  it.each([
    [
      "https://usuario:clave@api.example.test/base?destino=otro#fragmento",
      "https://api.example.test",
    ],
    ["http://localhost:8080/base?x=1#fragmento", "http://localhost:8080"],
  ])("usa solo el origen de %s para JSON y ZIP", async (url_api, origen) => {
    const llamadas: [string, RequestInit | undefined][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (ruta: string, opciones?: RequestInit) => {
        llamadas.push([ruta, opciones]);
        if (ruta === "/config.json") return json(200, { url_api });
        if (ruta.endsWith("/cuenta/datos"))
          return new Response(new Uint8Array([0x50, 0x4b]), {
            status: 200,
            headers: { "Content-Type": "application/zip" },
          });
        return json(200, {});
      }),
    );

    await cargarConfiguracion();
    await pedir("GET", "/api/v1/categorias");
    const descarga = await descargarMisDatos();
    expect(descarga.ok).toBe(true);

    expect(llamadas.map(([ruta]) => ruta)).toEqual([
      "/config.json",
      `${origen}/api/v1/categorias`,
      `${origen}/api/v1/cuenta/datos`,
    ]);
    const [config, api, zip] = llamadas.map(([, opciones]) => opciones);
    // La configuración es del mismo origen que la web, nunca en caché y sin la cookie de sesión.
    expect(config?.cache).toBe("no-store");
    expect(config?.credentials).not.toBe("include");
    // Las llamadas al API sí llevan la cookie.
    expect(api?.credentials).toBe("include");
    expect(zip?.credentials).toBe("include");
  });
});
