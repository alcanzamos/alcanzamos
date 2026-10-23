import { describe, expect, it, vi } from "vitest";
import { guardarCorreo, leerCorreo } from "../src/correoPendiente";

describe("correo pendiente", () => {
  it("guarda y lee el correo solo en esta pestaña", () => {
    expect(leerCorreo()).toBeNull();
    guardarCorreo("laura@ejemplo.com");
    expect(leerCorreo()).toBe("laura@ejemplo.com");
    expect(localStorage.length).toBe(0);
  });

  it("sin almacenamiento no falla", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("sin cuota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("sin acceso");
    });
    expect(() => guardarCorreo("laura@ejemplo.com")).not.toThrow();
    expect(leerCorreo()).toBeNull();
    vi.restoreAllMocks();
  });
});
