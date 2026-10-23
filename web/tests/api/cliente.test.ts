import { describe, expect, it, vi } from "vitest";
import { SIN_CONEXION, pedir } from "../../src/api/cliente";
import { json, simularApi } from "../ayudas";

describe("cliente del API", () => {
  it("usa rutas relativas, la cookie del mismo origen y JSON", async () => {
    simularApi(() => json(202, { estado: "ok" }));
    const respuesta = await pedir("POST", "/api/v1/cuentas", { a: 1 });
    expect(respuesta).toEqual({
      ok: true,
      estado: 202,
      cuerpo: { estado: "ok" },
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/cuentas", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: '{"a":1}',
    });
  });

  it("un pedido sin cuerpo no manda Content-Type", async () => {
    simularApi(() => json(200, {}));
    await pedir("GET", "/api/v1/cuentas/estado");
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/json",
    });
  });

  it("da el código de error y los errores de campo del API", async () => {
    simularApi(() =>
      json(422, {
        error: "validacion",
        campos: { correo: "correo_vacio", x: 3 },
      }),
    );
    expect(await pedir("POST", "/api/v1/cuentas", {})).toEqual({
      ok: false,
      estado: 422,
      codigo: "validacion",
      campos: { correo: "correo_vacio" },
    });
  });

  it("una respuesta sin JSON o sin código es un error desconocido", async () => {
    simularApi(() => new Response("<html>", { status: 502 }));
    expect(await pedir("GET", "/api/v1/x")).toEqual({
      ok: false,
      estado: 502,
      codigo: "desconocido",
      campos: {},
    });
  });

  it("un cuerpo que no es un objeto se trata como vacío", async () => {
    simularApi(() => json(400, "texto"));
    const respuesta = await pedir("GET", "/api/v1/x");
    expect(respuesta).toMatchObject({ ok: false, codigo: "desconocido" });
  });

  it("sin conexión devuelve el código sin_conexion con estado 0", async () => {
    simularApi(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await pedir("GET", "/api/v1/x")).toEqual({
      ok: false,
      estado: 0,
      codigo: SIN_CONEXION,
      campos: {},
    });
  });
});
