import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route } from "@playwright/test";

type Manejador = (ruta: Route, cuerpo: unknown) => Promise<void> | void;

/** Responde un pedido del API con un estado y un cuerpo JSON. */
export const responder =
  (estado: number, cuerpo?: unknown): Manejador =>
  (ruta) =>
    ruta.fulfill({
      status: estado,
      contentType: "application/json",
      body: cuerpo === undefined ? "" : JSON.stringify(cuerpo),
    });

/**
 * Simula el API con `page.route`: la clave es «MÉTODO /ruta». Un pedido sin manejador falla la prueba,
 * así ninguna pantalla llama a algo que la prueba no previó. Devuelve los pedidos hechos.
 */
export async function simularApi(
  page: Page,
  manejadores: Record<string, Manejador>,
) {
  const pedidos: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
  await page.route("**/api/**", async (ruta) => {
    const pedido = ruta.request();
    const { pathname } = new URL(pedido.url());
    const clave = `${pedido.method()} ${pathname}`;
    const datos = pedido.postData();
    const cuerpo: unknown = datos ? JSON.parse(datos) : undefined;
    pedidos.push({ metodo: pedido.method(), ruta: pathname, cuerpo });
    const manejador = manejadores[clave];
    if (!manejador) {
      await ruta.fulfill({ status: 599, body: `sin manejador: ${clave}` });
      throw new Error(`Pedido no previsto: ${clave}`);
    }
    await manejador(ruta, cuerpo);
  });
  return pedidos;
}

/** axe-core sobre lo que se ve ahora: cero violaciones (E17-ECO 4.10). */
export async function sinViolaciones(page: Page) {
  const resultado = await new AxeBuilder({ page }).analyze();
  expect(resultado.violations).toEqual([]);
}
