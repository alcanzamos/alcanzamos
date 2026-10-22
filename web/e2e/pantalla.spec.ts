import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("la pantalla de prueba no tiene violaciones de accesibilidad (axe-core)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Alcanzamos" }),
  ).toBeVisible();
  const resultado = await new AxeBuilder({ page }).analyze();
  expect(resultado.violations).toEqual([]);
});

test("las cifras usan Figtree con cifras tabulares y sin ss02", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const cifras = page.locator(".cifra dd");
  await expect(cifras).toHaveText(["$80.000", "$1.200.000", "$123.456,78"]);
  for (const cifra of await cifras.all()) {
    const estilo = await cifra.evaluate((el) => {
      const calculado = getComputedStyle(el);
      return {
        familia: calculado.fontFamily,
        numeros: calculado.fontVariantNumeric,
        caracteristicas: calculado.fontFeatureSettings,
      };
    });
    expect(estilo.familia).toContain("Figtree");
    expect(estilo.numeros).toContain("tabular-nums");
    expect(estilo.caracteristicas).not.toContain("ss02");
  }
  expect(
    await page.evaluate(() => document.fonts.check("700 32px Figtree")),
  ).toBe(true);
});

test("el enlace tiene foco visible con el teclado", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const enlace = page.getByRole("link", { name: "Ir a las cifras" });
  await expect(enlace).toBeFocused();
  const contorno = await enlace.evaluate((el) => {
    const c = getComputedStyle(el);
    return { estilo: c.outlineStyle, ancho: c.outlineWidth };
  });
  expect(contorno.estilo).toBe("solid");
  expect(contorno.ancho).not.toBe("0px");
});

test("no hace pedidos a otros orígenes (fuentes propias)", async ({
  page,
  baseURL,
}) => {
  const externos: string[] = [];
  page.on("request", (peticion) => {
    if (!peticion.url().startsWith(baseURL ?? ""))
      externos.push(peticion.url());
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  expect(externos).toEqual([]);
});
