import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PantallaPrueba } from "./PantallaPrueba";

describe("PantallaPrueba", () => {
  it("tiene un título principal y un texto de apoyo", () => {
    render(<PantallaPrueba />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Alcanzamos" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pantalla de prueba/i)).toBeInTheDocument();
  });

  it("muestra las cifras inventadas con el formato colombiano", () => {
    render(<PantallaPrueba />);
    const seccion = screen.getByRole("region", { name: "Cifras de ejemplo" });
    for (const monto of ["$80.000", "$1.200.000", "$123.456,78"]) {
      expect(within(seccion).getByText(monto)).toBeInTheDocument();
    }
  });

  it("ofrece un enlace que se alcanza con el teclado", () => {
    render(<PantallaPrueba />);
    const enlace = screen.getByRole("link", { name: "Ir a las cifras" });
    enlace.focus();
    expect(enlace).toHaveFocus();
  });
});
