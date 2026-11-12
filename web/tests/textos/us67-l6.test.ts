// @vitest-environment node
// S2, S5, S6: decisiones L6.2 y L6.5.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const data = JSON.parse(
  readFileSync(
    new URL("../../../diseno/textos/es.json", import.meta.url),
    "utf8",
  ),
);
const p = data.comun.politica ?? data.solo_web.politica;

it("L6.2: textos exactos, quinta viñeta y aprobación", () => {
  expect(p.dondeGuardamos.items.avisos?.texto).toBe(
    "Para los avisos con la app cerrada, tu teléfono o tu navegador nos da un código. En Android lo maneja Firebase Cloud Messaging, de Google; en la web, el servicio de avisos de tu navegador (Web Push). Todavía no confirmamos en qué país guardan ese código.",
  );
  expect(Object.keys(p.dondeGuardamos.items)).toHaveLength(5);
  expect(Object.keys(p.dondeGuardamos.items).at(-1)).toBe("avisos");
  expect(p.consultas.adolescentes?.texto).toBe(
    "Si tienes entre 12 y 17 años, puedes escribirnos tú o pedirle a quien te acompaña que escriba por ti.",
  );
  expect(p.responsable.proyecto.texto).toBe(
    "Alcanzamos, proyecto de Andrés Jiménez.",
  );
  expect(p.responsable.proyecto.e14).toMatch(/^Aprobado/);
  expect(p.responsable.proyecto.e14).not.toMatch(/Propuesto/);
});

it("L6.5: cada marcador de PN-36 documenta la sustitución", () => {
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
