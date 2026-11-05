// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hojasDe } from "../../../diseno/generar-textos.mjs";

// USA-004 (E18-PPR, RNF-015): ningún texto de la interfaz usa los términos excluidos del glosario de lenguaje. Los
// términos son la columna «No usar» del apéndice B de la ERS (E06, 01-especificacion-de-requisitos.md, líneas 363 a
// 371), copiados tal cual; las celdas con varios términos se separan por la coma. Se revisan todos los textos de
// es.json (comun, solo_web y solo_android) y cada forma de plural.
const noUsar = [
  "Transacción",
  "Egreso, débito",
  "Abono, crédito (como movimiento)",
  "Cuenta contable, asiento",
  "Liquidez, flujo de caja",
  "Déficit",
  "Morosidad",
];

const quitaAcentos = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// «Egreso, débito» son dos términos; lo que va entre paréntesis es la aclaración del glosario, no parte del término.
const terminos = noUsar
  .flatMap((celda) => celda.split(","))
  .map((t) => t.replace(/\(.*\)/, "").trim());

// Palabra completa, sin importar mayúsculas ni tildes, y con su plural (-s o -es).
const aparece = (termino: string, texto: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${quitaAcentos(termino)}(?:e?s)?(?![\\p{L}\\p{N}])`,
    "u",
  ).test(quitaAcentos(texto));

const json = JSON.parse(
  readFileSync(
    new URL("../../../diseno/textos/es.json", import.meta.url),
    "utf8",
  ),
) as Record<string, object>;

const textos = Object.entries(json).flatMap(([seccion, contenido]) =>
  hojasDe(contenido).flatMap(([nombre, h]) =>
    (typeof h.texto === "string"
      ? [h.texto]
      : Object.values(h.texto as Record<string, string>)
    ).map((t) => [`${seccion}.${nombre.join(".")}`, t] as const),
  ),
);

describe("USA-004 los textos de la interfaz no usan los términos excluidos del glosario", () => {
  it("USA-004 la lista de términos es la del apéndice B", () => {
    expect(terminos).toEqual([
      "Transacción",
      "Egreso",
      "débito",
      "Abono",
      "crédito",
      "Cuenta contable",
      "asiento",
      "Liquidez",
      "flujo de caja",
      "Déficit",
      "Morosidad",
    ]);
  });

  it("USA-004 revisa todos los textos de comun, solo_web y solo_android", () => {
    expect(textos.length).toBeGreaterThan(300);
    for (const seccion of ["comun", "solo_web", "solo_android"]) {
      expect(textos.some(([n]) => n.startsWith(`${seccion}.`))).toBe(true);
    }
  });

  it("USA-004 la comprobación detecta un término, con otra tilde, en plural o en mayúsculas", () => {
    expect(aparece("Transacción", "Tu transaccion de hoy")).toBe(true);
    expect(aparece("Transacción", "Tus TRANSACCIONES")).toBe(true);
    expect(aparece("Déficit", "Hay un deficit")).toBe(true);
    expect(aparece("Abono", "Abonos")).toBe(true);
    expect(aparece("Abono", "Un abonoextra")).toBe(false);
    expect(aparece("Liquidez", "Tu plata disponible")).toBe(false);
  });

  for (const termino of terminos) {
    it(`USA-004 ningún texto usa «${termino}»`, () => {
      const usos = textos
        .filter(([, texto]) => aparece(termino, texto))
        .map(([nombre, texto]) => `${nombre}: ${texto}`);
      expect(usos).toEqual([]);
    });
  }
});
