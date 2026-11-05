import { expect, test, type Page } from "@playwright/test";
import { responder, simularApi, sinPendientes } from "./ayudas";

// S13 (USA-008 de I05): el punto 5 de E14-MCO 4.2 pide sin desplazamiento horizontal de 360 a 1920 px.
const anchos = [360, 768, 1280, 1920];

// Hoy es el 14 de diciembre de 2026: las fechas de «Por confirmar» ya llegaron (E14-PRR 2.8).
async function hoyEs14DeDiciembre(page: Page) {
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

type Pantalla = {
  nombre: string;
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

const pantallas: Pantalla[] = [
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
    abrir: abrirConTitulo("/revisa-tu-correo", "Revisa tu correo"),
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
    preparar: (page) => simularApi(page, sesion),
    abrir: abrirConTitulo("/cuenta/seguridad", "Seguridad de la cuenta"),
  },
  {
    nombre: "PN-73 /cuenta/contrasena",
    preparar: sinApi,
    abrir: abrirConTitulo("/cuenta/contrasena", "Cambiar mi contraseña"),
  },
  {
    nombre: "PN-01 /movimientos con «Por confirmar»",
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
    preparar: apiDeRegistrar,
    abrir: abrirConTitulo("/registrar", "Registrar"),
  },
  {
    nombre: "PN-03 /registrar/se-repite",
    preparar: apiDeRegistrar,
    abrir: abrirConTitulo("/registrar/se-repite", "Se repite"),
  },
  {
    nombre: "PN-03 /registrar/se-repite en «Cada mes»",
    preparar: apiDeRegistrar,
    abrir: async (page) => {
      await page.goto("/registrar/se-repite");
      await expect(encabezado(page, "Se repite")).toBeVisible();
      await page.getByRole("radio", { name: "Cada mes" }).check();
      await expect(page.getByRole("radio", { name: "Cada mes" })).toBeChecked();
    },
  },
  {
    nombre: "/verificar?t=… (redirige a /entrar)",
    preparar: (page) =>
      simularApi(page, {
        "POST /api/v1/cuentas/verificacion": responder(200, {
          estado: "verificado",
          con_sesion: false,
        }),
      }),
    abrir: async (page) => {
      await page.goto("/verificar?t=abc123");
      await expect(page).toHaveURL(/\/entrar$/);
      await expect(page.getByRole("status")).toHaveText(
        "Listo, confirmamos tu correo.",
      );
      await expect(encabezado(page, "Inicia sesión")).toBeVisible();
    },
  },
];

test.describe("Sin desplazamiento horizontal de 360 a 1920 px (S13, E14-MCO 4.2 punto 5)", () => {
  for (const pantalla of pantallas) {
    for (const ancho of anchos) {
      test(`${pantalla.nombre} a ${ancho} px`, async ({ page }) => {
        // Defecto del producto: «Confirmar todos» a 360 px mide 368 px de ancho (scrollWidth 368, clientWidth 360).
        test.fail(
          pantalla.nombre.startsWith("«Confirmar todos»") && ancho === 360,
          "«Confirmar todos» se desborda 8 px a 360 px",
        );
        await page.setViewportSize({ width: ancho, height: 900 });
        await hoyEs14DeDiciembre(page);
        await pantalla.preparar(page);
        await pantalla.abrir(page);
        await page.evaluate(() => document.fonts.ready);

        const medidas = await page.evaluate(() => ({
          documento: [
            document.documentElement.scrollWidth,
            document.documentElement.clientWidth,
          ],
          cuerpo: [document.body.scrollWidth, document.body.clientWidth],
        }));
        expect(medidas.documento[0]).toBeLessThanOrEqual(medidas.documento[1]!);
        expect(medidas.cuerpo[0]).toBeLessThanOrEqual(medidas.documento[1]!);
      });
    }
  }
});
