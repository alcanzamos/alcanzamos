import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { json, simularApi } from "./ayudas";

function irA(ruta: string) {
  window.history.replaceState(null, "", ruta);
  render(<App />);
}

describe("App · rutas", () => {
  it.each([
    ["/crear-cuenta", "Crea tu cuenta"],
    ["/revisa-tu-correo", "Revisa tu correo"],
    ["/privacidad", "Cómo cuidamos tus datos"],
    ["/entrar", "Inicia sesión"],
    ["/cuenta/contrasena", "Cambiar mi contraseña"],
  ])("%s muestra su pantalla", (ruta, titulo) => {
    irA(ruta);
    expect(
      screen.getByRole("heading", { level: 1, name: titulo }),
    ).toBeInTheDocument();
  });

  it("/autorizacion muestra PN-64", () => {
    simularApi(() => json(500, { error: "interno" }));
    irA("/autorizacion");
    expect(
      screen.getByRole("heading", { level: 1, name: "Tu autorización" }),
    ).toBeInTheDocument();
  });

  it("/cuenta/seguridad muestra PN-71, que pide el ingreso anterior", () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    irA("/cuenta/seguridad");
    expect(
      screen.getByRole("heading", { level: 1, name: "Seguridad de la cuenta" }),
    ).toBeInTheDocument();
  });

  it("/verificar muestra el estado de PN-59 sin token", () => {
    irA("/verificar");
    expect(screen.getByText("Ese enlace ya no sirve.")).toBeInTheDocument();
  });

  it.each([
    ["/recuperar-acceso", "Recuperar el acceso"],
    ["/recuperar?t=x", "Elige tu contraseña nueva"],
  ])("%s muestra su pantalla", (ruta, titulo) => {
    irA(ruta);
    expect(
      screen.getByRole("heading", { level: 1, name: titulo }),
    ).toBeInTheDocument();
  });

  it.each(["/", "/no-existe"])(
    "%s lleva a /entrar sin dejar la ruta en el historial",
    async (ruta) => {
      irA(ruta);
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(
        screen.getByRole("heading", { name: "Inicia sesión" }),
      ).toBeInTheDocument();
    },
  );
});
