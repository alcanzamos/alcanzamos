import { expect, test } from "@playwright/test";
import { hoyEs14DeDiciembre, pantallas } from "./pantallas";

// S13 (USA-008 de I05): el punto 5 de E14-MCO 4.2 pide sin desplazamiento horizontal de 360 a 1920 px.
const anchos = [360, 768, 1280, 1920];

test.describe("Sin desplazamiento horizontal de 360 a 1920 px (S13, E14-MCO 4.2 punto 5)", () => {
  for (const pantalla of pantallas) {
    for (const ancho of anchos) {
      test(`${pantalla.nombre} a ${ancho} px`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: 900 });
        await hoyEs14DeDiciembre(page);
        await pantalla.preparar(page);
        await pantalla.abrir(page);
        await page.evaluate(() => document.fonts.ready);

        const medidas = await page.evaluate(() => ({
          documento: [
            document.documentElement.scrollWidth,
            document.documentElement.clientWidth,
          ],
          cuerpo: [document.body.scrollWidth, document.body.clientWidth],
        }));
        expect(medidas.documento[0]).toBeLessThanOrEqual(medidas.documento[1]!);
        expect(medidas.cuerpo[0]).toBeLessThanOrEqual(medidas.documento[1]!);
      });
    }
  }
});
