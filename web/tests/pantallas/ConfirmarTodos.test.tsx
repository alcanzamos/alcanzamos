import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Pendiente, Pendientes } from "../../src/api/repeticiones";
import { ConfirmarTodos } from "../../src/pantallas/ConfirmarTodos";
import { json, porTexto, simularApi } from "../ayudas";

const salario: Pendiente = {
  recurrente_id: "r1",
  fecha: "2026-12-01",
  tipo: "ingreso",
  categoria_id: 17,
  medio: "transferencia",
  monto_habitual_centavos: "120000000",
  periodicidad: "mensual",
};
const celular: Pendiente = {
  recurrente_id: "r2",
  fecha: "2026-11-12",
  tipo: "gasto",
  categoria_id: 9,
  medio: "transferencia",
  monto_habitual_centavos: "6000000",
  periodicidad: "mensual",
};
const energia: Pendiente = {
  recurrente_id: "r3",
  fecha: "2026-11-05",
  tipo: "gasto",
  categoria_id: 5,
  medio: "transferencia",
  monto_habitual_centavos: "12000000",
  periodicidad: "mensual",
};
const tres: Pendientes = {
  pendientes: [energia, celular, salario],
  resumen: { total: 3, ingresos: 1, gastos: 2 },
};

function abrir(datos: Pendientes = tres) {
  const alVolver = vi.fn();
  const alEmpezar = vi.fn();
  const alTerminar = vi.fn();
  const refrescar = vi.fn();
  render(
    <ConfirmarTodos
      datos={datos}
      atras="/movimientos?periodo=2026-11"
      alVolver={alVolver}
      alEmpezar={alEmpezar}
      alTerminar={alTerminar}
      refrescar={refrescar}
    />,
  );
  return { alVolver, alEmpezar, alTerminar, refrescar };
}
const casilla = (nombre: RegExp) =>
  screen.getByRole("checkbox", { name: nombre });
const mas = (nombre: string) =>
  screen.getByRole("button", {
    name: new RegExp(`^Más opciones de ${nombre}`),
  });
const guardar = (nombre: string | RegExp) =>
  screen.getByRole("button", { name: nombre });
const elegir = (fila: string, opcion: string) => {
  fireEvent.click(mas(fila));
  fireEvent.click(screen.getByRole("button", { name: opcion }));
};
const cambiarMonto = (fila: string, valor: string, boton = "Listo") => {
  elegir(fila, "Cambiar el monto");
  const hoja = within(screen.getByRole("dialog"));
  fireEvent.change(hoja.getByLabelText("Monto"), { target: { value: valor } });
  fireEvent.click(hoja.getByRole("button", { name: boton }));
};

describe("«Confirmar todos» (E14-PRR 4.8, D-093)", () => {
  it("todo viene marcado: título, explicación, «3 de 3 marcados», las filas de la más antigua a la más reciente y «Guardar 3 movimientos»", () => {
    abrir();
    expect(
      screen.getByRole("heading", { level: 2, name: "Confirmar todos" }),
    ).toHaveFocus();
    expect(
      screen.getByText(
        "Todo viene marcado. Desmarca lo que no quieras confirmar ahora, o toca «Más» si no pasó o cambió el monto.",
      ),
    ).toBeVisible();
    expect(screen.getByText(porTexto("3 de 3 marcados"))).toBeVisible();
    expect(
      screen.getByText(
        "Lo que desmarques sigue por confirmar. Una fecha que marques «No pasó» deja de contarse.",
      ),
    ).toBeVisible();
    const filas = screen.getAllByRole("checkbox");
    expect(filas.map((c) => (c as HTMLInputElement).checked)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      filas.map((c) => (c as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([
      "Servicios públicosGasto · 5 de noviembre de 2026$120.000",
      "ComunicacionesGasto · 12 de noviembre de 2026$60.000",
      "SalarioIngreso · 1 de diciembre de 2026$1.200.000",
    ]);
    expect(guardar("Guardar 3 movimientos")).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(
      screen.queryByRole("button", { name: /^Confirmar/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/movimientos?periodo=2026-11",
    );
  });

  it("desmarcar deja «Sigue por confirmar», baja la cuenta y el botón; volver a marcar la devuelve", () => {
    abrir();
    fireEvent.click(casilla(/Comunicaciones/));
    expect(casilla(/Comunicaciones/)).not.toBeChecked();
    expect(casilla(/Comunicaciones/)).toHaveAccessibleName(
      /Sigue por confirmar/,
    );
    expect(screen.getByText(porTexto("2 de 3 marcados"))).toBeVisible();
    expect(guardar("Guardar 2 movimientos")).toBeVisible();
    fireEvent.click(casilla(/Comunicaciones/));
    expect(screen.getByText(porTexto("3 de 3 marcados"))).toBeVisible();
  });

  it("con una sola marcada el botón dice «Guardar 1 movimiento»", () => {
    abrir();
    fireEvent.click(casilla(/Comunicaciones/));
    fireEvent.click(casilla(/Servicios/));
    expect(guardar("Guardar 1 movimiento")).toBeVisible();
  });

  it("«Más» → «Cambiar el monto» → «Listo»: la fila muestra el monto nuevo y «Monto cambiado», sigue marcada y no guarda todavía", () => {
    const pedidos = simularApi(() => json(200, {}));
    abrir();
    cambiarMonto("Salario", "1.100.000");
    expect(casilla(/Salario/)).toBeChecked();
    expect(casilla(/Salario/)).toHaveAccessibleName(
      "SalarioIngreso · 1 de diciembre de 2026Monto cambiado$1.100.000",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mas("Salario")).toHaveFocus();
    expect(pedidos).toEqual([]);
    expect(guardar("Guardar 3 movimientos")).toBeVisible();
  });

  it("ACC-004 (bug 231): tres filas iguales salvo el monto se distinguen en la casilla y en «Más»", () => {
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
    expect(
      screen
        .getAllByRole("checkbox")
        .map((c) => (c as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([
      "Otros gastosGasto · 5 de noviembre de 2026$55.000",
      "Otros gastosGasto · 5 de noviembre de 2026$30.000",
      "Otros gastosGasto · 5 de noviembre de 2026$12.500,50",
    ]);
    expect(
      screen
        .getAllByRole("button", { name: /^Más opciones de Otros gastos/ })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Más opciones de Otros gastos de $55.000 del 5 de noviembre de 2026",
      "Más opciones de Otros gastos de $30.000 del 5 de noviembre de 2026",
      "Más opciones de Otros gastos de $12.500,50 del 5 de noviembre de 2026",
    ]);
  });

  it("ACC-004 (bug 231): «Más» dice el monto cambiado de su fila", () => {
    abrir();
    cambiarMonto("Salario", "1.100.000");
    expect(mas("Salario")).toHaveAccessibleName(
      "Más opciones de Salario de $1.100.000 del 1 de diciembre de 2026",
    );
  });

  it("un monto igual al habitual no cuenta como cambiado; uno inválido muestra el error de E14-PPN 3.1", () => {
    abrir();
    cambiarMonto("Salario", "1.200.000");
    expect(casilla(/Salario/)).not.toHaveAccessibleName(/Monto cambiado/);
    elegir("Salario", "Cambiar el monto");
    const hoja = within(screen.getByRole("dialog"));
    fireEvent.change(hoja.getByLabelText("Monto"), { target: { value: "0" } });
    fireEvent.click(hoja.getByRole("button", { name: "Listo" }));
    expect(
      hoja.getByText(porTexto("El monto debe ser mayor que $0.")),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("«Más» → «No pasó»: la fila dice «No pasó», su casilla se deshabilita y no cuenta; «Más» solo ofrece «Volver a incluirla»", () => {
    abrir();
    elegir("Comunicaciones", "No pasó");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(casilla(/Comunicaciones/)).toBeDisabled();
    expect(casilla(/Comunicaciones/)).toHaveAccessibleName(
      "ComunicacionesGasto · 12 de noviembre de 2026No pasó$60.000",
    );
    expect(screen.getByText(porTexto("2 de 3 marcados"))).toBeVisible();
    expect(guardar("Guardar 2 movimientos")).toBeVisible();

    fireEvent.click(mas("Comunicaciones"));
    const hoja = within(screen.getByRole("dialog"));
    expect(hoja.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "",
      "Volver a incluirla",
    ]);
    fireEvent.click(hoja.getByRole("button", { name: "Volver a incluirla" }));
    expect(casilla(/Comunicaciones/)).toBeEnabled();
    expect(casilla(/Comunicaciones/)).toBeChecked();
    expect(screen.getByText(porTexto("3 de 3 marcados"))).toBeVisible();
  });

  it("«Volver a incluirla» deja el monto habitual aunque antes se hubiera cambiado", () => {
    abrir();
    cambiarMonto("Comunicaciones", "70.000");
    elegir("Comunicaciones", "No pasó");
    fireEvent.click(mas("Comunicaciones"));
    fireEvent.click(screen.getByRole("button", { name: "Volver a incluirla" }));
    expect(casilla(/Comunicaciones/)).toHaveAccessibleName(/\$60\.000$/);
    expect(casilla(/Comunicaciones/)).not.toHaveAccessibleName(
      /Monto cambiado/,
    );
  });

  it("solo «No pasó»: «0 de 3 marcados» y el botón dice «Guardar»; sin nada, «Guardar 0 movimientos» deshabilitado", () => {
    const pedidos = simularApi(() => json(200, {}));
    abrir();
    elegir("Servicios públicos", "No pasó");
    fireEvent.click(casilla(/Comunicaciones/));
    fireEvent.click(casilla(/Salario/));
    expect(screen.getByText(porTexto("0 de 3 marcados"))).toBeVisible();
    expect(guardar("Guardar")).not.toHaveAttribute("aria-disabled");
    fireEvent.click(mas("Servicios públicos"));
    fireEvent.click(screen.getByRole("button", { name: "Volver a incluirla" }));
    fireEvent.click(casilla(/Servicios/));
    expect(guardar("Guardar 0 movimientos")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(guardar("Guardar 0 movimientos"));
    expect(pedidos).toEqual([]);
  });

  it("FP-17: con una desmarcada, un monto cambiado y una «No pasó», manda exactamente eso y avisa con lo que cuenta el API", async () => {
    const pedidos = simularApi(() =>
      json(200, {
        movimientos: [],
        omitidas: [],
        siguen_pendientes: 1,
        resumen: { guardados: 1, omitidas: 1 },
      }),
    );
    const { alTerminar, alEmpezar } = abrir();
    fireEvent.click(casilla(/Servicios/));
    elegir("Comunicaciones", "No pasó");
    cambiarMonto("Salario", "1.100.000");
    expect(screen.getByText(porTexto("1 de 3 marcados"))).toBeVisible();
    fireEvent.click(guardar("Guardar 1 movimiento"));
    await waitFor(() => expect(alTerminar).toHaveBeenCalled());
    expect(alEmpezar).toHaveBeenCalledOnce();
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/decisiones",
        cuerpo: {
          decisiones: [
            { recurrente_id: "r2", fecha: "2026-11-12", omitida: true },
            {
              recurrente_id: "r1",
              fecha: "2026-12-01",
              monto_centavos: 110000000,
            },
          ],
        },
      },
    ]);
    expect(alTerminar).toHaveBeenCalledWith({
      tipo: "informacion",
      titulo: "Listo, guardamos 1 movimiento y dejamos de contar 1 fecha.",
    });
  });

  it.each([
    [1, 2, "Listo, guardamos 1 movimiento y dejamos de contar 2 fechas."],
    [2, 1, "Listo, guardamos 2 movimientos y dejamos de contar 1 fecha."],
  ])(
    "el aviso combinado con %i movimientos y %i «No pasó» pone cada número en su forma",
    async (guardados, omitidas, esperado) => {
      simularApi(() => json(200, { resumen: { guardados, omitidas } }));
      const { alTerminar } = abrir();
      fireEvent.click(guardar("Guardar 3 movimientos"));
      await waitFor(() => expect(alTerminar).toHaveBeenCalled());
      expect(alTerminar).toHaveBeenCalledWith({
        tipo: "informacion",
        titulo: esperado,
      });
    },
  );

  it("sin cambios manda todas sin monto ni «omitida»", async () => {
    const pedidos = simularApi(() =>
      json(200, { resumen: { guardados: 3, omitidas: 0 } }),
    );
    const { alTerminar } = abrir();
    fireEvent.click(guardar("Guardar 3 movimientos"));
    await waitFor(() => expect(alTerminar).toHaveBeenCalled());
    expect(pedidos[0]?.cuerpo).toEqual({
      decisiones: [
        { recurrente_id: "r3", fecha: "2026-11-05" },
        { recurrente_id: "r2", fecha: "2026-11-12" },
        { recurrente_id: "r1", fecha: "2026-12-01" },
      ],
    });
    expect(alTerminar).toHaveBeenCalledWith({
      tipo: "informacion",
      titulo: "Listo, guardamos 3 movimientos.",
    });
  });

  it("mientras guarda, un segundo toque no manda otro pedido y el botón queda deshabilitado", () => {
    const pedidos = simularApi(() => new Promise<Response>(() => {}));
    abrir();
    const boton = guardar("Guardar 3 movimientos");
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(boton).toHaveAttribute("aria-disabled", "true");
    expect(pedidos).toHaveLength(1);
  });

  it("un error al guardar dice «No pudimos guardar tus movimientos.» y la lista queda como estaba", async () => {
    simularApi(() => json(500, { error: "error_interno" }));
    const { alTerminar, refrescar } = abrir();
    fireEvent.click(casilla(/Comunicaciones/));
    cambiarMonto("Salario", "1.100.000");
    fireEvent.click(guardar("Guardar 2 movimientos"));
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent(
      "No pudimos guardar tus movimientos.No se guardó ninguno. Intenta de nuevo.",
    );
    expect(aviso).toHaveFocus();
    expect(alTerminar).not.toHaveBeenCalled();
    expect(refrescar).not.toHaveBeenCalled();
    expect(casilla(/Comunicaciones/)).not.toBeChecked();
    expect(casilla(/Salario/)).toHaveAccessibleName(/Monto cambiado/);
    expect(screen.getByText(porTexto("2 de 3 marcados"))).toBeVisible();
    // Se puede intentar de nuevo.
    expect(guardar("Guardar 2 movimientos")).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("409 conflicto_concurrente: pide la lista de nuevo y muestra el error genérico", async () => {
    simularApi(() => json(409, { error: "conflicto_concurrente" }));
    const { refrescar } = abrir();
    fireEvent.click(guardar("Guardar 3 movimientos"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No pudimos guardar tus movimientos.",
    );
    expect(refrescar).toHaveBeenCalledOnce();
  });

  it("sin conexión: «Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.» y lo marcado se conserva", async () => {
    simularApi(() => {
      throw new TypeError("Failed to fetch");
    });
    abrir();
    fireEvent.click(casilla(/Comunicaciones/));
    fireEvent.click(guardar("Guardar 2 movimientos"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
    );
    expect(casilla(/Comunicaciones/)).not.toBeChecked();
  });

  it("sin sesión (401) lleva a /entrar sin mostrar un error", async () => {
    simularApi(() => json(401, { error: "sin_sesion" }));
    abrir();
    fireEvent.click(guardar("Guardar 3 movimientos"));
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Atrás vuelve a la pantalla de origen sin guardar nada", () => {
    const pedidos = simularApi(() => json(200, {}));
    const { alVolver } = abrir();
    cambiarMonto("Salario", "1.100.000");
    fireEvent.click(screen.getByRole("link", { name: "Atrás" }));
    expect(alVolver).toHaveBeenCalledOnce();
    expect(window.location.pathname + window.location.search).toBe(
      "/movimientos?periodo=2026-11",
    );
    expect(pedidos).toEqual([]);
  });

  it("«Ahora no» en «Cambiar el monto» no cambia la fila y devuelve el foco a «Más»", () => {
    abrir();
    elegir("Salario", "Cambiar el monto");
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(casilla(/Salario/)).not.toHaveAccessibleName(/Monto cambiado/);
    expect(mas("Salario")).toHaveFocus();
  });

  it("«Cerrar» la hoja de «Más» devuelve el foco al botón que la abrió", () => {
    abrir();
    fireEvent.click(mas("Salario"));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(mas("Salario")).toHaveFocus();
  });
});
