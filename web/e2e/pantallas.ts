import { expect, type Page } from "@playwright/test";
import { responder, simularApi, sinPendientes } from "./ayudas";
import { apiDeIngresos, apiDePresupuesto, casos } from "./datosDePresupuesto";

// Todas las pantallas de la web, cada una con su API simulado: las recorren la prueba sin desplazamiento horizontal
// (S13) y la de la Navegación lateral (bug 233).

// Hoy es el 14 de diciembre de 2026: las fechas de «Por confirmar» ya llegaron (E14-PRR 2.8).
export async function hoyEs14DeDiciembre(page: Page) {
  await page.clock.setFixedTime(new Date("2026-12-14T15:00:00Z"));
}

const catalogo = {
  gasto: [
    { id: 1, nombre: "Alimentación", general: false },
    { id: 4, nombre: "Arriendo o cuota de vivienda", general: false },
    { id: 5, nombre: "Servicios públicos", general: false },
    { id: 8, nombre: "Transporte", general: false },
    { id: 9, nombre: "Comunicaciones", general: false },
    { id: 16, nombre: "Otros gastos", general: true },
  ],
  ingreso: [
    { id: 17, nombre: "Salario", general: false },
    { id: 25, nombre: "Otros ingresos", general: true },
  ],
};

const pendiente = (
  id: string,
  fecha: string,
  tipo: "gasto" | "ingreso",
  categoria: number,
  centavos: string,
) => ({
  recurrente_id: id,
  fecha,
  tipo,
  categoria_id: categoria,
  medio: "transferencia",
  monto_habitual_centavos: centavos,
  periodicidad: "mensual",
});
const pendientes = [
  pendiente("r1", "2026-11-05", "gasto", 5, "12000000"),
  pendiente("r2", "2026-11-12", "gasto", 9, "6000000"),
  pendiente("r3", "2026-12-01", "ingreso", 17, "120000000"),
  pendiente("r4", "2026-12-01", "gasto", 4, "65000000"),
];

const movimiento = (
  id: string,
  tipo: "gasto" | "ingreso",
  centavos: string,
  fecha: string,
  categoria: number,
  descripcion: string | null,
) => ({
  id,
  tipo,
  monto_centavos: centavos,
  fecha,
  categoria_id: categoria,
  medio: "transferencia",
  descripcion,
  compartido: false,
  meta: null,
  sentido: null,
  recurrente: null,
});
const movimientos = [
  movimiento("m1", "gasto", "1500000", "2026-12-12", 8, null),
  movimiento("m2", "gasto", "4500000", "2026-12-12", 1, "Mercado"),
  movimiento("m3", "ingreso", "120000000", "2026-12-10", 17, null),
  movimiento("m4", "gasto", "1990000", "2026-12-03", 9, null),
  movimiento("m5", "gasto", "7500000", "2026-12-02", 1, null),
];

const listaDelApi = (periodo: string, lista: unknown[]) => ({
  periodo_actual: periodo,
  periodo,
  resumen: { movimientos: lista.length, total_centavos: null },
  meses: [periodo],
  categorias: [
    { categoria_id: 1, movimientos: 2, oculta: false },
    { categoria_id: 8, movimientos: 1, oculta: false },
  ],
  movimientos: lista,
});

const sinMovimientos = {
  periodo_actual: "2026-12",
  periodo: "2026-12",
  resumen: { movimientos: 0, total_centavos: null },
  meses: [],
  categorias: [],
  movimientos: [],
};

/** El API de PN-01: movimientos del mes y, si se pide, «Por confirmar» con fechas que ya llegaron. */
function apiDeMovimientos(page: Page, conPendientes: boolean) {
  return simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/repeticiones/pendientes": responder(
      200,
      conPendientes
        ? {
            pendientes,
            resumen: { total: pendientes.length, ingresos: 1, gastos: 3 },
          }
        : sinPendientes,
    ),
    "GET /api/v1/movimientos": responder(
      200,
      listaDelApi("2026-12", movimientos),
    ),
  });
}

/** El API de F-1 y PN-03: sin movimientos y con las próximas fechas que calcula el API. */
function apiDeRegistrar(page: Page) {
  return simularApi(page, {
    "GET /api/v1/cuenta/seguridad": responder(200, { ingreso_anterior: null }),
    "GET /api/v1/movimientos": responder(200, sinMovimientos),
    "GET /api/v1/repeticiones/pendientes": responder(200, sinPendientes),
    "GET /api/v1/categorias": responder(200, catalogo),
    "GET /api/v1/repeticiones/proximas": responder(200, {
      proximas: ["2027-01-14", "2027-02-14", "2027-03-14"],
    }),
  });
}

const sesion = {
  "GET /api/v1/cuenta/seguridad": responder(200, {
    ingreso_anterior: "2026-12-13T02:40:00Z",
  }),
};
const encabezado = (page: Page, nombre: string) =>
  page.getByRole("heading", { level: 1, name: nombre });

/** Lo que la Navegación lateral web (E14-SDD 5.13) muestra en una pantalla con sesión. */
export type Lateral = {
  /** El enlace con `aria-current="page"`; `null` cuando la pantalla no es un destino (E14-PTU 4.0). */
  activo: "Movimientos" | "Presupuesto" | "Registrar" | null;
  /** Secundario donde la pantalla ya tiene su Primario: un solo Primario por pantalla (E14-SDD 5.13). */
  registrar: "primario" | "secundario";
};

export type Pantalla = {
  nombre: string;
  /** Solo las pantallas con sesión llevan la Navegación lateral desde 768 px; sin sesión, ninguna. */
  lateral?: Lateral;
  /** Prepara el API simulado y lo que haga falta antes de abrir la pantalla. */
  preparar: (page: Page) => Promise<unknown>;
  /** Abre la pantalla y comprueba que es la esperada, para que una redirección no pase en silencio. */
  abrir: (page: Page) => Promise<void>;
};

const abrirConTitulo = (ruta: string, titulo: string) => async (page: Page) => {
  await page.goto(ruta);
  await expect(encabezado(page, titulo)).toBeVisible();
};
const sinApi = async () => undefined;

export const pantallas: Pantalla[] = [
  {
    nombre: "PN-58 /crear-cuenta",
    preparar: sinApi,
    abrir: abrirConTitulo("/crear-cuenta", "Crea tu cuenta"),
  },
  {
    nombre: "PN-59 /revisa-tu-correo",
    preparar: (page) =>
      page.addInitScript(() =>
        sessionStorage.setItem("correo-pendiente", "laura@ejemplo.com"),
      ),
    abrir: async (page) => {
      await page.goto("/revisa-tu-correo");
      await expect(encabezado(page, "Revisa tu correo")).toBeVisible();
      // D-172: sin sesión no hay «Ya lo confirmé»; «Usar otro correo» ocupa su lugar.
      await expect(page.getByText("Ya lo confirmé")).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Usar otro correo" }),
      ).toBeVisible();
    },
  },
  {
    nombre:
      "PN-59 /revisa-tu-correo sin la dirección, con el formulario abierto",
    preparar: sinApi,
    abrir: async (page) => {
      await page.goto("/revisa-tu-correo");
      await page.getByRole("button", { name: "Reenviar el correo" }).click();
      await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    },
  },
  {
    nombre: "PN-60 /entrar",
    preparar: sinApi,
    abrir: abrirConTitulo("/entrar", "Inicia sesión"),
  },
  {
    nombre: "PN-61 /recuperar-acceso",
    preparar: sinApi,
    abrir: abrirConTitulo("/recuperar-acceso", "Recuperar el acceso"),
  },
  {
    nombre: "PN-62 /recuperar?t=…",
    preparar: sinApi,
    abrir: abrirConTitulo("/recuperar?t=abc", "Elige tu contraseña nueva"),
  },
  {
    nombre: "PN-63 /privacidad",
    preparar: sinApi,
    abrir: abrirConTitulo("/privacidad", "Cómo cuidamos tus datos"),
  },
  {
    nombre: "PN-63 /cuenta/privacidad (desde el menú)",
    lateral: { activo: null, registrar: "primario" },
    preparar: sinApi,
    abrir: async (page) => {
      await page.goto("/cuenta/privacidad");
      await expect(encabezado(page, "Cómo cuidamos tus datos")).toBeVisible();
      await expect(page.getByRole("link", { name: "Atrás" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continuar" })).toHaveCount(
        0,
      );
    },
  },
  {
    nombre: "PN-64 /autorizacion",
    preparar: (page) =>
      simularApi(page, {
        "GET /api/v1/autorizaciones": responder(200, {
          version: { numero: "1.0", fecha: "2026-10-30" },
          finalidades: [
            { codigo: "cuenta_y_acceso", tipo: "necesaria", otorgada: false },
            {
              codigo: "funciones_financieras",
              tipo: "necesaria",
              otorgada: false,
            },
            { codigo: "avisos", tipo: "accesoria", otorgada: false },
            { codigo: "horas_de_vida", tipo: "accesoria", otorgada: false },
          ],
        }),
      }),
    abrir: abrirConTitulo("/autorizacion", "Tu autorización"),
  },
  {
    nombre: "PN-69 /cuenta/borrar",
    lateral: { activo: null, registrar: "primario" },
    preparar: (page) =>
      simularApi(page, {
        "GET /api/v1/cuenta/borrado": responder(200, {
          hogar: {
            nombre: "Nuestro hogar",
            es_administradora: true,
            unica_adulta: false,
            nuevo_administrador: "Camilo",
          },
          menores: [{ id: "id-mateo", nombre: "Mateo" }],
        }),
      }),
    abrir: abrirConTitulo("/cuenta/borrar", "Borrar mi cuenta"),
  },
  {
    nombre: "PN-71 /cuenta/seguridad",
    lateral: { activo: null, registrar: "primario" },
    preparar: (page) => simularApi(page, sesion),
    abrir: abrirConTitulo("/cuenta/seguridad", "Seguridad de la cuenta"),
  },
  {
    nombre: "PN-73 /cuenta/contrasena",
    lateral: { activo: null, registrar: "secundario" },
    preparar: sinApi,
    abrir: abrirConTitulo("/cuenta/contrasena", "Cambiar mi contraseña"),
  },
  {
    nombre: "PN-01 /movimientos con «Por confirmar»",
    lateral: { activo: "Movimientos", registrar: "primario" },
    preparar: (page) => apiDeMovimientos(page, true),
    abrir: async (page) => {
      await page.goto("/movimientos");
      await expect(encabezado(page, "Movimientos")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Por confirmar" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Confirmar todos" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /Mercado/ })).toBeVisible();
    },
  },
  {
    nombre: "PN-02 /movimientos?movimiento=m2 (detalle)",
    lateral: { activo: "Movimientos", registrar: "primario" },
    preparar: (page) => apiDeMovimientos(page, false),
    abrir: async (page) => {
      await page.goto("/movimientos?movimiento=m2");
      await expect(encabezado(page, "Movimientos")).toBeAttached();
      await expect(
        page.getByRole("region", { name: "Movimiento" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Borrar este movimiento" }),
      ).toBeVisible();
    },
  },
  {
    nombre: "«Confirmar todos» /movimientos?confirmar=todos",
    lateral: { activo: "Movimientos", registrar: "primario" },
    preparar: (page) => apiDeMovimientos(page, true),
    abrir: async (page) => {
      await page.goto("/movimientos");
      await page.getByRole("link", { name: "Confirmar todos" }).click();
      await expect(page).toHaveURL(/\?confirmar=todos$/);
      await expect(
        page.getByRole("region", { name: "Confirmar todos" }),
      ).toBeVisible();
    },
  },
  {
    nombre: "F-1 /registrar",
    lateral: { activo: "Registrar", registrar: "secundario" },
    preparar: apiDeRegistrar,
    abrir: abrirConTitulo("/registrar", "Registrar"),
  },
  {
    nombre: "F-1 /registrar con «Revisa y confirma»",
    lateral: { activo: "Registrar", registrar: "secundario" },
    preparar: (page) =>
      simularApi(page, {
        "GET /api/v1/cuenta/seguridad": responder(200, {
          ingreso_anterior: null,
        }),
        "GET /api/v1/movimientos": responder(200, sinMovimientos),
        "GET /api/v1/repeticiones/pendientes": responder(200, sinPendientes),
        "GET /api/v1/categorias": responder(200, catalogo),
        "POST /api/v1/movimientos/interpretacion": responder(200, {
          resultado: "propuesta",
          tipo: "gasto",
          monto_centavos: 4500000,
          categoria: null,
          fecha: "2026-12-13",
          varios_movimientos: true,
        }),
      }),
    abrir: async (page) => {
      await page.goto("/registrar");
      await expect(encabezado(page, "Registrar")).toBeVisible();
      await page
        .getByLabel("Escribe el gasto o el ingreso")
        .fill("mercado 45 mil ayer y 12 mil de pasajes");
      await page.getByRole("button", { name: "Llenar el formulario" }).click();
      // Con varios montos la categoría llega vacía y la persona la elige (D-196, paso 1).
      await page.getByRole("radio", { name: "Alimentación" }).check();
      await page.getByRole("radio", { name: "Efectivo" }).check();
      await page.getByRole("button", { name: "Revisar y guardar" }).click();
      await expect(
        page.getByRole("heading", { level: 2, name: "Revisa y confirma" }),
      ).toBeVisible();
      await expect(
        page.getByText("Encontramos más de un movimiento"),
      ).toBeVisible();
    },
  },
  {
    nombre: "PN-03 /registrar/se-repite",
    lateral: { activo: null, registrar: "secundario" },
    preparar: apiDeRegistrar,
    abrir: abrirConTitulo("/registrar/se-repite", "Se repite"),
  },
  {
    nombre: "PN-03 /registrar/se-repite en «Cada mes»",
    lateral: { activo: null, registrar: "secundario" },
    preparar: apiDeRegistrar,
    abrir: async (page) => {
      await page.goto("/registrar/se-repite");
      await expect(encabezado(page, "Se repite")).toBeVisible();
      await page.getByRole("radio", { name: "Cada mes" }).check();
      await expect(page.getByRole("radio", { name: "Cada mes" })).toBeChecked();
    },
  },
  // PN-06 y PN-07 son el destino «Presupuesto» (E14-PPA 4.1, variante web); PN-08 no es un destino (E14-PPA 1): lleva
  // Barra superior con Atrás y la barra sin destino activo, como PN-03.
  {
    nombre: "PN-06 /presupuesto",
    lateral: { activo: "Presupuesto", registrar: "primario" },
    preparar: (page) => apiDePresupuesto(page, casos.laura()),
    abrir: async (page) => {
      await abrirConTitulo("/presupuesto", "Presupuesto de noviembre")(page);
      await expect(
        page.getByRole("button", { name: "Agregar otra categoría" }),
      ).toBeVisible();
    },
  },
  {
    nombre: "PN-06 /presupuesto con la hoja «Poner presupuesto» abierta",
    lateral: { activo: "Presupuesto", registrar: "primario" },
    preparar: (page) => apiDePresupuesto(page, casos.laura()),
    abrir: async (page) => {
      await abrirConTitulo("/presupuesto", "Presupuesto de noviembre")(page);
      await page
        .getByRole("button", {
          name: "Poner presupuesto a Arriendo o cuota de vivienda",
        })
        .click();
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page.getByText("Falta el monto.")).toBeVisible();
    },
  },
  {
    nombre: "PN-07 /presupuesto con ingreso nulo",
    lateral: { activo: "Presupuesto", registrar: "primario" },
    preparar: (page) => apiDePresupuesto(page, casos.nulo()),
    abrir: async (page) => {
      await abrirConTitulo("/presupuesto", "Presupuesto de noviembre")(page);
      await expect(
        page.getByRole("button", { name: "Dejar el presupuesto en cero" }),
      ).toBeVisible();
    },
  },
  {
    nombre: "PN-07 /presupuesto con ingreso bajo",
    lateral: { activo: "Presupuesto", registrar: "primario" },
    preparar: (page) => apiDePresupuesto(page, casos.bajo()),
    abrir: async (page) => {
      await abrirConTitulo("/presupuesto", "Presupuesto de noviembre")(page);
      await expect(page.getByText(/Lo asignado supera por/)).toBeVisible();
    },
  },
  {
    nombre: "PN-08 /ingresos con una fecha por confirmar",
    lateral: { activo: null, registrar: "primario" },
    preparar: (page) => apiDeIngresos(page, 1),
    abrir: async (page) => {
      await abrirConTitulo("/ingresos", "Ingresos")(page);
      await expect(
        page.getByRole("button", {
          name: "Confirmar Salario de $1.200.000 del 16 de noviembre de 2026",
        }),
      ).toBeVisible();
    },
  },
  {
    nombre: "PN-08 /ingresos?periodo=2026-10 (caso P, varias fuentes)",
    lateral: { activo: null, registrar: "primario" },
    preparar: (page) => apiDeIngresos(page),
    abrir: async (page) => {
      await abrirConTitulo("/ingresos?periodo=2026-10", "Ingresos")(page);
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: "Trabajo independiente o ventas",
        }),
      ).toBeVisible();
    },
  },
  {
    nombre: "PN-08 «Confirmar todos» /ingresos?confirmar=todos",
    lateral: { activo: null, registrar: "primario" },
    preparar: (page) => apiDeIngresos(page, 2),
    abrir: async (page) => {
      await page.goto("/ingresos?confirmar=todos");
      await expect(
        page.getByRole("region", { name: "Confirmar todos" }),
      ).toBeVisible();
    },
  },
  {
    nombre: "PN-74 /verificar?t=…",
    preparar: sinApi,
    abrir: abrirConTitulo("/verificar?t=abc123", "Elige tu contraseña"),
  },
  {
    nombre: "PN-74 /verificar?t=… con el enlace vencido",
    preparar: (page) =>
      simularApi(page, {
        "POST /api/v1/cuentas/verificacion": responder(400, {
          error: "enlace_invalido",
        }),
      }),
    abrir: async (page) => {
      await page.goto("/verificar?t=viejo");
      await page.getByLabel("Contraseña", { exact: true }).fill("lluvia café");
      await page.getByRole("button", { name: "Guardar la contraseña" }).click();
      await expect(page.getByText("Ese enlace ya no sirve.")).toBeVisible();
      await expect(encabezado(page, "Elige tu contraseña")).toBeVisible();
    },
  },
];
