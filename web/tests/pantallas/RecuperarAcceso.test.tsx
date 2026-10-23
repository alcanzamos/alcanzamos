import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecuperarAcceso } from "../../src/pantallas/RecuperarAcceso";
import { json, simularApi } from "../ayudas";

const enviar = () =>
  fireEvent.click(screen.getByRole("button", { name: "Enviar el enlace" }));
const escribir = (valor: string) =>
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: valor },
  });

describe("PN-61 · Recuperar el acceso", () => {
  it("tiene la barra con Atrás a PN-60, la explicación y el botón", () => {
    render(<RecuperarAcceso />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Recuperar el acceso" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/entrar",
    );
    expect(
      screen.getByText(
        "Escribe el correo de tu cuenta. Te enviamos un enlace para elegir una contraseña nueva.",
      ),
    ).toBeInTheDocument();
  });

  it("con 202 dice lo mismo tenga cuenta o no y ofrece volver a iniciar sesión", async () => {
    const pedidos = simularApi(() => json(202, { estado: "enlace_enviado" }));
    render(<RecuperarAcceso />);
    escribir("laura@ejemplo.com");
    enviar();
    expect(
      await screen.findByText(
        "Si ese correo tiene una cuenta, te enviamos un enlace.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Revisa también el correo no deseado."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
    expect(
      screen.getByRole("link", { name: "Volver a iniciar sesión" }),
    ).toHaveAttribute("href", "/entrar");
    expect(pedidos[0]).toEqual({
      metodo: "POST",
      ruta: "/api/v1/recuperacion",
      cuerpo: { correo: "laura@ejemplo.com" },
    });
  });

  it.each([
    ["correo_vacio", "Falta el correo electrónico."],
    [
      "correo_invalido",
      "Falta completar el correo. Por ejemplo, nombre@correo.com.",
    ],
  ])(
    "el código %s da su texto y el foco va al campo",
    async (codigo, texto) => {
      simularApi(() =>
        json(422, { error: "validacion", campos: { correo: codigo } }),
      );
      render(<RecuperarAcceso />);
      enviar();
      expect(await screen.findByText(texto)).toBeInTheDocument();
      expect(screen.getByLabelText("Correo electrónico")).toHaveFocus();
    },
  );

  it("429 dice el texto de espera", async () => {
    simularApi(() => json(429, { error: "demasiados_intentos" }));
    render(<RecuperarAcceso />);
    escribir("laura@ejemplo.com");
    enviar();
    expect(
      await screen.findByText(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      ),
    ).toBeInTheDocument();
  });

  it("un error dice «No pudimos enviar el enlace.» y sin conexión lo dice", async () => {
    simularApi(() => json(500, { error: "interno" }));
    const { unmount } = render(<RecuperarAcceso />);
    enviar();
    expect(
      await screen.findByText("No pudimos enviar el enlace."),
    ).toBeInTheDocument();
    unmount();
    simularApi(() => {
      throw new TypeError("sin red");
    });
    render(<RecuperarAcceso />);
    enviar();
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
  });
});
