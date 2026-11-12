import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seguirPorAccesoNegado } from "../src/accesoNegado";
import { avisoDeLlegada } from "../src/llegada";
import { avisos } from "../src/textos";
import { json, simularApi } from "./ayudas";

const fallo = (estado: number, codigo: string) =>
  ({ ok: false, estado, codigo, campos: {} }) as const;

describe("acceso negado", () => {
  it("401 lleva a entrar con «Tu sesión se cerró»", () => {
    expect(seguirPorAccesoNegado(fallo(401, "sin_sesion"))).toBe(true);
    expect(window.location.pathname).toBe("/entrar");
    expect(avisoDeLlegada()).toBe(avisos.sesionCerrada);
  });

  // SC-E21-25 sección 5, paso 2: la cuenta de antes del cambio ve PN-64 con la tarjeta que le falta; la persona nueva
  // ve primero PN-63 (RNF-011). El helper lo sabe preguntando el modo al API; sigue devolviendo verdadero de inmediato.
  describe("403 autorizacion_pendiente", () => {
    const catalogo = (modo: string) => ({
      version: { numero: "1.1", fecha: "2026-11-12" },
      modo,
      finalidades: [
        {
          codigo: "transmision_a_encargados",
          tipo: "necesaria",
          otorgada: false,
        },
      ],
    });
    const pendiente = fallo(403, "autorizacion_pendiente");

    it("con el modo falta_una_aceptacion va directo a PN-64", async () => {
      const pedidos = simularApi(() =>
        json(200, catalogo("falta_una_aceptacion")),
      );
      expect(seguirPorAccesoNegado(pendiente)).toBe(true);
      await waitFor(() =>
        expect(window.location.pathname).toBe("/autorizacion"),
      );
      expect(pedidos).toEqual([
        { metodo: "GET", ruta: "/api/v1/autorizaciones", cuerpo: undefined },
      ]);
    });

    it("con el modo completo lleva a PN-63", async () => {
      simularApi(() => json(200, catalogo("completo")));
      expect(seguirPorAccesoNegado(pendiente)).toBe(true);
      await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    });

    it.each([
      ["un modo que no conoce", () => json(200, catalogo("otro"))],
      ["un catálogo sin modo", () => json(200, { finalidades: [] })],
      ["un 500", () => json(500, { error: "interno" })],
      ["un 403", () => json(403, { error: "autorizacion_pendiente" })],
      [
        "sin conexión",
        () => {
          throw new TypeError("sin red");
        },
      ],
    ])("%s: lleva a PN-63, como siempre", async (_caso, respuesta) => {
      simularApi(respuesta);
      expect(seguirPorAccesoNegado(pendiente)).toBe(true);
      await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    });

    it("si la sesión ya no existe (401) lleva a PN-60 con «Tu sesión se cerró»", async () => {
      simularApi(() => json(401, { error: "sin_sesion" }));
      expect(seguirPorAccesoNegado(pendiente)).toBe(true);
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(avisoDeLlegada()).toBe(avisos.sesionCerrada);
    });
  });

  it.each([
    fallo(500, "interno"),
    fallo(429, "demasiados_intentos"),
    fallo(403, "otro"),
    // D-172: una cuenta sin verificar no tiene sesión; PN-59 ya no es destino de ningún acceso negado.
    fallo(403, "verificacion_pendiente"),
    fallo(0, "sin_conexion"),
  ])("lo demás no mueve a nadie", (respuesta) => {
    expect(seguirPorAccesoNegado(respuesta)).toBe(false);
    expect(window.location.pathname).toBe("/");
  });
});
