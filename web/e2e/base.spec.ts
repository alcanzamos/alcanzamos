import { expect, test } from "@playwright/test";
import { sinViolaciones } from "./ayudas";

test("«/» lleva a /entrar y la pantalla pendiente no tiene violaciones de axe", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Alcanzamos" }),
  ).toBeVisible();
  await sinViolaciones(page);
});

test("el logo se carga como archivo propio, con su texto alternativo y a 40 px de alto", async ({
  page,
}) => {
  await page.goto("/entrar");
  const logo = page.getByRole("img", { name: "Alcanzamos" });
  await expect(logo).toBeVisible();
  const medidas = await logo.evaluate((img: HTMLImageElement) => ({
    cargado: img.complete && img.naturalWidth > 0,
    alto: img.getBoundingClientRect().height,
    origen: new URL(img.currentSrc).origin === location.origin,
  }));
  expect(medidas).toEqual({ cargado: true, alto: 40, origen: true });
});

test("la columna mide 560 px por el token tamano-columna-contenido", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/entrar");
  const ancho = await page
    .locator("main")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(ancho).toBe(560);
});

test("no hace pedidos a otros orígenes (fuentes y logo propios)", async ({
  page,
  baseURL,
}) => {
  const externos: string[] = [];
  page.on("request", (peticion) => {
    if (!peticion.url().startsWith(baseURL ?? ""))
      externos.push(peticion.url());
  });
  await page.goto("/entrar");
  await page.evaluate(() => document.fonts.ready);
  expect(externos).toEqual([]);
});
