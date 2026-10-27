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

// Los diez movimientos de noviembre de E14-PRR 2.2 que importan aquí, y los de otros meses (el medio del cobro de
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

// El arriendo del 15 de agosto, mensual, creado el 26 de octubre (D-164, D-169): su fecha es historia y no vuelve a pendiente.
const arriendoDeAgosto = (vuelve: boolean) =>
  mov({
    id: "r1",
    monto_centavos: "65000000",
    fecha: "2026-08-15",
    categoria_id: 4,
    medio: "transferencia",
    recurrente: {
      recurrente_id: "rr",
      fecha_programada: "2026-08-15",
      periodicidad: "mensual",
      vuelve_a_pendiente: vuelve,
    },
  });

/** El API simulado: guarda los movimientos en memoria, filtra como el API y aplica «Corregir» y «Borrar». */
async function api(page: Page, inicial: Movimiento[]) {
  let movimientos = [...inicial];
  const cuerpos: { metodo: string; id: string; cuerpo: unknown }[] = [];
  const porId = Object.fromEntries(
    inicial.flatMap((m) => [
      [
        `PUT /api/v1/movimientos/${m.id}`,
        (
          ruta: Parameters<ReturnType<typeof responder>>[0],
          cuerpo: unknown,
        ) => {
          cuerpos.push({ metodo: "PUT", id: m.id, cuerpo });
          const c = cuerpo as Record<string, unknown>;
          movimientos = movimientos.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  monto_centavos: String(c.monto_centavos),
                  fecha: typeof c.fecha === "string" ? c.fecha : x.fecha,
                }
              : x,
          );
          return responder(200, {})(ruta, undefined);
        },
      ],
      [
        `DELETE /api/v1/movimientos/${m.id}`,
        (ruta: Parameters<ReturnType<typeof responder>>[0]) => {
          cuerpos.push({ metodo: "DELETE", id: m.id, cuerpo: undefined });
          movimientos = movimientos.filter((x) => x.id !== m.id);
          return responder(204)(ruta, undefined);
        },
      ],
    ]),
  );
  const pedidos = await simularApi(page, {
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
        .sort((a, b) => cuantas(b) - cuantas(a) || a - b)
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
    ...porId,
  });
  return { pedidos, cuerpos };
}

const fila = (page: Page, nombre: RegExp) =>
  page.getByRole("link", { name: nombre });

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
    const { pedidos } = await api(page, deNoviembre);
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

  test("web: lista y detalle en dos columnas a 1280 px y una pantalla a la vez a 360 px", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    await api(page, deNoviembre);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/movimientos");
    await expect(
      page.getByText("Elige un movimiento para verlo."),
    ).toBeVisible();
    await fila(page, /Mercado/).click();
    const detalle = page.getByRole("region", { name: "Movimiento" });
    await expect(detalle).toBeVisible();
    await expect(fila(page, /Transporte/)).toBeVisible();
    await expect(detalle.getByRole("link", { name: "Atrás" })).toBeHidden();
    const [lista, derecha] = await Promise.all([
      fila(page, /Transporte/).boundingBox(),
      detalle.boundingBox(),
    ]);
    expect(lista?.x).toBeLessThan(derecha?.x ?? 0);

    await page.setViewportSize({ width: 360, height: 740 });
    await expect(detalle).toBeVisible();
    await expect(fila(page, /Transporte/)).toBeHidden();
    await detalle.getByRole("link", { name: "Atrás" }).click();
    await expect(fila(page, /Transporte/)).toBeVisible();
    await expect(detalle).toBeHidden();
  });
});

test.describe("PN-02 · Detalle, corregir y borrar (US-52)", () => {
  test("abrir un movimiento, corregir el monto a $40.000 y volver a PN-01 con «Listo, guardamos los cambios.»", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const { cuerpos } = await api(page, deNoviembre);
    await page.goto("/movimientos");
    await fila(page, /Mercado/).click();
    const detalle = page.getByRole("region", { name: "Movimiento" });
    await expect(detalle).toContainText("$45.000");
    await expect(detalle).toContainText("Gasto en Alimentación");
    await expect(detalle).toContainText("De quién esSolo mío");
    await sinViolaciones(page);

    await detalle.getByRole("button", { name: "Corregir" }).click();
    const formulario = page.getByRole("region", {
      name: "Corregir movimiento",
    });
    await expect(formulario.getByLabel("Monto")).toHaveValue("$45.000");
    await expect(formulario.getByLabel("Fecha")).toHaveValue("2026-11-01");
    await sinViolaciones(page);
    await formulario.getByLabel("Monto").fill("40.000");
    await formulario
      .getByRole("button", { name: "Guardar los cambios" })
      .click();

    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Listo, guardamos los cambios." }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/movimientos\?periodo=2026-11$/);
    await expect(fila(page, /Mercado/)).toContainText("$40.000");
    expect(cuerpos).toEqual([
      {
        metodo: "PUT",
        id: "m9",
        cuerpo: {
          monto_centavos: 4000000,
          tipo: "gasto",
          fecha: "2026-11-01",
          categoria_id: 1,
          medio: "efectivo",
          descripcion: "Mercado",
        },
      },
    ]);
    await sinViolaciones(page);
  });

  test("borrar un movimiento: la hoja dice qué se borra y vuelve a PN-01 con «Listo, borramos el gasto de $45.000.»", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const { cuerpos } = await api(page, deNoviembre);
    await page.goto("/movimientos?movimiento=m9");
    await page.getByRole("button", { name: "Borrar este movimiento" }).click();
    const hoja = page.getByRole("region", { name: "¿Borrar este movimiento?" });
    await expect(hoja).toContainText("Gasto de $45.000 en Alimentación, Ayer.");
    await expect(hoja).toContainText(
      "Se quita de tu lista y calculamos el mes de nuevo.",
    );
    await expect(hoja).not.toContainText("por confirmar");
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Borrar el movimiento" }).click();

    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Listo, borramos el gasto de $45.000." }),
    ).toBeVisible();
    await expect(fila(page, /Mercado/)).toHaveCount(0);
    await expect(page.getByText("4 movimientos")).toBeVisible();
    expect(cuerpos).toEqual([
      { metodo: "DELETE", id: "m9", cuerpo: undefined },
    ]);
  });

  test("D-169: borrar una fecha de un recurrente que vuelve a pendiente lo dice; la del arriendo de agosto, no", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    await api(page, [
      arriendoDeAgosto(false),
      mov({
        id: "r2",
        fecha: "2026-11-01",
        categoria_id: 17,
        tipo: "ingreso",
        monto_centavos: "120000000",
        recurrente: {
          recurrente_id: "rq",
          fecha_programada: "2026-11-01",
          periodicidad: "quincenal",
          vuelve_a_pendiente: true,
        },
      }),
    ]);
    await page.goto("/movimientos?periodo=2026-11&movimiento=r2");
    await expect(
      page.getByRole("region", { name: "Movimiento" }),
    ).toContainText("Se repiteCada quincena");
    await page.getByRole("button", { name: "Borrar este movimiento" }).click();
    await expect(
      page.getByRole("region", { name: "¿Borrar este movimiento?" }),
    ).toContainText("Esta fecha volverá a quedar por confirmar.");

    await page.goto("/movimientos?periodo=2026-08&movimiento=r1");
    await page.getByRole("button", { name: "Borrar este movimiento" }).click();
    const hoja = page.getByRole("region", { name: "¿Borrar este movimiento?" });
    await expect(hoja).toContainText(
      "Gasto de $650.000 en Arriendo o cuota de vivienda, 15 de agosto de 2026.",
    );
    await expect(hoja).not.toContainText("por confirmar");
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Borrar el movimiento" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Listo, borramos el gasto de $650.000." }),
    ).toBeVisible();
  });

  test("D-168: corregir una fecha de un recurrente no muestra Fecha, lleva la frase y no manda la fecha", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    const { cuerpos } = await api(page, [arriendoDeAgosto(false)]);
    await page.goto("/movimientos?periodo=2026-08&movimiento=r1");
    await page.getByRole("button", { name: "Corregir" }).click();
    const formulario = page.getByRole("region", {
      name: "Corregir movimiento",
    });
    await expect(formulario.getByLabel("Fecha")).toHaveCount(0);
    await expect(formulario.getByRole("group", { name: "Tipo" })).toHaveCount(
      0,
    );
    await expect(
      formulario.getByText(
        "Este cambio es solo para esta fecha. Las demás siguen igual.",
      ),
    ).toHaveCount(1);
    await expect(formulario.getByLabel("Monto")).toHaveValue("$650.000");
    await sinViolaciones(page);
    await formulario.getByLabel("Monto").fill("600.000");
    await formulario
      .getByRole("button", { name: "Guardar los cambios" })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Listo, guardamos los cambios." }),
    ).toBeVisible();
    expect(cuerpos[0]?.cuerpo).toEqual({
      monto_centavos: 60000000,
      tipo: "gasto",
      categoria_id: 4,
      medio: "transferencia",
    });
  });

  test("un aporte: sin Tipo ni Categoría al corregir, y la hoja de borrar dice cuánto baja el avance de la meta", async ({
    page,
  }) => {
    await hoyEs2DeNoviembre(page);
    await api(page, deNoviembre);
    await page.goto("/movimientos?movimiento=m4");
    const detalle = page.getByRole("region", { name: "Movimiento" });
    await expect(detalle).toContainText("Aporte a «Arriendo de enero»");
    await expect(detalle).toContainText("De quién esCompartido con el hogar");
    await detalle.getByRole("button", { name: "Corregir" }).click();
    const formulario = page.getByRole("region", {
      name: "Corregir movimiento",
    });
    await expect(formulario.getByRole("group", { name: "Tipo" })).toHaveCount(
      0,
    );
    await expect(
      formulario.getByRole("group", { name: "Categoría" }),
    ).toHaveCount(0);
    await formulario.getByRole("button", { name: "Ahora no" }).click();
    await page.getByRole("button", { name: "Borrar este movimiento" }).click();
    await expect(
      page.getByRole("region", { name: "¿Borrar este movimiento?" }),
    ).toContainText(
      "El avance de «Arriendo de enero» baja $100.000. El avance nunca queda por debajo de cero.",
    );
  });

  test("un error al cargar dice «No pudimos cargar tus movimientos.» y no tiene violaciones de axe", async ({
    page,
  }) => {
    await simularApi(page, {
      "GET /api/v1/movimientos": responder(500, { error: "interno" }),
    });
    await page.goto("/movimientos");
    await expect(
      page.getByText("No pudimos cargar tus movimientos."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Intentar de nuevo" }),
    ).toBeVisible();
    await sinViolaciones(page);
  });
});
