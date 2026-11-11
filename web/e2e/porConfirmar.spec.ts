import { expect, test, type Page, type Route } from "@playwright/test";
import { responder, simularApi, sinViolaciones } from "./ayudas";

// Hoy es el 14 de diciembre de 2026 (E14-PRR 2.8): las fechas de noviembre y diciembre ya llegaron.
async function hoyEs14DeDiciembre(page: Page) {
  await page.clock.setFixedTime(new Date("2026-12-14T15:00:00Z"));
}

type Pendiente = {
  recurrente_id: string;
  fecha: string;
  tipo: "gasto" | "ingreso";
  categoria_id: number;
  medio: "efectivo" | "transferencia";
  monto_habitual_centavos: string;
  periodicidad: "mensual";
};
type Movimiento = {
  id: string;
  tipo: "gasto" | "ingreso";
  monto_centavos: string;
  fecha: string;
  categoria_id: number;
  medio: "efectivo" | "transferencia";
  descripcion: null;
  compartido: false;
  meta: null;
  sentido: null;
  recurrente: null;
};

const fecha = (
  id: string,
  dia: string,
  tipo: "gasto" | "ingreso",
  categoria: number,
  centavos: string,
): Pendiente => ({
  recurrente_id: id,
  fecha: dia,
  tipo,
  categoria_id: categoria,
  medio: "transferencia",
  monto_habitual_centavos: centavos,
  periodicidad: "mensual",
});

// De la más antigua a la más reciente y, con la misma fecha, primero el ingreso (E14-PRR 4.8).
const energia = fecha("r1", "2026-11-05", "gasto", 5, "12000000");
const celular = fecha("r2", "2026-11-12", "gasto", 9, "6000000");
const salario = fecha("r3", "2026-12-01", "ingreso", 17, "120000000");
const arriendo = fecha("r4", "2026-12-01", "gasto", 4, "65000000");
const transporte = fecha("r5", "2026-12-10", "gasto", 8, "3000000");

const catalogo = {
  gasto: [
    { id: 4, nombre: "Arriendo o cuota de vivienda", general: false },
    { id: 5, nombre: "Servicios públicos", general: false },
    { id: 8, nombre: "Transporte", general: false },
    { id: 9, nombre: "Comunicaciones", general: false },
  ],
  ingreso: [{ id: 17, nombre: "Salario", general: false }],
};

/**
 * El API simulado: guarda las fechas pendientes y los movimientos en memoria. Confirmar crea el movimiento con la fecha
 * programada (D-094) y la quita de las pendientes; «No pasó» solo la quita. `fallar` hace que guardar dé un error.
 */
async function api(page: Page, inicial: Pendiente[]) {
  let pendientes = [...inicial];
  let movimientos: Movimiento[] = [];
  const estado = { fallar: 0 };
  const nuevo = (p: Pendiente, centavos?: unknown): Movimiento => ({
    id: `n${movimientos.length + 1}`,
    tipo: p.tipo,
    monto_centavos: String(centavos ?? p.monto_habitual_centavos),
    fecha: p.fecha,
    categoria_id: p.categoria_id,
    medio: p.medio,
    descripcion: null,
    compartido: false,
    meta: null,
    sentido: null,
    recurrente: null,
  });
  const cuerpoDe = (cuerpo: unknown) => cuerpo as Record<string, unknown>;
  const buscar = (id: string, dia: unknown) =>
    pendientes.find((p) => p.recurrente_id === id && p.fecha === dia);
  const quitar = (p: Pendiente) => {
    pendientes = pendientes.filter((x) => x !== p);
  };
  const porId = Object.fromEntries(
    inicial.flatMap((p) => [
      [
        `POST /api/v1/repeticiones/${p.recurrente_id}/confirmacion`,
        (ruta: Route, cuerpo: unknown) => {
          const c = cuerpoDe(cuerpo);
          const fila = buscar(p.recurrente_id, c.fecha);
          if (!fila)
            return responder(409, { error: "fecha_no_pendiente" })(
              ruta,
              undefined,
            );
          if (estado.fallar > 0) {
            estado.fallar--;
            return responder(500, { error: "error_interno" })(ruta, undefined);
          }
          const creado = nuevo(fila, c.monto_centavos);
          movimientos = [...movimientos, creado];
          quitar(fila);
          return responder(201, creado)(ruta, undefined);
        },
      ],
      [
        `POST /api/v1/repeticiones/${p.recurrente_id}/omision`,
        (ruta: Route, cuerpo: unknown) => {
          const fila = buscar(p.recurrente_id, cuerpoDe(cuerpo).fecha);
          if (!fila)
            return responder(409, { error: "fecha_no_pendiente" })(
              ruta,
              undefined,
            );
          quitar(fila);
          return responder(204)(ruta, undefined);
        },
      ],
    ]),
  );
  const pedidos = await simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/repeticiones/pendientes": (ruta) =>
      responder(200, {
        pendientes,
        resumen: {
          total: pendientes.length,
          ingresos: pendientes.filter((p) => p.tipo === "ingreso").length,
          gastos: pendientes.filter((p) => p.tipo === "gasto").length,
        },
      })(ruta, undefined),
    "POST /api/v1/repeticiones/decisiones": (ruta, cuerpo) => {
      if (estado.fallar > 0) {
        estado.fallar--;
        return responder(500, { error: "error_interno" })(ruta, undefined);
      }
      const decisiones = cuerpoDe(cuerpo).decisiones as Record<
        string,
        unknown
      >[];
      const filas = decisiones.map((d) =>
        buscar(String(d.recurrente_id), d.fecha),
      );
      if (filas.some((f) => !f))
        return responder(409, { error: "fecha_no_pendiente" })(ruta, undefined);
      const creados: Movimiento[] = [];
      let omitidas = 0;
      decisiones.forEach((d, i) => {
        const fila = filas[i] as Pendiente;
        if (d.omitida) omitidas++;
        else creados.push(nuevo(fila, d.monto_centavos));
        quitar(fila);
      });
      movimientos = [...movimientos, ...creados];
      return responder(200, {
        movimientos: creados,
        omitidas: [],
        siguen_pendientes: pendientes.length,
        resumen: { guardados: creados.length, omitidas },
      })(ruta, undefined);
    },
    "GET /api/v1/movimientos": (ruta) =>
      responder(200, {
        periodo_actual: "2026-12",
        periodo: "2026-12",
        resumen: { movimientos: movimientos.length, total_centavos: null },
        meses: movimientos.length > 0 ? ["2026-12"] : [],
        categorias: [],
        movimientos,
      })(ruta, undefined),
    ...porId,
  });
  return { pedidos, estado };
}

const posts = (pedidos: { metodo: string; ruta: string; cuerpo: unknown }[]) =>
  pedidos.filter((p) => p.metodo === "POST");
const seccion = (page: Page) =>
  page.getByRole("heading", { level: 2, name: "Por confirmar" });
const estadoDeLaPagina = (page: Page, texto: string) =>
  page.getByRole("status").filter({ hasText: texto });
const todas = [energia, celular, salario, arriendo, transporte];

test.describe("PN-01 · «Por confirmar» (US-60)", () => {
  test("la sección aparece solo si el API trae fechas que ya llegaron", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    await api(page, []);
    await page.goto("/movimientos");
    await expect(
      page.getByRole("heading", { level: 1, name: "Movimientos" }),
    ).toBeVisible();
    await expect(page.getByText("Todavía no hay movimientos")).toBeVisible();
    await expect(seccion(page)).toHaveCount(0);

    const con = await page.context().newPage();
    await hoyEs14DeDiciembre(con);
    await api(con, todas);
    await con.goto("/movimientos");
    await expect(seccion(con)).toBeVisible();
    await expect(
      con.getByText("5 por confirmar: 1 ingreso y 4 gastos"),
    ).toBeVisible();
    await expect(
      con.getByRole("link", { name: "Confirmar todos" }),
    ).toBeVisible();
    await expect(
      con.getByRole("button", {
        name: "Confirmar Salario de $1.200.000 del 1 de diciembre de 2026",
      }),
    ).toBeVisible();
    await sinViolaciones(con);
    await con.close();
  });

  test("«Confirmar» crea el movimiento con el monto habitual y la fecha programada, y avisa", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    const { pedidos } = await api(page, [salario, arriendo]);
    await page.goto("/movimientos");
    await page
      .getByRole("button", {
        name: "Confirmar Salario de $1.200.000 del 1 de diciembre de 2026",
      })
      .click();

    await expect(
      estadoDeLaPagina(page, "Listo, confirmamos tu ingreso de $1.200.000."),
    ).toBeVisible();
    expect(posts(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r3/confirmacion",
        cuerpo: { fecha: "2026-12-01" },
      },
    ]);
    // Quedó una sola fecha: sin resumen ni «Confirmar todos». El movimiento entra en la lista de su día.
    await expect(
      page.getByText(
        "Esta fecha de un movimiento que se repite ya llegó. Confírmala con un toque, o toca «Más» si no pasó o cambió el monto.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Confirmar todos" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "1 de diciembre de 2026" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^Salario/ })).toContainText(
      "$1.200.000",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Movimientos" }),
    ).toBeFocused();
    await sinViolaciones(page);
  });

  test("«Más» → «Cambiar el monto» → «Confirmar» con otro monto, solo para esa fecha", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    const { pedidos } = await api(page, [salario, arriendo]);
    await page.goto("/movimientos");
    const mas = page.getByRole("button", {
      name: "Más opciones de Salario de $1.200.000 del 1 de diciembre de 2026",
    });
    await mas.click();
    const hoja = page.getByRole("dialog", {
      name: "Salario · 1 de diciembre de 2026",
    });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByRole("heading", { level: 3 })).toBeFocused();
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "Cerrar" }).click();
    await expect(hoja).toHaveCount(0);
    await expect(mas).toBeFocused();

    await mas.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cambiar el monto" })
      .click();
    const monto = page.getByRole("dialog", { name: "¿Cuánto llegó?" });
    await expect(monto.getByLabel("Monto")).toHaveValue("$1.200.000");
    await expect(
      monto.getByText(
        "Este cambio es solo para esta fecha. Las demás siguen igual.",
      ),
    ).toBeVisible();
    await sinViolaciones(page);
    await monto.getByLabel("Monto").fill("1.100.000");
    await monto.getByRole("button", { name: "Confirmar" }).click();

    await expect(
      estadoDeLaPagina(page, "Listo, confirmamos tu ingreso de $1.100.000."),
    ).toBeVisible();
    expect(posts(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r3/confirmacion",
        cuerpo: { fecha: "2026-12-01", monto_centavos: 110000000 },
      },
    ]);
  });

  test("«Más» → «No pasó»: la fila sale, no se crea ningún movimiento y avisa", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    const { pedidos } = await api(page, [celular, arriendo]);
    await page.goto("/movimientos");
    await page
      .getByRole("button", {
        name: "Más opciones de Comunicaciones de $60.000 del 12 de noviembre de 2026",
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "No pasó" })
      .click();
    const hoja = page.getByRole("dialog", { name: "¿Esta fecha no pasó?" });
    await expect(
      hoja.getByText(
        "Dejamos de contarla en tu simulación. Las demás fechas siguen igual. Si después pasó, la registras a mano.",
      ),
    ).toBeVisible();
    await sinViolaciones(page);
    await hoja.getByRole("button", { name: "No pasó" }).click();

    await expect(
      estadoDeLaPagina(page, "Listo, ya no contamos esa fecha."),
    ).toBeVisible();
    expect(posts(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r2/omision",
        cuerpo: { fecha: "2026-11-12" },
      },
    ]);
    await expect(page.getByText("Todavía no hay movimientos")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Comunicaciones/ }),
    ).toHaveCount(0);
  });

  test("un error al confirmar dice «No pudimos confirmar el movimiento.» y la fecha sigue por confirmar", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    const { estado } = await api(page, [salario, arriendo]);
    estado.fallar = 1;
    await page.goto("/movimientos");
    await page
      .getByRole("button", {
        name: "Confirmar Salario de $1.200.000 del 1 de diciembre de 2026",
      })
      .click();
    const aviso = page
      .getByRole("status")
      .filter({ hasText: "No pudimos confirmar el movimiento." });
    await expect(aviso).toContainText("Sigue por confirmar. Intenta de nuevo.");
    await expect(aviso).toBeFocused();
    await expect(
      page.getByRole("button", {
        name: "Confirmar Salario de $1.200.000 del 1 de diciembre de 2026",
      }),
    ).toBeVisible();
    await sinViolaciones(page);
  });
});

test.describe("«Confirmar todos» (US-60, E14-PRR 4.8)", () => {
  const casilla = (page: Page, nombre: RegExp) =>
    page.getByRole("checkbox", { name: nombre });
  const panel = (page: Page) =>
    page.getByRole("region", { name: "Confirmar todos" });

  async function abrir(page: Page) {
    await page.goto("/movimientos");
    await page.getByRole("link", { name: "Confirmar todos" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(/\?confirmar=todos$/);
  }
  async function elegir(page: Page, fila: string, opcion: string) {
    await panel(page)
      .getByRole("button", { name: new RegExp(`^Más opciones de ${fila}`) })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: opcion })
      .click();
  }

  test("todo viene marcado, sin guardar nada; Atrás vuelve sin guardar y sin cambiar de página", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    const { pedidos } = await api(page, todas);
    await abrir(page);
    await expect(page.getByText("5 de 5 marcados")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guardar 5 movimientos" }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(5);
    await sinViolaciones(page);
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Confirmar todos" }),
    ).toBeFocused();
    expect(posts(pedidos)).toEqual([]);
  });

  test("una desmarcada, un monto cambiado y una «No pasó»: manda exactamente eso y avisa «Listo, guardamos 3 movimientos y dejamos de contar 1 fecha.»", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    const { pedidos } = await api(page, todas);
    await abrir(page);

    await casilla(page, /Servicios públicos/).uncheck();
    await expect(
      page.getByText("Sigue por confirmar", { exact: true }),
    ).toBeVisible();
    await elegir(page, "Comunicaciones", "No pasó");
    await expect(casilla(page, /Comunicaciones/)).toBeDisabled();
    await expect(page.getByText("3 de 5 marcados")).toBeVisible();

    await elegir(page, "Salario", "Cambiar el monto");
    const monto = page.getByRole("dialog", { name: "¿Cuánto llegó?" });
    await monto.getByLabel("Monto").fill("1.100.000");
    await monto.getByRole("button", { name: "Listo" }).click();
    await expect(page.getByText("Monto cambiado")).toBeVisible();
    await expect(casilla(page, /Salario/)).toBeChecked();
    expect(posts(pedidos)).toEqual([]);
    await sinViolaciones(page);

    await page.getByRole("button", { name: "Guardar 3 movimientos" }).click();
    await expect(
      estadoDeLaPagina(
        page,
        "Listo, guardamos 3 movimientos y dejamos de contar 1 fecha.",
      ),
    ).toBeVisible();
    expect(posts(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/decisiones",
        cuerpo: {
          decisiones: [
            { recurrente_id: "r2", fecha: "2026-11-12", omitida: true },
            {
              recurrente_id: "r3",
              fecha: "2026-12-01",
              monto_centavos: 110000000,
            },
            { recurrente_id: "r4", fecha: "2026-12-01" },
            { recurrente_id: "r5", fecha: "2026-12-10" },
          ],
        },
      },
    ]);
    // Vuelve a PN-01: lo desmarcado sigue por confirmar y los tres movimientos están en su lista, con su fecha programada.
    await expect(page).toHaveURL(/\/movimientos$/);
    await expect(panel(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Confirmar Servicios públicos de $120.000 del 5 de noviembre de 2026",
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^Salario/ })).toContainText(
      "$1.100.000",
    );
    await expect(page.getByRole("link", { name: /^Transporte/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "1 de diciembre de 2026" }),
    ).toBeVisible();
  });

  for (const [noPaso, aviso] of [
    [
      ["Comunicaciones"],
      "Listo, guardamos 2 movimientos y dejamos de contar 1 fecha.",
    ],
    [
      ["Comunicaciones", "Salario"],
      "Listo, guardamos 1 movimiento y dejamos de contar 2 fechas.",
    ],
  ] as const) {
    test(`el aviso combinado pone cada número en su forma: «${aviso}»`, async ({
      page,
    }) => {
      await hoyEs14DeDiciembre(page);
      await api(page, [energia, celular, salario]);
      await abrir(page);
      for (const fila of noPaso) await elegir(page, fila, "No pasó");
      await page.getByRole("button", { name: "Guardar" }).first().click();
      await expect(estadoDeLaPagina(page, aviso)).toBeVisible();
    });
  }

  test("un error al guardar dice «No pudimos guardar tus movimientos.» y la lista queda como estaba", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    const { estado } = await api(page, todas);
    estado.fallar = 1;
    await abrir(page);
    await casilla(page, /Transporte/).uncheck();
    await elegir(page, "Salario", "Cambiar el monto");
    await page.getByRole("dialog").getByLabel("Monto").fill("1.100.000");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Listo" })
      .click();
    await page.getByRole("button", { name: "Guardar 4 movimientos" }).click();

    const aviso = page
      .getByRole("status")
      .filter({ hasText: "No pudimos guardar tus movimientos." });
    await expect(aviso).toContainText(
      "No se guardó ninguno. Intenta de nuevo.",
    );
    await expect(aviso).toBeFocused();
    await expect(page).toHaveURL(/\?confirmar=todos$/);
    await expect(page.getByText("4 de 5 marcados")).toBeVisible();
    await expect(casilla(page, /Transporte/)).not.toBeChecked();
    await expect(page.getByText("Monto cambiado")).toBeVisible();
    await sinViolaciones(page);

    // Se puede intentar de nuevo: esta vez el API guarda.
    await page.getByRole("button", { name: "Guardar 4 movimientos" }).click();
    await expect(
      estadoDeLaPagina(page, "Listo, guardamos 4 movimientos."),
    ).toBeVisible();
  });

  test("a 360 px es una pantalla a la vez: el panel reemplaza la lista y Atrás la devuelve", async ({
    page,
  }) => {
    await hoyEs14DeDiciembre(page);
    await api(page, todas);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/movimientos");
    await expect(seccion(page)).toBeVisible();
    await page.getByRole("link", { name: "Confirmar todos" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(seccion(page)).toBeHidden();
    await elegir(page, "Salario", "Cambiar el monto");
    await expect(
      page.getByRole("dialog", { name: "¿Cuánto llegó?" }),
    ).toBeVisible();
    await sinViolaciones(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Ahora no" })
      .click();
    await page.getByRole("link", { name: "Atrás" }).click();
    await expect(seccion(page)).toBeVisible();
  });
});
