import { describe, expect, it } from "vitest";
import { avisoDeFallo, avisos, textoDeErrorDeCampo } from "../src/textos";

const fallo = (estado: number, codigo: string) =>
  ({ ok: false, estado, codigo, campos: {} }) as const;

const generico = { tipo: "informacion", titulo: "Genérico" } as const;

describe("textos de E14", () => {
  it.each([
    ["correo_vacio", "Falta el correo electrónico."],
    [
      "correo_invalido",
      "Falta completar el correo. Por ejemplo, nombre@correo.com.",
    ],
  ])("el código %s da su texto", (codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo)).toBe(texto);
  });

  it("un código sin texto en E14 no inventa uno", () => {
    expect(textoDeErrorDeCampo("desconocido")).toBeUndefined();
  });

  it("T1 y T10 (E14-PCP 4.16) son los textos aprobados, palabra por palabra", () => {
    expect(avisos.demasiadosIntentos.titulo).toBe(
      "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
    );
    expect(avisos.sinConexion.titulo).toBe(
      "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
    );
  });

  it("avisoDeFallo distingue sin conexión, demasiados intentos y el resto", () => {
    expect(avisoDeFallo(fallo(0, "sin_conexion"), generico)).toBe(
      avisos.sinConexion,
    );
    expect(avisoDeFallo(fallo(429, "demasiados_intentos"), generico)).toBe(
      avisos.demasiadosIntentos,
    );
    expect(avisoDeFallo(fallo(500, "x"), generico)).toBe(generico);
  });
});
