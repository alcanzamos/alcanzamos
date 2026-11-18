import { expect, test } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

const sinConexion =
  "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.";

// `vite preview` arma /config.json como `ca-web`: `{"url_api": <origen del API>}`, y sin caché. Aquí el API es el
// mismo origen (el `page.route` de las pruebas lo simula); el origen distinto lo cubren las pruebas de `tests/`.
test("la web lee /config.json antes del primer pedido al API y le habla al origen que dice", async ({
  page,
}) => {
  const urls: string[] = [];
  page.on("request", (pedido) => urls.push(pedido.url()));
  await simularApi(page, {
    "POST /api/v1/sesiones": responder(401, {
      error: "credenciales_invalidas",
    }),
  });

  const config = await page.request.get("/config.json");
  expect(config.headers()["cache-control"]).toBe("no-store");
  const { url_api: origenDelApi } = (await config.json()) as {
    url_api: string;
  };
  expect(new URL(origenDelApi).origin).toBe(origenDelApi);

  await page.goto("/entrar");
  await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("mala");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(
    page.getByText("No pudimos entrar con esos datos."),
  ).toBeVisible();

  const iConfig = urls.indexOf(`${origenDelApi}/config.json`);
  const iApi = urls.findIndex((url) => url.includes("/api/"));
  expect(iConfig).toBeGreaterThanOrEqual(0);
  expect(iApi).toBeGreaterThan(iConfig);
  expect(urls[iApi]).toBe(`${origenDelApi}/api/v1/sesiones`);
});

test("sin /config.json la web no monta la app: falla a la vista, sin violaciones, y se puede reintentar", async ({
  page,
}) => {
  const apis: string[] = [];
  page.on("request", (pedido) => {
    if (pedido.url().includes("/api/")) apis.push(pedido.url());
  });
  let sirve = false;
  await page.route("**/config.json", (ruta) =>
    sirve ? ruta.fallback() : ruta.fulfill({ status: 502, body: "" }),
  );
  await page.goto("/entrar");
  const titulo = page.getByRole("heading", { level: 1, name: sinConexion });
  await expect(titulo).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Inicia sesión" }),
  ).toHaveCount(0);
  await sinViolaciones(page);

  sirve = true;
  await page.getByRole("button", { name: "Intentar de nuevo" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Inicia sesión" }),
  ).toBeVisible();
  expect(apis).toEqual([]);
});
