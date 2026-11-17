// @vitest-environment node
// Textos de la política (PN-68) y de la aceptación expresa (PN-64) de la US-67, tal como los aprobó el dueño.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const data = JSON.parse(
  readFileSync(
    new URL("../../../diseno/textos/es.json", import.meta.url),
    "utf8",
  ),
);
const p = data.comun.politica;
const a = data.comun.autorizacion;

it("«Dónde guardamos tus datos» no tiene entrada propia de avisos y el texto viejo no existe", () => {
  expect(Object.keys(p.dondeGuardamos.items)).toHaveLength(4);
  expect(p.dondeGuardamos.items.avisos).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain(
    "Todavía no confirmamos en qué país guardan ese código.",
  );
});

it("la quinta viñeta de PN-68 es la frase aprobada de los avisos de PN-64, con su nota de E14", () => {
  expect(a.fraseDeAvisos.texto).toBe(
    "Si activas los avisos con la app cerrada, el código de tu teléfono o de tu navegador y un aviso que solo dice «Tienes un aviso en Alcanzamos.» pasan por el servicio de notificaciones de Google (Firebase Cloud Messaging) en Android, o por el de la empresa que hace tu navegador en la web. Esas empresas no dicen en qué país los procesan.",
  );
  expect(a.fraseDeAvisos.e14).toContain(
    "y en la viñeta de los avisos de PN-68 (fila 5 b, SC-E21-25 sección 4)",
  );
  expect(a.fraseDeAvisos.e14).not.toContain("por decisión del dueño");
});

it("la frase para quienes tienen entre 12 y 17 años cierra «Cómo hacer una consulta o un reclamo»", () => {
  expect(p.consultas.adolescentes.texto).toBe(
    "Si tienes entre 12 y 17 años, puedes escribirnos tú o pedirle a quien te acompaña que escriba por ti.",
  );
});

it("el responsable es «Alcanzamos, proyecto de Andrés Jiménez.» y está aprobado", () => {
  expect(p.responsable.proyecto.texto).toBe(
    "Alcanzamos, proyecto de Andrés Jiménez.",
  );
  expect(p.responsable.proyecto.e14).toMatch(/^Aprobado/);
  expect(p.responsable.proyecto.e14).not.toMatch(/Propuesto/);
});

it("la tarjeta «Dónde guardamos tus datos» tiene una nota propia para el modo «falta una aceptación» y conserva la de siempre", () => {
  expect(a.dondeGuardamos.nota.texto).toBe(
    "Sin esta aceptación no podemos darte la cuenta, porque la app guarda tus datos en esos servicios.",
  );
  expect(a.dondeGuardamos.notaFaltaUnaAceptacion.texto).toBe(
    "Sin esta aceptación no puedes seguir usando la app, porque guarda tus datos en esos servicios.",
  );
  expect(a.dondeGuardamos.notaFaltaUnaAceptacion.e14).toMatch(/^Aprobado/);
});

it("cada texto con {nombre} de PN-36 dice que reemplaza a «{nombre del menor}» de P-3", () => {
  let count = 0;
  const visit = (value: unknown) => {
    const x = value as Record<string, unknown>;
    if (typeof x.texto === "string") {
      if (x.texto.includes("{nombre}")) {
        count++;
        expect(x.e14).toContain(
          "{nombre} reemplaza a «{nombre del menor}» de P-3 porque el generador de textos no admite espacios dentro de un marcador",
        );
      }
    } else {
      Object.values(x).forEach(visit);
    }
  };
  visit(data.solo_android.crearCuentaDelMenor);
  expect(count).toBe(6);
});
