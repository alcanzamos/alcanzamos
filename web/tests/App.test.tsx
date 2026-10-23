import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

function irA(ruta: string) {
  window.history.replaceState(null, "", ruta);
  render(<App />);
}

describe("App · rutas", () => {
  it.each([
    "/entrar",
    "/crear-cuenta",
    "/revisa-tu-correo",
    "/verificar",
    "/sin-autorizacion",
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
