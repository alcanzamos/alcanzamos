import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  formatear,
  plural,
  textos,
  type Datos,
  type Marcadores,
} from "../../src/textos/es.generated";

// Tipos: `tsc --noEmit` (npm run typecheck) revisa esta carpeta, así que cada `@ts-expect-error` falla si el
// compilador deja de ver el error que se espera.
describe("formatear (S3: marcadores {nombre})", () => {
  it("pone cada dato en su marcador, también si el marcador se repite", () => {
    expect(
      formatear("Te enviamos un enlace a {correo}.", {
        correo: "laura@ejemplo.com",
      }),
    ).toBe("Te enviamos un enlace a laura@ejemplo.com.");
    expect(formatear("{a} y {b} y {a}", { a: "1", b: "2" })).toBe("1 y 2 y 1");
  });

  it("un texto sin marcadores se usa sin datos", () => {
    expect(formatear(textos.pagina.atras)).toBe("Atrás");
  });

  it("no vuelve a interpretar las llaves de un dato", () => {
    expect(formatear("Hola {nombre}", { nombre: "{otro}" })).toBe(
      "Hola {otro}",
    );
  });

  it("los marcadores se leen del tipo del texto", () => {
    // Se comprueba con tsc (typecheck); en ejecución solo vale que el texto exista.
    expect(textos.seguridadDeLaCuenta.ingresoAnterior).toMatch(/\{fecha\}/);
    expectTypeOf<Marcadores<"{a} y {b}">>().toEqualTypeOf<"a" | "b">();
    expectTypeOf<Marcadores<"sin marcadores">>().toBeNever();
    expectTypeOf<
      Datos<typeof textos.seguridadDeLaCuenta.ingresoAnterior>
    >().toEqualTypeOf<{ fecha: string }>();
  });

  it("falta un marcador: error de tipo y de ejecución", () => {
    expect(() =>
      // @ts-expect-error falta el dato «fecha»
      formatear(textos.seguridadDeLaCuenta.ingresoAnterior, {}),
    ).toThrow(/faltan \[fecha\] y sobran \[\]/);
    expect(() =>
      // @ts-expect-error faltan los datos de «{correo}»
      formatear(textos.revisaTuCorreo.enviadoA),
    ).toThrow(/faltan \[correo\]/);
  });

  it("sobra un dato: error de tipo y de ejecución", () => {
    expect(() =>
      formatear(textos.seguridadDeLaCuenta.ingresoAnterior, {
        fecha: "hoy",
        // @ts-expect-error «dia» no es un marcador del texto
        dia: "lunes",
      }),
    ).toThrow(/faltan \[\] y sobran \[dia\]/);
    expect(() =>
      // @ts-expect-error un texto sin marcadores no recibe datos
      formatear(textos.pagina.atras, { x: "y" }),
    ).toThrow(/sobran \[x\]/);
  });

  it("un dato con otro nombre cuenta como uno que falta y otro que sobra", () => {
    expect(() =>
      formatear(textos.revisaTuCorreo.enviadoA, {
        // @ts-expect-error el marcador es «correo», no «mail»
        mail: "laura@ejemplo.com",
      }),
    ).toThrow(/faltan \[correo\] y sobran \[mail\]/);
  });
});

describe("plural (S4, D-163: one y other con la regla manual del español)", () => {
  const ingresos = textos.porConfirmar.ingresos;

  it.each([
    [0, "0 ingresos"],
    [1, "1 ingreso"],
    [2, "2 ingresos"],
    [13, "13 ingresos"],
    [1000000, "1000000 ingresos"],
  ])("con %d da «%s»", (n, esperado) => {
    expect(plural(ingresos, n)).toBe(esperado);
  });

  it("solo el 1 es «one»; 0, 2 y los millones son «other»", () => {
    expect(plural(ingresos, 1)).toBe("1 ingreso");
    for (const n of [0, 2, 13, 1000000]) {
      expect(plural(ingresos, n)).toBe(`${n} ingresos`);
    }
  });

  it("no usa Intl.PluralRules: ni la consulta ni la necesita (Hermes no la trae)", () => {
    const select = vi.spyOn(Intl.PluralRules.prototype, "select");
    for (const n of [0, 1, 2, 13, 1000000]) plural(ingresos, n);
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
  });

  it("una forma puede no llevar {n}", () => {
    const formas = { one: "Un ingreso", other: "{n} ingresos" } as const;
    expect(plural(formas, 1)).toBe("Un ingreso");
    expect(plural(formas, 3)).toBe("3 ingresos");
  });

  it("pide los demás marcadores del texto, ni más ni menos", () => {
    const formas = {
      one: "{n} cosa de {quien}",
      other: "{n} cosas de {quien}",
    } as const;
    expect(plural(formas, 2, { quien: "Laura" })).toBe("2 cosas de Laura");
    // @ts-expect-error falta el dato «quien»
    expect(() => plural(formas, 2)).toThrow(/faltan \[quien\]/);
    // @ts-expect-error «otro» no es un marcador del plural
    expect(() => plural(formas, 1, { quien: "Laura", otro: "x" })).toThrow(
      /sobran \[otro\]/,
    );
  });
});
