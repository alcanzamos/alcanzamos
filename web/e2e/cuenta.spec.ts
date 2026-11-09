import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

const sinConexion =
  "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.";

async function llenarCrearCuenta(page: Page, marcar = true) {
  await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
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
          mayor_de_edad: "mayor_de_edad_requerido",
        },
      }),
    });
    await page.goto("/crear-cuenta");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(
      page.getByText("Falta marcar que eres mayor de edad."),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Falta completar el correo. Por ejemplo, nombre@correo.com.",
      ),
    ).toBeVisible();
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
    await expect(page.getByLabel("Correo electrónico")).toHaveValue(
      "laura@ejemplo.com",
    );
    await sinViolaciones(page);
  });

  test("pide solo el correo y la casilla, con los textos aprobados de D-176", async ({
    page,
  }) => {
    await page.goto("/crear-cuenta");
    await expect(page.getByText("Empecemos por tu correo.")).toBeVisible();
    await expect(
      page.getByText(
        "Te enviaremos un enlace para confirmarlo y elegir tu contraseña.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Después de confirmar tu correo elegirás tu contraseña, verás cómo cuidamos tus datos y decidirás si los autorizas.",
      ),
    ).toBeVisible();
    await expect(page.locator("input")).toHaveCount(2);
    await expect(page.getByLabel("Contraseña")).toHaveCount(0);
    await expect(page.getByLabel("Nombre para mostrar")).toHaveCount(0);
  });

  test("con 202 va a PN-59 con el correo escrito y manda solo el correo y mayor_de_edad", async ({
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
        "Te enviamos un correo a laura@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
      ),
    ).toBeVisible();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.cuerpo).toEqual({
      correo: "laura@ejemplo.com",
      mayor_de_edad: true,
    });
  });

  test("solo con el teclado: del correo a PN-59", async ({ page }) => {
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

  test("no tiene «Ya lo confirmé» ni «Cambiar el correo», y «Usar otro correo» vuelve a PN-58 con lo escrito", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {});
    await page.goto("/revisa-tu-correo");
    await expect(
      page.getByText(
        "Te enviamos un correo a laura@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Ya lo confirmé")).toHaveCount(0);
    await expect(page.getByText("Cambiar el correo")).toHaveCount(0);
    // Sin sesión: abrirla no consulta nada al API.
    expect(pedidos).toEqual([]);
    await page.getByRole("link", { name: "Usar otro correo" }).click();
    await expect(page).toHaveURL(/\/crear-cuenta$/);
    await expect(page.getByLabel("Correo electrónico")).toHaveValue(
      "laura@ejemplo.com",
    );
    await expect(page.getByLabel("Soy mayor de edad")).not.toBeChecked();
  });

  test("«Reenviar el correo»: manda el correo sin sesión, avisa, 30 s de espera con su texto y luego se libera", async ({
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
    expect(pedidos[0]?.cuerpo).toEqual({ correo: "laura@ejemplo.com" });
    await page.clock.fastForward(31_000);
    await expect(reenviar).not.toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByText("Puedes pedir otro en un momento."),
    ).toBeHidden();
  });

  test("«Reenviar el correo» con 429 (T1): «Hiciste muchos intentos…» con el foco, el botón espera y sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion/reenvio": responder(429, {
        error: "demasiados_intentos",
      }),
    });
    await page.goto("/revisa-tu-correo");
    await page.getByRole("button", { name: "Reenviar el correo" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Hiciste muchos intentos." }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Reenviar el correo" }),
    ).toHaveAttribute("aria-disabled", "true");
    await sinViolaciones(page);
  });

  test("«Reenviar el correo» con error del servidor: «No pudimos enviar el correo.» y sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion/reenvio": responder(500, {
        error: "interno",
      }),
    });
    await page.goto("/revisa-tu-correo");
    await page.getByRole("button", { name: "Reenviar el correo" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "No pudimos enviar el correo." }),
    ).toBeFocused();
    await sinViolaciones(page);
  });
});

test.describe("PN-59 sin la dirección (T3 y T4)", () => {
  test("pide el correo en la misma pantalla, muestra el error de campo y reenvía", async ({
    page,
  }) => {
    let respuesta = responder(422, {
      error: "validacion",
      campos: { correo: "correo_invalido" },
    });
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuentas/verificacion/reenvio": (ruta, cuerpo) =>
        respuesta(ruta, cuerpo),
    });
    await page.goto("/revisa-tu-correo");
    await expect(
      page.getByText(
        "Te enviamos un correo. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
      ),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Reenviar el correo" }).click();
    await expect(page).toHaveURL(/\/revisa-tu-correo$/);
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await expect(
      page.getByText(
        "Te enviaremos un enlace para confirmarlo y elegir tu contraseña.",
      ),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByLabel("Correo electrónico").fill("otro");
    await page.getByRole("button", { name: "Reenviar el correo" }).click();
    await expect(
      page.getByText(
        "Falta completar el correo. Por ejemplo, nombre@correo.com.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await sinViolaciones(page);
    respuesta = responder(202, { estado: "verificacion_pendiente" });
    await page.getByLabel("Correo electrónico").fill("otro@ejemplo.com");
    await page.getByRole("button", { name: "Reenviar el correo" }).click();
    await expect(
      page.getByText(
        "Te enviamos un correo a otro@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
      ),
    ).toBeVisible();
    expect(pedidos.at(-1)?.cuerpo).toEqual({ correo: "otro@ejemplo.com" });
  });
});

test.describe("PN-74 · Elige tu contraseña (/verificar?t=)", () => {
  async function llenarPN74(page: Page, contrasena = "lluvia café tren azul") {
    await page.getByLabel("Contraseña", { exact: true }).fill(contrasena);
    await page.getByLabel("Nombre para mostrar").fill("Laura");
  }
  const guardar = (page: Page) =>
    page.getByRole("button", { name: "Guardar la contraseña" }).click();

  test("vacía: textos de E14, Mostrar la contraseña y sin violaciones; abrir el enlace no llama al API", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {});
    await page.goto("/verificar?t=abc123");
    await expect(
      page.getByRole("heading", { level: 1, name: "Elige tu contraseña" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Un último paso para crear tu cuenta. Elige tu contraseña y dinos cómo quieres que te llamemos.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mostrar la contraseña" }).click();
    await expect(
      page.getByLabel("Contraseña", { exact: true }),
    ).toHaveAttribute("type", "text");
    await expect(page.getByLabel("Correo electrónico")).toHaveCount(0);
    expect(pedidos).toEqual([]);
    await sinViolaciones(page);
  });

  test("USA-003 guardada: PN-58 → PN-59 → enlace → PN-74 → PN-63 con «Listo, confirmamos tu correo.» arriba como role=status (T11)", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuentas": responder(202, {
        estado: "verificacion_pendiente",
      }),
      "POST /api/v1/cuentas/verificacion": responder(200, {
        estado: "activa",
      }),
    });
    await page.goto("/crear-cuenta");
    await llenarCrearCuenta(page);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page).toHaveURL(/\/revisa-tu-correo$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Revisa tu correo" }),
    ).toBeFocused();
    // La persona abre el enlace del correo.
    await page.goto("/verificar?t=abc123");
    await llenarPN74(page);
    await guardar(page);
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
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      "POST /api/v1/cuentas",
      "POST /api/v1/cuentas/verificacion",
    ]);
    expect(pedidos[1]?.cuerpo).toEqual({
      token: "abc123",
      contrasena: "lluvia café tren azul",
      nombre: "Laura",
    });
  });

  test("errores de campo (D-142 y D-192): los dos a la vez, con el foco en la contraseña, lo escrito se conserva y sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(422, {
        error: "validacion",
        campos: { contrasena: "contrasena_personal", nombre: "nombre_largo" },
      }),
    });
    await page.goto("/verificar?t=abc123");
    await llenarPN74(page, "laura@ejemplo.com laura");
    await guardar(page);
    await expect(
      page.getByText(
        "Falta una contraseña que no incluya tu correo ni la palabra «Alcanzamos».",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Escribe un nombre de hasta 60 caracteres."),
    ).toBeVisible();
    await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
    await expect(
      page.getByLabel("Contraseña", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Nombre para mostrar")).toHaveValue("Laura");
    await sinViolaciones(page);
  });

  // D-192 (c): el API da el mismo 400 enlace_invalido si el enlace venció, ya se usó o lo reemplazó uno nuevo.
  test("enlace vencido, ya usado o reemplazado: «Ese enlace ya no sirve.» con «Pedir otro enlace» que lleva a PN-58, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(400, {
        error: "enlace_invalido",
      }),
    });
    await page.goto("/verificar?t=viejo");
    await llenarPN74(page);
    await guardar(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Ese enlace ya no sirve." }),
    ).toBeFocused();
    await expect(page.getByText("Pide uno nuevo.")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toHaveCount(0);
    await expect(
      page.getByText("No pudimos guardar tu contraseña."),
    ).toHaveCount(0);
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Pedir otro enlace" }).click();
    await expect(page).toHaveURL(/\/crear-cuenta$/);
  });

  test("sin token: el mismo estado de enlace vencido, sin llamar al API", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {});
    await page.goto("/verificar");
    await expect(page.getByText("Ese enlace ya no sirve.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Pedir otro enlace" }),
    ).toBeVisible();
    expect(pedidos).toEqual([]);
    await sinViolaciones(page);
  });

  test("429: «Hiciste muchos intentos…» y lo escrito se conserva, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(429, {
        error: "demasiados_intentos",
      }),
    });
    await page.goto("/verificar?t=abc123");
    await llenarPN74(page);
    await guardar(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Hiciste muchos intentos." }),
    ).toBeFocused();
    await expect(page.getByLabel("Nombre para mostrar")).toHaveValue("Laura");
    await sinViolaciones(page);
  });

  test("error del servidor: «No pudimos guardar tu contraseña.», no el del enlace vencido; sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(500, {
        error: "interno",
      }),
    });
    await page.goto("/verificar?t=abc123");
    await llenarPN74(page);
    await guardar(page);
    await expect(
      page.getByText("No pudimos guardar tu contraseña."),
    ).toBeVisible();
    await expect(page.getByText("Ese enlace ya no sirve.")).toBeHidden();
    await sinViolaciones(page);
  });

  test("sin conexión: aviso y lo escrito se conserva", async ({ page }) => {
    await page.route("**/api/**", (ruta) => ruta.abort("internetdisconnected"));
    await page.goto("/verificar?t=abc123");
    await llenarPN74(page);
    await guardar(page);
    await expect(page.getByText(sinConexion)).toBeVisible();
    await expect(page.getByLabel("Nombre para mostrar")).toHaveValue("Laura");
    await sinViolaciones(page);
  });

  test("solo con el teclado: contraseña, Mostrar, nombre y Guardar", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(200, {
        estado: "activa",
      }),
    });
    await page.goto("/verificar?t=abc123");
    await expect(page.getByLabel("Nombre para mostrar")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
    await page.keyboard.type("lluvia café tren azul");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Mostrar la contraseña" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Nombre para mostrar")).toBeFocused();
    await page.keyboard.type("Laura");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Guardar la contraseña" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/privacidad$/);
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
