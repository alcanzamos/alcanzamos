import { describe, expect, it } from "vitest";
import { formatearPesos } from "./dinero";

describe("formatearPesos", () => {
  it("muestra pesos enteros sin centavos", () => {
    expect(formatearPesos(8000000)).toBe("$80.000");
    expect(formatearPesos(120000000)).toBe("$1.200.000");
  });

  it("muestra los centavos con coma cuando no son cero", () => {
    expect(formatearPesos(12345678)).toBe("$123.456,78");
    expect(formatearPesos(5)).toBe("$0,05");
    expect(formatearPesos(150)).toBe("$1,50");
  });

  it("muestra cero", () => {
    expect(formatearPesos(0)).toBe("$0");
  });

  it("agrupa montos grandes", () => {
    expect(formatearPesos(123456789000)).toBe("$1.234.567.890");
    expect(formatearPesos(99900)).toBe("$999");
    expect(formatearPesos(100000)).toBe("$1.000");
  });

  it("pone el signo antes del peso en montos negativos", () => {
    expect(formatearPesos(-8000000)).toBe("-$80.000");
    expect(formatearPesos(-12345678)).toBe("-$123.456,78");
  });

  it("no muestra «-$0» para cero negativo", () => {
    expect(formatearPesos(-0)).toBe("$0");
  });

  it("rechaza montos que no son centavos enteros", () => {
    expect(() => formatearPesos(80.5)).toThrow(RangeError);
    expect(() => formatearPesos(Number.NaN)).toThrow(RangeError);
    expect(() => formatearPesos(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
