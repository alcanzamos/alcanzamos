import { describe, expect, it } from "vitest";
import { diaEnPalabras, fechaEnPalabras } from "../src/fechas";

describe("fechaEnPalabras", () => {
  it("da la fecha de E14 en la hora de Colombia (D-090)", () => {
    // 2026-11-02 02:40 UTC es el 1 de noviembre a las 9:40 p. m. en Bogotá.
    expect(fechaEnPalabras("2026-11-02T02:40:00Z")).toBe(
      "el 1 de noviembre de 2026, a las 9:40 p. m.",
    );
  });

  it("de mañana usa a. m. y dos dígitos en los minutos", () => {
    expect(fechaEnPalabras("2026-11-02T13:05:00Z")).toBe(
      "el 2 de noviembre de 2026, a las 8:05 a. m.",
    );
  });

  it("la medianoche y el mediodía son las 12", () => {
    expect(fechaEnPalabras("2026-03-10T05:00:00Z")).toBe(
      "el 10 de marzo de 2026, a las 12:00 a. m.",
    );
    expect(fechaEnPalabras("2026-03-10T17:30:00Z")).toBe(
      "el 10 de marzo de 2026, a las 12:30 p. m.",
    );
  });

  it("la una va en singular", () => {
    expect(fechaEnPalabras("2026-12-31T18:07:00Z")).toBe(
      "el 31 de diciembre de 2026, a la 1:07 p. m.",
    );
  });

  it("no cambia de día con el horario del navegador: el 1 de enero a las 11 p. m. sigue siendo 31 de diciembre en UTC", () => {
    expect(fechaEnPalabras("2027-01-01T04:00:00Z")).toBe(
      "el 31 de diciembre de 2026, a las 11:00 p. m.",
    );
  });

  it("devuelve null si no es una fecha", () => {
    expect(fechaEnPalabras("ayer")).toBeNull();
  });
});

describe("diaEnPalabras", () => {
  it("escribe una fecha AAAA-MM-DD en palabras, sin hora y sin ceros (D-090)", () => {
    expect(diaEnPalabras("2026-10-30")).toBe("30 de octubre de 2026");
    expect(diaEnPalabras("2027-01-05")).toBe("5 de enero de 2027");
  });

  it.each([
    "",
    "30 de octubre",
    "2026-10-30T00:00:00Z",
    "2026-13-01",
    "2026-00-10",
    "2026-02-30",
  ])("«%s» no es una fecha: null", (entrada) => {
    expect(diaEnPalabras(entrada)).toBeNull();
  });
});
