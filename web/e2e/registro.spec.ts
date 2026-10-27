import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

// Los nombres de `nombre` son los del catálogo de la base; la pantalla pone el texto de E14 por `id` (api/README.md).
const catalogo = {
  gasto: [
    { id: 1, nombre: "Alimentación", general: false },
    { id: 4, nombre: "Arriendo o cuota de vivienda", general: false },
    { id: 16, nombre: "Otros gastos", general: true },
  ],
  ingreso: [
    { id: 17, nombre: "Salario", general: false },
    { id: 25, nombre: "Otros ingresos", general: true },
  ],
};
const creado = {
  movimiento_id: "m1",
  recurrente_id: null,
  proximas: [],
  pendientes: [],
};

// Hoy es el 26 de octubre de 2026 (el día del caso del arriendo, S4 y D-164), a las 10:00 en Colombia.
async function hoyEs26DeOctubre(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-26T15:00:00Z"));
}

// Lo que el API contesta en `GET /api/v1/repeticiones/proximas` (L6, D-165): la web no calcula fechas, las muestra.
const proximasDelApi: Record<string, string[]> = {
  "mensual 2026-08-15": ["2026-11-15", "2026-12-15", "2027-01-15"],
  "semanal 2026-10-26": ["2026-11-02", "2026-11-09", "2026-11-16"],
};

/** Las consultas que llegaron al endpoint de próximas fechas, con su texto de consulta tal cual. */
type Consultas = string[];

function api(
  page: Page,
  resultado: unknown = creado,
  consultas: Consultas = [],
) {
  return simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/repeticiones/proximas": (ruta) => {
      const { searchParams, search } = new URL(ruta.request().url());
      consultas.push(search);
      const clave = `${searchParams.get("periodicidad")} ${searchParams.get("inicio")}`;
      return responder(200, { proximas: proximasDelApi[clave] ?? [] })(
        ruta,
        undefined,
      );
    },
    "POST /api/v1/movimientos": responder(201, resultado),
  });
}

const guardados = (pedidos: { metodo: string; cuerpo: unknown }[]) =>
  pedidos.filter((p) => p.metodo === "POST").map((p) => p.cuerpo);

test.describe("PN-01 · Formulario de registro (US-51)", () => {
  // USA-004 (registrar un gasto en efectivo en menos de 20 s) no se cronometra aquí: lo mide una persona con la app.
  // Lo que sí se puede fijar es cuántas interacciones cuesta: son cinco desde PN-71, con «Hoy»: la categoría
  // cuenta porque todavía no existe el motor de reglas que la sugiere (D-165).
  test("un gasto en efectivo: desde PN-71, cinco interacciones, y vuelve con «Listo, registramos tu gasto de $45.000.»", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    const pedidos = await api(page);
    await page.goto("/cuenta/seguridad");
    await page.getByText("Este es tu primer ingreso.").waitFor();
    let interacciones = 0;

    await page.getByRole("link", { name: "Registrar un movimiento" }).click();
    interacciones++; // 1. abrir el formulario
    await expect(
      page.getByRole("heading", { level: 1, name: "Registrar" }),
    ).toBeFocused();
    await expect(page).toHaveURL(/\/registrar$/);
    await expect(
      page.getByRole("radio", { name: "Gasto", exact: true }),
    ).toBeChecked();
    await expect(page.getByLabel("Fecha")).toHaveValue("2026-10-26");
    await expect(page.getByText("Hoy")).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Otros gastos" }),
    ).not.toBeChecked();
    await expect(page.getByRole("radio", { name: "Tarjeta" })).toHaveCount(0);
    await expect(page.getByText("Cuotas")).toHaveCount(0);

    await page.getByLabel("Monto").fill("45.000");
    interacciones++; // 2. escribir el monto
    await page.getByRole("radio", { name: "Otros gastos" }).check();
    interacciones++; // 3. elegir la categoría
    await page.getByRole("radio", { name: "Efectivo" }).check();
    interacciones++; // 4. elegir el medio de pago
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Guardar" }).click();
    interacciones++; // 5. guardar

    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(
      page.getByRole("status").filter({
        hasText: "Listo, registramos tu gasto de $45.000.",
      }),
    ).toBeVisible();
    await sinViolaciones(page);
    expect(interacciones).toBe(5);
    expect(guardados(pedidos)).toEqual([
      {
        monto_centavos: 4500000,
        tipo: "gasto",
        fecha: "2026-10-26",
        categoria_id: 16,
        medio: "efectivo",
      },
    ]);
  });

  test("con todos los errores a la vez: sin violaciones de axe y el foco en el primero", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    const pedidos = await api(page);
    await page.goto("/registrar");
    await page.getByLabel("Fecha").fill("");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Falta el monto.")).toBeVisible();
    await expect(page.getByText("Falta la fecha.")).toBeVisible();
    await expect(page.getByText("Falta elegir la categoría.")).toBeVisible();
    await expect(
      page.getByText("Falta elegir el medio de pago."),
    ).toBeVisible();
    await expect(page.getByLabel("Monto")).toBeFocused();
    await sinViolaciones(page);
    await page.getByLabel("Fecha").fill("2026-10-26");
    await page.getByLabel("Monto").fill("12.5");
    await page.getByRole("radio", { name: "Otros gastos" }).check();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(
      page.getByText("¿Quisiste decir $12.500 o $12,50?"),
    ).toBeVisible();
    expect(guardados(pedidos)).toEqual([]);
  });

  test("«Ver todas», un ingreso con centavos y su aviso de E14-PPN 1.11", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    const pedidos = await api(page);
    await page.goto("/registrar");
    await page.getByRole("radio", { name: "Ingreso", exact: true }).check();
    await expect(page.getByRole("radio", { name: "Salario" })).toBeVisible();
    await page.getByRole("button", { name: "Ver todas" }).click();
    await sinViolaciones(page);
    await page
      .getByRole("list")
      .getByRole("button", { name: "Salario" })
      .click();
    await expect(page.getByRole("radio", { name: "Salario" })).toBeChecked();
    await page.getByLabel("Monto").fill("1.200.000,50");
    await page.getByRole("radio", { name: "Transferencia" }).check();
    await page.getByLabel("Descripción (opcional)").fill("Quincena");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Listo, registramos tu ingreso de $1.200.000,50.",
      }),
    ).toBeVisible();
    expect(guardados(pedidos)).toEqual([
      {
        monto_centavos: 120000050,
        tipo: "ingreso",
        fecha: "2026-10-26",
        categoria_id: 17,
        medio: "transferencia",
        descripcion: "Quincena",
      },
    ]);
  });

  test("una fecha futura sin repetición se guarda con su fecha (L3)", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    const pedidos = await api(page);
    await page.goto("/registrar");
    await page.getByLabel("Fecha").fill("2026-12-20");
    await expect(page.getByText("20 de diciembre de 2026")).toBeVisible();
    await page.getByLabel("Monto").fill("150.000");
    await page.getByRole("radio", { name: "Otros gastos" }).check();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Listo, registramos tu gasto de $150.000.",
      }),
    ).toBeVisible();
    expect(guardados(pedidos)).toEqual([
      {
        monto_centavos: 15000000,
        tipo: "gasto",
        fecha: "2026-12-20",
        categoria_id: 16,
        medio: "efectivo",
      },
    ]);
  });

  test("un fallo del servidor deja lo escrito y ofrece «Intentar de nuevo»", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    await simularApi(page, {
      "GET /api/v1/categorias": responder(200, catalogo),
      "POST /api/v1/movimientos": responder(500, { error: "error_interno" }),
    });
    await page.goto("/registrar");
    await page.getByLabel("Monto").fill("45.000");
    await page.getByRole("radio", { name: "Otros gastos" }).check();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("No pudimos guardar tu gasto.")).toBeVisible();
    await expect(
      page.getByText("Lo que escribiste sigue ahí. Intenta de nuevo."),
    ).toBeVisible();
    await expect(page.getByLabel("Monto")).toHaveValue("$45.000");
    await sinViolaciones(page);
  });
});

test.describe("PN-03 · Se repite (US-51)", () => {
  test("el arriendo del 15 de agosto, mensual, escrito el 26 de octubre: «Se repite: Cada mes» y vuelve a PN-71", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    const consultas: Consultas = [];
    const pedidos = await api(
      page,
      {
        movimiento_id: "m1",
        recurrente_id: "r1",
        proximas: ["2026-11-15", "2026-12-15", "2027-01-15"],
        pendientes: [],
      },
      consultas,
    );
    await page.goto("/registrar");
    await page.getByLabel("Monto").fill("650.000");
    await page.getByLabel("Fecha").fill("2026-08-15");
    await page
      .getByRole("radio", { name: "Arriendo o cuota de vivienda" })
      .check();
    await page.getByRole("radio", { name: "Transferencia" }).check();
    await expect(page.getByText("No se repite")).toBeVisible();

    await page.getByRole("link", { name: "Cambiar" }).click();
    await expect(page).toHaveURL(/\/registrar\/se-repite$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Se repite" }),
    ).toBeFocused();
    await expect(
      page.getByRole("radio", { name: "No se repite" }),
    ).toBeChecked();
    await expect(page.getByLabel("Empieza el")).toHaveCount(0);
    await sinViolaciones(page);

    await page.getByRole("radio", { name: "Cada mes" }).check();
    await expect(page.getByLabel("Empieza el")).toHaveValue(
      "15 de agosto de 2026",
    );
    await expect(
      page.getByText(
        "El mismo día de cada mes. Si el mes es más corto, usamos su último día.",
      ),
    ).toBeVisible();
    const proximas = page.getByRole("region", { name: "Próximas fechas" });
    await expect(proximas.getByRole("listitem")).toHaveText([
      "15 de noviembre de 2026",
      "15 de diciembre de 2026",
      "15 de enero de 2027",
    ]);
    // PN-03 llamó al endpoint con la periodicidad y «Empieza el», y mostró lo que recibió (D-165).
    expect(consultas).toEqual(["?periodicidad=mensual&inicio=2026-08-15"]);
    await sinViolaciones(page);

    await page.getByRole("button", { name: "Listo" }).click();
    await expect(page).toHaveURL(/\/registrar$/);
    await expect(page.getByText("Se repite: Cada mes")).toBeVisible();
    // Lo escrito antes de ir a PN-03 sigue ahí.
    await expect(page.getByLabel("Monto")).toHaveValue("$650.000");
    await expect(page.getByLabel("Fecha")).toHaveValue("2026-08-15");
    await expect(
      page.getByRole("radio", { name: "Transferencia" }),
    ).toBeChecked();

    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await expect(
      page.getByRole("status").filter({
        hasText: "Listo, registramos tu gasto de $650.000.",
      }),
    ).toBeVisible();
    expect(guardados(pedidos)).toEqual([
      {
        monto_centavos: 65000000,
        tipo: "gasto",
        fecha: "2026-08-15",
        categoria_id: 4,
        medio: "transferencia",
        repeticion: { periodicidad: "mensual" },
      },
    ]);
  });

  test("sin fecha de inicio avisa «Falta la fecha en que empieza.» y no vuelve", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    const consultas: Consultas = [];
    await api(page, creado, consultas);
    await page.goto("/registrar");
    await page.getByLabel("Fecha").fill("");
    await page.getByRole("link", { name: "Cambiar" }).click();
    await page.getByRole("radio", { name: "Cada semana" }).check();
    await expect(page.getByText("No hay fechas próximas.")).toBeVisible();
    expect(consultas).toEqual([]);
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(
      page.getByText("Falta la fecha en que empieza."),
    ).toBeVisible();
    await expect(page.getByLabel("Empieza el")).toBeFocused();
    await expect(page).toHaveURL(/\/registrar\/se-repite$/);
    await sinViolaciones(page);
  });

  test("si el API no contesta, PN-03 avisa con «Intentar de nuevo» y «Listo» sigue sirviendo", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    await simularApi(page, {
      "GET /api/v1/categorias": responder(200, catalogo),
      "GET /api/v1/repeticiones/proximas": responder(500, {
        error: "error_interno",
      }),
    });
    await page.goto("/registrar");
    await page.getByRole("link", { name: "Cambiar" }).click();
    await page.getByRole("radio", { name: "Cada mes" }).check();
    await expect(
      page.getByText("No pudimos cargar la información."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Intentar de nuevo" }),
    ).toBeVisible();
    await sinViolaciones(page);
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(page).toHaveURL(/\/registrar$/);
    await expect(page.getByText("Se repite: Cada mes")).toBeVisible();
  });

  test("un gasto de fecha futura que se repite: «Listo. Tu gasto de $90.000 queda por confirmar el 20 de diciembre de 2026.»", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    const pedidos = await api(page, {
      movimiento_id: null,
      recurrente_id: "r1",
      proximas: ["2026-12-20"],
      pendientes: [],
    });
    await page.goto("/registrar");
    await page.getByLabel("Monto").fill("90.000");
    await page.getByLabel("Fecha").fill("2026-12-20");
    await page.getByRole("radio", { name: "Otros gastos" }).check();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("link", { name: "Cambiar" }).click();
    await page.getByRole("radio", { name: "Cada semestre" }).check();
    await page.getByRole("button", { name: "Listo" }).click();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText:
          "Listo. Tu gasto de $90.000 queda por confirmar el 20 de diciembre de 2026.",
      }),
    ).toBeVisible();
    expect(guardados(pedidos)).toEqual([
      {
        monto_centavos: 9000000,
        tipo: "gasto",
        fecha: "2026-12-20",
        categoria_id: 16,
        medio: "efectivo",
        repeticion: { periodicidad: "semestral" },
      },
    ]);
  });
});

test.describe("Borrador del registro (L10)", () => {
  test("escribir un monto, volver a PN-71, cerrar sesión y entrar con otra cuenta: el formulario abre vacío", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    await simularApi(page, {
      "GET /api/v1/cuenta/seguridad": responder(200, {
        ingreso_anterior: null,
      }),
      "GET /api/v1/categorias": responder(200, catalogo),
      "DELETE /api/v1/sesiones/actual": responder(204),
      "POST /api/v1/sesiones": responder(200, { estado: "activa" }),
    });
    await page.goto("/cuenta/seguridad");
    await page.getByRole("link", { name: "Registrar un movimiento" }).click();
    await page.getByLabel("Monto").fill("45.000");
    await page.getByRole("radio", { name: "Otros gastos" }).check();
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.getByLabel("Correo electrónico").fill("otra@correo.co");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill("OtraContrasena-2026");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
    await page.getByRole("link", { name: "Registrar un movimiento" }).click();

    await expect(page.getByLabel("Monto")).toHaveValue("");
    await expect(
      page.getByRole("radio", { name: "Otros gastos" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Gasto", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Efectivo" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Transferencia" }),
    ).not.toBeChecked();
    await expect(page.getByLabel("Fecha")).toHaveValue("2026-10-26");
    await expect(page.getByText("No se repite")).toBeVisible();
  });

  test("escribir un monto, ir a PN-03 y volver: el monto sigue ahí", async ({
    page,
  }) => {
    await hoyEs26DeOctubre(page);
    await api(page);
    await page.goto("/cuenta/seguridad");
    await page.getByRole("link", { name: "Registrar un movimiento" }).click();
    await page.getByLabel("Monto").fill("45.000");
    await page.getByRole("link", { name: "Cambiar" }).click();
    await expect(page).toHaveURL(/\/registrar\/se-repite$/);
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(page.getByLabel("Monto")).toHaveValue("$45.000");
  });
});
