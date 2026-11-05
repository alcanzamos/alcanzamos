import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Hoja } from "../../src/componentes/Hoja";

// Hoja inferior de E14-SDD 5.12, en la web un panel junto al botón que la abre.
function abrir(alCerrar = vi.fn()) {
  render(
    <>
      <button type="button">Antes</button>
      <Hoja titulo="¿Esta fecha no pasó?" alCerrar={alCerrar}>
        <button type="button">Primero</button>
        <button type="button">Último</button>
      </Hoja>
    </>,
  );
  return alCerrar;
}

describe("Hoja", () => {
  it("es un diálogo con su título, y el foco entra en el título al abrirla", () => {
    abrir();
    const hoja = screen.getByRole("dialog", { name: "¿Esta fecha no pasó?" });
    expect(hoja).toBeVisible();
    expect(screen.getByRole("heading", { level: 3 })).toHaveFocus();
  });

  it("se cierra con el ícono «Cerrar», con el velo y con Escape", () => {
    const alCerrar = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(alCerrar).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector(".hoja__velo")!);
    expect(alCerrar).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(alCerrar).toHaveBeenCalledTimes(3);
  });

  it("el foco queda dentro: Tab desde el último vuelve al primero y Mayús+Tab desde el título al último", () => {
    abrir();
    const hoja = screen.getByRole("dialog");
    const ultimo = screen.getByRole("button", { name: "Último" });
    ultimo.focus();
    fireEvent.keyDown(hoja, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    screen.getByRole("heading", { level: 3 }).focus();
    fireEvent.keyDown(hoja, { key: "Tab", shiftKey: true });
    expect(ultimo).toHaveFocus();
  });

  it("Tab en medio y las demás teclas siguen su curso", () => {
    abrir();
    const hoja = screen.getByRole("dialog");
    const primero = screen.getByRole("button", { name: "Primero" });
    primero.focus();
    expect(fireEvent.keyDown(hoja, { key: "Tab" })).toBe(true);
    expect(primero).toHaveFocus();
    expect(fireEvent.keyDown(hoja, { key: "a" })).toBe(true);
    // Mayús+Tab desde el primero de la lista (el ícono «Cerrar») salta al último.
    screen.getByRole("button", { name: "Cerrar" }).focus();
    fireEvent.keyDown(hoja, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
  });
});
