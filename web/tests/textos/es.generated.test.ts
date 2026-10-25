import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
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

describe("plural (S4: one y other con Intl.PluralRules)", () => {
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

  it("en español 1000000 es «many» para Intl.PluralRules y aquí cae en «other»", () => {
    // Node 26 (ICU 78) da «many» para los millones exactos; otra versión de ICU puede dar «other». Las dos van a «other».
    expect(["many", "other"]).toContain(new Intl.PluralRules("es").select(1e6));
    expect(plural(ingresos, 1e6)).toBe("1000000 ingresos");
    expect(plural(ingresos, 2e6)).toBe("2000000 ingresos");
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

  // Hermes (Android) no trae Intl.PluralRules (facebook/hermes#1462); el helper es el mismo en las dos apps y no
  // puede caerse al cargar en una plataforma sin ella (la web de hoy sí la tiene: se prueba la rama).
  describe("sin Intl.PluralRules", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    it.each([0, 1, 2, 13, 1000000])(
      "carga y da lo mismo que con Intl.PluralRules con %d",
      async (n) => {
        vi.stubGlobal("Intl", { ...Intl, PluralRules: undefined });
        vi.resetModules();
        const sinIntl = await import("../../src/textos/es.generated");
        expect(typeof Intl.PluralRules).toBe("undefined");
        expect(sinIntl.plural(sinIntl.textos.porConfirmar.gastos, n)).toBe(
          plural(textos.porConfirmar.gastos, n),
        );
      },
    );
  });
});
