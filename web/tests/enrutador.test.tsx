import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { llegoNavegando, navegar, useUbicacion } from "../src/enrutador";

function Ubicacion() {
  const { ruta, parametros } = useUbicacion();
  return (
    <p>
      {ruta}|{parametros.get("t") ?? "sin t"}
    </p>
  );
}

describe("enrutador", () => {
  it("lee la ruta y los parámetros de la dirección", () => {
    window.history.replaceState(null, "", "/verificar?t=abc");
    render(<Ubicacion />);
    expect(screen.getByText("/verificar|abc")).toBeInTheDocument();
  });

  it("navegar cambia la dirección y avisa a quien la mira", () => {
    render(<Ubicacion />);
    act(() => navegar("/crear-cuenta"));
    expect(screen.getByText("/crear-cuenta|sin t")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/crear-cuenta");
    expect(llegoNavegando()).toBe(true);
  });

  it("reemplazar no deja la pantalla anterior en el historial", () => {
    render(<Ubicacion />);
    const antes = window.history.length;
    act(() => navegar("/entrar", true));
    expect(window.history.length).toBe(antes);
    expect(screen.getByText("/entrar|sin t")).toBeInTheDocument();
  });

  it("sigue el botón Atrás del navegador", () => {
    render(<Ubicacion />);
    act(() => {
      window.history.replaceState(null, "", "/revisa-tu-correo");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByText("/revisa-tu-correo|sin t")).toBeInTheDocument();
  });
});
