import { describe, expect, it } from "vitest";
import { avisoDeLlegada, irConAviso } from "../src/llegada";
import { avisos } from "../src/textos";

describe("aviso de llegada", () => {
  it("sin aviso no hay nada", () => {
    expect(avisoDeLlegada()).toBeNull();
  });

  it.each([
    ["sesion_cerrada", avisos.sesionCerrada],
    ["correo_confirmado", avisos.correoConfirmado],
    ["contrasena_cambiada", avisos.contrasenaCambiada],
  ] as const)(
    "%s llega a su destino sin dejar la pantalla anterior",
    (llegada, aviso) => {
      irConAviso("/entrar", llegada);
      expect(window.location.pathname).toBe("/entrar");
      expect(avisoDeLlegada()).toBe(aviso);
    },
  );

  it("ignora un estado del historial que no es de la app", () => {
    window.history.replaceState({ llegada: "otra" }, "", "/");
    expect(avisoDeLlegada()).toBeNull();
    window.history.replaceState("texto", "", "/");
    expect(avisoDeLlegada()).toBeNull();
  });
});
