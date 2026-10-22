import { expect, test } from "@playwright/test";

// Debe ser idéntica a politicaCSP en api/internal/servidor/servidor.go y a la de vite.config.ts.
const politicaCSP =
  "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

declare global {
  interface Window {
    __violacionesCSP: string[];
  }
}

test("la página llega con la CSP exacta y el navegador no reporta violaciones", async ({
  page,
}) => {
  const consola: string[] = [];
  page.on("console", (mensaje) => {
    if (/Content Security Policy/i.test(mensaje.text()))
      consola.push(mensaje.text());
  });
  await page.addInitScript(() => {
    window.__violacionesCSP = [];
    document.addEventListener("securitypolicyviolation", (evento) => {
      window.__violacionesCSP.push(
        `${evento.violatedDirective} bloqueó ${evento.blockedURI || "inline"}`,
      );
    });
  });

  const respuesta = await page.goto("/");
  expect(respuesta?.headers()["content-security-policy"]).toBe(politicaCSP);

  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("heading", { level: 1, name: "Alcanzamos" }),
  ).toBeVisible();
  // Mismo recorrido que la prueba de foco: el teclado también ejercita los estilos de foco.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Ir a las cifras" }),
  ).toBeFocused();

  expect(await page.evaluate(() => window.__violacionesCSP)).toEqual([]);
  expect(consola).toEqual([]);
});
