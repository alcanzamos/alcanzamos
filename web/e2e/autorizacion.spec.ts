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
  test("sin violaciones de axe, con las ocho tarjetas, sin Atrás y con «Continuar» a PN-64", async ({
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
  test("S2: una persona nueva que entra, autoriza en PN-64 y llega a PN-71 en la misma sesión ve «Este es tu primer ingreso.»", async ({
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
