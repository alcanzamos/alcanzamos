import { expect, test } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

const resumenConMenor = {
  hogar: {
    nombre: "Nuestro hogar",
    es_administradora: true,
    unica_adulta: false,
    nuevo_administrador: "Camilo",
  },
  menores: [{ id: "id-mateo", nombre: "Mateo" }],
};

test.describe("PN-69 · Borrar la cuenta", () => {
  test("con hogar y un menor no tiene violaciones de axe", async ({ page }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(200, resumenConMenor),
    });
    await page.goto("/cuenta/borrar");
    await expect(
      page.getByRole("heading", { level: 1, name: "Borrar mi cuenta" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Eres quien lo administra. El papel pasa ahora mismo a Camilo. Lo que compartiste sigue en el hogar, sin tu nombre.",
      ),
    ).toBeVisible();
    await expect(
      page.getByLabel("Entiendo que también se borra la cuenta de Mateo."),
    ).not.toBeChecked();
    await sinViolaciones(page);
  });

  test("con los errores de campo visibles no tiene violaciones y el foco va a la contraseña", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(200, resumenConMenor),
      "POST /api/v1/cuenta/borrado": responder(422, {
        error: "validacion",
        campos: {
          contrasena: "contrasena_vacia",
          confirma_menores: "confirmacion_requerida",
        },
      }),
    });
    await page.goto("/cuenta/borrar");
    await page.getByRole("button", { name: "Borrar mi cuenta" }).click();
    await expect(page.getByText("Falta tu contraseña.")).toBeVisible();
    await expect(page.getByText("Falta confirmar lo de Mateo.")).toBeVisible();
    await expect(page.getByLabel("Tu contraseña")).toBeFocused();
    await sinViolaciones(page);
  });

  test("borrar: manda la contraseña y lo del menor, va a entrar con «Borramos tu cuenta.»", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(200, resumenConMenor),
      "POST /api/v1/cuenta/borrado": responder(200, {
        estado: "cuenta_borrada",
      }),
    });
    await page.goto("/cuenta/borrar");
    await page.getByLabel("Tu contraseña").fill("lluvia café tren azul");
    await page
      .getByLabel("Entiendo que también se borra la cuenta de Mateo.")
      .check();
    await page.getByRole("button", { name: "Borrar mi cuenta" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole("status")).toContainText("Borramos tu cuenta.");
    await expect(
      page.getByText("Gracias por haber usado Alcanzamos."),
    ).toBeVisible();
    await sinViolaciones(page);
    expect(pedidos[1]).toEqual({
      metodo: "POST",
      ruta: "/api/v1/cuenta/borrado",
      cuerpo: {
        contrasena: "lluvia café tren azul",
        confirma_menores: true,
        menores: ["id-mateo"],
      },
    });
  });

  test("si los menores cambiaron (409) vuelve a leer y pide confirmar a cada uno, sin violaciones", async ({
    page,
  }) => {
    let lecturas = 0;
    await simularApi(page, {
      "GET /api/v1/cuenta/borrado": (ruta) =>
        responder(200, {
          hogar: null,
          menores:
            ++lecturas === 1
              ? [{ id: "id-mateo", nombre: "Mateo" }]
              : [
                  { id: "id-mateo", nombre: "Mateo" },
                  { id: "id-sofia", nombre: "Sofía" },
                ],
        })(ruta, undefined),
      "POST /api/v1/cuenta/borrado": responder(409, {
        error: "menores_cambiaron",
      }),
    });
    await page.goto("/cuenta/borrar");
    await page.getByLabel("Tu contraseña").fill("lluvia café tren azul");
    await page
      .getByLabel("Entiendo que también se borra la cuenta de Mateo.")
      .check();
    await page.getByRole("button", { name: "Borrar mi cuenta" }).click();
    await expect(
      page.getByLabel(
        "Entiendo que también se borran las cuentas de Mateo y Sofía.",
      ),
    ).not.toBeChecked();
    await expect(page.getByText("No pudimos borrar tu cuenta.")).toBeVisible();
    await expect(page).toHaveURL(/\/cuenta\/borrar$/);
    await sinViolaciones(page);
  });

  test("«Descargar mis datos»: baja el ZIP, avisa y no cambia de pantalla; sin violaciones", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(200, {
        hogar: null,
        menores: [],
      }),
      "GET /api/v1/cuenta/datos": (ruta) =>
        ruta.fulfill({
          status: 200,
          contentType: "application/zip",
          headers: {
            "Content-Disposition":
              'attachment; filename="alcanzamos-mis-datos.zip"',
          },
          body: Buffer.from("PK"),
        }),
    });
    await page.goto("/cuenta/borrar");
    const bajada = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar mis datos" }).click();
    expect((await bajada).suggestedFilename()).toBe("alcanzamos-mis-datos.zip");
    await expect(page.getByText("Listo, descargamos tus datos.")).toBeVisible();
    await expect(page).toHaveURL(/\/cuenta\/borrar$/);
    await sinViolaciones(page);
    expect(pedidos.map((p) => p.ruta)).toEqual([
      "/api/v1/cuenta/borrado",
      "/api/v1/cuenta/datos",
    ]);
  });

  test("un error al descargar avisa y deja borrar igual, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(200, {
        hogar: null,
        menores: [],
      }),
      "GET /api/v1/cuenta/datos": responder(500, { error: "error_interno" }),
    });
    await page.goto("/cuenta/borrar");
    await page.getByRole("button", { name: "Descargar mis datos" }).click();
    await expect(
      page.getByText("No pudimos preparar tu archivo."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Borrar mi cuenta" }),
    ).toBeEnabled();
    await sinViolaciones(page);
  });

  test("con hogar, la tarjeta lleva el ícono y el nombre del hogar", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(200, resumenConMenor),
    });
    await page.goto("/cuenta/borrar");
    await expect(
      page
        .getByRole("heading", { level: 2, name: "Nuestro hogar" })
        .locator("svg"),
    ).toBeVisible();
  });

  test("la contraseña que no coincide se queda en la pantalla, con el error en su campo", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(200, {
        hogar: null,
        menores: [],
      }),
      "POST /api/v1/cuenta/borrado": responder(400, {
        error: "contrasena_incorrecta",
      }),
    });
    await page.goto("/cuenta/borrar");
    await page.getByLabel("Tu contraseña").fill("la que no es");
    await page.getByRole("button", { name: "Borrar mi cuenta" }).click();
    await expect(
      page.getByText("No pudimos confirmar tu contraseña. Escríbela de nuevo."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/cuenta\/borrar$/);
    await sinViolaciones(page);
  });

  test("se llega desde «Borrar mi cuenta» de PN-71 y «Ahora no» vuelve", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
      "GET /api/v1/cuenta/borrado": responder(200, {
        hogar: null,
        menores: [],
      }),
    });
    await page.goto("/cuenta/seguridad");
    await page.getByRole("link", { name: "Borrar mi cuenta" }).click();
    await expect(page).toHaveURL(/\/cuenta\/borrar$/);
    await page.getByRole("link", { name: "Ahora no" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
  });

  test("sin poder leer lo que se borra no deja borrar y permite reintentar, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/borrado": responder(500, { error: "error_interno" }),
    });
    await page.goto("/cuenta/borrar");
    await expect(page.getByText("No pudimos cargar tus datos.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Borrar mi cuenta" }),
    ).toHaveCount(0);
    await sinViolaciones(page);
  });
});
