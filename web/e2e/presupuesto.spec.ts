import { expect, test, type Page } from "@playwright/test";
import { responder, sinViolaciones } from "./ayudas";
import {
  apiDePresupuesto,
  casos,
  hoyEs2DeNoviembre,
} from "./datosDePresupuesto";

// PN-06 y PN-07 (E14-PPA 4.1 y 4.2) contra el API simulado con el escenario de E14-PPA 2.2 y 2.3.
test.beforeEach(async ({ page }) => {
  await hoyEs2DeNoviembre(page);
});

const titulo = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Presupuesto de noviembre" });
const tarjeta = (page: Page, nombre: string) =>
  page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: nombre }),
  });
const filas = (page: Page) =>
  tarjeta(page, "Por categoría").getByRole("listitem");
const mensaje = (page: Page) => page.locator("#mensaje-de-estado");

async function abrir(page: Page) {
  await page.goto("/presupuesto");
  await expect(titulo(page)).toBeVisible();
  await expect(tarjeta(page, "Por categoría")).toBeVisible();
}

// RNF-017 (E14-PPA 4.2, «Lo que esta pantalla no dice nunca»): ni Atención, ni rojo, ni signo menos.
async function sinReproche(page: Page) {
  await expect(page.locator("main")).not.toContainText(
    /sin ingresos|no tienes plata|no hay plata|te pasaste|de más|déficit|no alcanza|debes registrar|gasta menos|ahorra|-\$/i,
  );
  await expect(page.locator(".aviso--atencion, .campo__error")).toHaveCount(0);
}

test.describe("PN-06 · Presupuesto del periodo por categorías", () => {
  test("Laura en noviembre: resumen, «Por categoría» en orden y sin violaciones de axe", async ({
    page,
  }) => {
    await apiDePresupuesto(page, casos.laura());
    await abrir(page);
    const resumen = tarjeta(page, "Tu presupuesto este mes");
    await expect(resumen).toContainText("Ingreso registrado$1.200.000");
    await expect(resumen).toContainText("Asignado$40.000");
    await expect(resumen).toContainText("Sin asignar$1.160.000");
    await expect(resumen).toContainText("Llega después: $1.200.000 (esperado)");
    await expect(resumen).toContainText(
      "Sin asignar cuenta lo que ya registraste. Salario del 16 de noviembre de 2026 se suma cuando llegue.",
    );
    await expect(filas(page)).toHaveText([
      "TransportePresupuesto $40.000 · Gastado $40.000Ya usaste todo lo presupuestado.CorregirQuitar",
      "Arriendo o cuota de viviendaGastado $650.000 · Sin presupuestoPoner presupuesto",
      "AlimentaciónGastado $120.000 · Sin presupuestoPoner presupuesto",
      "Restaurantes y hotelesGastado $25.000 · Sin presupuestoPoner presupuesto",
      "Recreación y culturaGastado $15.000 · Sin presupuestoPoner presupuesto",
    ]);
    await expect(page.getByText("Para mirar con calma")).toHaveCount(0);
    await sinViolaciones(page);
  });

  test("a 1280 px: el resumen a la izquierda (5/12) y a la derecha solo «Por categoría» y «Agregar otra categoría» (L3, punto 1)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await apiDePresupuesto(page, casos.laura());
    await abrir(page);
    const columnas = page.locator(".presupuesto > .presupuesto__columna");
    await expect(columnas).toHaveCount(2);
    const [izquierda, derecha] = await Promise.all([
      columnas.nth(0).boundingBox(),
      columnas.nth(1).boundingBox(),
    ]);
    expect(izquierda && derecha).toBeTruthy();
    // Misma fila, la derecha más ancha: 5/12 y 7/12 del contenedor de 960 px (menos el espacio entre las dos).
    expect(Math.abs(izquierda!.y - derecha!.y)).toBeLessThan(1);
    expect(derecha!.x).toBeGreaterThan(izquierda!.x + izquierda!.width);
    expect(derecha!.width / izquierda!.width).toBeCloseTo(7 / 5, 1);
    const derechaLleva = await columnas
      .nth(1)
      .locator(":scope > *")
      .evaluateAll((hijos) =>
        hijos.map((h) => h.querySelector("h2, button")?.textContent),
      );
    expect(derechaLleva).toEqual(["Por categoría", "Agregar otra categoría"]);
    // Desde 768 px, «Registrar» es el de la Navegación lateral (bug 233), como en PN-01: uno solo a la vista.
    const registrar = page
      .getByRole("link", { name: "Registrar", exact: true })
      .filter({ visible: true });
    await expect(registrar).toHaveCount(1);
    await expect(page.getByRole("navigation")).toContainText("Registrar");
    await expect(
      columnas.nth(0).getByRole("link", { name: "Registrar", exact: true }),
    ).toBeHidden();
  });

  test("a 360 px: una sola columna, el resumen arriba y «Por categoría» debajo, como Android", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await apiDePresupuesto(page, casos.laura());
    await abrir(page);
    const resumen = await tarjeta(
      page,
      "Tu presupuesto este mes",
    ).boundingBox();
    const categorias = await tarjeta(page, "Por categoría").boundingBox();
    expect(categorias!.y).toBeGreaterThan(resumen!.y + resumen!.height);
    expect(Math.abs(categorias!.x - resumen!.x)).toBeLessThan(1);
    // Sin la Navegación lateral: «Registrar» es el de arriba del resumen, como en Android.
    await expect(page.getByRole("navigation")).toBeHidden();
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Registrar", exact: true }),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("«Poner presupuesto»: la hoja junto a la fila, el error de E14 sin monto y, al guardar, el aviso y la fila con «Corregir»", async ({
    page,
  }) => {
    const { pedidos } = await apiDePresupuesto(page, casos.laura());
    await abrir(page);
    await page
      .getByRole("button", {
        name: "Poner presupuesto a Arriendo o cuota de vivienda",
      })
      .click();
    const hoja = page.getByRole("dialog", {
      name: "Presupuesto de Arriendo o cuota de vivienda",
    });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByLabel("Monto para noviembre")).toHaveValue("");
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja.getByText("Falta el monto.")).toBeVisible();
    await expect(hoja.getByLabel("Monto para noviembre")).toBeFocused();
    await sinViolaciones(page);
    await hoja.getByLabel("Monto para noviembre").fill("650.000");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(mensaje(page)).toHaveText(
      "Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.",
    );
    await expect(hoja).toHaveCount(0);
    await expect(filas(page).nth(0)).toHaveText(
      "Arriendo o cuota de viviendaPresupuesto $650.000 · Gastado $650.000Ya usaste todo lo presupuestado.CorregirQuitar",
    );
    expect(
      pedidos.filter((p) => p.metodo === "POST").map((p) => p.cuerpo),
    ).toEqual([
      { periodo: "2026-11", categoria_id: 4, monto_centavos: 65000000 },
    ]);
    await sinViolaciones(page);
  });

  test("«Corregir»: la hoja trae el monto actual; los errores de campo de E14 y el fallo del servidor en el aviso de la hoja", async ({
    page,
  }) => {
    const { estado } = await apiDePresupuesto(page, casos.laura());
    await abrir(page);
    await page
      .getByRole("button", { name: "Corregir el presupuesto de Transporte" })
      .click();
    const hoja = page.getByRole("dialog", {
      name: "Corregir el presupuesto de Transporte",
    });
    const monto = hoja.getByLabel("Monto para noviembre");
    await expect(monto).toHaveValue("$40.000");
    await monto.fill("0");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(
      hoja.getByText("El monto debe ser mayor que $0."),
    ).toBeVisible();
    await monto.fill("12,345");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(
      hoja.getByText("El monto puede tener hasta dos decimales."),
    ).toBeVisible();
    await expect(monto).toHaveAttribute("aria-invalid", "true");
    await sinViolaciones(page);
    // Un fallo del servidor deja la hoja abierta con lo escrito; el segundo «Guardar» ya pasa.
    estado.fallar = 1;
    await monto.fill("45.000");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(
      hoja.getByText("No pudimos guardar el presupuesto."),
    ).toBeVisible();
    await expect(
      hoja.getByText("Tus datos están a salvo. Intenta de nuevo."),
    ).toBeVisible();
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(mensaje(page)).toHaveText(
      "Listo, guardamos tu presupuesto de Transporte.",
    );
    await expect(filas(page).nth(0)).toContainText(
      "Presupuesto $45.000 · Gastado $40.000Quedan $5.000 por gastar.",
    );
  });

  test("«Quitar» pide confirmación: «Ahora no» no quita nada y devuelve el foco; «Quitar presupuesto» deja la fila sin presupuesto", async ({
    page,
  }) => {
    const { pedidos } = await apiDePresupuesto(page, casos.laura());
    await abrir(page);
    const quitar = page.getByRole("button", {
      name: "Quitar el presupuesto de Transporte",
    });
    await quitar.click();
    const hoja = page.getByRole("dialog", {
      name: "¿Quitar el presupuesto de Transporte?",
    });
    await expect(hoja).toContainText(
      "Lo que gastaste no cambia. Puedes poner otro cuando quieras.",
    );
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Ahora no" }).click();
    await expect(hoja).toHaveCount(0);
    await expect(quitar).toBeFocused();
    await quitar.click();
    await page.keyboard.press("Escape");
    await expect(quitar).toBeFocused();
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toEqual([]);
    await quitar.click();
    await hoja.getByRole("button", { name: "Quitar presupuesto" }).click();
    await expect(mensaje(page)).toHaveText(
      "Listo, quitamos tu presupuesto de Transporte.",
    );
    await expect(filas(page).filter({ hasText: "Transporte" })).toHaveText(
      "TransporteGastado $40.000 · Sin presupuestoPoner presupuesto",
    );
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toHaveLength(1);
    await sinViolaciones(page);
  });

  test("«Agregar otra categoría» abre «Ver todas» y pone el presupuesto a la elegida", async ({
    page,
  }) => {
    await apiDePresupuesto(page, casos.laura());
    await abrir(page);
    await page.getByRole("button", { name: "Agregar otra categoría" }).click();
    const lista = page.getByRole("list", { name: "Agregar otra categoría" });
    await expect(lista.getByRole("button")).toHaveText([
      "Servicios públicos",
      "Otros gastos",
    ]);
    await sinViolaciones(page);
    await lista.getByRole("button", { name: "Servicios públicos" }).click();
    const hoja = page.getByRole("dialog", {
      name: "Presupuesto de Servicios públicos",
    });
    await hoja.getByLabel("Monto para noviembre").fill("400.000");
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(mensaje(page)).toHaveText(
      "Listo, guardamos tu presupuesto de Servicios públicos.",
    );
    // Sin gasto, queda después de Transporte: de mayor a menor gasto entre las que tienen presupuesto (orden del API).
    await expect(filas(page).nth(1)).toHaveText(
      "Servicios públicosPresupuesto $400.000 · Gastado $0Quedan $400.000 por gastar.CorregirQuitar",
    );
  });

  test("PN-71 lleva a PN-06 con «Presupuesto», después de «Movimientos»", async ({
    page,
  }) => {
    await apiDePresupuesto(page, casos.laura());
    await page.goto("/cuenta/seguridad");
    await expect(page.locator("main > a, main > button")).toHaveText([
      "Movimientos",
      "Presupuesto",
      "Cómo cuidamos tus datos",
      "Cerrar sesión",
      "Borrar mi cuenta",
    ]);
    // El de PN-71, no el destino de la Navegación lateral.
    await page
      .getByRole("main")
      .getByRole("link", { name: "Presupuesto" })
      .click();
    await expect(page).toHaveURL(/\/presupuesto$/);
    await expect(titulo(page)).toBeFocused();
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Presupuesto" }),
    ).toHaveAttribute("aria-current", "page");
  });

  // L17 de la US-77, punto 1: otro dispositivo quitó el presupuesto de Transporte mientras esta pantalla lo mostraba.
  test("hoja con datos viejos: un 404 al corregir cierra la hoja, vuelve a pedir la pantalla y deja el aviso en ella", async ({
    page,
  }) => {
    const { caso, pedidos } = await apiDePresupuesto(page, casos.laura(), {
      "PUT /api/v1/presupuestos/p8": responder(404, { error: "no_encontrado" }),
    });
    await abrir(page);
    await page
      .getByRole("button", { name: "Corregir el presupuesto de Transporte" })
      .click();
    const hoja = page.getByRole("dialog", {
      name: "Corregir el presupuesto de Transporte",
    });
    await hoja.getByLabel("Monto para noviembre").fill("45.000");
    delete caso.presupuestos[8];
    await hoja.getByRole("button", { name: "Guardar" }).click();
    await expect(hoja).toHaveCount(0);
    const aviso = page.locator("main .aviso", {
      hasText: "No pudimos guardar el presupuesto.",
    });
    await expect(aviso).toBeFocused();
    await expect(aviso).toContainText(
      "Tus datos están a salvo. Intenta de nuevo.",
    );
    await expect(filas(page).filter({ hasText: "Transporte" })).toHaveText(
      "TransporteGastado $40.000 · Sin presupuestoPoner presupuesto",
    );
    expect(pedidos.filter((p) => p.metodo === "PUT")).toHaveLength(1);
    await sinViolaciones(page);
  });
});

test.describe("PN-07 · Presupuesto con ingreso bajo o nulo", () => {
  test("con ingreso nulo: «Ingreso registrado $0», sin «Sin asignar», sin reproche y sin violaciones de axe", async ({
    page,
  }) => {
    await apiDePresupuesto(page, casos.nulo());
    await abrir(page);
    const resumen = tarjeta(page, "Tu presupuesto este mes");
    await expect(resumen).toContainText("Ingreso registrado$0");
    await expect(resumen).toContainText(
      "Puedes repartir lo que llegue o dejar el presupuesto en cero.",
    );
    await expect(page.getByText("Sin asignar")).toHaveCount(0);
    await expect(tarjeta(page, "Por categoría")).toContainText(
      "Todavía no hay gastos este mes.",
    );
    await expect(
      page.getByRole("button", { name: "Dejar el presupuesto en cero" }),
    ).toBeVisible();
    await sinReproche(page);
    await sinViolaciones(page);
  });

  test("«Dejar el presupuesto en cero» se guarda: el aviso de E14 y, al recargar, el botón no vuelve", async ({
    page,
  }) => {
    const { pedidos } = await apiDePresupuesto(page, casos.nulo());
    await abrir(page);
    await page
      .getByRole("button", { name: "Dejar el presupuesto en cero" })
      .click();
    await expect(mensaje(page)).toHaveText(
      "Listo, tu presupuesto de noviembre queda en cero. Cuando llegue un ingreso, puedes repartirlo.",
    );
    await expect(
      page.getByRole("button", { name: "Dejar el presupuesto en cero" }),
    ).toHaveCount(0);
    expect(
      pedidos.filter((p) => p.metodo === "POST").map((p) => [p.ruta, p.cuerpo]),
    ).toEqual([["/api/v1/presupuestos/en-cero", { periodo: "2026-11" }]]);
    await sinReproche(page);
    await sinViolaciones(page);
    await page.reload();
    await expect(tarjeta(page, "Por categoría")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Dejar el presupuesto en cero" }),
    ).toHaveCount(0);
  });

  test("con ingreso bajo: las dos filas y la frase de E14, sin reproche y sin violaciones de axe", async ({
    page,
  }) => {
    await apiDePresupuesto(page, casos.bajo());
    await abrir(page);
    const resumen = tarjeta(page, "Tu presupuesto este mes");
    await expect(resumen).toContainText("Ingreso registrado$150.000");
    await expect(resumen).toContainText("Asignado$160.000");
    await expect(resumen).toContainText(
      "Lo asignado supera por $10.000 lo que registraste. Se actualiza cuando registres más ingresos.",
    );
    await expect(
      page.getByRole("button", { name: "Dejar el presupuesto en cero" }),
    ).toHaveCount(0);
    await sinReproche(page);
    await sinViolaciones(page);
  });

  test("«Registrar un ingreso» abre el formulario con Tipo «Ingreso»", async ({
    page,
  }) => {
    await apiDePresupuesto(page, casos.nulo());
    await abrir(page);
    await page.getByRole("link", { name: "Registrar un ingreso" }).click();
    await expect(page).toHaveURL(/\/registrar$/);
    await expect(
      page.getByRole("radio", { name: "Ingreso", exact: true }),
    ).toBeChecked();
  });
});
