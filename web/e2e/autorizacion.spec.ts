import { expect, test } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

const finalidades = [
  { codigo: "cuenta_y_acceso", tipo: "necesaria", otorgada: false },
  { codigo: "funciones_financieras", tipo: "necesaria", otorgada: false },
  { codigo: "avisos", tipo: "accesoria", otorgada: false },
  { codigo: "horas_de_vida", tipo: "accesoria", otorgada: false },
];
const catalogo = {
  version: { numero: "1.0", fecha: "2026-10-30" },
  finalidades,
};
const NECESARIAS =
  "Autorizo el uso de mis datos para estas finalidades necesarias.";

test.describe("PN-63 · Información de privacidad", () => {
  test("USA-003 sin violaciones de axe, con las ocho tarjetas, sin Atrás y con «Continuar» a PN-64", async ({
    page,
  }) => {
    await page.goto("/privacidad");
    await expect(
      page.getByRole("heading", { level: 1, name: "Cómo cuidamos tus datos" }),
    ).toBeVisible();
    await expect(page.getByRole("region")).toHaveCount(8);
    await expect(page.getByRole("link")).toHaveCount(0);
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

  // USA-003 (RNF-011, RF-059, E14-PCP 3 «A un toque del menú principal» y 4.9): desde el menú principal, la fila «Cómo
  // cuidamos tus datos» abre PN-63 de un toque, en el modo «desde el menú» (E14-PCP 4.6): con Atrás y sin «Continuar».
  // El menú principal es PN-66; mientras no exista, la pantalla de inicio de quien ya autorizó es PN-71, que tiene las
  // filas 7 y 8 de PN-66 (SeguridadDeLaCuenta.tsx), y es ahí donde se busca la fila.
  test("USA-003 a un toque del menú principal: «Cómo cuidamos tus datos» abre PN-63 con Atrás y sin «Continuar»", async ({
    page,
  }) => {
    // Defecto (USA-003, I06; hallado en la US-65): la web no tiene el menú PN-66 y su inicio provisional (PN-71) no lleva
    // a PN-63: la información de privacidad solo se ve en el primer uso. PN-63 tampoco tiene el modo «desde el menú»
    // (Privacidad.tsx: siempre con «Continuar» y sin Atrás). Cuando se construya, esta prueba pasa y hay que quitar esto.
    test.fail(
      true,
      "PN-63 no está a un toque del menú principal: falta PN-66 y el modo «desde el menú» de PN-63",
    );
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
    });
    await page.goto("/cuenta/seguridad");
    await expect(page.getByText("Este es tu primer ingreso.")).toBeVisible();

    const fila = page
      .getByRole("link", { name: "Cómo cuidamos tus datos" })
      .or(page.getByRole("button", { name: "Cómo cuidamos tus datos" }));
    await expect(fila).toBeVisible();
    await fila.click();

    await expect(page).toHaveURL(/\/privacidad$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cómo cuidamos tus datos" }),
    ).toBeVisible();
    await expect(page.getByRole("region")).toHaveCount(8);
    await expect(page.getByRole("link", { name: "Atrás" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar" })).toHaveCount(
      0,
    );
    await sinViolaciones(page);
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
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    for (const casilla of await page.getByRole("checkbox").all())
      await expect(casilla).not.toBeChecked();
    await expect(
      page.getByText("Texto versión 1.0 del 30 de octubre de 2026."),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Autorizar y continuar" }).click();
    await expect(
      page.getByText("Falta tu autorización para lo necesario."),
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
    await page.getByLabel("Autorizo los avisos con la app cerrada.").check();
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
      finalidades: ["cuenta_y_acceso", "funciones_financieras", "avisos"],
      version: "1.0",
    });
  });
});
