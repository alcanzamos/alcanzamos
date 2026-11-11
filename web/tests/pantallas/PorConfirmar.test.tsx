import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Pendiente, Pendientes } from "../../src/api/repeticiones";
import { PorConfirmar } from "../../src/pantallas/PorConfirmar";
import { json, porTexto, simularApi } from "../ayudas";

const salario: Pendiente = {
  recurrente_id: "r1",
  fecha: "2026-11-16",
  tipo: "ingreso",
  categoria_id: 17,
  medio: "transferencia",
  monto_habitual_centavos: "120000000",
  periodicidad: "mensual",
};
const arriendo: Pendiente = {
  recurrente_id: "r2",
  fecha: "2026-12-01",
  tipo: "gasto",
  categoria_id: 4,
  medio: "transferencia",
  monto_habitual_centavos: "65000000",
  periodicidad: "mensual",
};
const dos: Pendientes = {
  pendientes: [salario, arriendo],
  resumen: { total: 2, ingresos: 1, gastos: 1 },
};
const una: Pendientes = {
  pendientes: [salario],
  resumen: { total: 1, ingresos: 1, gastos: 0 },
};

const movimientoConfirmado = {
  id: "m1",
  tipo: "ingreso",
  monto_centavos: "120000000",
  fecha: "2026-11-16",
};

function abrir(datos: Pendientes = dos) {
  const alEmpezar = vi.fn();
  const alTerminar = vi.fn();
  const refrescar = vi.fn();
  render(
    <PorConfirmar
      datos={datos}
      hrefDeTodos="/movimientos?confirmar=todos"
      alEmpezar={alEmpezar}
      alTerminar={alTerminar}
      refrescar={refrescar}
    />,
  );
  return { alEmpezar, alTerminar, refrescar };
}
const nombreSalario =
  "Confirmar Salario de $1.200.000 del 16 de noviembre de 2026";
const masSalario = () =>
  screen.getByRole("button", {
    name: "Más opciones de Salario de $1.200.000 del 16 de noviembre de 2026",
  });

describe("«Por confirmar» en PN-01 (E14-PRR 4.1)", () => {
  it("con más de una fecha: título, texto, resumen, «Confirmar todos» y una fila por fecha con «Confirmar» y «Más»", () => {
    abrir();
    expect(
      screen.getByRole("heading", { level: 2, name: "Por confirmar" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Estos movimientos que se repiten ya llegaron a su fecha. Confírmalos con un toque, o toca «Más» si no pasaron o cambió el monto.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(porTexto("2 por confirmar: 1 ingreso y 1 gasto")),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Confirmar todos" }),
    ).toHaveAttribute("href", "/movimientos?confirmar=todos");
    const filas = screen.getAllByRole("listitem");
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent(
      "SalarioIngreso · Transferencia · 16 de noviembre de 2026Por confirmar$1.200.000ConfirmarMás",
    );
    expect(filas[1]).toHaveTextContent(
      "Arriendo o cuota de viviendaGasto · Transferencia · 1 de diciembre de 2026Por confirmar$650.000ConfirmarMás",
    );
    expect(
      screen.getByRole("button", { name: nombreSalario }),
    ).toHaveTextContent("Confirmar");
    expect(masSalario()).toHaveTextContent("Más");
  });

  it("con una sola fecha no hay resumen ni «Confirmar todos»: queda la fila con «Confirmar» y «Más»", () => {
    abrir(una);
    expect(
      screen.getByText(
        "Esta fecha de un movimiento que se repite ya llegó. Confírmala con un toque, o toca «Más» si no pasó o cambió el monto.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/por confirmar:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Confirmar todos" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("un solo tipo dice «2 gastos por confirmar» (D-163)", () => {
    abrir({
      pendientes: [arriendo, { ...arriendo, fecha: "2026-12-02" }],
      resumen: { total: 2, ingresos: 0, gastos: 2 },
    });
    expect(screen.getByText(porTexto("2 gastos por confirmar"))).toBeVisible();
  });

  it("«Confirmar» crea el movimiento con el monto habitual y avisa con el monto que guardó el API", async () => {
    const pedidos = simularApi(() => json(201, movimientoConfirmado));
    const { alEmpezar, alTerminar } = abrir();
    fireEvent.click(screen.getByRole("button", { name: nombreSalario }));
    await waitFor(() => expect(alTerminar).toHaveBeenCalled());
    expect(alEmpezar).toHaveBeenCalledOnce();
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r1/confirmacion",
        cuerpo: { fecha: "2026-11-16" },
      },
    ]);
    expect(alTerminar).toHaveBeenCalledWith({
      tipo: "informacion",
      titulo: "Listo, confirmamos tu ingreso de $1.200.000.",
    });
  });

  it("mientras confirma, un segundo toque no manda otro pedido", async () => {
    let terminar: (r: Response) => void = () => {};
    const pedidos = simularApi(
      () => new Promise<Response>((resolver) => (terminar = resolver)),
    );
    const { alTerminar } = abrir();
    const boton = screen.getByRole("button", { name: nombreSalario });
    fireEvent.click(boton);
    fireEvent.click(boton);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirmar Arriendo o cuota de vivienda de $650.000 del 1 de diciembre de 2026",
      }),
    );
    expect(boton).toHaveAttribute("aria-disabled", "true");
    expect(pedidos).toHaveLength(1);
    terminar(json(201, movimientoConfirmado));
    await waitFor(() => expect(alTerminar).toHaveBeenCalledOnce());
  });

  it("ACC-004 (bug 231): tres fechas de la misma categoría y día que solo cambian en el monto tienen seis botones con nombres distintos", () => {
    // La sesión 3 del celular: tres fechas de «Otros gastos» del 5 de noviembre de 2026 que solo cambian en el monto.
    const otros = (id: string, centavos: string): Pendiente => ({
      recurrente_id: id,
      fecha: "2026-11-05",
      tipo: "gasto",
      categoria_id: 16,
      medio: "efectivo",
      monto_habitual_centavos: centavos,
      periodicidad: "mensual",
    });
    abrir({
      pendientes: [
        otros("r-a", "5500000"),
        otros("r-b", "3000000"),
        otros("r-c", "1250050"),
      ],
      resumen: { total: 3, ingresos: 0, gastos: 3 },
    });
    const nombres = [
      "Confirmar Otros gastos de $55.000 del 5 de noviembre de 2026",
      "Confirmar Otros gastos de $30.000 del 5 de noviembre de 2026",
      "Confirmar Otros gastos de $12.500,50 del 5 de noviembre de 2026",
      "Más opciones de Otros gastos de $55.000 del 5 de noviembre de 2026",
      "Más opciones de Otros gastos de $30.000 del 5 de noviembre de 2026",
      "Más opciones de Otros gastos de $12.500,50 del 5 de noviembre de 2026",
    ];
    expect(
      screen
        .getAllByRole("button", { name: /Otros gastos/ })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      nombres[0],
      nombres[3],
      nombres[1],
      nombres[4],
      nombres[2],
      nombres[5],
    ]);
    // getByRole falla si dos botones tienen el mismo nombre: cada uno es único.
    nombres.forEach((nombre, i) =>
      expect(screen.getByRole("button", { name: nombre })).toHaveTextContent(
        i < 3 ? "Confirmar" : "Más",
      ),
    );
  });

  it("«Más» abre la hoja con el nombre y la fecha, «Cambiar el monto» y «No pasó»; «Cerrar» devuelve el foco a «Más»", () => {
    abrir();
    fireEvent.click(masSalario());
    const hoja = screen.getByRole("dialog", {
      name: "Salario · 16 de noviembre de 2026",
    });
    expect(
      within(hoja)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["", "Cambiar el monto", "No pasó"]);
    expect(hoja.querySelector("h3")).toHaveFocus();
    fireEvent.click(within(hoja).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(masSalario()).toHaveFocus();
  });

  it("«Cambiar el monto»: «¿Cuánto llegó?», el monto habitual escrito y, al confirmar, el nuevo monto solo para esa fecha", async () => {
    const pedidos = simularApi(() =>
      json(201, { ...movimientoConfirmado, monto_centavos: "110000000" }),
    );
    const { alTerminar } = abrir();
    fireEvent.click(masSalario());
    fireEvent.click(screen.getByRole("button", { name: "Cambiar el monto" }));
    const hoja = screen.getByRole("dialog", { name: "¿Cuánto llegó?" });
    const campo = within(hoja).getByLabelText("Monto");
    expect(campo).toHaveValue("$1.200.000");
    expect(
      within(hoja).getByText(
        "Este cambio es solo para esta fecha. Las demás siguen igual.",
      ),
    ).toBeVisible();
    expect(
      within(hoja).getByRole("button", { name: "Ahora no" }),
    ).toBeVisible();
    fireEvent.change(campo, { target: { value: "1.100.000" } });
    fireEvent.blur(campo);
    expect(campo).toHaveValue("$1.100.000");
    fireEvent.click(within(hoja).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(alTerminar).toHaveBeenCalled());
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r1/confirmacion",
        cuerpo: { fecha: "2026-11-16", monto_centavos: 110000000 },
      },
    ]);
    expect(alTerminar).toHaveBeenCalledWith({
      tipo: "informacion",
      titulo: "Listo, confirmamos tu ingreso de $1.100.000.",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("«Ahora no» en «Cambiar el monto» cierra la hoja sin guardar y devuelve el foco a «Más»", () => {
    const pedidos = simularApi(() => json(201, movimientoConfirmado));
    abrir();
    fireEvent.click(masSalario());
    fireEvent.click(screen.getByRole("button", { name: "Cambiar el monto" }));
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(masSalario()).toHaveFocus();
    expect(pedidos).toEqual([]);
  });

  it("de un gasto pregunta «¿Cuánto pagaste?»; con el monto vacío dice «Falta el monto.» y no manda nada", () => {
    const pedidos = simularApi(() => json(201, movimientoConfirmado));
    abrir();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Más opciones de Arriendo o cuota de vivienda de $650.000 del 1 de diciembre de 2026",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cambiar el monto" }));
    const hoja = screen.getByRole("dialog", { name: "¿Cuánto pagaste?" });
    const campo = within(hoja).getByLabelText("Monto");
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.blur(campo);
    fireEvent.click(within(hoja).getByRole("button", { name: "Confirmar" }));
    expect(within(hoja).getByText("Falta el monto.")).toBeVisible();
    expect(campo).toHaveFocus();
    expect(campo).toHaveAccessibleDescription(/Falta el monto\./);
    expect(pedidos).toEqual([]);
  });

  it("«No pasó»: la hoja «¿Esta fecha no pasó?» explica y, al confirmar, guarda la fecha omitida", async () => {
    const pedidos = simularApi(() => json(204));
    const { alTerminar } = abrir();
    fireEvent.click(masSalario());
    fireEvent.click(screen.getByRole("button", { name: "No pasó" }));
    const hoja = screen.getByRole("dialog", { name: "¿Esta fecha no pasó?" });
    expect(
      within(hoja).getByText(
        "Dejamos de contarla en tu simulación. Las demás fechas siguen igual. Si después pasó, la registras a mano.",
      ),
    ).toBeVisible();
    expect(
      within(hoja).getByRole("button", { name: "Ahora no" }),
    ).toBeVisible();
    fireEvent.click(within(hoja).getByRole("button", { name: "No pasó" }));
    await waitFor(() => expect(alTerminar).toHaveBeenCalled());
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r1/omision",
        cuerpo: { fecha: "2026-11-16" },
      },
    ]);
    expect(alTerminar).toHaveBeenCalledWith({
      tipo: "informacion",
      titulo: "Listo, ya no contamos esa fecha.",
    });
  });

  it("«Ahora no» en la hoja de «No pasó» no guarda nada", () => {
    const pedidos = simularApi(() => json(204));
    abrir();
    fireEvent.click(masSalario());
    fireEvent.click(screen.getByRole("button", { name: "No pasó" }));
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });

  it("un error al confirmar dice «No pudimos confirmar el movimiento.», deja la fecha por confirmar y lleva el foco al aviso", async () => {
    simularApi(() => json(500, { error: "error_interno" }));
    const { alTerminar, refrescar } = abrir();
    fireEvent.click(screen.getByRole("button", { name: nombreSalario }));
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent(
      "No pudimos confirmar el movimiento.Sigue por confirmar. Intenta de nuevo.",
    );
    expect(aviso).toHaveFocus();
    expect(alTerminar).not.toHaveBeenCalled();
    expect(refrescar).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("409 conflicto_concurrente o fecha_no_pendiente: pide la lista de nuevo y muestra el error genérico", async () => {
    simularApi(() => json(409, { error: "conflicto_concurrente" }));
    const { refrescar } = abrir();
    fireEvent.click(screen.getByRole("button", { name: nombreSalario }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No pudimos confirmar el movimiento.",
    );
    expect(refrescar).toHaveBeenCalledOnce();
  });

  it("un error al marcar «No pasó» dice «No pudimos guardar el cambio.» y cierra la hoja", async () => {
    simularApi(() => json(409, { error: "fecha_no_pendiente" }));
    const { refrescar } = abrir();
    fireEvent.click(masSalario());
    fireEvent.click(screen.getByRole("button", { name: "No pasó" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "No pasó",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No pudimos guardar el cambio.Sigue por confirmar. Intenta de nuevo.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refrescar).toHaveBeenCalledOnce();
  });

  it("sin conexión muestra el aviso de sin conexión", async () => {
    simularApi(() => {
      throw new TypeError("Failed to fetch");
    });
    abrir();
    fireEvent.click(screen.getByRole("button", { name: nombreSalario }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
    );
  });

  it("sin sesión (401) lleva a /entrar", async () => {
    simularApi(() => json(401, { error: "sin_sesion" }));
    abrir();
    fireEvent.click(screen.getByRole("button", { name: nombreSalario }));
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sin sesión (401) al marcar «No pasó» también lleva a /entrar", async () => {
    simularApi(() => json(401, { error: "sin_sesion" }));
    abrir();
    fireEvent.click(masSalario());
    fireEvent.click(screen.getByRole("button", { name: "No pasó" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "No pasó",
      }),
    );
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
  });

  it("mientras marca «No pasó», un segundo toque no manda otro pedido", async () => {
    const pedidos = simularApi(() => new Promise<Response>(() => {}));
    abrir();
    fireEvent.click(masSalario());
    fireEvent.click(screen.getByRole("button", { name: "No pasó" }));
    const boton = within(screen.getByRole("dialog")).getByRole("button", {
      name: "No pasó",
    });
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(pedidos).toHaveLength(1);
  });
});
