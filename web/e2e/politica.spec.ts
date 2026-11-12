import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

// PN-68 · Política de tratamiento (E14-PCP 4.11, D-195, US-67): pública, sin API, con la versión del texto y sus
// entradas: PN-60, PN-58, PN-63 (primer uso y desde el menú), PN-64 (en autorizacion.spec.ts) y PN-71.
const titulo = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Política de tratamiento" });
const lateral = (page: Page) => page.getByRole("navigation");

test.describe("PN-68 · la pantalla", () => {
  test("sin sesión y sin API: las cinco tarjetas, la versión, sin barra lateral y sin violaciones de axe", async ({
    page,
  }) => {
    // Sin manejadores: cualquier pedido al API falla la prueba (es texto de la página, sin sesión).
    const pedidos = await simularApi(page, {});
    await page.goto("/politica");
    await expect(titulo(page)).toBeVisible();
    await expect(page).toHaveTitle("Política de tratamiento · Alcanzamos");
    await expect(
      page.getByText("Versión 1.1 del 12 de noviembre de 2026."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Quién responde por tus datos",
      "Para qué usamos tus datos",
      "Tus derechos",
      "Dónde guardamos tus datos",
      "Cómo hacer una consulta o un reclamo",
    ]);
    await expect(lateral(page)).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await sinViolaciones(page);
    expect(pedidos).toEqual([]);
  });

  test("dice quién responde, la frase de D-200 y nombra a cada encargado con su país (SC-E21-25, criterio 7)", async ({
    page,
  }) => {
    await page.goto("/politica");
    await expect(
      page.getByText("Alcanzamos, proyecto de Andrés Jiménez."),
    ).toBeVisible();
    await expect(
      page.getByText(
        "No vendemos tus datos ni los usamos para mostrarte publicidad de terceros.",
      ),
    ).toBeVisible();
    const donde = page.getByRole("region", {
      name: "Dónde guardamos tus datos",
    });
    await expect(donde).toContainText("Microsoft Azure, en México");
    await expect(donde).toContainText(
      "Azure Communication Services, que guarda sus datos en Francia",
    );
    await expect(donde).toContainText("Zoho Mail, en Estados Unidos");
    await expect(donde).toContainText(
      "Esas empresas no dicen en qué país los procesan.",
    );
  });

  test("«Escribir al correo» abre el correo con la dirección", async ({
    page,
  }) => {
    await page.goto("/politica");
    await expect(
      page.getByRole("link", { name: "Escribir al correo" }),
    ).toHaveAttribute("href", "mailto:privacidad@alcanzamos.co");
  });
});

test.describe("PN-68 · sus entradas", () => {
  test("«Entrar» (PN-60): «Política de tratamiento y consultas» abre PN-68 con el foco en el título y Atrás vuelve a PN-60", async ({
    page,
  }) => {
    await page.goto("/entrar");
    await page
      .getByRole("link", { name: "Política de tratamiento y consultas" })
      .click();
    await expect(page).toHaveURL(/\/politica\?desde=%2Fentrar$/);
    await expect(titulo(page)).toBeFocused();
    await expect(lateral(page)).toHaveCount(0);
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test("«Crear cuenta» (PN-58): «Política de tratamiento de datos» abre PN-68 y Atrás vuelve a PN-58", async ({
    page,
  }) => {
    await page.goto("/crear-cuenta");
    await page
      .getByRole("link", { name: "Política de tratamiento de datos" })
      .click();
    await expect(page).toHaveURL(/\/politica\?desde=%2Fcrear-cuenta$/);
    await expect(titulo(page)).toBeVisible();
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/crear-cuenta$/);
  });

  test("PN-63 en el primer uso: «Leer la política completa» abre PN-68 sin barra lateral y Atrás vuelve a PN-63", async ({
    page,
  }) => {
    await page.goto("/privacidad");
    await page.getByRole("link", { name: "Leer la política completa" }).click();
    await expect(page).toHaveURL(/\/politica\?desde=%2Fprivacidad$/);
    await expect(titulo(page)).toBeVisible();
    await expect(lateral(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/privacidad$/);
    await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();
  });

  test("PN-63 desde el menú: «Leer la política completa» abre PN-68 con la barra lateral y Atrás vuelve", async ({
    page,
  }) => {
    await page.goto("/cuenta/privacidad");
    await page.getByRole("link", { name: "Leer la política completa" }).click();
    await expect(page).toHaveURL(/\/politica\?desde=%2Fcuenta%2Fprivacidad$/);
    await expect(titulo(page)).toBeVisible();
    await expect(lateral(page)).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/cuenta\/privacidad$/);
  });

  test("PN-71: «Política de tratamiento y consultas» abre PN-68 con la barra lateral y Atrás vuelve a PN-71", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
    });
    await page.goto("/cuenta/seguridad");
    await page
      .getByRole("link", { name: "Política de tratamiento y consultas" })
      .click();
    await expect(page).toHaveURL(/\/politica\?desde=%2Fcuenta%2Fseguridad$/);
    await expect(titulo(page)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(lateral(page)).toBeVisible();
    await expect(
      lateral(page).getByRole("link", { name: "Registrar" }),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();
  });

  test("un origen que no está en la lista no cambia el destino de Atrás", async ({
    page,
  }) => {
    await page.goto("/politica?desde=https%3A%2F%2Fejemplo.com");
    await expect(page.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/entrar",
    );
    await expect(lateral(page)).toHaveCount(0);
  });
});
