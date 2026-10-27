import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { navegar } from "../src/enrutador";
import { json, simularApi } from "./ayudas";

// L10: el borrador del formulario solo se conserva en el viaje a PN-03 y de vuelta; en cualquier otra pantalla se vacía.
const catalogo = {
  gasto: [
    { id: 1, nombre: "x", general: false },
    { id: 16, nombre: "x", general: true },
  ],
  ingreso: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  simularApi((p) => {
    if (p.ruta.startsWith("/api/v1/repeticiones"))
      return json(200, { proximas: [] });
    if (p.ruta === "/api/v1/categorias") return json(200, catalogo);
    if (p.metodo === "DELETE") return json(204);
    return json(200, { ingreso_anterior: null });
  });
});

const monto = () => screen.findByLabelText<HTMLInputElement>("Monto");
const escribir = async (valor: string) =>
  fireEvent.change(await monto(), { target: { value: valor } });
const ir = (ruta: string) => navegar(ruta);
const abrirDesdePN71 = async () => {
  fireEvent.click(
    await screen.findByRole("link", { name: "Registrar un movimiento" }),
  );
  await monto();
};

describe("Borrador del registro · cuándo se conserva y cuándo se vacía (L10)", () => {
  it("abrir el formulario desde PN-71 empieza vacío aunque la persona haya escrito y vuelto", async () => {
    window.history.replaceState(null, "", "/cuenta/seguridad");
    render(<App />);
    await abrirDesdePN71();
    await escribir("45.000");
    fireEvent.click(await screen.findByRole("radio", { name: "Alimentación" }));
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("link", { name: "Atrás" }));
    await abrirDesdePN71();
    expect((await monto()).value).toBe("");
    expect(
      screen.getByRole("radio", { name: "Alimentación" }),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Efectivo" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Gasto" })).toBeChecked();
  });

  it("el viaje a PN-03 y de vuelta conserva el monto, la categoría y la repetición", async () => {
    window.history.replaceState(null, "", "/cuenta/seguridad");
    render(<App />);
    await abrirDesdePN71();
    await escribir("45.000");
    fireEvent.click(await screen.findByRole("radio", { name: "Alimentación" }));
    fireEvent.click(screen.getByRole("link", { name: "Cambiar" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Cada mes" }));
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect((await monto()).value).toBe("45.000");
    expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
    expect(screen.getByText("Se repite: Cada mes")).toBeInTheDocument();
  });

  it("el Atrás de PN-03 vuelve al formulario con lo escrito", async () => {
    window.history.replaceState(null, "", "/registrar");
    render(<App />);
    await escribir("45.000");
    fireEvent.click(screen.getByRole("link", { name: "Cambiar" }));
    fireEvent.click(await screen.findByRole("link", { name: "Atrás" }));
    expect((await monto()).value).toBe("45.000");
  });

  it("cerrar la sesión en PN-71 lo vacía: la siguiente persona abre el formulario sin nada", async () => {
    window.history.replaceState(null, "", "/cuenta/seguridad");
    render(<App />);
    await abrirDesdePN71();
    await escribir("45.000");
    ir("/cuenta/seguridad");
    fireEvent.click(
      await screen.findByRole("button", { name: "Cerrar sesión" }),
    );
    await screen.findByRole("heading", { level: 1, name: "Inicia sesión" });
    ir("/registrar");
    expect((await monto()).value).toBe("");
  });

  it("un 401 que lleva a PN-60 lo vacía", async () => {
    simularApi((p) =>
      p.ruta === "/api/v1/categorias"
        ? json(401, { error: "sin_sesion" })
        : json(200, {}),
    );
    window.history.replaceState(null, "", "/registrar");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    simularApi(() => json(200, catalogo));
    ir("/registrar");
    expect((await monto()).value).toBe("");
  });
});
