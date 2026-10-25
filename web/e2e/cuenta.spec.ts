import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

const sinConexion =
  "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.";

async function llenarCrearCuenta(page: Page, marcar = true) {
  await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("lluvia café tren azul");
  await page.getByLabel("Nombre para mostrar").fill("Laura");
  if (marcar) await page.getByLabel("Soy mayor de edad").check();
}

test.describe("PN-58 · Crear la cuenta", () => {
  test("sin errores y con la casilla sin marcar no tiene violaciones de axe", async ({
    page,
  }) => {
    await page.goto("/crear-cuenta");
    await expect(
      page.getByRole("heading", { level: 1, name: "Crea tu cuenta" }),
    ).toBeVisible();
    await expect(page.getByLabel("Soy mayor de edad")).not.toBeChecked();
    await expect(page.getByRole("img", { name: "Alcanzamos" })).toBeVisible();
    await sinViolaciones(page);
  });

  test("con todos los errores visibles no tiene violaciones y el foco va al primero", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas": responder(422, {
        error: "validacion",
        campos: {
          correo: "correo_invalido",
          contrasena: "contrasena_comun",
          nombre: "nombre_vacio",
          mayor_de_edad: "mayor_de_edad_requerido",
        },
      }),
    });
    await page.goto("/crear-cuenta");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(
      page.getByText("Falta marcar que eres mayor de edad."),
    ).toBeVisible();
    await expect(page.getByText("Falta el nombre para mostrar.")).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await expect(page.getByLabel("Correo electrónico")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await sinViolaciones(page);
  });

  for (const [nombre, manejador, texto] of [
    [
      "429",
      responder(429, { error: "demasiados_intentos" }),
      "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
    ],
    [
      "error de envío",
      responder(500, { error: "interno" }),
      "No pudimos crear la cuenta.",
    ],
  ] as const) {
    test(`${nombre}: aviso con el foco, sin violaciones de axe`, async ({
      page,
    }) => {
      await simularApi(page, { "POST /api/v1/cuentas": manejador });
      await page.goto("/crear-cuenta");
      await llenarCrearCuenta(page);
      await page.getByRole("button", { name: "Crear cuenta" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: texto }),
      ).toBeFocused();
      await sinViolaciones(page);
    });
  }

  test("sin conexión: aviso y lo escrito se conserva", async ({ page }) => {
    await page.route("**/api/**", (ruta) => ruta.abort("internetdisconnected"));
    await page.goto("/crear-cuenta");
    await llenarCrearCuenta(page);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText(sinConexion)).toBeVisible();
    await expect(page.getByLabel("Nombre para mostrar")).toHaveValue("Laura");
    await sinViolaciones(page);
  });

  test("con 202 va a PN-59 con el correo escrito y manda mayor_de_edad", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuentas": responder(202, {
        estado: "verificacion_pendiente",
      }),
    });
    await page.goto("/crear-cuenta");
    await llenarCrearCuenta(page);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page).toHaveURL(/\/revisa-tu-correo$/);
    await expect(
      page.getByText(
        "Te enviamos un enlace a laura@ejemplo.com. Ábrelo para confirmar tu cuenta.",
      ),
    ).toBeVisible();
    expect(pedidos[0]?.cuerpo).toEqual({
      correo: "laura@ejemplo.com",
      contrasena: "lluvia café tren azul",
      nombre: "Laura",
      mayor_de_edad: true,
    });
  });

  test("solo con el teclado: de los campos a PN-59", async ({ page }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas": responder(202, {
        estado: "verificacion_pendiente",
      }),
    });
    await page.goto("/crear-cuenta");
    const escribir = async (texto: string) => page.keyboard.type(texto);
    // Sin esta espera, en un agente lento el Tab llega antes de que el formulario exista.
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await escribir("laura@ejemplo.com");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
    await escribir("lluvia café tren azul");
    await page.keyboard.press("Tab");
    const ver = page.getByRole("button", { name: "Mostrar la contraseña" });
    await expect(ver).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByLabel("Contraseña", { exact: true }),
    ).toHaveAttribute("type", "text");
    await expect(
      page.getByRole("button", { name: "Ocultar la contraseña" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Nombre para mostrar")).toBeFocused();
    await escribir("Laura");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Soy mayor de edad")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByLabel("Soy mayor de edad")).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Crear cuenta" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/revisa-tu-correo$/);
    // Al llegar a la pantalla nueva el foco está en el título.
    await expect(
      page.getByRole("heading", { level: 1, name: "Revisa tu correo" }),
    ).toBeFocused();
  });

  test("el foco se ve: la caja del campo, la casilla y el botón", async ({
    page,
  }) => {
    await page.goto("/crear-cuenta");
    // Contorno de 2 px sólido; toHaveCSS reintenta hasta que el estilo de foco se aplica.
    const contornoVisible = async (selector: string) => {
      const el = page.locator(selector).first();
      await expect(el).toHaveCSS("outline-style", "solid");
      await expect(el).toHaveCSS("outline-width", "2px");
    };
    // Sin esta espera, en un agente lento el Tab llega antes de que el formulario exista (build 143).
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await contornoVisible(".campo__caja:focus-within");
    await page.getByLabel("Soy mayor de edad").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Soy mayor de edad")).toBeFocused();
    await contornoVisible(".casilla input:focus-visible + .casilla__caja");
    await page.getByRole("button", { name: "Crear cuenta" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Crear cuenta" }),
    ).toBeFocused();
    await contornoVisible(".boton:focus-visible");
  });
});

test.describe("PN-59 · Verificar el correo", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("correo-pendiente", "laura@ejemplo.com"),
    );
  });

  test("estado esperando, sin violaciones", async ({ page }) => {
    await page.goto("/revisa-tu-correo");
    await expect(
      page.getByText("Si no lo confirmas en 7 días, borramos esta cuenta."),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("los números del texto van en Figtree, con cifras tabulares y sin ss02", async ({
    page,
  }) => {
    await page.goto("/revisa-tu-correo");
    await page.evaluate(() => document.fonts.ready);
    const cifra = page.locator(".cifra", { hasText: "7" });
    await expect(cifra).toHaveCount(1);
    const estilo = await cifra.evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        familia: c.fontFamily,
        numeros: c.fontVariantNumeric,
        caracteristicas: c.fontFeatureSettings,
      };
    });
    expect(estilo.familia).toContain("Figtree");
    expect(estilo.numeros).toContain("tabular-nums");
    expect(estilo.caracteristicas).not.toContain("ss02");
    expect(
      await page.evaluate(() => document.fonts.check("600 16px Figtree")),
    ).toBe(true);
  });

  test("«Ya lo confirmé» sin confirmar: aviso; confirmado: PN-63", async ({
    page,
  }) => {
    let verificada = false;
    await simularApi(page, {
      "GET /api/v1/cuentas/estado": (ruta) =>
        responder(200, { verificada })(ruta, undefined),
    });
    await page.goto("/revisa-tu-correo");
    await page.getByRole("button", { name: "Ya lo confirmé" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Todavía no confirmaste tu correo." }),
    ).toBeFocused();
    await sinViolaciones(page);
    verificada = true;
    await page.getByRole("button", { name: "Ya lo confirmé" }).click();
    await expect(page).toHaveURL(/\/privacidad$/);
  });

  test("«Reenviar el correo»: aviso, 30 s de espera con su texto y luego se libera", async ({
    page,
  }) => {
    await page.clock.install();
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuentas/verificacion/reenvio": responder(202, {
        estado: "verificacion_pendiente",
      }),
    });
    await page.goto("/revisa-tu-correo");
    await page.getByRole("button", { name: "Reenviar el correo" }).click();
    await expect(page.getByText("Te enviamos otro correo.")).toBeVisible();
    await expect(
      page.getByText("Puedes pedir otro en un momento."),
    ).toBeVisible();
    const reenviar = page.getByRole("button", { name: "Reenviar el correo" });
    await expect(reenviar).toHaveAttribute("aria-disabled", "true");
    await sinViolaciones(page);
    // Playwright no hace clic en lo aria-disabled salvo con force: es lo que probamos (no hace nada).
    await reenviar.click({ force: true });
    expect(pedidos).toHaveLength(1);
    await page.clock.fastForward(31_000);
    await expect(reenviar).not.toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByText("Puedes pedir otro en un momento."),
    ).toBeHidden();
  });

  test("«Cambiar el correo» (T3): campo en la misma pantalla, error de campo y envío", async ({
    page,
  }) => {
    let respuesta = responder(422, {
      error: "validacion",
      campos: { correo: "correo_invalido" },
    });
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuentas/correo": (ruta, cuerpo) => respuesta(ruta, cuerpo),
    });
    await page.goto("/revisa-tu-correo");
    await page.getByRole("button", { name: "Cambiar el correo" }).click();
    await expect(page).toHaveURL(/\/revisa-tu-correo$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Revisa tu correo" }),
    ).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await expect(
      page.getByText("Te enviaremos un enlace para confirmarlo."),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByLabel("Correo electrónico").fill("otro");
    await page.getByRole("button", { name: "Cambiar el correo" }).click();
    await expect(
      page.getByText(
        "Falta completar el correo. Por ejemplo, nombre@correo.com.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await sinViolaciones(page);
    respuesta = responder(202, { estado: "verificacion_pendiente" });
    await page.getByLabel("Correo electrónico").fill("otro@ejemplo.com");
    await page.getByRole("button", { name: "Cambiar el correo" }).click();
    await expect(
      page.getByText(
        "Te enviamos un enlace a otro@ejemplo.com. Ábrelo para confirmar tu cuenta.",
      ),
    ).toBeVisible();
    expect(pedidos.at(-1)?.cuerpo).toEqual({ correo: "otro@ejemplo.com" });
  });

  test("«Cambiar el correo» con 429 (T1) y «Ya lo confirmé» con 500 (T8): avisos, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/correo": responder(429, {
        error: "demasiados_intentos",
      }),
      "GET /api/v1/cuentas/estado": responder(500, { error: "interno" }),
    });
    await page.goto("/revisa-tu-correo");
    await page.getByRole("button", { name: "Ya lo confirmé" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "No pudimos revisar si confirmaste tu correo." }),
    ).toBeFocused();
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Cambiar el correo" }).click();
    await page.getByLabel("Correo electrónico").fill("otro@ejemplo.com");
    await page.getByRole("button", { name: "Cambiar el correo" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Hiciste muchos intentos." }),
    ).toBeFocused();
    await sinViolaciones(page);
  });
});

test.describe("/verificar?t= · enlace del correo", () => {
  test("enlace bueno con sesión: va enseguida a PN-63 con «Listo, confirmamos tu correo.» como estado (T11)", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(200, {
        estado: "verificado",
        con_sesion: true,
      }),
    });
    await page.goto("/verificar?t=abc123");
    await expect(page).toHaveURL(/\/privacidad$/);
    const estado = page.getByRole("status");
    await expect(estado).toHaveText("Listo, confirmamos tu correo.");
    // El estado va arriba, antes del título.
    const [arribaEstado, arribaTitulo] = await Promise.all([
      estado.evaluate((el) => el.getBoundingClientRect().top),
      page
        .getByRole("heading", { level: 1 })
        .evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(arribaEstado).toBeLessThan(arribaTitulo);
    await sinViolaciones(page);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.cuerpo).toEqual({ token: "abc123" });
  });

  test("enlace bueno sin sesión (otro dispositivo): va enseguida a entrar", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(200, {
        estado: "verificado",
        con_sesion: false,
      }),
    });
    await page.goto("/verificar?t=abc123");
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test("error del servidor (T9): aviso propio, no el del enlace vencido; sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(500, {
        error: "interno",
      }),
    });
    await page.goto("/verificar?t=abc123");
    await expect(
      page.getByText("No pudimos confirmar tu correo."),
    ).toBeVisible();
    await expect(page.getByText("Ese enlace ya no sirve.")).toBeHidden();
    await sinViolaciones(page);
  });

  test("enlace vencido: aviso de atención y «Reenviar el correo», sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(400, {
        error: "enlace_invalido",
      }),
      "POST /api/v1/cuentas/verificacion/reenvio": responder(202, {
        estado: "verificacion_pendiente",
      }),
    });
    await page.goto("/verificar?t=viejo");
    await expect(page.getByText("Ese enlace ya no sirve.")).toBeVisible();
    await expect(page.getByText("Pide uno nuevo.")).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Reenviar el correo" }).click();
    await expect(page).toHaveURL(/\/revisa-tu-correo$/);
  });
});

test.describe("rutas", () => {
  test("/ y las rutas desconocidas llevan a /entrar que no tiene violaciones", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Inicia sesión" }),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.goto("/ruta-que-no-existe");
    await expect(page).toHaveURL(/\/entrar$/);
  });
});
