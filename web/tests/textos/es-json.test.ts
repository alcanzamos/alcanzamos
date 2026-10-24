// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generar,
  generarDesdeArchivos,
  hojasDe,
  hojasDeLaPlataforma,
  marcadoresDe,
} from "../../../diseno/generar-textos.mjs";

const ruta = (archivo: string) =>
  new URL(`../../../diseno/textos/${archivo}`, import.meta.url);
const json = JSON.parse(readFileSync(ruta("es.json"), "utf8")) as Record<
  string,
  object
>;
const hoja = (texto: unknown) => ({ texto, e14: "E14-PCP 4.1" });

const textosDe = (seccion: object) =>
  hojasDe(seccion).flatMap(([nombre, h]) =>
    typeof h.texto === "string"
      ? [[nombre.join("."), h.texto] as const]
      : Object.values(h.texto).map((f) => [nombre.join("."), f] as const),
  );

describe("diseno/textos/es.json", () => {
  it("tiene las secciones comun, solo_web y solo_android, y nada más", () => {
    expect(Object.keys(json).sort()).toEqual([
      "comun",
      "solo_android",
      "solo_web",
    ]);
  });

  it("cada hoja tiene texto y referencia de E14, y un plural solo one y other", () => {
    for (const seccion of Object.values(json)) {
      for (const [nombre, h] of hojasDe(seccion)) {
        expect(h.e14, nombre.join(".")).toMatch(/E14/);
      }
    }
  });

  it("todo {…} es un marcador de nombre válido y no hay llaves sin cerrar", () => {
    const textos = Object.values(json).flatMap(textosDe);
    expect(textos.length).toBeGreaterThan(50);
    for (const [nombre, texto] of textos) {
      const sinMarcadores = texto.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "");
      expect(sinMarcadores, `${nombre}: «${texto}»`).not.toMatch(/[{}]/);
    }
  });

  it("los dos lados de un plural llevan los mismos marcadores", () => {
    for (const seccion of Object.values(json)) {
      for (const [nombre, h] of hojasDe(seccion)) {
        if (typeof h.texto === "string") continue;
        const sinN = (t: string) => marcadoresDe(t).filter((m) => m !== "n");
        expect(sinN(h.texto.one), nombre.join(".")).toEqual(
          sinN(h.texto.other),
        );
      }
    }
  });

  it("ningún texto está en comun y en una sección de plataforma", () => {
    expect(() => hojasDeLaPlataforma(json, "web")).not.toThrow();
    expect(() => hojasDeLaPlataforma(json, "android")).not.toThrow();
  });

  it("src/textos/es.generated.ts es lo que genera el generador (npm run textos)", () => {
    const actual = readFileSync(
      new URL("../../src/textos/es.generated.ts", import.meta.url),
      "utf8",
    );
    expect(actual).toBe(generarDesdeArchivos("web"));
  });
});

describe("generador de textos", () => {
  it.each([
    ["una llave sin cerrar", "Hola {nombre", /Llaves sin cerrar/],
    ["una llave de cierre suelta", "Hola nombre}", /Llaves sin cerrar/],
    ["un marcador vacío", "Hola {}", /Marcador inválido/],
    ["un marcador con espacio", "Hola {mi nombre}", /Marcador inválido/],
    ["llaves anidadas", "Hola {{nombre}}", /Marcador inválido|Llaves/],
  ])("rechaza %s", (_caso, texto, error) => {
    expect(() => hojasDe({ x: hoja(texto) })).toThrow(error);
  });

  it("rechaza una hoja sin referencia de E14 y una clave de más", () => {
    expect(() => hojasDe({ x: { texto: "Hola", e14: "" } })).toThrow(
      /referencia/,
    );
    expect(() =>
      hojasDe({ x: { texto: "Hola", e14: "E14", otra: "no" } }),
    ).toThrow(/claves de más/);
  });

  it("rechaza un plural con formas de más o con marcadores distintos", () => {
    expect(() =>
      hojasDe({ x: hoja({ one: "{n} a", other: "{n} b", few: "{n} c" }) }),
    ).toThrow(/one.*other/);
    expect(() =>
      hojasDe({ x: hoja({ one: "{n} a de {x}", other: "{n} b" }) }),
    ).toThrow(/marcadores distintos/);
  });

  it("rechaza el mismo texto en comun y en la sección de la plataforma", () => {
    const repetido = {
      comun: { a: hoja("Hola") },
      solo_web: { a: hoja("Hola") },
    };
    expect(() => hojasDeLaPlataforma(repetido, "web")).toThrow(/comun/);
  });

  it("rechaza una plataforma desconocida", () => {
    expect(() => generar({}, "ios" as never, "")).toThrow(/desconocida/);
  });

  it("cada plataforma recibe comun y su sección, y no la de la otra", () => {
    const base = {
      comun: { a: hoja("Común") },
      solo_web: { b: hoja("Web") },
      solo_android: { c: hoja("Android") },
    };
    const web = generar(base, "web", "// ayudas");
    expect(web).toContain('a: "Común"');
    expect(web).toContain('b: "Web"');
    expect(web).not.toContain("Android");
    const android = generar(base, "android", "// ayudas");
    expect(android).toContain('c: "Android"');
    expect(android).not.toContain('"Web"');
    expect(android).toMatch(/^\/\/ Archivo generado por `npm run textos`/);
    expect(android.endsWith("// ayudas")).toBe(true);
  });
});
