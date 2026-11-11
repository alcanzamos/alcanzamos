import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ingresos } from "../../src/pantallas/Ingresos";
import { json, simularApi, type Pedido } from "../ayudas";

// E14-PPA 2.4: Laura en noviembre (una fuente) y el caso P en octubre (varias fuentes, RF-009).
type Marca = "registrado" | "esperado" | "por_confirmar";
const ingreso = (
  fecha: string,
  marca: Marca,
  centavos: number,
  descripcion: string | null = null,
) => ({
  fecha,
  marca,
  monto_centavos: centavos,
  medio: "transferencia",
  descripcion,
  movimiento_id: marca === "registrado" ? `m-${fecha}` : null,
  recurrente_id: marca === "registrado" ? null : `r-${fecha}`,
});
const fuente = (
  id: number,
  total: number,
  ingresos: unknown[],
  oculta = false,
) => ({
  categoria_id: id,
  nombre: "x",
  oculta,
  total_centavos: total,
  ingresos,
});
const periodoDe = (
  periodo: string,
  total: [number, number, number, number],
  fuentes: unknown[],
) => ({
  periodo_actual: "2026-11",
  periodo,
  meses: ["2026-11", "2026-10", "2026-08"],
  total: {
    entran_centavos: total[0],
    registrado_centavos: total[1],
    esperado_centavos: total[2],
    por_confirmar: total[3],
  },
  fuentes,
});

const lauraNoviembre = periodoDe(
  "2026-11",
  [240000000, 120000000, 120000000, 0],
  [
    fuente(17, 240000000, [
      ingreso("2026-11-01", "registrado", 120000000),
      ingreso("2026-11-16", "esperado", 120000000),
    ]),
  ],
);
const casoPOctubre = periodoDe(
  "2026-10",
  [55000000, 55000000, 0, 0],
  [
    fuente(18, 39000000, [
      ingreso("2026-10-03", "registrado", 30000000, "Venta de artesanías"),
      ingreso("2026-10-28", "registrado", 9000000, "Venta de artesanías"),
    ]),
    fuente(20, 16000000, [
      ingreso("2026-10-15", "registrado", 16000000, "Subsidio"),
    ]),
  ],
);
const conPorConfirmar = (n: 1 | 2) =>
  periodoDe(
    "2026-11",
    [240000000, 120000000, 120000000, n],
    [
      fuente(17, 240000000, [
        ingreso("2026-11-01", "por_confirmar", 120000000),
        ...(n === 2
          ? [ingreso("2026-11-16", "por_confirmar", 120000000)]
          : [ingreso("2026-11-16", "esperado", 120000000)]),
      ]),
    ],
  );
const sinIngresos = periodoDe("2026-11", [0, 0, 0, 0], []);

function api(
  leer: (p: Pedido) => unknown,
  escribir: (p: Pedido) => Response = () => json(201, {}),
) {
  return simularApi((p) =>
    p.metodo === "GET" ? json(200, leer(p)) : escribir(p),
  );
}
const lecturas = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.metodo === "GET").map((p) => p.ruta);

async function abrir(ruta = "/ingresos") {
  window.history.replaceState(null, "", ruta);
  render(<Ingresos />);
  await screen.findByRole("group", { name: "Periodo" });
}
const chips = () =>
  within(screen.getByRole("group", { name: "Periodo" }))
    .getAllByRole("radio")
    .map((c) => [
      (c as HTMLInputElement).labels?.[0]?.textContent,
      (c as HTMLInputElement).checked,
    ]);
const tarjeta = (titulo: string) =>
  screen.getByRole("heading", { level: 2, name: titulo }).closest("section")!;

describe("PN-08 · Ingresos del periodo de varias fuentes (E14-PPA 4.3)", () => {
  it("Laura en noviembre: barra con Atrás, periodos, total, la tarjeta «Salario» y «Registrar un ingreso»", async () => {
    api(() => lauraNoviembre);
    await abrir();
    expect(
      screen.getByRole("heading", { level: 1, name: "Ingresos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/presupuesto",
    );
    expect(chips()).toEqual([
      ["Octubre", false],
      ["Noviembre", true],
      ["Diciembre", false],
    ]);
    expect(tarjeta("Entran este mes")).toHaveTextContent(
      "Entran este mes$2.400.000Ya registrado$1.200.000Esperado$1.200.000",
    );
    expect(tarjeta("Salario")).toHaveTextContent(
      "Salario$2.400.0001 de noviembre de 2026TransferenciaRegistrado$1.200.00016 de noviembre de 2026TransferenciaEsperado$1.200.000",
    );
    expect(
      screen.getByRole("link", { name: /1 de noviembre de 2026/ }),
    ).toHaveAttribute(
      "href",
      "/movimientos?periodo=2026-11&movimiento=m-2026-11-01",
    );
    // Lo esperado no se confirma todavía (D-091): sin «Confirmar» ni enlace.
    expect(screen.queryByRole("button", { name: /Confirmar/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /16 de noviembre/ })).toBeNull();
    expect(screen.queryByText("Confirmar todos")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Registrar un ingreso" }),
    ).toHaveAttribute("href", "/registrar?tipo=ingreso");
    expect(screen.queryByText(/Prima, cesantías o intereses/)).toBeNull();
  });

  it("lleva la Navegación lateral (bug 233), con «Registrar» primario y sin destino activo mientras falte «Presupuesto»", async () => {
    api(() => lauraNoviembre);
    await abrir();
    const barra = within(screen.getByRole("navigation"));
    expect(barra.getAllByRole("link").map((e) => e.textContent)).toEqual([
      "Registrar",
      "Movimientos",
    ]);
    expect(barra.getByRole("link", { name: "Registrar" })).toHaveClass(
      "boton--primario",
    );
    for (const enlace of barra.getAllByRole("link"))
      expect(enlace).not.toHaveAttribute("aria-current");
  });

  it("caso P en octubre: «Entraron este mes», dos fuentes de mayor a menor y la descripción en el texto de apoyo", async () => {
    const pedidos = api(() => casoPOctubre);
    await abrir("/ingresos?periodo=2026-10");
    expect(lecturas(pedidos)).toEqual(["/api/v1/ingresos?periodo=2026-10"]);
    expect(tarjeta("Entraron este mes")).toHaveTextContent(
      "Entraron este mes$550.000Ya registrado$550.000Esperado$0",
    );
    const fuentes = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(fuentes).toEqual([
      "Entraron este mes",
      "Trabajo independiente o ventas",
      "Ayudas y subsidios",
    ]);
    expect(tarjeta("Trabajo independiente o ventas")).toHaveTextContent(
      "Trabajo independiente o ventas$390.0003 de octubre de 2026Transferencia · Venta de artesaníasRegistrado$300.00028 de octubre de 2026Transferencia · Venta de artesaníasRegistrado$90.000",
    );
    expect(tarjeta("Ayudas y subsidios")).toHaveTextContent(
      "Ayudas y subsidios$160.00015 de octubre de 2026Transferencia · SubsidioRegistrado$160.000",
    );
  });

  it("un chip de periodo lleva a ese mes en la dirección y pide sus ingresos", async () => {
    const pedidos = api(() => lauraNoviembre);
    await abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Diciembre" }));
    expect(window.location.search).toBe("?periodo=2026-12");
    await waitFor(() =>
      expect(lecturas(pedidos)).toEqual([
        "/api/v1/ingresos",
        "/api/v1/ingresos?periodo=2026-12",
      ]),
    );
  });

  it("«Otro mes» muestra los meses con ingresos registrados; el elegido suma su chip", async () => {
    api((p) =>
      p.ruta.endsWith("2026-08")
        ? { ...sinIngresos, periodo: "2026-08" }
        : lauraNoviembre,
    );
    await abrir();
    const otroMes = screen.getByRole("button", { name: "Otro mes" });
    expect(otroMes).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(otroMes);
    const meses = screen.getAllByRole("button", { name: /de 2026$/ });
    expect(meses.map((m) => m.textContent)).toEqual([
      "Noviembre de 2026",
      "Octubre de 2026",
      "Agosto de 2026",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Agosto de 2026" }));
    expect(window.location.search).toBe("?periodo=2026-08");
    await waitFor(() =>
      expect(chips()).toEqual([
        ["Octubre", false],
        ["Noviembre", false],
        ["Diciembre", false],
        ["Agosto", true],
      ]),
    );
  });

  it("sin ingresos en el periodo: la tarjeta de E14, sin Atención", async () => {
    api(() => sinIngresos);
    await abrir();
    expect(
      screen.getByText("Todavía no registras ingresos este mes."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cuando registres uno, aquí lo verás."),
    ).toBeInTheDocument();
    expect(document.querySelector(".aviso--atencion")).toBeNull();
  });

  it("una fuente oculta lleva el ícono y la palabra «Oculta»", async () => {
    api(() =>
      periodoDe(
        "2026-11",
        [100, 100, 0, 0],
        [fuente(19, 100, [ingreso("2026-11-02", "registrado", 100)], true)],
      ),
    );
    await abrir();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Remesas o giros familiares Oculta",
      }),
    ).toBeInTheDocument();
  });

  it("un error de carga dice el texto de E14 y «Intentar de nuevo» vuelve a pedir", async () => {
    let fallar = true;
    simularApi(() =>
      fallar
        ? json(500, { error: "error_interno" })
        : json(200, lauraNoviembre),
    );
    window.history.replaceState(null, "", "/ingresos");
    render(<Ingresos />);
    expect(
      await screen.findByText("No pudimos cargar tus ingresos."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tus datos están a salvo. Intenta de nuevo."),
    ).toBeInTheDocument();
    fallar = false;
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await screen.findByText("Entran este mes")).toBeInTheDocument();
  });
});

describe("PN-08 · Por confirmar y «Confirmar todos» (US-60, D-091 a D-093)", () => {
  it("una fecha por confirmar lleva la marca, «Confirmar» y «Más»; sin «Confirmar todos»", async () => {
    api(() => conPorConfirmar(1));
    await abrir();
    expect(tarjeta("Salario")).toHaveTextContent(
      "1 de noviembre de 2026TransferenciaPor confirmar$1.200.000ConfirmarMás",
    );
    expect(
      screen.getByRole("button", {
        name: "Confirmar Salario de $1.200.000 del 1 de noviembre de 2026",
      }),
    ).toHaveClass("boton--secundario");
    expect(
      screen.getByRole("button", {
        name: "Más opciones de Salario de $1.200.000 del 1 de noviembre de 2026",
      }),
    ).toHaveClass("boton--texto");
    expect(screen.queryByText("Confirmar todos")).toBeNull();
  });

  it("«Confirmar» usa la ruta de la US-60, avisa con el monto del API y vuelve a pedir los ingresos", async () => {
    const pedidos = api(
      () => conPorConfirmar(1),
      () =>
        json(201, {
          id: "m9",
          tipo: "ingreso",
          monto_centavos: 120000000,
          fecha: "2026-11-01",
        }),
    );
    await abrir();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirmar Salario de $1.200.000 del 1 de noviembre de 2026",
      }),
    );
    const estado = await screen.findByRole("status");
    await waitFor(() =>
      expect(estado).toHaveTextContent(
        "Listo, confirmamos tu ingreso de $1.200.000.",
      ),
    );
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r-2026-11-01/confirmacion",
        cuerpo: { fecha: "2026-11-01" },
      },
    ]);
    await waitFor(() => expect(lecturas(pedidos)).toHaveLength(2));
  });

  it("un error al confirmar deja la fecha por confirmar y dice el aviso de E14", async () => {
    api(
      () => conPorConfirmar(1),
      () => json(500, { error: "error_interno" }),
    );
    await abrir();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirmar Salario de $1.200.000 del 1 de noviembre de 2026",
      }),
    );
    expect(
      await screen.findByText("No pudimos confirmar el movimiento."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sigue por confirmar. Intenta de nuevo."),
    ).toBeInTheDocument();
  });

  it("«Más» abre la hoja de la US-60 con «Cambiar el monto» y «No pasó»", async () => {
    api(() => conPorConfirmar(1));
    await abrir();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Más opciones de Salario de $1.200.000 del 1 de noviembre de 2026",
      }),
    );
    const hoja = screen.getByRole("dialog", {
      name: "Salario · 1 de noviembre de 2026",
    });
    expect(
      within(hoja)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["", "Cambiar el monto", "No pasó"]);
  });

  it("con dos o más, la tarjeta del total suma «Confirmar todos», que abre la lista de la US-60 con lo del periodo", async () => {
    const pedidos = api(
      () => conPorConfirmar(2),
      () =>
        json(200, {
          movimientos: [],
          omitidas: [],
          siguen_pendientes: 0,
          resumen: { guardados: 2, omitidas: 0 },
        }),
    );
    await abrir();
    const todos = within(tarjeta("Entran este mes")).getByRole("link", {
      name: "Confirmar todos",
    });
    expect(todos).toHaveAttribute("href", "/ingresos?confirmar=todos");
    expect(todos).toHaveClass("boton--texto");
    fireEvent.click(todos);
    const panel = await screen.findByRole("region", {
      name: "Confirmar todos",
    });
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Guardar 2 movimientos" }),
    );
    const estado = await screen.findByRole("status");
    await waitFor(() =>
      expect(estado).toHaveTextContent("Listo, guardamos 2 movimientos."),
    );
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/decisiones",
        cuerpo: {
          decisiones: [
            { recurrente_id: "r-2026-11-01", fecha: "2026-11-01" },
            { recurrente_id: "r-2026-11-16", fecha: "2026-11-16" },
          ],
        },
      },
    ]);
    expect(window.location.search).toBe("");
  });

  it("Atrás del panel vuelve a las fuentes sin guardar nada", async () => {
    const pedidos = api(() => conPorConfirmar(2));
    await abrir("/ingresos?confirmar=todos");
    const panel = await screen.findByRole("region", {
      name: "Confirmar todos",
    });
    fireEvent.click(within(panel).getByRole("link", { name: "Atrás" }));
    expect(window.location.search).toBe("");
    await screen.findByRole("heading", { level: 2, name: "Salario" });
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
  });

  it("con una sola fecha por confirmar la dirección de «Confirmar todos» no abre el panel", async () => {
    api(() => conPorConfirmar(1));
    await abrir("/ingresos?confirmar=todos");
    expect(
      screen.queryByRole("region", { name: "Confirmar todos" }),
    ).toBeNull();
    expect(tarjeta("Salario")).toBeInTheDocument();
  });
});
