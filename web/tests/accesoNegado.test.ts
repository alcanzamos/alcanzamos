import { describe, expect, it } from "vitest";
import { seguirPorAccesoNegado } from "../src/accesoNegado";
import { avisoDeLlegada } from "../src/llegada";
import { avisos } from "../src/textos";

const fallo = (estado: number, codigo: string) =>
  ({ ok: false, estado, codigo, campos: {} }) as const;

describe("acceso negado", () => {
  it("401 lleva a entrar con «Tu sesión se cerró»", () => {
    expect(seguirPorAccesoNegado(fallo(401, "sin_sesion"))).toBe(true);
    expect(window.location.pathname).toBe("/entrar");
    expect(avisoDeLlegada()).toBe(avisos.sesionCerrada);
  });

  it("403 autorizacion_pendiente lleva a PN-63", () => {
    expect(seguirPorAccesoNegado(fallo(403, "autorizacion_pendiente"))).toBe(
      true,
    );
    expect(window.location.pathname).toBe("/privacidad");
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
