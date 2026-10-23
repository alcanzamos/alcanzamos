import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

function irA(ruta: string) {
  window.history.replaceState(null, "", ruta);
  render(<App />);
}

describe("App · rutas", () => {
  it.each([
    ["/crear-cuenta", "Crea tu cuenta"],
    ["/revisa-tu-correo", "Revisa tu correo"],
    ["/sin-autorizacion", "Sin esta autorización no podemos darte la cuenta."],
  ])("%s muestra su pantalla", (ruta, titulo) => {
    irA(ruta);
    expect(
      screen.getByRole("heading", { level: 1, name: titulo }),
    ).toBeInTheDocument();
  });

  it("/verificar muestra el estado de PN-59 sin token", () => {
    irA("/verificar");
    expect(screen.getByText("Ese enlace ya no sirve.")).toBeInTheDocument();
  });

  it.each([
    "/entrar",
    "/recuperar-acceso",
    "/recuperar?t=x",
    "/cuenta/contrasena",
    "/cuenta/seguridad",
  ])(
    "%s tiene su ruta y, por ahora, la pantalla pendiente con el logo",
    (ruta) => {
      irA(ruta);
      expect(
        screen.getByRole("heading", { level: 1, name: "Alcanzamos" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "Alcanzamos" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["/", "/no-existe"])(
    "%s lleva a /entrar sin dejar la ruta en el historial",
    async (ruta) => {
      irA(ruta);
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(
        screen.getByRole("heading", { name: "Alcanzamos" }),
      ).toBeInTheDocument();
    },
  );
});
