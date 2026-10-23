import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { irConAviso } from "../../src/llegada";
import { SinAutorizacion } from "../../src/pantallas/SinAutorizacion";
import { json, simularApi } from "../ayudas";

describe("pantalla provisional · sin autorización (US-49 P1)", () => {
  it("tiene el texto de E14-PCP 4.7 y solo «Cerrar sesión»", () => {
    render(<SinAutorizacion />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sin esta autorización no podemos darte la cuenta.",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("«Cerrar sesión» es un botón de texto (E14-PCP 4.16 T2)", () => {
    render(<SinAutorizacion />);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toHaveClass(
      "boton--texto",
    );
  });

  // E14-PCP 4.16 T11 (D-153): el mensaje de estado va arriba, antes del título, y no toma el foco.
  it("tras confirmar el correo muestra arriba «Listo, confirmamos tu correo.» en un role=status", async () => {
    irConAviso("/sin-autorizacion", "correo_confirmado");
    render(<SinAutorizacion />);
    const estado = await screen.findByRole("status");
    expect(estado).toHaveTextContent("Listo, confirmamos tu correo.");
    const titulo = screen.getByRole("heading", { level: 1 });
    expect(
      estado.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(estado).not.toHaveFocus();
  });

  it("sin llegada por la confirmación no hay mensaje de estado", () => {
    render(<SinAutorizacion />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("cerrar sesión llama al API y lleva a entrar", async () => {
    const pedidos = simularApi(() => new Response(null, { status: 204 }));
    render(<SinAutorizacion />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(pedidos[0]).toMatchObject({
      metodo: "DELETE",
      ruta: "/api/v1/sesiones/actual",
    });
  });

  it("si la sesión ya no existía (401) también sale", async () => {
    simularApi(() => json(401, { error: "sin_sesion" }));
    render(<SinAutorizacion />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
  });

  it("sin conexión se queda y lo dice", async () => {
    simularApi(() => {
      throw new TypeError("sin red");
    });
    render(<SinAutorizacion />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
