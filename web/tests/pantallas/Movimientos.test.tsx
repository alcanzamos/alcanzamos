import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import type { Listado, Movimiento } from "../../src/api/movimientos";
import { avisoDeLlegada, irConMensaje } from "../../src/llegada";
import { Movimientos } from "../../src/pantallas/Movimientos";
import { json, porTexto, simularApi, type Pedido } from "../ayudas";

// Hoy es el 2 de noviembre de 2026, el día del escenario de E14-PRR 2.1.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T15:00:00Z"));
});

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
const musica = mov({
  id: "m2",
  monto_centavos: "1990000",
  fecha: "2026-10-05",
  categoria_id: 10,
  medio: "transferencia",
});
const deNoviembre = [transporte, mercado, alimentacion, arriendoDeEnero];

const lista = (
  movimientos: Movimiento[],
  cambios: Partial<Listado> = {},
): Listado => ({
  periodo_actual: "2026-11",
  periodo: "2026-11",
  resumen: { movimientos: movimientos.length, total_centavos: null },
  meses: ["2026-12", "2026-11", "2026-10", "2026-09"],
  categorias: [
    { categoria_id: 1, movimientos: 2, oculta: false },
    { categoria_id: 8, movimientos: 1, oculta: false },
    { categoria_id: 13, movimientos: 1, oculta: false },
    { categoria_id: 11, movimientos: 1, oculta: false },
    { categoria_id: 3, movimientos: 1, oculta: true },
  ],
  movimientos,
  ...cambios,
});

const catalogo = {
  gasto: [
    { id: 1, nombre: "x", general: false },
    { id: 4, nombre: "x", general: false },
    { id: 8, nombre: "x", general: false },
    { id: 16, nombre: "x", general: true },
  ],
  ingreso: [{ id: 17, nombre: "x", general: false }],
};

// Lo que contesta cada ruta; cada prueba cambia lo que necesita.
let alListar: (consulta: URLSearchParams) => Response;
let alCorregir: (pedido: Pedido) => Response;
let alBorrar: (pedido: Pedido) => Response;

beforeEach(() => {
  alListar = () => json(200, lista(deNoviembre));
  alCorregir = () => json(200, {});
  alBorrar = () => json(204);
});

function api() {
  return simularApi((p) => {
    const { pathname, searchParams } = new URL(p.ruta, "http://app");
    if (pathname === "/api/v1/categorias") return json(200, catalogo);
    if (p.metodo === "PUT") return alCorregir(p);
    if (p.metodo === "DELETE") return alBorrar(p);
    return alListar(searchParams);
  });
}

async function abrir(ruta = "/movimientos") {
  window.history.replaceState(null, "", ruta);
  render(<Movimientos />);
  await screen.findAllByRole("link", { name: /\$/ });
}
const fila = (nombre: RegExp) => screen.getByRole("link", { name: nombre });
const abrirFila = (nombre: RegExp) => fireEvent.click(fila(nombre));
const formulario = () =>
  within(screen.getByRole("region", { name: "Corregir movimiento" }));

describe("PN-01 · Movimientos: lista y filtros (E14-PRR 4.1)", () => {
  it("trae el título, «Registrar» y los movimientos del mes agrupados por día, del más reciente al más antiguo", async () => {
    const pedidos = api();
    await abrir();
    expect(
      screen.getByRole("heading", { level: 1, name: "Movimientos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar" })).toHaveAttribute(
      "href",
      "/registrar",
    );
    const dias = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(dias).toEqual([
      "Hoy, 2 de noviembre de 2026",
      "Ayer, 1 de noviembre de 2026",
    ]);
    const filas = screen
      .getAllByRole("link", { name: /\$/ })
      .map((f) => f.textContent);
    expect(filas).toEqual([
      "TransporteGasto · Efectivo$15.000",
      "Alimentación · MercadoGasto · Efectivo$45.000",
      "AlimentaciónGasto · Transferencia$75.000",
      "Arriendo de eneroAporte a una meta · TransferenciaCompartido con el hogar$100.000",
    ]);
    expect(screen.getByText(porTexto("4 movimientos"))).toBeInTheDocument();
    expect(pedidos[0]?.ruta).toBe("/api/v1/movimientos?");
  });

  // SEG-002 (NC-E16-40, NM-05): la fila «Arriendo de enero» es el aporte compartido de $100.000 y lleva la marca;
  // las demás, no (E14-PRR 2.2, fila 7).
  it("SEG-002: la fila «Arriendo de enero» de $100.000 muestra «Compartido con el hogar» y las demás no", async () => {
    api();
    await abrir();
    const arriendo = fila(/Arriendo de enero/);
    expect(arriendo).toHaveTextContent("$100.000");
    expect(arriendo).toHaveTextContent("Aporte a una meta · Transferencia");
    expect(within(arriendo).getByText("Compartido con el hogar")).toBeVisible();
    expect(screen.getAllByText("Compartido con el hogar")).toHaveLength(1);
    expect(fila(/Transporte/)).not.toHaveTextContent("Compartido");
  });

  it("los chips de periodo son el mes de hoy y el anterior; los de categoría, las tres con más movimientos", async () => {
    api();
    await abrir();
    const periodo = within(screen.getByRole("group", { name: "Periodo" }));
    expect(periodo.getAllByRole("radio").map((c) => c.id)).toEqual([
      "filtro-periodo-2026-11",
      "filtro-periodo-2026-10",
    ]);
    expect(periodo.getByRole("radio", { name: "Noviembre" })).toBeChecked();
    expect(periodo.getByRole("radio", { name: "Octubre" })).not.toBeChecked();
    const categoria = within(screen.getByRole("group", { name: "Categoría" }));
    expect(
      categoria
        .getAllByRole("radio")
        .map((c) => (c as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([
      "Todas",
      "Alimentación",
      "Transporte",
      "Restaurantes y hoteles",
    ]);
    expect(categoria.getByRole("radio", { name: "Todas" })).toBeChecked();
  });

  it("elegir una categoría la pone en la dirección y pide solo esa categoría; el resumen suma sus montos", async () => {
    const pedidos = api();
    alListar = (q) =>
      json(
        200,
        q.get("categoria") === "1"
          ? lista([mercado, alimentacion], {
              resumen: { movimientos: 2, total_centavos: "12000000" },
            })
          : lista(deNoviembre),
      );
    await abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Alimentación" }));
    await screen.findByText(porTexto("Alimentación: 2 movimientos, $120.000"));
    expect(window.location.search).toBe("?periodo=2026-11&categoria=1");
    expect(pedidos.at(-1)?.ruta).toBe(
      "/api/v1/movimientos?periodo=2026-11&categoria=1",
    );
    expect(screen.getAllByRole("link", { name: /\$/ })).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Todas" }));
    await screen.findByText(porTexto("4 movimientos"));
    expect(window.location.search).toBe("?periodo=2026-11");
  });

  it("«Ver todas» lista también las categorías ocultas y la elegida sin chip entra como chip", async () => {
    api();
    alListar = () =>
      json(
        200,
        lista(deNoviembre, {
          resumen: { movimientos: 1, total_centavos: "1" },
        }),
      );
    await abrir();
    expect(screen.queryByRole("button", { name: "Ropa y calzado" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }));
    expect(screen.getByRole("button", { name: "Ver todas" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const hojas = screen
      .getAllByRole("button", { pressed: false })
      .map((b) => b.textContent);
    expect(hojas).toEqual([
      "Alimentación",
      "Transporte",
      "Restaurantes y hoteles",
      "Recreación y cultura",
      "Ropa y calzado",
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Recreación y cultura" }),
    );
    expect(window.location.search).toBe("?periodo=2026-11&categoria=11");
    expect(
      await screen.findByRole("radio", { name: "Recreación y cultura" }),
    ).toBeChecked();
    expect(screen.queryByRole("button", { name: "Ropa y calzado" })).toBeNull();
  });

  it("elegir «Octubre» pone el periodo en la dirección y pide ese mes, con la categoría que ya estaba elegida", async () => {
    const pedidos = api();
    alListar = (q) =>
      json(
        200,
        q.get("periodo") === "2026-10"
          ? lista([musica], { periodo: "2026-10" })
          : lista(deNoviembre),
      );
    await abrir("/movimientos?categoria=10");
    fireEvent.click(screen.getByRole("radio", { name: "Octubre" }));
    await screen.findByRole("heading", {
      level: 2,
      name: "5 de octubre de 2026",
    });
    expect(window.location.search).toBe("?periodo=2026-10&categoria=10");
    expect(pedidos.at(-1)?.ruta).toBe(
      "/api/v1/movimientos?periodo=2026-10&categoria=10",
    );
  });

  it("«Otro mes» ofrece los meses con movimientos y el elegido sale como chip", async () => {
    api();
    alListar = (q) =>
      json(
        200,
        q.get("periodo") === "2026-12"
          ? lista([], {
              periodo: "2026-12",
              resumen: { movimientos: 0, total_centavos: null },
            })
          : lista(deNoviembre),
      );
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Otro mes" }));
    expect(
      screen
        .getAllByRole("button", { pressed: false })
        .map((b) => b.textContent),
    ).toEqual(["Diciembre de 2026", "Octubre de 2026", "Septiembre de 2026"]);
    expect(
      screen.getByRole("button", { name: "Noviembre de 2026", pressed: true }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diciembre de 2026" }));
    expect(window.location.search).toBe("?periodo=2026-12");
    expect(
      await screen.findByRole("radio", { name: "Diciembre" }),
    ).toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Septiembre de 2026" }),
    ).toBeNull();
  });

  it("un día que no es hoy ni ayer lleva su fecha en palabras", async () => {
    api();
    alListar = () => json(200, lista([musica], { periodo: "2026-10" }));
    await abrir("/movimientos?periodo=2026-10");
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "5 de octubre de 2026",
      }),
    ).toBeInTheDocument();
    expect(fila(/Suscripciones/)).toHaveTextContent("Gasto · Transferencia");
    expect(screen.getByRole("radio", { name: "Octubre" })).toBeChecked();
  });

  it("sin resultados con el filtro: lo dice y «Quitar los filtros» vuelve al mes de hoy", async () => {
    api();
    alListar = (q) =>
      json(
        200,
        q.has("categoria")
          ? lista([], { resumen: { movimientos: 0, total_centavos: "0" } })
          : lista(deNoviembre),
      );
    window.history.replaceState(null, "", "/movimientos?categoria=11");
    render(<Movimientos />);
    await screen.findByText("No hay movimientos con este filtro.");
    expect(screen.getByText("Cambia el periodo o la categoría.")).toBeVisible();
    expect(screen.queryByText(/\d movimientos/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Quitar los filtros" }));
    await screen.findByText(porTexto("4 movimientos"));
    expect(window.location.pathname + window.location.search).toBe(
      "/movimientos",
    );
  });

  it("sin ningún movimiento: «Todavía no hay movimientos» y «Registrar» sigue a la vista", async () => {
    api();
    alListar = () => json(200, lista([], { meses: [], categorias: [] }));
    window.history.replaceState(null, "", "/movimientos");
    render(<Movimientos />);
    await screen.findByText("Todavía no hay movimientos");
    expect(
      screen.getByText("Registra el primero y aquí lo verás."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Registrar" })).toBeVisible();
  });

  it("un error de carga dice «No pudimos cargar tus movimientos.» y «Intentar de nuevo» lo vuelve a pedir", async () => {
    const pedidos = api();
    alListar = () => json(500, { error: "interno" });
    window.history.replaceState(null, "", "/movimientos");
    render(<Movimientos />);
    await screen.findByText("No pudimos cargar tus movimientos.");
    expect(
      screen.getByText("Tus datos están a salvo. Intenta de nuevo."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Registrar" })).toBeVisible();
    alListar = () => json(200, lista(deNoviembre));
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    await screen.findByText(porTexto("4 movimientos"));
    expect(pedidos.filter((p) => p.metodo === "GET")).toHaveLength(2);
  });

  it("sin conexión muestra el aviso de sin conexión", async () => {
    simularApi(() => {
      throw new TypeError("Failed to fetch");
    });
    window.history.replaceState(null, "", "/movimientos");
    render(<Movimientos />);
    await screen.findByText(
      "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
    );
  });

  it("sin sesión (401) lleva a PN-60", async () => {
    api();
    alListar = () => json(401, { error: "sin_sesion" });
    window.history.replaceState(null, "", "/movimientos");
    render(<Movimientos />);
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
  });

  it("el aviso con que se llega (el registro de un movimiento) sale como mensaje de estado", async () => {
    api();
    window.history.replaceState(null, "", "/movimientos");
    irConMensaje("/movimientos", {
      tipo: "informacion",
      titulo: "Listo, registramos tu gasto de $45.000.",
    });
    render(<Movimientos />);
    await screen.findAllByRole("link", { name: /\$/ });
    expect(
      await screen.findByText(
        porTexto("Listo, registramos tu gasto de $45.000."),
      ),
    ).toBeInTheDocument();
    expect(avisoDeLlegada()?.titulo).toBe(
      "Listo, registramos tu gasto de $45.000.",
    );
  });

  it("es una ruta de la app: /movimientos", async () => {
    api();
    window.history.replaceState(null, "", "/movimientos");
    render(<App />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Movimientos" }),
    ).toBeInTheDocument();
  });
});

describe("PN-02 · Detalle de un movimiento (E14-PRR 4.2)", () => {
  it("sin movimiento elegido, la columna del detalle dice «Elige un movimiento para verlo.»", async () => {
    api();
    await abrir();
    expect(screen.getByText("Elige un movimiento para verlo.")).toBeVisible();
    expect(document.querySelector(".movimientos--abierto")).toBeNull();
  });

  it("tocar una fila abre el detalle en la dirección, con sus filas y los dos botones", async () => {
    api();
    await abrir();
    abrirFila(/Mercado/);
    const detalle = await screen.findByRole("region", { name: "Movimiento" });
    expect(window.location.search).toBe("?periodo=2026-11&movimiento=m9");
    expect(document.querySelector(".movimientos--abierto")).not.toBeNull();
    expect(fila(/Mercado/)).toHaveAttribute("aria-current", "true");
    expect(detalle).toHaveTextContent("$45.000");
    expect(detalle).toHaveTextContent("Gasto en Alimentación");
    expect(detalle).toHaveTextContent("FechaAyer, 1 de noviembre de 2026");
    expect(detalle).toHaveTextContent("Medio de pagoEfectivo");
    expect(detalle).toHaveTextContent("De quién esSolo mío");
    expect(detalle).toHaveTextContent("DescripciónMercado");
    expect(detalle).not.toHaveTextContent("Se repite");
    expect(
      within(detalle).getByRole("button", { name: "Corregir" }),
    ).toBeVisible();
    expect(
      within(detalle).getByRole("button", { name: "Borrar este movimiento" }),
    ).toBeVisible();
    expect(
      within(detalle).getByRole("link", { name: "Atrás" }),
    ).toHaveAttribute("href", "/movimientos?periodo=2026-11");
  });

  it("un movimiento de una fecha de un recurrente muestra la fila «Se repite», sin enlace para cambiarla", async () => {
    api();
    alListar = () =>
      json(
        200,
        lista([
          mov({
            id: "r1",
            categoria_id: 17,
            tipo: "ingreso",
            recurrente: {
              recurrente_id: "rr",
              fecha_programada: "2026-11-02",
              periodicidad: "quincenal",
              vuelve_a_pendiente: true,
            },
          }),
        ]),
      );
    await abrir("/movimientos?movimiento=r1");
    const detalle = await screen.findByRole("region", { name: "Movimiento" });
    expect(detalle).toHaveTextContent("Se repiteCada quincena");
    expect(detalle).toHaveTextContent("Ingreso en Salario");
    expect(within(detalle).queryByRole("link", { name: /repite/i })).toBeNull();
  });

  it("el aporte muestra su meta en lugar de la categoría y la Marca «Compartido con el hogar»", async () => {
    api();
    await abrir("/movimientos?movimiento=m4");
    const detalle = await screen.findByRole("region", { name: "Movimiento" });
    expect(detalle).toHaveTextContent("Aporte a «Arriendo de enero»");
    expect(detalle).toHaveTextContent("De quién esCompartido con el hogar");
  });

  it("un movimiento que ya no está (la dirección trae un id que la lista no tiene) lo dice y vuelve a la lista", async () => {
    api();
    await abrir("/movimientos?periodo=2026-11&movimiento=otro");
    await screen.findByText("Ese movimiento ya no está.");
    fireEvent.click(screen.getByRole("link", { name: "Ir a Movimientos" }));
    expect(window.location.search).toBe("?periodo=2026-11");
    expect(screen.getByText("Elige un movimiento para verlo.")).toBeVisible();
  });
});

describe("PN-02 · Corregir (E14-PRR 4.2, D-168)", () => {
  const corregir = async (ruta: string) => {
    await abrir(ruta);
    fireEvent.click(await screen.findByRole("button", { name: "Corregir" }));
    await screen.findByLabelText("Monto");
  };
  const guardarCambios = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar los cambios" }),
    );
  const puts = (pedidos: Pedido[]) => pedidos.filter((p) => p.metodo === "PUT");

  it("abre los campos del formulario ya llenos, con «Guardar los cambios» y «Ahora no»", async () => {
    api();
    await corregir("/movimientos?movimiento=m9");
    expect(
      screen.getByRole("heading", { level: 2, name: "Corregir movimiento" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue("$45.000");
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Descripción (opcional)")).toHaveValue(
      "Mercado",
    );
    expect(formulario().getByRole("radio", { name: "Gasto" })).toBeChecked();
    expect(
      formulario().getByRole("radio", { name: "Alimentación" }),
    ).toBeChecked();
    expect(
      formulario().getByRole("radio", { name: "Transferencia" }),
    ).not.toBeChecked();
    expect(formulario().getByRole("radio", { name: "Efectivo" })).toBeChecked();
    expect(formulario().getByRole("radio", { name: "Solo mío" })).toBeChecked();
    expect(screen.queryByRole("link", { name: "Cambiar" })).toBeNull();
    expect(
      screen.queryByText(
        "Este cambio es solo para esta fecha. Las demás siguen igual.",
      ),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  it("corregir el monto a $40.000 manda el PUT con todos los campos y vuelve a PN-01 con «Listo, guardamos los cambios.»", async () => {
    const pedidos = api();
    await corregir("/movimientos?periodo=2026-11&movimiento=m9");
    fireEvent.change(screen.getByLabelText("Monto"), {
      target: { value: "40.000" },
    });
    guardarCambios();
    await screen.findByText("Listo, guardamos los cambios.");
    expect(puts(pedidos)).toEqual([
      {
        metodo: "PUT",
        ruta: "/api/v1/movimientos/m9",
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
    expect(window.location.pathname + window.location.search).toBe(
      "/movimientos?periodo=2026-11",
    );
    expect(screen.getByText("Elige un movimiento para verlo.")).toBeVisible();
    // la lista se vuelve a pedir: el API es quien sabe lo que quedó
    expect(
      pedidos.filter(
        (p) => p.metodo === "GET" && p.ruta.startsWith("/api/v1/movimientos"),
      ),
    ).toHaveLength(2);
  });

  it("un movimiento suelto puede cambiar de Tipo y de Fecha; «Ahora no» vuelve al detalle sin guardar", async () => {
    const pedidos = api();
    await corregir("/movimientos?movimiento=m9");
    fireEvent.click(formulario().getByRole("radio", { name: "Ingreso" }));
    expect(
      formulario().getByRole("radio", { name: "Salario" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(
      await screen.findByRole("button", { name: "Corregir" }),
    ).toBeVisible();
    expect(puts(pedidos)).toEqual([]);
    expect(
      screen.getByRole("heading", { level: 2, name: "Movimiento" }),
    ).toHaveFocus();
  });

  it("D-168: en una fecha de un recurrente no hay Fecha ni Tipo, la frase va en el formulario y el PUT no manda la fecha", async () => {
    const pedidos = api();
    alListar = () =>
      json(
        200,
        lista([
          mov({
            id: "r1",
            fecha: "2026-10-26",
            categoria_id: 4,
            monto_centavos: "65000000",
            recurrente: {
              recurrente_id: "rr",
              fecha_programada: "2026-10-26",
              periodicidad: "mensual",
              vuelve_a_pendiente: false,
            },
          }),
        ]),
      );
    await corregir("/movimientos?movimiento=r1");
    expect(screen.queryByLabelText("Fecha")).toBeNull();
    expect(formulario().queryByRole("group", { name: "Tipo" })).toBeNull();
    expect(
      screen.getAllByText(
        "Este cambio es solo para esta fecha. Las demás siguen igual.",
      ),
    ).toHaveLength(1);
    expect(
      formulario().getByRole("group", { name: "Categoría" }),
    ).toBeVisible();
    expect(
      formulario().getByRole("group", { name: "Medio de pago" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Monto"), {
      target: { value: "$600.000" },
    });
    guardarCambios();
    await screen.findByText("Listo, guardamos los cambios.");
    expect(puts(pedidos)[0]?.cuerpo).toEqual({
      monto_centavos: 60000000,
      tipo: "gasto",
      categoria_id: 4,
      medio: "efectivo",
    });
  });

  it("un aporte no ofrece Tipo ni Categoría, conserva «Compartido con el hogar» y manda su tipo", async () => {
    const pedidos = api();
    await corregir("/movimientos?movimiento=m4");
    expect(formulario().queryByRole("group", { name: "Tipo" })).toBeNull();
    expect(formulario().queryByRole("group", { name: "Categoría" })).toBeNull();
    expect(
      formulario().queryByRole("button", { name: "Ver todas" }),
    ).toBeNull();
    expect(
      formulario().getByRole("radio", { name: "Compartido con el hogar" }),
    ).toBeChecked();
    expect(
      formulario().getByRole("radio", { name: "Transferencia" }),
    ).toBeChecked();
    fireEvent.change(screen.getByLabelText("Monto"), {
      target: { value: "90.000" },
    });
    guardarCambios();
    await screen.findByText("Listo, guardamos los cambios.");
    expect(puts(pedidos)[0]?.cuerpo).toEqual({
      monto_centavos: 9000000,
      tipo: "aporte",
      fecha: "2026-11-01",
      medio: "transferencia",
    });
  });

  it("un error de campo se muestra en el campo y no manda nada si falta el monto", async () => {
    const pedidos = api();
    await corregir("/movimientos?movimiento=m9");
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "" } });
    guardarCambios();
    expect(await screen.findByText("Falta el monto.")).toBeVisible();
    expect(puts(pedidos)).toEqual([]);
    fireEvent.change(screen.getByLabelText("Monto"), {
      target: { value: "40.000" },
    });
    alCorregir = () =>
      json(422, {
        error: "datos_invalidos",
        campos: { monto_centavos: "monto_no_positivo" },
      });
    guardarCambios();
    expect(
      await screen.findByText(porTexto("El monto debe ser mayor que $0.")),
    ).toBeVisible();
  });

  it("un error al guardar dice «No pudimos guardar los cambios.» y deja lo escrito", async () => {
    api();
    await corregir("/movimientos?movimiento=m9");
    alCorregir = () => json(500, { error: "interno" });
    fireEvent.change(screen.getByLabelText("Monto"), {
      target: { value: "40.000" },
    });
    guardarCambios();
    await screen.findByText("No pudimos guardar los cambios.");
    expect(
      screen.getByText("Tu movimiento sigue igual. Intenta de nuevo."),
    ).toBeVisible();
    expect(screen.getByLabelText("Monto")).toHaveValue("40.000");
  });

  it("si el API dice que ya no existe (404), PN-01 lo muestra como «Ese movimiento ya no está.»", async () => {
    api();
    await corregir("/movimientos?movimiento=m9");
    alCorregir = () => json(404, { error: "no_encontrado" });
    alListar = () => json(200, lista([transporte]));
    guardarCambios();
    await screen.findByText("Ese movimiento ya no está.");
    expect(
      screen.getByRole("link", { name: "Ir a Movimientos" }),
    ).toBeVisible();
  });

  it("sin sesión (401) al guardar lleva a PN-60", async () => {
    api();
    await corregir("/movimientos?movimiento=m9");
    alCorregir = () => json(401, { error: "sin_sesion" });
    guardarCambios();
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
  });
});

describe("PN-02 · Borrar (E14-PRR 4.2, D-168, D-169)", () => {
  const abrirHoja = async (ruta: string) => {
    await abrir(ruta);
    fireEvent.click(
      await screen.findByRole("button", { name: "Borrar este movimiento" }),
    );
    return screen.findByRole("region", { name: "¿Borrar este movimiento?" });
  };
  const confirmar = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Borrar el movimiento" }),
    );
  const recurrente = (vuelve: boolean) =>
    mov({
      id: "r1",
      fecha: "2026-08-15",
      categoria_id: 4,
      monto_centavos: "65000000",
      recurrente: {
        recurrente_id: "rr",
        fecha_programada: "2026-08-15",
        periodicidad: "mensual",
        vuelve_a_pendiente: vuelve,
      },
    });

  it("la hoja dice qué se borra y qué pasa, y borrar manda el DELETE y vuelve a PN-01 con «Listo, borramos el gasto de $45.000.»", async () => {
    const pedidos = api();
    const hoja = await abrirHoja("/movimientos?periodo=2026-11&movimiento=m9");
    expect(hoja).toHaveTextContent("Gasto de $45.000 en Alimentación, Ayer.");
    expect(hoja).toHaveTextContent(
      "Se quita de tu lista y calculamos el mes de nuevo.",
    );
    expect(hoja).not.toHaveTextContent("por confirmar");
    expect(hoja).not.toHaveTextContent("avance");
    expect(
      screen.getByRole("heading", { name: "¿Borrar este movimiento?" }),
    ).toHaveFocus();
    alListar = () =>
      json(200, lista([transporte, alimentacion, arriendoDeEnero]));
    confirmar();
    await screen.findByText(porTexto("Listo, borramos el gasto de $45.000."));
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toEqual([
      { metodo: "DELETE", ruta: "/api/v1/movimientos/m9", cuerpo: undefined },
    ]);
    await screen.findByText(porTexto("3 movimientos"));
    expect(window.location.pathname + window.location.search).toBe(
      "/movimientos?periodo=2026-11",
    );
    expect(screen.queryByRole("link", { name: /Mercado/ })).toBeNull();
  });

  it("«Ahora no» cierra la hoja sin borrar", async () => {
    const pedidos = api();
    await abrirHoja("/movimientos?movimiento=m9");
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(
      screen.queryByRole("region", { name: "¿Borrar este movimiento?" }),
    ).toBeNull();
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toEqual([]);
  });

  // D-169: la frase solo si la fecha de verdad vuelve a pendiente.
  it("D-169: una fecha que vuelve a pendiente agrega «Esta fecha volverá a quedar por confirmar.»", async () => {
    api();
    alListar = () => json(200, lista([recurrente(true)]));
    const hoja = await abrirHoja("/movimientos?movimiento=r1");
    expect(hoja).toHaveTextContent(
      "Esta fecha volverá a quedar por confirmar.",
    );
  });

  it("D-169: el arriendo del 15 de agosto (anterior al día en que se creó la repetición) no lleva la frase y se borra", async () => {
    const pedidos = api();
    alListar = () => json(200, lista([recurrente(false)]));
    const hoja = await abrirHoja("/movimientos?movimiento=r1");
    expect(hoja).toHaveTextContent(
      "Gasto de $650.000 en Arriendo o cuota de vivienda, 15 de agosto de 2026.",
    );
    expect(hoja).not.toHaveTextContent("por confirmar");
    confirmar();
    await screen.findByText(porTexto("Listo, borramos el gasto de $650.000."));
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toHaveLength(1);
  });

  it("un aporte agrega que el avance de la meta baja y su aviso dice «aporte»", async () => {
    api();
    const hoja = await abrirHoja("/movimientos?movimiento=m4");
    expect(hoja).toHaveTextContent(
      "Aporte de $100.000 a «Arriendo de enero», Ayer.",
    );
    expect(hoja).toHaveTextContent(
      "El avance de «Arriendo de enero» baja $100.000. El avance nunca queda por debajo de cero.",
    );
    confirmar();
    await screen.findByText(porTexto("Listo, borramos el aporte de $100.000."));
  });

  it("un retiro de una meta no dice que el avance baja", async () => {
    api();
    alListar = () =>
      json(200, lista([{ ...arriendoDeEnero, sentido: "salida" }]));
    const hoja = await abrirHoja("/movimientos?movimiento=m4");
    expect(hoja).not.toHaveTextContent("avance");
    expect(fila(/Arriendo de enero/)).toHaveTextContent(
      "Retiro de una meta · Transferencia",
    );
  });

  it("un ingreso dice «ingreso» en la hoja y en el aviso", async () => {
    api();
    alListar = () =>
      json(
        200,
        lista([
          mov({
            id: "i1",
            tipo: "ingreso",
            categoria_id: 17,
            monto_centavos: "120000000",
          }),
        ]),
      );
    const hoja = await abrirHoja("/movimientos?movimiento=i1");
    expect(hoja).toHaveTextContent("Ingreso de $1.200.000 en Salario, Hoy.");
    confirmar();
    await screen.findByText(
      porTexto("Listo, borramos el ingreso de $1.200.000."),
    );
  });

  it("un error al borrar dice «No pudimos borrar el movimiento.» y la hoja sigue abierta", async () => {
    const pedidos = api();
    await abrirHoja("/movimientos?movimiento=m9");
    alBorrar = () => json(500, { error: "interno" });
    confirmar();
    await screen.findByText("No pudimos borrar el movimiento.");
    expect(
      screen.getByText("Sigue en tu lista. Intenta de nuevo."),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Borrar el movimiento" }),
    ).toBeVisible();
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toHaveLength(1);
  });

  it("no manda dos borrados si se toca otra vez mientras borra", async () => {
    const pedidos = api();
    await abrirHoja("/movimientos?movimiento=m9");
    confirmar();
    confirmar();
    await screen.findByText(porTexto("Listo, borramos el gasto de $45.000."));
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toHaveLength(1);
  });

  it("si el API dice que ya no existe (404) o que no hay sesión (401), sigue lo que corresponde", async () => {
    api();
    await abrirHoja("/movimientos?movimiento=m9");
    alBorrar = () => json(404, { error: "no_encontrado" });
    alListar = () => json(200, lista([transporte]));
    confirmar();
    await screen.findByText("Ese movimiento ya no está.");
  });

  it("sin sesión (401) al borrar lleva a PN-60", async () => {
    api();
    await abrirHoja("/movimientos?movimiento=m9");
    alBorrar = () => json(401, { error: "sin_sesion" });
    confirmar();
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
  });
});
