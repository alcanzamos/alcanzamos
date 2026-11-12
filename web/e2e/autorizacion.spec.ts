import { expect, test } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";
import {
  AVISOS,
  catalogoCompleto,
  catalogoLimitado,
  NECESARIAS,
  TRANSMISION,
} from "./datosDeAutorizacion";

const catalogo = catalogoCompleto;

test.describe("PN-63 · Información de privacidad", () => {
  test("USA-003 sin violaciones de axe, con las ocho tarjetas, sin Atrás y con «Continuar» a PN-64", async ({
    page,
  }) => {
    await page.goto("/privacidad");
    await expect(
      page.getByRole("heading", { level: 1, name: "Cómo cuidamos tus datos" }),
    ).toBeVisible();
    await expect(page.getByRole("region")).toHaveCount(8);
    // Sin Atrás; el único enlace es «Leer la política completa» (E14-PCP 4.6, fila 10).
    await expect(page.getByRole("link")).toHaveText([
      "Leer la política completa",
    ]);
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page).toHaveURL(/\/autorizacion$/);
  });

  // USA-003 (RNF-011, E14-PCP 3 «Información antes de autorizar»): en el primer uso, PN-74 lleva a PN-63 y no a PN-64;
  // PN-63 no pide nada ni consulta la autorización, y PN-64 sale solo después de «Continuar».
  test("USA-003 en el primer uso la información sale antes de la autorización: PN-74 → PN-63 → «Continuar» → PN-64", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "POST /api/v1/cuentas/verificacion": responder(200, { estado: "activa" }),
      "GET /api/v1/autorizaciones": responder(200, catalogo),
    });
    await page.goto("/verificar?t=abc123");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill("lluvia café tren azul");
    await page.getByLabel("Nombre para mostrar").fill("Laura");
    await page.getByRole("button", { name: "Guardar la contraseña" }).click();

    await expect(page).toHaveURL(/\/privacidad$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cómo cuidamos tus datos" }),
    ).toBeVisible();
    await expect(page.getByRole("region")).toHaveCount(8);
    await expect(
      page.getByRole("heading", { name: "Tu autorización" }),
    ).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      "POST /api/v1/cuentas/verificacion",
    ]);

    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page).toHaveURL(/\/autorizacion$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tu autorización" }),
    ).toBeVisible();
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      "POST /api/v1/cuentas/verificacion",
      "GET /api/v1/autorizaciones",
    ]);
  });

  // USA-003 (RNF-011, RF-059; E14-PCP 4.6 y nota del 2026-11-08 de 4.14, bug 260): mientras no exista PN-66, el inicio de
  // quien ya autorizó es PN-71, que lleva la entrada provisional «Cómo cuidamos tus datos». De un toque abre PN-63 desde
  // el menú: las mismas ocho tarjetas, con Atrás y sin «Continuar», sin pedir nada al API. Atrás vuelve a PN-71.
  test("USA-003 la información de privacidad está a un toque del inicio", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
    });
    await page.goto("/cuenta/seguridad");
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();

    await page.getByRole("link", { name: "Cómo cuidamos tus datos" }).click();
    await expect(page).toHaveURL(/\/cuenta\/privacidad$/);
    const titulo = page.getByRole("heading", {
      level: 1,
      name: "Cómo cuidamos tus datos",
    });
    await expect(titulo).toBeVisible();
    await expect(titulo).toBeFocused();
    await expect(page.getByRole("region")).toHaveCount(8);
    await expect(page.getByRole("link", { name: "Atrás" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Leer la política completa" }),
    ).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
    await sinViolaciones(page);
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      "GET /api/v1/cuenta/seguridad",
    ]);

    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();
  });
});

test.describe("PN-64 · Autorización de datos", () => {
  test("sin violaciones de axe: al llegar, sin marcar, y con el error de lo necesario", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogo),
    });
    await page.goto("/autorizacion");
    await expect(
      page.getByRole("heading", { level: 1, name: "Tu autorización" }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(4);
    for (const casilla of await page.getByRole("checkbox").all())
      await expect(casilla).not.toBeChecked();
    await expect(
      page.getByText("Texto versión 1.1 del 12 de noviembre de 2026."),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Autorizar y continuar" }).click();
    await expect(
      page.getByText("Falta tu autorización para lo necesario."),
    ).toBeVisible();
    await expect(
      page.getByText("Falta que aceptes dónde guardamos tus datos."),
    ).toBeVisible();
    await expect(page.getByLabel(NECESARIAS)).toBeFocused();
    await sinViolaciones(page);
    expect(pedidos).toHaveLength(1);
  });

  test("«No autorizo» borra la cuenta y va a PN-60 con «Borramos el correo que nos diste.»", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogo),
      "POST /api/v1/autorizaciones/rechazo": (ruta) =>
        ruta.fulfill({ status: 204 }),
    });
    await page.goto("/autorizacion");
    await page.getByRole("button", { name: "No autorizo" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(
      page.getByRole("status").filter({
        hasText: "Borramos el correo que nos diste.",
      }),
    ).toBeVisible();
    await sinViolaciones(page);
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      "GET /api/v1/autorizaciones",
      "POST /api/v1/autorizaciones/rechazo",
    ]);
  });

  // S2 (dueño, 2026-10-24): «una persona nueva que entra, autoriza en PN-64 y llega a PN-71 en la misma sesión debe ver
  // «Este es tu primer ingreso.»». El API está simulado: igual que el real, autorizar no reautentica ni toca el ingreso
  // anterior, y PN-71 contesta `ingreso_anterior: null` solo porque nada vuelve a iniciar sesión (la prueba de integración
  // del API, TestS2LaPersonaNuevaAutorizaYVeSuPrimerIngresoEnLaMismaSesion, prueba el lado del servidor).
  test("USA-003 S2: una persona nueva que entra, autoriza en PN-64 y llega a PN-71 en la misma sesión ve «Este es tu primer ingreso.»", async ({
    page,
  }) => {
    let autorizada = false;
    const pedidos = await simularApi(page, {
      "POST /api/v1/sesiones": responder(200, { estado: "activa" }),
      "GET /api/v1/cuenta/seguridad": (ruta, cuerpo) =>
        autorizada
          ? responder(200, { ingreso_anterior: null })(ruta, cuerpo)
          : responder(403, { error: "autorizacion_pendiente" })(ruta, cuerpo),
      "GET /api/v1/autorizaciones": responder(200, catalogo),
      "POST /api/v1/autorizaciones": (ruta, cuerpo) => {
        autorizada = true;
        return responder(200, { estado: "autorizada" })(ruta, cuerpo);
      },
    });

    // Entra: la cuenta no tiene autorización, así que PN-71 la manda a PN-63.
    await page.goto("/entrar");
    await page.getByLabel("Correo electrónico").fill("laura@ejemplo.com");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill("lluvia café tren azul");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/privacidad$/);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page).toHaveURL(/\/autorizacion$/);

    // Autoriza lo necesario y una accesoria en PN-64.
    await page.getByLabel(NECESARIAS).check();
    await page.getByLabel(TRANSMISION).check();
    await page.getByLabel(AVISOS).check();
    await page.getByRole("button", { name: "Autorizar y continuar" }).click();

    // Llega a PN-71 en la misma sesión: ve su primer ingreso.
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();
    await sinViolaciones(page);

    const hechos = pedidos.map((p) => `${p.metodo} ${p.ruta}`);
    expect(hechos.filter((h) => h === "POST /api/v1/sesiones")).toHaveLength(1);
    expect(
      pedidos.find(
        (p) => p.metodo === "POST" && p.ruta === "/api/v1/autorizaciones",
      )?.cuerpo,
    ).toEqual({
      finalidades: [
        "cuenta_y_acceso",
        "funciones_financieras",
        "transmision_a_encargados",
        "avisos",
      ],
      version: "1.1",
    });
  });

  // SC-E21-25 3.6 y 3.8, criterio 1: la tarjeta «Dónde guardamos tus datos» y la frase de los avisos, bajo su casilla.
  test("la tarjeta «Dónde guardamos tus datos» y la frase de los avisos con la app cerrada, sin violaciones de axe", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogo),
    });
    await page.goto("/autorizacion");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Lo necesario para usar la app",
      "Dónde guardamos tus datos",
      "Lo que puedes elegir",
    ]);
    await expect(
      page.getByRole("region", { name: "Dónde guardamos tus datos" }),
    ).toContainText("Microsoft Azure, en México");
    // Solo la casilla de la tarjeta lleva el error; el error de la tarjeta y su nota describen la casilla.
    await page.getByLabel(NECESARIAS).check();
    await page.getByRole("button", { name: "Autorizar y continuar" }).click();
    const casilla = page.getByLabel(TRANSMISION);
    await expect(casilla).toBeFocused();
    await expect(casilla).toHaveAccessibleDescription(
      /^Falta que aceptes dónde guardamos tus datos\. Sin esta aceptación no podemos darte la cuenta/,
    );
    await sinViolaciones(page);
    await expect(page.getByLabel(AVISOS)).toHaveAccessibleDescription(
      /^Si activas los avisos con la app cerrada, el código de tu teléfono o de tu navegador/,
    );
    await expect(page.getByLabel(AVISOS)).not.toBeChecked();
  });

  // SC-E21-25 3.8, criterio 10 (a): sin «Autorizo los avisos con la app cerrada.» la web no pide la suscripción de push ni
  // manda ninguna petición para registrar el token; el API simulado falla la prueba con cualquier pedido no previsto.
  test("autorizar sin los avisos no suscribe el navegador a push ni registra ningún token (criterio 10)", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogo),
      "POST /api/v1/autorizaciones": responder(200, { estado: "autorizada" }),
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
    });
    await page.goto("/autorizacion");
    await page.getByLabel(NECESARIAS).check();
    await page.getByLabel(TRANSMISION).check();
    await page.getByRole("button", { name: "Autorizar y continuar" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();
    expect(
      pedidos.filter((p) => p.ruta.startsWith("/api/v1/dispositivos")),
    ).toEqual([]);
    const suscripcion = await page.evaluate(async () => {
      const registro = await navigator.serviceWorker?.getRegistration();
      return registro ? await registro.pushManager.getSubscription() : null;
    });
    expect(suscripcion).toBeNull();
  });

  // D-195: «Leer la política completa» abre PN-68 con la versión del texto que se ve, y Atrás vuelve con lo marcado.
  test("«Leer la política completa» abre PN-68 con la versión que se ve y Atrás vuelve con lo marcado", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogo),
    });
    await page.goto("/autorizacion");
    await page.getByLabel(TRANSMISION).check();
    await page.getByLabel(AVISOS).check();
    await page.getByRole("link", { name: "Leer la política completa" }).click();
    await expect(page).toHaveURL(/\/politica\?desde=%2Fautorizacion$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Política de tratamiento" }),
    ).toBeVisible();
    await expect(
      page.getByText("Versión 1.1 del 12 de noviembre de 2026."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/autorizacion$/);
    await expect(page.getByLabel(TRANSMISION)).toBeChecked();
    await expect(page.getByLabel(AVISOS)).toBeChecked();
    await expect(page.getByLabel(NECESARIAS)).not.toBeChecked();
  });
});

// SC-E21-25 sección 5 y 3.8, criterio 6: la cuenta de antes del cambio ve solo la tarjeta que le falta y, al aceptar,
// llega a Inicio con todos sus datos.
test.describe("PN-64 · modo «falta una aceptación»", () => {
  test("solo la tarjeta que falta, sin violaciones de axe, y al aceptar manda solo esa aceptación y llega a Inicio", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogoLimitado),
      "POST /api/v1/autorizaciones": responder(200, { estado: "autorizada" }),
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: "2026-12-13T02:40:00Z",
      }),
    });
    await page.goto("/autorizacion");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Dónde guardamos tus datos",
    ]);
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expect(page.getByLabel(TRANSMISION)).not.toBeChecked();
    await expect(page.getByText("Lo necesario para usar la app")).toHaveCount(
      0,
    );
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Autorizar y continuar" }).click();
    await expect(
      page.getByText("Falta que aceptes dónde guardamos tus datos."),
    ).toBeVisible();
    await sinViolaciones(page);
    expect(pedidos).toHaveLength(1);
    await page.getByLabel(TRANSMISION).check();
    await page.getByRole("button", { name: "Autorizar y continuar" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(
      page.getByText(/Tu ingreso anterior fue el 12 de diciembre de 2026/),
    ).toBeVisible();
    expect(pedidos.find((p) => p.metodo === "POST")?.cuerpo).toEqual({
      finalidades: ["transmision_a_encargados"],
      version: "1.1",
    });
  });

  test("«No autorizo» abre la hoja de PN-54 sin llamar al rechazo, con la descarga y la contraseña, y «Volver y decidir» la cierra", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogoLimitado),
      "GET /api/v1/cuenta/borrado": responder(200, {
        hogar: null,
        menores: [],
      }),
    });
    await page.goto("/autorizacion");
    await page.getByLabel(TRANSMISION).check();
    await page.getByRole("button", { name: "No autorizo" }).click();
    const hoja = page.getByRole("dialog", { name: "¿No autorizas?" });
    await expect(hoja).toBeVisible();
    await expect(
      hoja.getByText("Si no autorizas, borramos tu cuenta y tu historial."),
    ).toBeVisible();
    await expect(hoja.getByLabel("Tu contraseña")).toBeVisible();
    await expect(
      hoja.getByRole("button", { name: "Descargar mis datos" }),
    ).toBeVisible();
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Borrar mi cuenta" }).click();
    await expect(
      hoja.getByText("Falta tu contraseña para borrar la cuenta."),
    ).toBeVisible();
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Volver y decidir" }).click();
    await expect(hoja).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "No autorizo" }),
    ).toBeFocused();
    await expect(page.getByLabel(TRANSMISION)).toBeChecked();
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      "GET /api/v1/autorizaciones",
      "GET /api/v1/cuenta/borrado",
    ]);
  });

  test("desde la hoja se borra la cuenta con la contraseña y va a PN-60 con «Borramos tu cuenta.»", async ({
    page,
  }) => {
    const pedidos = await simularApi(page, {
      "GET /api/v1/autorizaciones": responder(200, catalogoLimitado),
      "GET /api/v1/cuenta/borrado": responder(200, {
        hogar: null,
        menores: [],
      }),
      "POST /api/v1/cuenta/borrado": responder(200, {
        estado: "cuenta_borrada",
      }),
    });
    await page.goto("/autorizacion");
    await page.getByRole("button", { name: "No autorizo" }).click();
    const hoja = page.getByRole("dialog", { name: "¿No autorizas?" });
    await hoja.getByLabel("Tu contraseña").fill("lluvia café tren azul");
    await hoja.getByRole("button", { name: "Borrar mi cuenta" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Borramos tu cuenta." }),
    ).toBeVisible();
    expect(pedidos.at(-1)?.cuerpo).toEqual({
      contrasena: "lluvia café tren azul",
      confirma_menores: false,
      menores: [],
    });
  });
});
