// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  enlaceALaPolitica,
  origenDeLaPolitica,
  VERSION_DE_LA_POLITICA,
} from "../src/politica";

// La política (PN-68) es texto de la web y su versión es un dato del API (`autorizacion.VersionActual`, RF-063): web y
// API se fusionan juntos (L3 de la US-67). Esta prueba lee el archivo de Go del mismo árbol y falla si se separan.
const servicio = fileURLToPath(
  new URL("../../api/src/autorizacion/servicio.go", import.meta.url),
);

describe("la versión de la política de la web", () => {
  it("es la versión vigente del API (autorizacion.VersionActual)", () => {
    const fuente = readFileSync(servicio, "utf8");
    const coincidencia =
      /VersionActual\s*=\s*Version\{Numero:\s*"([^"]+)",\s*Fecha:\s*"([^"]+)"\}/.exec(
        fuente,
      );
    expect(
      coincidencia,
      "no se encontró VersionActual en servicio.go",
    ).not.toBe(null);
    expect(VERSION_DE_LA_POLITICA).toEqual({
      numero: coincidencia?.[1],
      fecha: coincidencia?.[2],
    });
  });
});

describe("de dónde se abre la política (E14-PCP 4.11)", () => {
  it("el enlace lleva el origen codificado", () => {
    expect(enlaceALaPolitica("/autorizacion")).toBe(
      "/politica?desde=%2Fautorizacion",
    );
  });

  it.each([
    ["/entrar", "/entrar", false],
    ["/crear-cuenta", "/crear-cuenta", false],
    ["/privacidad", "/privacidad", false],
    ["/autorizacion", "/autorizacion", false],
    ["/cuenta/privacidad", "/cuenta/privacidad", true],
    ["/cuenta/seguridad", "/cuenta/seguridad", true],
  ])("desde %s: Atrás a %s, barra lateral %s", (desde, atras, lateral) => {
    expect(origenDeLaPolitica(new URLSearchParams({ desde }))).toEqual({
      atras,
      lateral,
    });
  });

  it.each([
    [""],
    ["desde="],
    ["desde=/movimientos"],
    ["desde=https://ejemplo.com"],
    ["desde=//ejemplo.com"],
    ["desde=javascript:alert(1)"],
    ["desde=/entrar&desde=/cuenta/seguridad"],
  ])(
    "«%s» no es un origen permitido: Atrás a /entrar y sin barra lateral",
    (busqueda) => {
      expect(origenDeLaPolitica(new URLSearchParams(busqueda))).toEqual({
        atras: "/entrar",
        lateral: false,
      });
    },
  );
});
