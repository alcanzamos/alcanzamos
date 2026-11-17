import { expect, test, type Locator, type Page } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";
import { hoyEs14DeDiciembre, pantallas, type Pantalla } from "./pantallas";

// Bug 233 (USA-008, S2): las pantallas web con sesión llevan la Navegación lateral web de E14-SDD 5.13, con
// «Registrar» como acción principal arriba de los destinos (E14-MCO 4.2, punto 5). Desde 768 px; por debajo, el
// diseño de Android, sin la barra. Solo los destinos que ya existen: hoy, Movimientos y Presupuesto (nota del 2026-11-10
// de E14-SDD 5.13; L17 de la US-77, punto 2).
const barra = (page: Page) => page.getByRole("navigation");
const enlace = (page: Page, nombre: string) =>
  barra(page).getByRole("link", { name: nombre, exact: true });

async function abrir(page: Page, pantalla: Pantalla, ancho: number) {
  await page.setViewportSize({ width: ancho, height: 900 });
  await hoyEs14DeDiciembre(page);
  await pantalla.preparar(page);
  await pantalla.abrir(page);
  await page.evaluate(() => document.fonts.ready);
}

/** Desde el título de la pantalla, Mayús+Tab llega a `objetivo` en pocos pasos: la barra va antes del contenido. */
async function llegarConTeclado(page: Page, objetivo: Locator) {
  await page.locator("#titulo-de-pagina").focus();
  for (let paso = 0; paso < 6; paso++) {
    await page.keyboard.press("Shift+Tab");
    if (await objetivo.evaluate((e) => e === document.activeElement)) return;
  }
  throw new Error("«Registrar» de la barra no se alcanza con el teclado");
}

const conSesion = pantallas.filter((p) => p.lateral);
const sinSesion = pantallas.filter((p) => !p.lateral);

test.describe("Navegación lateral web en las pantallas con sesión (bug 233, E14-SDD 5.13)", () => {
  for (const pantalla of conSesion) {
    const { activo, registrar } = pantalla.lateral!;

    test(`${pantalla.nombre}: desde 768 px, «Registrar» ${registrar} arriba de los destinos`, async ({
      page,
    }) => {
      await abrir(page, pantalla, 1280);
      await expect(barra(page)).toBeVisible();
      // 240 px de ancho, alto completo, pegada a la izquierda.
      const caja = await barra(page).boundingBox();
      expect(caja).toMatchObject({ x: 0, y: 0, width: 240, height: 900 });

      // «Registrar» primero; luego solo los destinos construidos.
      await expect(barra(page).getByRole("link")).toHaveText([
        "Registrar",
        "Movimientos",
        "Presupuesto",
      ]);
      await expect(enlace(page, "Registrar")).toHaveAttribute(
        "href",
        "/registrar",
      );
      await expect(enlace(page, "Registrar")).toHaveClass(
        new RegExp(`\\bboton--${registrar}\\b`),
      );
      await expect(enlace(page, "Movimientos")).toHaveAttribute(
        "href",
        "/movimientos",
      );
      await expect(enlace(page, "Presupuesto")).toHaveAttribute(
        "href",
        "/presupuesto",
      );

      // El destino activo lleva aria-current; en las que no son destino, ninguno.
      await expect(barra(page).locator("[aria-current]")).toHaveCount(
        activo ? 1 : 0,
      );
      if (activo)
        await expect(enlace(page, activo)).toHaveAttribute(
          "aria-current",
          "page",
        );

      await sinViolaciones(page);

      // Se alcanza con el teclado y el foco se ve: «Registrar» y, con Tab, «Movimientos» y «Presupuesto».
      await llegarConTeclado(page, enlace(page, "Registrar"));
      await expect(enlace(page, "Registrar")).toBeFocused();
      await expect(enlace(page, "Registrar")).toHaveCSS(
        "outline-style",
        "solid",
      );
      await page.keyboard.press("Tab");
      await expect(enlace(page, "Movimientos")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(enlace(page, "Presupuesto")).toBeFocused();

      // El corte es el de E14: a 768 px sigue; a 767 y a 360 px, el diseño de Android, sin la barra.
      await page.setViewportSize({ width: 768, height: 900 });
      await expect(barra(page)).toBeVisible();
      await page.setViewportSize({ width: 767, height: 900 });
      await expect(barra(page)).toBeHidden();
      await page.setViewportSize({ width: 360, height: 900 });
      await expect(barra(page)).toBeHidden();
    });
  }

  for (const pantalla of sinSesion) {
    test(`${pantalla.nombre}: sin sesión no lleva la Navegación lateral`, async ({
      page,
    }) => {
      await abrir(page, pantalla, 1280);
      await expect(barra(page)).toHaveCount(0);
    });
  }

  test("en PN-01 la web tiene un solo «Registrar»: el de la barra desde 768 px y el de la lista por debajo", async ({
    page,
  }) => {
    const pn01 = pantallas.find((p) => p.nombre.startsWith("PN-01"))!;
    await abrir(page, pn01, 1280);
    const visibles = page
      .getByRole("link", { name: "Registrar", exact: true })
      .filter({ visible: true });
    await expect(visibles).toHaveCount(1);
    await expect(visibles).toHaveClass(/\bboton--primario\b/);
    await expect(barra(page)).toContainText("Registrar");
    await page.setViewportSize({ width: 360, height: 900 });
    await expect(visibles).toHaveCount(1);
    await expect(
      page.getByRole("main").getByRole("link", { name: "Registrar" }),
    ).toBeVisible();
  });

  test("PN-01 junto a la barra: de 768 a 1007 px una pantalla a la vez; desde 1008 px, la lista y el detalle juntos", async ({
    page,
  }) => {
    const pn02 = pantallas.find((p) => p.nombre.startsWith("PN-02"))!;
    await abrir(page, pn02, 768);
    const detalle = page.getByRole("region", { name: "Movimiento" });
    const fila = page.getByRole("link", { name: /Mercado/ });
    const atras = detalle.getByRole("link", { name: "Atrás" });
    for (const ancho of [768, 1007]) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await expect(barra(page)).toBeVisible();
      await expect(detalle).toBeVisible();
      await expect(atras).toBeVisible();
      await expect(fila).toBeHidden();
    }
    await page.setViewportSize({ width: 1008, height: 900 });
    await expect(fila).toBeVisible();
    await expect(detalle).toBeVisible();
    await expect(atras).toBeHidden();
  });

  test("F-1 a 768 px: el cuadro y su botón caben en su columna, junto a la barra", async ({
    page,
  }) => {
    const f1 = pantallas.find((p) => p.nombre === "F-1 /registrar")!;
    await abrir(page, f1, 768);
    const columna = await page.locator(".registro__cuadro").boundingBox();
    for (const parte of [
      page.getByLabel("Escribe el gasto o el ingreso"),
      page.getByRole("button", { name: "Llenar el formulario" }),
    ]) {
      const caja = (await parte.boundingBox())!;
      expect(caja.x + caja.width).toBeLessThanOrEqual(
        columna!.x + columna!.width + 1,
      );
    }
  });

  test("«Registrar» no se desplaza con el contenido", async ({ page }) => {
    const menu = pantallas.find((p) =>
      p.nombre.startsWith("PN-63 /cuenta/privacidad"),
    )!;
    await page.setViewportSize({ width: 1280, height: 600 });
    await menu.preparar(page);
    await menu.abrir(page);
    const antes = await enlace(page, "Registrar").boundingBox();
    await page.mouse.wheel(0, 2000);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    expect(await enlace(page, "Registrar").boundingBox()).toEqual(antes);
  });

  test("con el teclado, «Movimientos» lleva de PN-71 a PN-01 y «Registrar» de PN-01 al formulario", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
      "GET /api/v1/repeticiones/pendientes": responder(200, {
        pendientes: [],
        resumen: { total: 0, ingresos: 0, gastos: 0 },
      }),
      "GET /api/v1/movimientos": responder(200, {
        periodo_actual: "2026-12",
        periodo: "2026-12",
        resumen: { movimientos: 0, total_centavos: null },
        meses: [],
        categorias: [],
        movimientos: [],
      }),
      "GET /api/v1/categorias": responder(200, { gasto: [], ingreso: [] }),
    });
    await page.goto("/cuenta/seguridad");
    await expect(
      page.getByRole("heading", { level: 1, name: "Seguridad de la cuenta" }),
    ).toBeVisible();
    await enlace(page, "Movimientos").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/movimientos$/);
    await expect(enlace(page, "Movimientos")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await enlace(page, "Registrar").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/registrar$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Registrar" }),
    ).toBeFocused();
    await expect(enlace(page, "Registrar")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
