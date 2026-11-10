import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  // Bug 260 (USA-003): PN-63 desde el menú, con Atrás y sin «Continuar»; /privacidad sigue siendo el primer uso.
  it("/cuenta/privacidad muestra PN-63 desde el menú y /privacidad, el primer uso", () => {
    irA("/cuenta/privacidad");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Cómo cuidamos tus datos",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).toBeNull();
    cleanup();
    irA("/privacidad");
    expect(screen.queryByRole("link", { name: "Atrás" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Continuar" }),
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

  it("/registrar muestra el formulario y /registrar/se-repite, PN-03", () => {
    simularApi(() => json(200, { gasto: [], ingreso: [] }));
    irA("/registrar");
    expect(
      screen.getByRole("heading", { level: 1, name: "Registrar" }),
    ).toBeInTheDocument();
    cleanup();
    irA("/registrar/se-repite");
    expect(
      screen.getByRole("heading", { level: 1, name: "Se repite" }),
    ).toBeInTheDocument();
  });

  it("/presupuesto muestra PN-06", () => {
    simularApi(() => json(500, { error: "error_interno" }));
    irA("/presupuesto");
    expect(
      screen.getByRole("heading", { level: 1, name: /^Presupuesto de / }),
    ).toBeInTheDocument();
  });

  it("/verificar muestra PN-74 y, sin token, «Ese enlace ya no sirve.»", () => {
    irA("/verificar");
    expect(
      screen.getByRole("heading", { level: 1, name: "Elige tu contraseña" }),
    ).toBeInTheDocument();
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
