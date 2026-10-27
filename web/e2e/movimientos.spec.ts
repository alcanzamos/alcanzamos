import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

// Hoy es el 2 de noviembre de 2026 (E14-PRR 2.1), a las 10:00 en Colombia.
async function hoyEs2DeNoviembre(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-02T15:00:00Z"));
}

type Movimiento = {
  id: string;
  tipo: "gasto" | "ingreso" | "aporte";
  monto_centavos: string;
  fecha: string;
  categoria_id: number | null;
  medio: "efectivo" | "transferencia";
  descripcion: string | null;
  compartido: boolean;
  meta: { id: string; nombre: string } | null;
  sentido: "entrada" | "salida" | null;
  recurrente: {
    recurrente_id: string;
    fecha_programada: string;
    periodicidad: string;
    vuelve_a_pendiente: boolean;
  } | null;
};

const mov = (cambios: Partial<Movimiento>): Movimiento => ({
  id: "m1",
  tipo: "gasto",
  monto_centavos: "1500000",
  fecha: "2026-11-02",
  categoria_id: 8,
  medio: "efectivo",
  descripcion: null,
  compartido: false,
  meta: null,
  sentido: null,
  recurrente: null,
  ...cambios,
});

// Los movimientos de noviembre de E14-PRR 2.2 que importan aquí, y los de otros meses (el medio del cobro de
// octubre no está en el escenario: se le pone «transferencia»).
const transporte = mov({ id: "m10" });
const mercado = mov({
  id: "m9",
  monto_centavos: "4500000",
  fecha: "2026-11-01",
  categoria_id: 1,
  descripcion: "Mercado",
});
const alimentacion = mov({
  id: "m5",
  monto_centavos: "7500000",
  fecha: "2026-11-01",
  categoria_id: 1,
  medio: "transferencia",
});
const arriendoDeEnero = mov({
  id: "m4",
  tipo: "aporte",
  monto_centavos: "10000000",
  fecha: "2026-11-01",
  categoria_id: null,
  medio: "transferencia",
  compartido: true,
  meta: { id: "g1", nombre: "Arriendo de enero" },
  sentido: "entrada",
});
const salario = mov({
  id: "m1",
  tipo: "ingreso",
  monto_centavos: "120000000",
  fecha: "2026-11-01",
  categoria_id: 17,
  medio: "transferencia",
});
const musica = mov({
  id: "m2",
  monto_centavos: "1990000",
  fecha: "2026-10-05",
  categoria_id: 10,
  medio: "transferencia",
});
const navidad = mov({
  id: "m3",
  monto_centavos: "50000000",
  fecha: "2026-12-20",
  categoria_id: 16,
});
const deNoviembre = [
  transporte,
  mercado,
  alimentacion,
  arriendoDeEnero,
  salario,
];

const catalogo = {
  gasto: [
    { id: 1, nombre: "Alimentación", general: false },
    { id: 4, nombre: "Arriendo o cuota de vivienda", general: false },
    { id: 8, nombre: "Transporte", general: false },
    { id: 16, nombre: "Otros gastos", general: true },
  ],
  ingreso: [{ id: 17, nombre: "Salario", general: false }],
};

/** El API simulado: filtra los movimientos como el API (periodo, categoría, meses, categorías y la suma). */
async function api(page: Page, movimientos: Movimiento[]) {
  return simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/movimientos": (ruta) => {
      const consulta = new URL(ruta.request().url()).searchParams;
      const periodo = consulta.get("periodo") ?? "2026-11";
      const categoria = Number(consulta.get("categoria")) || null;
      const delMes = movimientos.filter((m) => m.fecha.startsWith(periodo));
      const lista = delMes.filter(
        (m) => categoria === null || m.categoria_id === categoria,
      );
      const total = lista.reduce(
        (suma, m) => suma + BigInt(m.monto_centavos),
        0n,
      );
      const cuantas = (id: number) =>
        delMes.filter((m) => m.categoria_id === id).length;
      const categorias = [
        ...new Set(
          delMes.flatMap((m) => (m.categoria_id ? [m.categoria_id] : [])),
        ),
      ]
        .sort((x, y) => cuantas(y) - cuantas(x) || x - y)
        .map((id) => ({
          categoria_id: id,
          movimientos: cuantas(id),
          oculta: false,
        }));
      return responder(200, {
        periodo_actual: "2026-11",
        periodo,
        resumen: {
          movimientos: lista.length,
          total_centavos: categoria === null ? null : total.toString(),
        },
        meses: [...new Set(movimientos.map((m) => m.fecha.slice(0, 7)))]
          .sort()
          .reverse(),
        categorias,
        movimientos: lista,
      })(ruta, undefined);
    },
  });
}

const fila = (page: Page, nombre: RegExp) =>
  page.locator(".lista-de-filas li").filter({ hasText: nombre });

test.describe("PN-01 · Movimientos: lista y filtros (US-52)", () => {
  test("la lista agrupada por día, con filtros de periodo y de categoría y sin violaciones de axe", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    await api(page, [...deNoviembre, musica, navidad]);
    await page.goto("/movimientos");

    await expect(
      page.getByRole("heading", { level: 1, name: "Movimientos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Hoy, 2 de noviembre de 2026",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Ayer, 1 de noviembre de 2026",
      }),
    ).toBeVisible();
    await expect(page.getByText("5 movimientos")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Noviembre" })).toBeChecked();
    await sinViolaciones(page);

    // «Alimentación»: 2 movimientos y $120.000 en total (E14-PRR 2.2, filtros de ejemplo).
    await page.getByRole("radio", { name: "Alimentación" }).check();
    await expect(
      page.getByText("Alimentación: 2 movimientos, $120.000"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\?periodo=2026-11&categoria=1$/);
    await expect(fila(page, /Transporte/)).toHaveCount(0);
    await sinViolaciones(page);

    // Octubre, «Suscripciones»: 1 movimiento del 5 de octubre.
    await page.getByRole("radio", { name: "Octubre" }).check();
    await expect(
      page.getByText("No hay movimientos con este filtro."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Quitar los filtros" }).click();
    await page.getByRole("radio", { name: "Octubre" }).check();
    await expect(
      page.getByRole("heading", { level: 2, name: "5 de octubre de 2026" }),
    ).toBeVisible();
    await expect(fila(page, /Suscripciones/)).toContainText(
      "Gasto · Transferencia",
    );

    // «Otro mes»: los meses con movimientos.
    await page.getByRole("button", { name: "Otro mes" }).click();
    await page.getByRole("button", { name: "Diciembre de 2026" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "20 de diciembre de 2026" }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "Diciembre" })).toBeChecked();
  });

  // SEG-002 (NC-E16-40, NM-05): lo compartido se ve siempre con su marca.
  test("SEG-002: la fila «Arriendo de enero» de $100.000 muestra «Compartido con el hogar»", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    await api(page, deNoviembre);
    await page.goto("/movimientos");
    const arriendo = fila(page, /Arriendo de enero/);
    await expect(arriendo).toContainText("Aporte a una meta · Transferencia");
    await expect(arriendo).toContainText("$100.000");
    await expect(arriendo.getByText("Compartido con el hogar")).toBeVisible();
    await expect(page.getByText("Compartido con el hogar")).toHaveCount(1);
    await expect(fila(page, /Salario/)).not.toContainText("Compartido");
  });

  test("PN-71 ya no trae «Registrar un movimiento»: PN-01 es la entrada al formulario y a él vuelve al guardar", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const pedidos = await api(page, deNoviembre);
    await page.goto("/cuenta/seguridad");
    await page.getByText("Este es tu primer ingreso.").waitFor();
    await expect(
      page.getByRole("link", { name: "Registrar un movimiento" }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Movimientos" }).click();
    await expect(page).toHaveURL(/\/movimientos$/);
    await page.getByRole("link", { name: "Registrar", exact: true }).click();
    await expect(page).toHaveURL(/\/registrar$/);
    await expect(page.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/movimientos",
    );
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(page).toHaveURL(/\/movimientos$/);
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
  });
});
