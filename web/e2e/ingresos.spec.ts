import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";
import {
  apiDeIngresos,
  apiDePresupuesto,
  casos,
  hoyEs2DeNoviembre,
} from "./datosDePresupuesto";

// PN-08 (E14-PPA 4.3) contra el API simulado con E14-PPA 2.4: Laura en noviembre y diciembre, el caso P en octubre.
test.beforeEach(async ({ page }) => {
  await hoyEs2DeNoviembre(page);
});

const tarjeta = (page: Page, nombre: string) =>
  page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: nombre }),
  });
const periodo = (page: Page) => page.getByRole("group", { name: "Periodo" });
const mensaje = (page: Page) => page.locator("#mensaje-de-estado");

async function abrir(page: Page, ruta = "/ingresos") {
  await page.goto(ruta);
  await expect(
    page.getByRole("heading", { level: 1, name: "Ingresos" }),
  ).toBeVisible();
  await expect(periodo(page)).toBeVisible();
}

test.describe("PN-08 · Ingresos del periodo de varias fuentes", () => {
  test("Laura en noviembre: periodos, total, la fuente «Salario» y sin violaciones de axe", async ({
    page,
  }) => {
    await apiDeIngresos(page);
    await abrir(page);
    await expect(periodo(page).getByRole("radio")).toHaveCount(3);
    await expect(
      periodo(page).getByRole("radio", { name: "Noviembre" }),
    ).toBeChecked();
    await expect(tarjeta(page, "Entran este mes")).toHaveText(
      "Entran este mes$2.400.000Ya registrado$1.200.000Esperado$1.200.000",
    );
    await expect(tarjeta(page, "Salario").getByRole("listitem")).toHaveText([
      "1 de noviembre de 2026TransferenciaRegistrado$1.200.000",
      "16 de noviembre de 2026TransferenciaEsperado$1.200.000",
    ]);
    await expect(page.getByText("Confirmar todos")).toHaveCount(0);
    await expect(page.getByText("Prima, cesantías o intereses")).toHaveCount(0);
    await sinViolaciones(page);
  });

  test("a 1280 px: el periodo y el total a la izquierda (5/12) y las fuentes a la derecha (7/12)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await apiDeIngresos(page);
    await abrir(page);
    const total = await tarjeta(page, "Entran este mes").boundingBox();
    const salario = await tarjeta(page, "Salario").boundingBox();
    expect(salario!.x).toBeGreaterThan(total!.x + total!.width);
    expect(salario!.width / total!.width).toBeCloseTo(7 / 5, 1);
  });

  test("los chips y «Otro mes» cambian el periodo: diciembre con la prima y agosto sin ingresos", async ({
    page,
  }) => {
    await apiDeIngresos(page);
    await abrir(page);
    await periodo(page).getByRole("radio", { name: "Diciembre" }).check();
    await expect(page).toHaveURL(/\?periodo=2026-12$/);
    await expect(tarjeta(page, "Entran este mes")).toContainText("$3.600.000");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Entran este mes",
      "Salario",
      "Prima de servicios",
    ]);
    await page.getByRole("button", { name: "Otro mes" }).click();
    await expect(page.getByRole("button", { name: /de 2026$/ })).toHaveText([
      "Noviembre de 2026",
      "Octubre de 2026",
      "Agosto de 2026",
    ]);
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Agosto de 2026" }).click();
    await expect(page).toHaveURL(/\?periodo=2026-08$/);
    await expect(
      periodo(page).getByRole("radio", { name: "Agosto" }),
    ).toBeChecked();
    await expect(
      page.getByText("Todavía no registras ingresos este mes."),
    ).toBeVisible();
    await expect(
      page.getByText("Cuando registres uno, aquí lo verás."),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("caso P en octubre: «Entraron este mes» y dos fuentes de mayor a menor", async ({
    page,
  }) => {
    await apiDeIngresos(page);
    await abrir(page, "/ingresos?periodo=2026-10");
    await expect(tarjeta(page, "Entraron este mes")).toContainText("$550.000");
    await expect(
      tarjeta(page, "Trabajo independiente o ventas").getByRole("listitem"),
    ).toHaveText([
      "3 de octubre de 2026Transferencia · Venta de artesaníasRegistrado$300.000",
      "28 de octubre de 2026Transferencia · Venta de artesaníasRegistrado$90.000",
    ]);
    await expect(tarjeta(page, "Ayudas y subsidios")).toContainText("$160.000");
    await sinViolaciones(page);
  });

  test("una fecha por confirmar: «Confirmar» la registra con el aviso de E14, y «Más» abre la hoja de la US-60", async ({
    page,
  }) => {
    const { estado } = await apiDeIngresos(page, 1);
    await abrir(page);
    const fila = tarjeta(page, "Salario").getByRole("listitem").nth(1);
    await expect(fila).toContainText(
      "16 de noviembre de 2026TransferenciaPor confirmar$1.200.000",
    );
    await sinViolaciones(page);
    await fila
      .getByRole("button", {
        name: "Más opciones de Salario de $1.200.000 del 16 de noviembre de 2026",
      })
      .click();
    const hoja = page.getByRole("dialog", {
      name: "Salario · 16 de noviembre de 2026",
    });
    await expect(hoja.getByRole("button", { name: "No pasó" })).toBeVisible();
    await sinViolaciones(page);
    await page.keyboard.press("Escape");
    estado.fallar = 1;
    const confirmar = fila.getByRole("button", {
      name: "Confirmar Salario de $1.200.000 del 16 de noviembre de 2026",
    });
    await confirmar.click();
    await expect(
      page.getByText("No pudimos confirmar el movimiento."),
    ).toBeVisible();
    await sinViolaciones(page);
    await confirmar.click();
    await expect(mensaje(page)).toHaveText(
      "Listo, confirmamos tu ingreso de $1.200.000.",
    );
    await expect(fila).toContainText("Registrado");
    await expect(tarjeta(page, "Entran este mes")).toContainText(
      "Ya registrado$2.400.000Esperado$0",
    );
  });

  test("con dos fechas por confirmar, «Confirmar todos» abre la lista con todo marcado y guarda las dos", async ({
    page,
  }) => {
    const { pedidos } = await apiDeIngresos(page, 2);
    await abrir(page);
    await tarjeta(page, "Entran este mes")
      .getByRole("link", { name: "Confirmar todos" })
      .click();
    await expect(page).toHaveURL(/\?confirmar=todos$/);
    const panel = page.getByRole("region", { name: "Confirmar todos" });
    await expect(panel.getByRole("checkbox")).toHaveCount(2);
    await sinViolaciones(page);
    await panel.getByRole("button", { name: "Guardar 2 movimientos" }).click();
    await expect(mensaje(page)).toHaveText("Listo, guardamos 2 movimientos.");
    await expect(page).toHaveURL(/\/ingresos$/);
    expect(
      pedidos.filter((p) => p.metodo === "POST").map((p) => p.cuerpo),
    ).toEqual([
      {
        decisiones: [
          { recurrente_id: "r-2026-11-01", fecha: "2026-11-01" },
          { recurrente_id: "r-2026-11-16", fecha: "2026-11-16" },
        ],
      },
    ]);
    await expect(page.getByText("Confirmar todos")).toHaveCount(0);
  });

  test("un error de carga dice el texto de E14 con «Intentar de nuevo», sin violaciones de axe", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/ingresos": responder(500, { error: "error_interno" }),
    });
    await page.goto("/ingresos");
    await expect(
      page.getByText("No pudimos cargar tus ingresos."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Intentar de nuevo" }),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("«Ver mis ingresos» de PN-06 abre PN-08 y su Atrás vuelve a PN-06", async ({
    page,
  }) => {
    await apiDePresupuesto(page, casos.laura(), {
      "GET /api/v1/ingresos": responder(200, {
        periodo_actual: "2026-11",
        periodo: "2026-11",
        meses: [],
        total: {
          entran_centavos: 0,
          registrado_centavos: 0,
          esperado_centavos: 0,
          por_confirmar: 0,
        },
        fuentes: [],
      }),
    });
    await page.goto("/presupuesto");
    await page.getByRole("link", { name: "Ver mis ingresos" }).click();
    await expect(page).toHaveURL(/\/ingresos$/);
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/presupuesto$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Presupuesto de noviembre" }),
    ).toBeVisible();
  });
});
