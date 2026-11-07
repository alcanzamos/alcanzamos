import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinPendientes, sinViolaciones } from "./ayudas";

// F-1 con el cuadro de lenguaje natural y el paso «Revisa y confirma» (US-62, E14-PPN 3.1), con el API simulado.
const catalogo = {
  gasto: [
    { id: 1, nombre: "Alimentación", general: false },
    { id: 8, nombre: "Transporte", general: false },
    { id: 16, nombre: "Otros gastos", general: true },
  ],
  ingreso: [
    { id: 17, nombre: "Salario", general: false },
    { id: 25, nombre: "Otros ingresos", general: true },
  ],
};
const sinMovimientos = {
  periodo_actual: "2026-11",
  periodo: "2026-11",
  resumen: { movimientos: 0, total_centavos: null },
  meses: [],
  categorias: [],
  movimientos: [],
};
const propuesta = {
  resultado: "propuesta",
  tipo: "gasto",
  monto_centavos: 4500000,
  categoria: { id: 1, nombre: "Alimentación" },
  fecha: "2026-11-01",
  varios_movimientos: false,
};

// Hoy es el 2 de noviembre de 2026 (el caso B de E14-PPN 9.5: «mercado 45 mil ayer»).
const hoyEs2DeNoviembre = (page: Page) =>
  page.clock.setFixedTime(new Date("2026-11-02T15:00:00Z"));

async function api(
  page: Page,
  interpretacion: unknown = propuesta,
  estado = 200,
) {
  return simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/movimientos": responder(200, sinMovimientos),
    "GET /api/v1/repeticiones/pendientes": responder(200, sinPendientes),
    "GET /api/v1/categorias": responder(200, catalogo),
    "POST /api/v1/movimientos/interpretacion": responder(
      estado,
      interpretacion,
    ),
    "POST /api/v1/movimientos": responder(201, {
      movimiento_id: "m1",
      recurrente_id: null,
      proximas: [],
      pendientes: [],
    }),
  });
}

const guardados = (
  pedidos: { metodo: string; ruta: string; cuerpo: unknown }[],
) =>
  pedidos
    .filter((p) => p.metodo === "POST" && p.ruta === "/api/v1/movimientos")
    .map((p) => p.cuerpo);
const cuadro = (page: Page) => page.getByLabel("Escribe el gasto o el ingreso");

test.describe("F-1 · cuadro de lenguaje natural y «Revisa y confirma» (US-62)", () => {
  test("«mercado 45 mil ayer»: llena, revisa, confirma y guarda una sola vez (RN-001)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(page);
    await page.goto("/registrar");
    await expect(cuadro(page)).toBeVisible();
    await expect(
      page.getByText("Por ejemplo: mercado 45 mil ayer."),
    ).toBeVisible();
    await sinViolaciones(page);

    await cuadro(page).fill("mercado 45 mil ayer");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Llenamos el formulario con tu texto. Cambia lo que quieras.",
      }),
    ).toBeFocused();
    await expect(page.getByLabel("Monto")).toHaveValue("$45.000");
    await expect(page.getByLabel("Fecha")).toHaveValue("2026-11-01");
    await expect(
      page.getByRole("radio", { name: "Alimentación" }),
    ).toBeChecked();
    await sinViolaciones(page);

    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Revisar y guardar" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Revisa y confirma" }),
    ).toBeFocused();
    for (const fila of [
      "TipoGasto",
      "Monto$45.000",
      "CategoríaAlimentación",
      "FechaAyer",
      "Medio de pagoEfectivo",
      "De quién esSolo mío",
    ])
      await expect(
        page.getByRole("listitem").filter({ hasText: fila }),
      ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cambiar" })).toHaveCount(6);
    // Dos columnas desde 768 px: el cuadro a la izquierda y «Revisa y confirma» a la derecha, sin cambiar de página.
    const izquierda = await cuadro(page).boundingBox();
    const derecha = await page
      .getByRole("heading", { level: 2, name: "Revisa y confirma" })
      .boundingBox();
    expect(derecha!.x).toBeGreaterThan(izquierda!.x + izquierda!.width);
    await expect(page).toHaveURL(/\/registrar$/);
    await sinViolaciones(page);
    // Todavía nada se guardó.
    expect(guardados(pedidos)).toEqual([]);

    await page.getByRole("button", { name: "Confirmar y guardar" }).click();
    await expect(page).toHaveURL(/\/movimientos$/);
    await expect(
      page.getByRole("status").filter({
        hasText: "Listo, registramos tu gasto de $45.000.",
      }),
    ).toBeVisible();
    expect(guardados(pedidos)).toEqual([
      {
        monto_centavos: 4500000,
        tipo: "gasto",
        fecha: "2026-11-01",
        categoria_id: 1,
        medio: "efectivo",
      },
    ]);
  });

  test("a 360 px es la columna de Android: el cuadro arriba y el formulario debajo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await hoyEs2DeNoviembre(page);
    await api(page);
    await page.goto("/registrar");
    const arriba = await cuadro(page).boundingBox();
    const abajo = await page.getByLabel("Monto").boundingBox();
    expect(abajo!.y).toBeGreaterThan(arriba!.y + arriba!.height);
    expect(Math.abs(abajo!.x - arriba!.x)).toBeLessThan(1);
    await sinViolaciones(page);
  });

  test("«Volver al formulario» y «Cambiar» regresan sin guardar", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(page);
    await page.goto("/registrar");
    await cuadro(page).fill("mercado 45 mil ayer");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Revisar y guardar" }).click();
    await page.getByRole("button", { name: "Volver al formulario" }).click();
    await expect(page.getByLabel("Monto")).toHaveValue("$45.000");
    await page.getByRole("button", { name: "Revisar y guardar" }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: "Monto" })
      .getByRole("button", { name: "Cambiar" })
      .click();
    await expect(page.getByLabel("Monto")).toBeFocused();
    expect(guardados(pedidos)).toEqual([]);
  });

  test("varios movimientos: el aviso va encima de la tarjeta", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    await api(page, { ...propuesta, varios_movimientos: true });
    await page.goto("/registrar");
    await cuadro(page).fill("mercado 45 mil ayer y 12 mil de pasajes");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Revisar y guardar" }).click();
    await expect(
      page.getByText("Encontramos más de un movimiento"),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Tomamos solo el primer movimiento. Registra los otros por separado.",
      ),
    ).toBeVisible();
    await sinViolaciones(page);
  });

  test("monto ambiguo: «¿Quisiste decir $12.500 o $12,50?» y el Monto vacío, sin adivinar", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(page, {
      ...propuesta,
      resultado: "monto_ambiguo",
      monto_centavos: null,
      lecturas_del_monto: {
        con_punto_de_miles: "12.500",
        con_coma_decimal: "12,50",
      },
    });
    await page.goto("/registrar");
    await cuadro(page).fill("mercado 12.5");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    await expect(
      page.getByText("¿Quisiste decir $12.500 o $12,50?"),
    ).toBeVisible();
    await expect(page.getByLabel("Monto")).toHaveValue("");
    await expect(page.getByLabel("Monto")).toBeFocused();
    await sinViolaciones(page);
    expect(guardados(pedidos)).toEqual([]);
  });

  for (const [resultado, titulo] of [
    [
      "recomendacion",
      "Aquí no damos recomendaciones sobre créditos ni inversiones.",
    ],
    ["pregunta", "Aquí solo registramos movimientos."],
    ["no_entendido", "No pudimos entender el texto."],
    ["tiempo_agotado", "No pudimos entender el texto."],
  ] as const) {
    test(`«${resultado}»: aviso de información, sin propuesta y con el texto en el cuadro`, async ({
      page,
    }) => {
      await hoyEs2DeNoviembre(page);
      const pedidos = await api(page, { resultado });
      await page.goto("/registrar");
      await cuadro(page).fill("hola");
      await page.getByRole("button", { name: "Llenar el formulario" }).click();
      const aviso = page.getByRole("status").filter({ hasText: titulo });
      await expect(aviso).toBeFocused();
      await expect(cuadro(page)).toHaveValue("hola");
      await expect(page.getByLabel("Monto")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Guardar" })).toBeVisible();
      await sinViolaciones(page);
      expect(guardados(pedidos)).toEqual([]);
    });
  }

  test("sin texto: el error del cuadro, sin llamar al API de interpretación", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(page);
    await page.goto("/registrar");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    await expect(
      page.getByText("Falta escribir el gasto o el ingreso."),
    ).toBeVisible();
    await expect(cuadro(page)).toBeFocused();
    await sinViolaciones(page);
    expect(pedidos.filter((p) => p.ruta.endsWith("/interpretacion"))).toEqual(
      [],
    );
  });

  test("texto de más de 280 caracteres: el cuadro en Error con su texto, conserva lo escrito y tiene el foco (D-193)", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(
      page,
      { error: "datos_invalidos", campos: { texto: "texto_largo" } },
      422,
    );
    await page.goto("/registrar");
    await cuadro(page).fill("mercado 45 mil");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    await expect(
      page.getByText("El texto es demasiado largo. Usa hasta 280 caracteres."),
    ).toBeVisible();
    await expect(cuadro(page)).toBeFocused();
    await expect(cuadro(page)).toHaveValue("mercado 45 mil");
    await expect(cuadro(page)).toHaveAttribute("aria-invalid", "true");
    await sinViolaciones(page);
    expect(guardados(pedidos)).toEqual([]);
  });

  test("falla del servidor: aviso «No pudimos llenar el formulario.» con «Llena el formulario: lo que escribiste sigue ahí.» y el texto intacto (D-193)", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(page, { error: "error_interno" }, 500);
    await page.goto("/registrar");
    await cuadro(page).fill("mercado 45 mil");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    const aviso = page.getByRole("status").filter({
      hasText: "No pudimos llenar el formulario.",
    });
    await expect(aviso).toContainText(
      "Llena el formulario: lo que escribiste sigue ahí.",
    );
    await expect(aviso).toBeFocused();
    await expect(cuadro(page)).toHaveValue("mercado 45 mil");
    await expect(cuadro(page)).not.toHaveAttribute("aria-invalid", "true");
    await sinViolaciones(page);
    expect(guardados(pedidos)).toEqual([]);
  });

  test("categoría: con el cuadro llega sugerida; a mano sigue obligatoria (D-193)", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    await api(page, { ...propuesta, categoria: null });
    await page.goto("/registrar");
    await cuadro(page).fill("mercado 45 mil ayer");
    await page.getByRole("button", { name: "Llenar el formulario" }).click();
    await expect(page.getByLabel("Monto")).toHaveValue("$45.000");
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Revisar y guardar" }).click();
    await expect(page.getByText("Falta elegir la categoría.")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Revisa y confirma" }),
    ).toHaveCount(0);
  });

  test("el formulario sin el cuadro sigue igual: «Guardar» guarda directo (RF-002)", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(page);
    await page.goto("/registrar");
    await page.getByLabel("Monto").fill("45.000");
    await page.getByRole("radio", { name: "Alimentación" }).check();
    await page.getByRole("radio", { name: "Efectivo" }).check();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/movimientos$/);
    expect(guardados(pedidos)).toHaveLength(1);
    expect(pedidos.map((p) => p.ruta)).not.toContain(
      "/api/v1/movimientos/interpretacion",
    );
  });
});
