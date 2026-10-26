import { describe, expect, it } from "vitest";
import { avisoDeLlegada, irConAviso, irConMensaje } from "../src/llegada";
import { avisos } from "../src/textos";

describe("aviso de llegada", () => {
  it("sin aviso no hay nada", () => {
    expect(avisoDeLlegada()).toBeNull();
  });

  it.each([
    ["sesion_cerrada", avisos.sesionCerrada],
    ["correo_confirmado", avisos.correoConfirmado],
    ["contrasena_recuperada", avisos.contrasenaRecuperada],
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

  it("un mensaje con datos viaja entero en el historial", () => {
    const aviso = {
      tipo: "informacion",
      titulo: "Listo, registramos tu gasto de $45.000.",
    } as const;
    irConMensaje("/cuenta/seguridad", aviso);
    expect(window.location.pathname).toBe("/cuenta/seguridad");
    expect(avisoDeLlegada()).toEqual(aviso);
    const conMensaje = { ...aviso, mensaje: "Más" };
    irConMensaje("/cuenta/seguridad", conMensaje);
    expect(avisoDeLlegada()).toEqual(conMensaje);
  });

  it("ignora un mensaje del historial que no tiene la forma de un aviso", () => {
    for (const aviso of [
      "texto",
      { tipo: "otro", titulo: "x" },
      { tipo: "logro" },
      { tipo: "logro", titulo: "x", mensaje: 3 },
    ]) {
      window.history.replaceState({ aviso }, "", "/");
      expect(avisoDeLlegada()).toBeNull();
    }
  });
});
