import { expect, test, type Locator, type Page } from "@playwright/test";
import { responder, simularApi, sinPendientes } from "./ayudas";

// Bug 305: una descripción larga y sin espacios (280 letras, el máximo del campo) debe partirse dentro de la fila de PN-01
// y del detalle de PN-02, sin salirse de la tarjeta ni causar desplazamiento horizontal (E14-SDD, «Un texto largo pasa a
// dos líneas; la fila crece y no recorta.»; E14-PPN, «Sin desplazamiento horizontal de 360 a 1920 px»).
const LARGA = "a".repeat(280);
const anchos = [360, 960, 1280];

// Hoy es el 2 de noviembre de 2026, a las 10:00 en Colombia.
async function hoyEs2DeNoviembre(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-02T15:00:00Z"));
}

type Movimiento = {
  id: string;
  tipo: "gasto";
  monto_centavos: string;
  fecha: string;
  categoria_id: number;
  medio: "efectivo" | "transferencia";
  descripcion: string | null;
  compartido: boolean;
  meta: null;
  sentido: null;
  recurrente: null;
};

const mercado: Movimiento = {
  id: "m9",
  tipo: "gasto",
  monto_centavos: "4500000",
  fecha: "2026-11-02",
  categoria_id: 1,
  medio: "efectivo",
  descripcion: "Mercado",
  compartido: false,
  meta: null,
  sentido: null,
  recurrente: null,
};

const catalogo = {
  gasto: [
    { id: 1, nombre: "Alimentación", general: false },
    { id: 16, nombre: "Otros gastos", general: true },
  ],
  ingreso: [{ id: 17, nombre: "Salario", general: false }],
};

/** El API simulado: guarda en memoria lo que «Registrar» crea y lo que «Corregir» cambia. */
async function api(page: Page, inicial: Movimiento[]) {
  let movimientos = [...inicial];
  await simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/repeticiones/pendientes": responder(200, sinPendientes),
    "GET /api/v1/movimientos": (ruta) =>
      responder(200, {
        periodo_actual: "2026-11",
        periodo: "2026-11",
        resumen: {
          movimientos: movimientos.length,
          total_centavos: null,
        },
        meses: movimientos.length > 0 ? ["2026-11"] : [],
        categorias: [],
        movimientos,
      })(ruta, undefined),
    "POST /api/v1/movimientos": (ruta, cuerpo) => {
      const c = cuerpo as Record<string, unknown>;
      movimientos = [
        {
          ...mercado,
          id: "nuevo",
          monto_centavos: String(c.monto_centavos),
          categoria_id: Number(c.categoria_id),
          descripcion: typeof c.descripcion === "string" ? c.descripcion : null,
        },
        ...movimientos,
      ];
      return responder(201, {
        movimiento_id: "nuevo",
        recurrente_id: null,
        proximas: [],
        pendientes: [],
      })(ruta, undefined);
    },
    "PUT /api/v1/movimientos/m9": (ruta, cuerpo) => {
      const c = cuerpo as Record<string, unknown>;
      movimientos = movimientos.map((m) =>
        m.id === "m9"
          ? {
              ...m,
              descripcion:
                typeof c.descripcion === "string" ? c.descripcion : null,
            }
          : m,
      );
      return responder(200, {})(ruta, undefined);
    },
  });
}

/** Pega 300 letras «a» en «Descripción»: el campo se queda con las 280 de su `maxLength`. */
async function escribirLaDescripcion(page: Page) {
  const campo = page.getByLabel("Descripción");
  await campo.fill("a".repeat(300));
  await expect(campo).toHaveValue(LARGA);
}

/**
 * Mide que `texto` (con el texto de la descripción) no se sale de `tarjeta` por la derecha, ni él ni su contenido, que la
 * página no tiene desplazamiento horizontal y que el texto está completo, sin recortar.
 */
async function sinSalirseDeLaTarjeta(texto: Locator) {
  await expect(texto).toBeVisible();
  const medidas = await texto.evaluate((el) => {
    const tarjeta = el.closest(".tarjeta");
    if (!tarjeta) throw new Error("La descripción no está en una tarjeta");
    const rango = document.createRange();
    rango.selectNodeContents(el);
    const estilo = getComputedStyle(el);
    const raiz = document.documentElement;
    return {
      tarjeta: tarjeta.getBoundingClientRect().right,
      elemento: el.getBoundingClientRect().right,
      contenido: rango.getBoundingClientRect().right,
      texto: el.textContent ?? "",
      recorta:
        estilo.textOverflow !== "clip" ||
        estilo.overflowX === "hidden" ||
        estilo.overflowX === "clip",
      documento: [raiz.scrollWidth, raiz.clientWidth],
      cuerpo: [document.body.scrollWidth, raiz.clientWidth],
    };
  });
  expect.soft(medidas.elemento).toBeLessThanOrEqual(medidas.tarjeta);
  expect.soft(medidas.contenido).toBeLessThanOrEqual(medidas.tarjeta);
  expect.soft(medidas.documento[0]).toBeLessThanOrEqual(medidas.documento[1]!);
  expect.soft(medidas.cuerpo[0]).toBeLessThanOrEqual(medidas.cuerpo[1]!);
  expect.soft(medidas.texto).toContain(LARGA);
  expect.soft(medidas.recorta).toBe(false);
}

/** La descripción larga en la fila de PN-01 y, abierta la fila, en el detalle de PN-02. */
async function enLaListaYEnElDetalle(page: Page) {
  const fila = page.getByRole("link", { name: new RegExp(LARGA) });
  await sinSalirseDeLaTarjeta(fila.locator(".fila__nombre"));
  await fila.click();
  const detalle = page.getByRole("region", { name: "Movimiento" });
  await sinSalirseDeLaTarjeta(detalle.locator("p", { hasText: LARGA }));
}

for (const ancho of anchos) {
  test.describe(`Descripción larga sin espacios a ${ancho} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 900 });
      await hoyEs2DeNoviembre(page);
    });

    test(`«Registrar»: la fila de PN-01 y el detalle de PN-02 la parten dentro de la tarjeta`, async ({
      page,
    }) => {
      await api(page, []);
      await page.goto("/movimientos");
      await page.getByRole("link", { name: "Registrar", exact: true }).click();
      await page.getByLabel("Monto").fill("45.000");
      await page.getByRole("radio", { name: "Otros gastos" }).check();
      await page.getByRole("radio", { name: "Efectivo" }).check();
      await escribirLaDescripcion(page);
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page).toHaveURL(/\/movimientos$/);

      await enLaListaYEnElDetalle(page);
    });

    test(`«Corregir»: la fila de PN-01 y el detalle de PN-02 la parten dentro de la tarjeta`, async ({
      page,
    }) => {
      await api(page, [mercado]);
      await page.goto("/movimientos");
      await page.getByRole("link", { name: /Mercado/ }).click();
      const detalle = page.getByRole("region", { name: "Movimiento" });
      await detalle.getByRole("button", { name: "Corregir" }).click();
      await escribirLaDescripcion(page);
      await page.getByRole("button", { name: "Guardar los cambios" }).click();
      await expect(page).toHaveURL(/\/movimientos\?periodo=2026-11$/);

      await enLaListaYEnElDetalle(page);
    });
  });
}
