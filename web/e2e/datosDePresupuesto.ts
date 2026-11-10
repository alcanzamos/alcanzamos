import type { Page, Route } from "@playwright/test";
import { responder, simularApi } from "./ayudas";

// El escenario de E14-PPA 2 para PN-06, PN-07 y PN-08: Laura el 2 de noviembre de 2026 (2.2 y 2.4) y el caso P (2.3 y
// 2.4). El API simulado guarda los presupuestos en memoria y arma la respuesta con las reglas de api/README.md
// («Presupuesto del periodo»): el modo, las sumas, los estados y el orden. Los montos van en centavos.

export const hoyEs2DeNoviembre = (page: Page) =>
  page.clock.setFixedTime(new Date("2026-11-02T15:00:00Z"));

export const catalogo = {
  gasto: [
    { id: 1, nombre: "Alimentación", general: false },
    { id: 4, nombre: "Arriendo o cuota de vivienda", general: false },
    { id: 5, nombre: "Servicios públicos", general: false },
    { id: 8, nombre: "Transporte", general: false },
    { id: 11, nombre: "Recreación y cultura", general: false },
    { id: 13, nombre: "Restaurantes y hoteles", general: false },
    { id: 16, nombre: "Otros gastos", general: true },
  ],
  ingreso: [
    { id: 17, nombre: "Salario", general: false },
    { id: 18, nombre: "Trabajo independiente o ventas", general: false },
    { id: 20, nombre: "Ayudas y subsidios", general: false },
    { id: 22, nombre: "Prima de servicios", general: false },
    { id: 25, nombre: "Otros ingresos", general: true },
  ],
};
const nombres = Object.fromEntries(catalogo.gasto.map((c) => [c.id, c.nombre]));

type Caso = {
  ingreso: number;
  /** Lo gastado en el mes, por categoría. */
  gastos: Record<number, number>;
  presupuestos: Record<number, number>;
  /** Las fechas pendientes de las repeticiones de ingreso (no cuentan en «Sin asignar»). */
  esperados: { fecha: string; categoria_id: number; monto: number }[];
};

export const casos = {
  laura: (): Caso => ({
    ingreso: 120000000,
    gastos: { 4: 65000000, 1: 12000000, 13: 2500000, 11: 1500000, 8: 4000000 },
    presupuestos: { 8: 4000000 },
    esperados: [{ fecha: "2026-11-16", categoria_id: 17, monto: 120000000 }],
  }),
  nulo: (): Caso => ({
    ingreso: 0,
    gastos: {},
    presupuestos: {},
    esperados: [],
  }),
  bajo: (): Caso => ({
    ingreso: 15000000,
    gastos: {},
    presupuestos: { 1: 10000000, 8: 6000000 },
    esperados: [],
  }),
};

function respuestaDe(caso: Caso, enCero: boolean) {
  const asignado = Object.values(caso.presupuestos).reduce((a, b) => a + b, 0);
  const llega = caso.esperados.reduce((a, e) => a + e.monto, 0);
  const modo =
    caso.ingreso === 0
      ? "ingreso_nulo"
      : asignado > caso.ingreso
        ? "ingreso_bajo"
        : "normal";
  const ids = new Set(
    [...Object.keys(caso.presupuestos), ...Object.keys(caso.gastos)].map(
      Number,
    ),
  );
  const filas = [...ids].map((id) => {
    const monto = caso.presupuestos[id];
    const gastado = caso.gastos[id] ?? 0;
    return {
      categoria_id: id,
      nombre: nombres[id] ?? "",
      oculta: false,
      presupuesto: monto ? { id: `p${id}`, monto_centavos: monto } : null,
      gastado_centavos: gastado,
      estado: !monto
        ? null
        : gastado < monto
          ? "quedan"
          : gastado === monto
            ? "usado_todo"
            : "superado",
      quedan_centavos: monto && gastado < monto ? monto - gastado : null,
    };
  });
  const orden = (a: (typeof filas)[number], b: (typeof filas)[number]) =>
    Number(Boolean(b.presupuesto)) - Number(Boolean(a.presupuesto)) ||
    b.gastado_centavos - a.gastado_centavos ||
    a.nombre.localeCompare(b.nombre, "es");
  return {
    periodo_actual: "2026-11",
    periodo: "2026-11",
    editable: true,
    resumen: {
      modo,
      en_cero: enCero && caso.ingreso === 0 && asignado === 0,
      ingreso_registrado_centavos: caso.ingreso,
      asignado_centavos: asignado,
      sin_asignar_centavos: modo === "normal" ? caso.ingreso - asignado : null,
      asignado_supera_por_centavos:
        modo === "ingreso_bajo" ? asignado - caso.ingreso : null,
      llega_despues_centavos: llega,
    },
    llega_despues: caso.esperados.map((e, i) => ({
      recurrente_id: `r${i + 1}`,
      fecha: e.fecha,
      categoria_id: e.categoria_id,
      monto_centavos: e.monto,
      marca: "esperado",
    })),
    categorias: filas
      .filter((f) => f.presupuesto || f.gastado_centavos > 0)
      .sort(orden),
  };
}

const cuerpoDe = (cuerpo: unknown) => (cuerpo ?? {}) as Record<string, unknown>;

/**
 * El API de PN-06 y PN-07 con el caso en memoria. `estado.fallar` hace que la próxima escritura dé un `500`; un monto
 * de cero da el `422` del API. Devuelve los pedidos hechos y el estado, para mirar lo guardado.
 */
export async function apiDePresupuesto(
  page: Page,
  inicial: Caso,
  extra: Parameters<typeof simularApi>[1] = {},
) {
  const caso = inicial;
  const estado = { fallar: 0, enCero: false };
  const escribir =
    (hacer: (cuerpo: Record<string, unknown>) => number) =>
    (ruta: Route, cuerpo: unknown) => {
      if (estado.fallar > 0) {
        estado.fallar--;
        return responder(500, { error: "error_interno" })(ruta, undefined);
      }
      const c = cuerpoDe(cuerpo);
      if ("monto_centavos" in c && Number(c.monto_centavos) <= 0)
        return responder(422, {
          error: "datos_invalidos",
          campos: { monto_centavos: "monto_no_positivo" },
        })(ruta, undefined);
      return responder(hacer(c), {})(ruta, undefined);
    };
  const porId = Object.fromEntries(
    catalogo.gasto.flatMap((c) => [
      [
        `PUT /api/v1/presupuestos/p${c.id}`,
        escribir((cuerpo) => {
          caso.presupuestos[c.id] = Number(cuerpo.monto_centavos);
          return 200;
        }),
      ],
      [
        `DELETE /api/v1/presupuestos/p${c.id}`,
        escribir(() => {
          delete caso.presupuestos[c.id];
          return 204;
        }),
      ],
    ]),
  );
  const pedidos = await simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/presupuestos": (ruta) =>
      responder(200, respuestaDe(caso, estado.enCero))(ruta, undefined),
    "POST /api/v1/presupuestos": escribir((cuerpo) => {
      caso.presupuestos[Number(cuerpo.categoria_id)] = Number(
        cuerpo.monto_centavos,
      );
      return 201;
    }),
    "POST /api/v1/presupuestos/en-cero": escribir(() => {
      estado.enCero = true;
      return 204;
    }),
    ...porId,
    ...extra,
  });
  return { pedidos, estado, caso };
}

type Marca = "registrado" | "esperado" | "por_confirmar";
const ingreso = (
  fecha: string,
  marca: Marca,
  monto: number,
  descripcion: string | null = null,
) => ({
  fecha,
  marca,
  monto_centavos: monto,
  medio: "transferencia",
  descripcion,
  movimiento_id: marca === "registrado" ? `m-${fecha}` : null,
  recurrente_id: marca === "registrado" ? null : `r-${fecha}`,
});
type Ingreso = ReturnType<typeof ingreso>;
type Fuente = { categoria_id: number; ingresos: Ingreso[] };

const periodoDeIngresos = (periodo: string, fuentes: Fuente[]) => {
  const todos = fuentes.flatMap((f) => f.ingresos);
  const suma = (lista: Ingreso[]) =>
    lista.reduce((a, i) => a + i.monto_centavos, 0);
  const registrado = suma(todos.filter((i) => i.marca === "registrado"));
  const esperado = suma(todos.filter((i) => i.marca !== "registrado"));
  return {
    periodo_actual: "2026-11",
    periodo,
    meses: ["2026-11", "2026-10", "2026-08"],
    total: {
      entran_centavos: registrado + esperado,
      registrado_centavos: registrado,
      esperado_centavos: esperado,
      por_confirmar: todos.filter((i) => i.marca === "por_confirmar").length,
    },
    fuentes: fuentes
      .map((f) => ({
        categoria_id: f.categoria_id,
        nombre: "",
        oculta: false,
        total_centavos: suma(f.ingresos),
        ingresos: f.ingresos,
      }))
      .sort((a, b) => b.total_centavos - a.total_centavos),
  };
};

/** Los ingresos de E14-PPA 2.4 por periodo; noviembre puede traer el salario del 16 «Por confirmar». */
export const ingresosDe = {
  "2026-11": (porConfirmar: 0 | 1 | 2 = 0) =>
    periodoDeIngresos("2026-11", [
      {
        categoria_id: 17,
        ingresos: [
          ingreso(
            "2026-11-01",
            porConfirmar === 2 ? "por_confirmar" : "registrado",
            120000000,
          ),
          ingreso(
            "2026-11-16",
            porConfirmar > 0 ? "por_confirmar" : "esperado",
            120000000,
          ),
        ],
      },
    ]),
  "2026-12": () =>
    periodoDeIngresos("2026-12", [
      {
        categoria_id: 17,
        ingresos: [
          ingreso("2026-12-01", "esperado", 120000000),
          ingreso("2026-12-16", "esperado", 120000000),
        ],
      },
      {
        categoria_id: 22,
        ingresos: [ingreso("2026-12-20", "esperado", 120000000)],
      },
    ]),
  "2026-10": () =>
    periodoDeIngresos("2026-10", [
      {
        categoria_id: 18,
        ingresos: [
          ingreso("2026-10-03", "registrado", 30000000, "Venta de artesanías"),
          ingreso("2026-10-28", "registrado", 9000000, "Venta de artesanías"),
        ],
      },
      {
        categoria_id: 20,
        ingresos: [ingreso("2026-10-15", "registrado", 16000000, "Subsidio")],
      },
    ]),
  vacio: (periodo: string) => periodoDeIngresos(periodo, []),
};

/**
 * El API de PN-08: los ingresos de cada periodo y la confirmación de la US-60, que pasa la fecha a «Registrado».
 * `porConfirmar` dice cuántas fechas de noviembre llegaron sin confirmar.
 */
export async function apiDeIngresos(page: Page, porConfirmar: 0 | 1 | 2 = 0) {
  let noviembre = ingresosDe["2026-11"](porConfirmar);
  const estado = { fallar: 0 };
  const confirmar = (fechas: string[]) => {
    noviembre = {
      ...noviembre,
      fuentes: noviembre.fuentes.map((f) => ({
        ...f,
        ingresos: f.ingresos.map((i) =>
          fechas.includes(i.fecha)
            ? {
                ...i,
                marca: "registrado" as const,
                movimiento_id: `m-${i.fecha}`,
              }
            : i,
        ),
      })),
    };
    const todos = noviembre.fuentes.flatMap((f) => f.ingresos);
    const registrado = todos
      .filter((i) => i.marca === "registrado")
      .reduce((a, i) => a + i.monto_centavos, 0);
    noviembre.total = {
      ...noviembre.total,
      registrado_centavos: registrado,
      esperado_centavos: noviembre.total.entran_centavos - registrado,
      por_confirmar: todos.filter((i) => i.marca === "por_confirmar").length,
    };
  };
  const confirmacion = (fecha: string) => (ruta: Route) => {
    if (estado.fallar > 0) {
      estado.fallar--;
      return responder(500, { error: "error_interno" })(ruta, undefined);
    }
    confirmar([fecha]);
    return responder(201, {
      id: `m-${fecha}`,
      tipo: "ingreso",
      monto_centavos: 120000000,
      fecha,
    })(ruta, undefined);
  };
  const pedidos = await simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/ingresos": (ruta) => {
      const periodo =
        new URL(ruta.request().url()).searchParams.get("periodo") ?? "2026-11";
      const datos =
        periodo === "2026-11"
          ? noviembre
          : periodo in ingresosDe && periodo !== "vacio"
            ? ingresosDe[periodo as "2026-10" | "2026-12"]()
            : ingresosDe.vacio(periodo);
      return responder(200, datos)(ruta, undefined);
    },
    "POST /api/v1/repeticiones/r-2026-11-01/confirmacion":
      confirmacion("2026-11-01"),
    "POST /api/v1/repeticiones/r-2026-11-16/confirmacion":
      confirmacion("2026-11-16"),
    "POST /api/v1/repeticiones/decisiones": (ruta, cuerpo) => {
      const decisiones = cuerpoDe(cuerpo).decisiones as { fecha: string }[];
      confirmar(decisiones.map((d) => d.fecha));
      return responder(200, {
        movimientos: [],
        omitidas: [],
        siguen_pendientes: 0,
        resumen: { guardados: decisiones.length, omitidas: 0 },
      })(ruta, undefined);
    },
  });
  return { pedidos, estado };
}
