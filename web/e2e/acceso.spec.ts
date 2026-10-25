import { expect, test } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

const espera =
  "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.";
const sinConexion =
  "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.";

test.describe("PN-60 · Iniciar sesión", () => {
  test("vacía no tiene violaciones de axe", async ({ page }) => {
    await page.goto("/entrar");
    await expect(
      page.getByRole("heading", { level: 1, name: "Inicia sesión" }),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("datos que no coinciden: aviso de atención con el foco, sin violaciones", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "POST /api/v1/sesiones": responder(401, {
        error: "credenciales_invalidas",
      }),
    });
    await page.goto("/entrar");
    await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
    await page.getByLabel("Contraseña", { exact: true }).fill("mala");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    const aviso = page
      .getByRole("status")
      .filter({ hasText: "No pudimos entrar con esos datos." });
    await expect(aviso).toBeFocused();
    await expect(
      page.getByText("Revisa lo que escribiste e intenta de nuevo."),
    ).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toHaveValue(
      "laura@ejemplo.com",
    );
    await sinViolaciones(page);
    expect(pedidos[0]?.cuerpo).toEqual({
      identificador: "laura@ejemplo.com",
      contrasena: "mala",
    });
  });

  test("errores de campo visibles, sin violaciones", async ({ page }) => {
    await simularApi(page, {
      "POST /api/v1/sesiones": responder(422, {
        error: "validacion",
        campos: {
          identificador: "identificador_vacio",
          contrasena: "contrasena_vacia",
        },
      }),
    });
    await page.goto("/entrar");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByText("Falta el correo electrónico.")).toBeVisible();
    await expect(page.getByText("Falta la contraseña.")).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await sinViolaciones(page);
  });

  test("429 y sin conexión, sin violaciones", async ({ page }) => {
    await simularApi(page, {
      "POST /api/v1/sesiones": responder(429, {
        error: "demasiados_intentos",
      }),
    });
    await page.goto("/entrar");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByText(espera)).toBeVisible();
    await sinViolaciones(page);
    await page.unrouteAll();
    await page.route("**/api/**", (ruta) => ruta.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByText(sinConexion)).toBeVisible();
    await sinViolaciones(page);
  });

  test("cuenta sin verificar va a PN-59 con su correo", async ({ page }) => {
    await simularApi(page, {
      "POST /api/v1/sesiones": responder(200, {
        estado: "verificacion_pendiente",
      }),
    });
    await page.goto("/entrar");
    await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
    await page.getByLabel("Contraseña", { exact: true }).fill("lluvia");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/revisa-tu-correo$/);
    await expect(page.getByText(/laura@ejemplo\.com/)).toBeVisible();
  });

  test("cuenta activa con autorización va a la seguridad de la cuenta", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/sesiones": responder(200, { estado: "activa" }),
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
    });
    await page.goto("/entrar");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();
  });

  test("cuenta activa sin autorización va a PN-63", async ({ page }) => {
    await simularApi(page, {
      "POST /api/v1/sesiones": responder(200, { estado: "activa" }),
      "GET /api/v1/cuenta/seguridad": responder(403, {
        error: "autorizacion_pendiente",
      }),
    });
    await page.goto("/entrar");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/privacidad$/);
  });

  test("solo con el teclado: de los campos a la seguridad de la cuenta", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/sesiones": responder(200, { estado: "activa" }),
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
    });
    await page.goto("/entrar");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Correo electrónico")).toBeFocused();
    await page.keyboard.type("laura@ejemplo.com");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
    await page.keyboard.type("lluvia café tren azul");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Mostrar la contraseña" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Crear una cuenta" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Seguridad de la cuenta" }),
    ).toBeFocused();
  });

  test("llega con «Tu sesión se cerró» cuando el API niega la sesión", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(401, { error: "sin_sesion" }),
    });
    await page.goto("/cuenta/seguridad");
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(
      page.getByText("Tu sesión se cerró. Entra de nuevo."),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("error del servidor (T7): «No pudimos iniciar tu sesión.», nunca «datos que no coinciden»", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/sesiones": responder(500, { error: "interno" }),
    });
    await page.goto("/entrar");
    await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
    await page.getByLabel("Contraseña", { exact: true }).fill("lluvia café");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "No pudimos iniciar tu sesión." }),
    ).toBeFocused();
    await expect(
      page.getByText(
        "El problema es de nuestro lado. Intenta de nuevo en un momento.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("No pudimos entrar con esos datos."),
    ).toBeHidden();
    await sinViolaciones(page);
  });

  test("enlace de verificación abierto sin sesión (T11): llega a PN-60 con «Listo, confirmamos tu correo.» arriba como role=status", async ({
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
    await expect(page.getByRole("status")).toHaveText(
      "Listo, confirmamos tu correo.",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Inicia sesión" }),
    ).toBeVisible();
    await sinViolaciones(page);
  });
});

test.describe("PN-61 · Recuperar el acceso", () => {
  test("vacía, con error de campo y con el enlace enviado, sin violaciones", async ({
    page,
  }) => {
    let respuesta = responder(422, {
      error: "validacion",
      campos: { correo: "correo_vacio" },
    });
    await simularApi(page, {
      "POST /api/v1/recuperacion": (ruta, cuerpo) => respuesta(ruta, cuerpo),
    });
    await page.goto("/recuperar-acceso");
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Enviar el enlace" }).click();
    await expect(page.getByText("Falta el correo electrónico.")).toBeVisible();
    await sinViolaciones(page);
    respuesta = responder(202, { estado: "enlace_enviado" });
    await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
    await page.getByRole("button", { name: "Enviar el enlace" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Si ese correo tiene una cuenta, te enviamos un enlace.",
      }),
    ).toBeFocused();
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Volver a iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test("Atrás vuelve a PN-60 y 429 dice el texto de espera", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/recuperacion": responder(429, {
        error: "demasiados_intentos",
      }),
    });
    await page.goto("/recuperar-acceso");
    await page.getByRole("button", { name: "Enviar el enlace" }).click();
    await expect(page.getByText(espera)).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
  });
});

test.describe("PN-62 · Elegir la contraseña nueva", () => {
  test("errores presentacionales y del API visibles, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/recuperacion/contrasena": responder(422, {
        error: "validacion",
        campos: { contrasena: "contrasena_corta" },
      }),
    });
    await page.goto("/recuperar?t=abc");
    await sinViolaciones(page);
    await page
      .getByLabel("Contraseña nueva", { exact: true })
      .fill("una frase larga");
    await page.getByLabel("Repite la contraseña nueva").fill("otra distinta");
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();
    await expect(
      page.getByText("Falta que las dos contraseñas sean iguales."),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByLabel("Repite la contraseña nueva").fill("una frase larga");
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();
    await expect(
      page.getByText("Falta que la contraseña tenga al menos 15 caracteres."),
    ).toBeVisible();
    await expect(
      page.getByLabel("Contraseña nueva", { exact: true }),
    ).toBeFocused();
    await sinViolaciones(page);
  });

  test("guardada va a PN-60 con «Listo, cambiaste tu contraseña.»", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "POST /api/v1/recuperacion/contrasena": responder(200, {
        estado: "contrasena_cambiada",
      }),
    });
    await page.goto("/recuperar?t=abc");
    await page
      .getByLabel("Contraseña nueva", { exact: true })
      .fill("lluvia café tren azul");
    await page
      .getByLabel("Repite la contraseña nueva")
      .fill("lluvia café tren azul");
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(
      page.getByText("Listo, cambiaste tu contraseña."),
    ).toBeVisible();
    await sinViolaciones(page);
    expect(pedidos[0]?.cuerpo).toEqual({
      token: "abc",
      contrasena: "lluvia café tren azul",
    });
  });

  test("enlace vencido: aviso, sin campos y «Pedir otro enlace», sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/recuperacion/contrasena": responder(400, {
        error: "enlace_invalido",
      }),
    });
    await page.goto("/recuperar?t=viejo");
    await page
      .getByLabel("Contraseña nueva", { exact: true })
      .fill("lluvia café tren azul");
    await page
      .getByLabel("Repite la contraseña nueva")
      .fill("lluvia café tren azul");
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();
    await expect(page.getByText("Ese enlace ya no sirve.")).toBeVisible();
    await expect(
      page.getByLabel("Contraseña nueva", { exact: true }),
    ).toHaveCount(0);
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Pedir otro enlace" }).click();
    await expect(page).toHaveURL(/\/recuperar-acceso$/);
  });
});

test.describe("PN-71 · Seguridad de la cuenta", () => {
  test("con ingreso anterior: fecha en palabras en Bogotá, cifras en Figtree sin ss02, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: "2026-11-02T02:40:00Z",
      }),
    });
    await page.goto("/cuenta/seguridad");
    await expect(
      page.getByText(
        "Tu ingreso anterior fue el 1 de noviembre de 2026, a las 9:40 p. m.",
      ),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const cifras = page.locator("section .cifra");
    await expect(cifras).toHaveText(["1", "2026", "9:40"]);
    for (const cifra of await cifras.all()) {
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
    }
    await sinViolaciones(page);
  });

  test("la hora sale en Bogotá aunque el navegador esté en otra zona", async ({
    browser,
  }) => {
    const contexto = await browser.newContext({ timezoneId: "Asia/Tokyo" });
    const page = await contexto.newPage();
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: "2026-11-02T02:40:00Z",
      }),
    });
    await page.goto("http://127.0.0.1:4173/cuenta/seguridad");
    await expect(
      page.getByText(
        "Tu ingreso anterior fue el 1 de noviembre de 2026, a las 9:40 p. m.",
      ),
    ).toBeVisible();
    await contexto.close();
  });

  test("primer ingreso y error de carga, sin violaciones", async ({ page }) => {
    let respuesta = responder(200, { ingreso_anterior: null });
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": (ruta, cuerpo) => respuesta(ruta, cuerpo),
    });
    await page.goto("/cuenta/seguridad");
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();
    await sinViolaciones(page);
    respuesta = responder(500, { error: "interno" });
    await page.reload();
    await expect(
      page.getByText("No pudimos cargar tu último ingreso."),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("Cerrar sesión sale a PN-60 y «Cambiar mi contraseña» lleva a PN-73", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: "2026-11-02T02:40:00Z",
      }),
      "DELETE /api/v1/sesiones/actual": (ruta) => ruta.fulfill({ status: 204 }),
    });
    await page.goto("/cuenta/seguridad");
    await page.getByRole("link", { name: "Cambiar mi contraseña" }).click();
    await expect(page).toHaveURL(/\/cuenta\/contrasena$/);
    await page.getByRole("link", { name: "Ahora no" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
  });
});

test.describe("PN-73 · Cambiar la contraseña", () => {
  test("vacía y con los errores de campo visibles, sin violaciones", async ({
    page,
  }) => {
    await simularApi(page, {
      "POST /api/v1/cuenta/contrasena": responder(422, {
        error: "validacion",
        campos: {
          contrasena_actual: "contrasena_vacia",
          contrasena_nueva: "contrasena_comun",
        },
      }),
    });
    await page.goto("/cuenta/contrasena");
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();
    await expect(page.getByText("Falta tu contraseña de ahora.")).toBeVisible();
    await expect(page.getByLabel("Tu contraseña de ahora")).toBeFocused();
    await sinViolaciones(page);
  });

  test("la de ahora incorrecta, 429 y error de guardado, sin violaciones", async ({
    page,
  }) => {
    let respuesta = responder(400, { error: "contrasena_actual_incorrecta" });
    await simularApi(page, {
      "POST /api/v1/cuenta/contrasena": (ruta, cuerpo) =>
        respuesta(ruta, cuerpo),
    });
    await page.goto("/cuenta/contrasena");
    const guardar = page.getByRole("button", { name: "Guardar la contraseña" });
    await guardar.click();
    await expect(
      page.getByText(
        "No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.",
      ),
    ).toBeVisible();
    await sinViolaciones(page);
    respuesta = responder(429, { error: "demasiados_intentos" });
    await guardar.click();
    await expect(page.getByText(espera)).toBeVisible();
    await sinViolaciones(page);
    respuesta = responder(500, { error: "interno" });
    await guardar.click();
    await expect(
      page.getByText("Tu contraseña de ahora sigue igual. Intenta de nuevo."),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("guardada vuelve a PN-71 con el logro y sin violaciones", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuenta/contrasena": responder(200, {
        estado: "contrasena_cambiada",
      }),
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
    });
    await page.goto("/cuenta/contrasena");
    await page.getByLabel("Tu contraseña de ahora").fill("la de ahora");
    await page.getByLabel("Tu contraseña nueva").fill("lluvia café tren azul");
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(
      page.getByText("Listo, cambiamos tu contraseña."),
    ).toBeVisible();
    await expect(
      page.getByText("Cerramos tus otras sesiones. Esta sigue abierta."),
    ).toBeVisible();
    await sinViolaciones(page);
    expect(pedidos[0]?.cuerpo).toEqual({
      contrasena_actual: "la de ahora",
      contrasena_nueva: "lluvia café tren azul",
    });
  });

  test("sin autorización el API manda a PN-63", async ({ page }) => {
    await simularApi(page, {
      "POST /api/v1/cuenta/contrasena": responder(403, {
        error: "autorizacion_pendiente",
      }),
    });
    await page.goto("/cuenta/contrasena");
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();
    await expect(page).toHaveURL(/\/privacidad$/);
  });
});
