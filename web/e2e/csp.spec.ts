import { expect, test } from "@playwright/test";

// Debe ser idéntica a la de ca-web (web/servidor/internal/servidor/config.go, politicaCSP) y a la de vite.config.ts:
// con el origen del API en connect-src. `vite preview` usa su propio origen como el del API (ver vite.config.ts).
const politicaCSP = (origenDelApi: string) =>
  `default-src 'self'; connect-src 'self' ${origenDelApi}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

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

  const respuesta = await page.goto("/entrar");
  const origen = new URL(page.url()).origin;
  expect(respuesta?.headers()["content-security-policy"]).toBe(
    politicaCSP(origen),
  );

  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("heading", { level: 1, name: "Inicia sesión" }),
  ).toBeVisible();
  // El logo es un archivo propio: la CSP (default-src 'self') lo deja pasar.
  await expect(page.getByRole("img", { name: "Alcanzamos" })).toBeVisible();

  expect(await page.evaluate(() => window.__violacionesCSP)).toEqual([]);
  expect(consola).toEqual([]);
});
