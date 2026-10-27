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
import { json, porTexto, simularApi } from "../ayudas";

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

// Lo que contesta la lista; cada prueba cambia lo que necesita.
let alListar: (consulta: URLSearchParams) => Response;

beforeEach(() => {
  alListar = () => json(200, lista(deNoviembre));
});

const api = () =>
  simularApi((p) => alListar(new URL(p.ruta, "http://app").searchParams));

async function abrir(ruta = "/movimientos") {
  window.history.replaceState(null, "", ruta);
  render(<Movimientos />);
  await screen.findAllByRole("heading", { level: 2 });
}
const filas = () => [...document.querySelectorAll(".lista-de-filas li")];
const fila = (nombre: RegExp) =>
  filas().find((f) => nombre.test(f.textContent ?? "")) as HTMLElement;

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
    expect(filas().map((f) => f.textContent)).toEqual([
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
    expect(filas()).toHaveLength(2);
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
    await screen.findAllByRole("heading", { level: 2 });
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
