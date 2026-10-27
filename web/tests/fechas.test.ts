import { describe, expect, it, vi } from "vitest";
import {
  diaEnPalabras,
  esFechaDeMovimiento,
  fechaEnPalabras,
  hoyEnColombia,
  mesAnterior,
  mesEnPalabras,
  relativoDelDia,
} from "../src/fechas";

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

describe("hoyEnColombia", () => {
  // Las mismas fechas que TestHoyEnColombiaEsUTCMenosCinco del API.
  it.each([
    ["2026-10-26T04:59:59Z", "2026-10-25"],
    ["2026-10-26T05:00:00Z", "2026-10-26"],
    ["2026-10-27T04:59:59Z", "2026-10-26"],
    ["2026-12-31T23:00:00Z", "2026-12-31"],
    ["2027-01-01T04:00:00Z", "2026-12-31"],
  ])("a las %s en Colombia es %s", (utc, hoy) => {
    expect(hoyEnColombia(new Date(utc))).toBe(hoy);
  });

  it("sin argumento usa el reloj", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
    expect(hoyEnColombia()).toBe("2026-10-26");
  });
});

describe("esFechaDeMovimiento", () => {
  it("acepta una fecha real desde 1900, también una futura", () => {
    expect(esFechaDeMovimiento("2026-12-20")).toBe(true);
    expect(esFechaDeMovimiento("1900-01-01")).toBe(true);
  });

  it("rechaza lo que el API rechaza", () => {
    expect(esFechaDeMovimiento("")).toBe(false);
    expect(esFechaDeMovimiento("2026-02-30")).toBe(false);
    expect(esFechaDeMovimiento("1899-12-31")).toBe(false);
    expect(esFechaDeMovimiento("0002-10-26")).toBe(false);
  });
});

describe("relativoDelDia (los títulos de día de PN-01)", () => {
  it("hoy, ayer y cualquier otro día, también al cambiar de mes y de año", () => {
    expect(relativoDelDia("2026-11-02", "2026-11-02")).toBe("hoy");
    expect(relativoDelDia("2026-11-01", "2026-11-02")).toBe("ayer");
    expect(relativoDelDia("2026-10-31", "2026-11-01")).toBe("ayer");
    expect(relativoDelDia("2026-12-31", "2027-01-01")).toBe("ayer");
    expect(relativoDelDia("2026-10-31", "2026-11-02")).toBeNull();
    expect(relativoDelDia("2026-11-03", "2026-11-02")).toBeNull();
  });
});

describe("mesEnPalabras y mesAnterior (los chips de periodo de PN-01)", () => {
  it("escribe el mes con mayúscula y, si se pide, con el año", () => {
    expect(mesEnPalabras("2026-11")).toBe("Noviembre");
    expect(mesEnPalabras("2026-12", true)).toBe("Diciembre de 2026");
    expect(mesEnPalabras("2026-01", true)).toBe("Enero de 2026");
  });

  it.each(["", "2026", "2026-13", "2026-00", "2026-1", "2026-11-02"])(
    "«%s» no es un periodo",
    (periodo) => {
      expect(mesEnPalabras(periodo)).toBeNull();
    },
  );

  it("el mes anterior pasa de enero al diciembre del año anterior", () => {
    expect(mesAnterior("2026-11")).toBe("2026-10");
    expect(mesAnterior("2026-10")).toBe("2026-09");
    expect(mesAnterior("2026-01")).toBe("2025-12");
  });
});
