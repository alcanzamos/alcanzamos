import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { avisoDeLlegada } from "../../src/llegada";
import { CambiarContrasena } from "../../src/pantallas/CambiarContrasena";
import { avisos } from "../../src/textos";
import { json, porTexto, simularApi } from "../ayudas";

function llenar(
  actual = "la de ahora que tengo",
  nueva = "lluvia café tren azul",
) {
  fireEvent.change(screen.getByLabelText("Tu contraseña de ahora"), {
    target: { value: actual },
  });
  fireEvent.change(screen.getByLabelText("Tu contraseña nueva"), {
    target: { value: nueva },
  });
}
const guardar = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar la contraseña" }),
  );

describe("PN-73 · Cambiar la contraseña", () => {
  it("tiene la barra con Atrás a PN-71, los campos y «Ahora no»", () => {
    render(<CambiarContrasena />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Cambiar mi contraseña" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/cuenta/seguridad",
    );
    expect(
      screen.getByText("Escribe tu contraseña de ahora y la nueva."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tu contraseña de ahora")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("Tu contraseña nueva")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByRole("link", { name: "Ahora no" })).toHaveAttribute(
      "href",
      "/cuenta/seguridad",
    );
    expect(screen.queryByLabelText(/Repite/)).not.toBeInTheDocument();
  });

  it("guardada: manda las dos y vuelve a PN-71 con el logro", async () => {
    const pedidos = simularApi(() =>
      json(200, { estado: "contrasena_cambiada" }),
    );
    render(<CambiarContrasena />);
    llenar();
    guardar();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/cuenta/seguridad"),
    );
    expect(avisoDeLlegada()).toBe(avisos.contrasenaCambiada);
    expect(pedidos[0]).toEqual({
      metodo: "POST",
      ruta: "/api/v1/cuenta/contrasena",
      cuerpo: {
        contrasena_actual: "la de ahora que tengo",
        contrasena_nueva: "lluvia café tren azul",
      },
    });
  });

  it("la de ahora incorrecta (400) se muestra en su campo", async () => {
    simularApi(() => json(400, { error: "contrasena_actual_incorrecta" }));
    render(<CambiarContrasena />);
    llenar();
    guardar();
    expect(
      await screen.findByText(
        "No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tu contraseña de ahora")).toHaveFocus();
    expect(screen.getByLabelText("Tu contraseña nueva")).toHaveValue(
      "lluvia café tren azul",
    );
  });

  it("422 muestra los errores de las dos y el foco va a la primera", async () => {
    simularApi(() =>
      json(422, {
        error: "validacion",
        campos: {
          contrasena_actual: "contrasena_vacia",
          contrasena_nueva: "contrasena_corta",
        },
      }),
    );
    render(<CambiarContrasena />);
    guardar();
    expect(
      await screen.findByText("Falta tu contraseña de ahora."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        porTexto("Falta que la contraseña tenga al menos 15 caracteres."),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tu contraseña de ahora")).toHaveFocus();
  });

  it.each([
    ["contrasena_vacia", "Falta la contraseña nueva."],
    [
      "contrasena_comun",
      "Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.",
    ],
    [
      "contrasena_personal",
      "Falta una contraseña que no incluya tu correo ni el nombre de la app.",
    ],
  ])(
    "la nueva con %s da su texto y el foco va a la nueva",
    async (codigo, texto) => {
      simularApi(() =>
        json(422, {
          error: "validacion",
          campos: { contrasena_nueva: codigo },
        }),
      );
      render(<CambiarContrasena />);
      guardar();
      expect(await screen.findByText(texto)).toBeInTheDocument();
      expect(screen.getByLabelText("Tu contraseña nueva")).toHaveFocus();
    },
  );

  it("429 dice el texto de espera", async () => {
    simularApi(() => json(429, { error: "demasiados_intentos" }));
    render(<CambiarContrasena />);
    llenar();
    guardar();
    expect(
      await screen.findByText(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      ),
    ).toBeInTheDocument();
  });

  it("un error dice «No pudimos guardar tu contraseña.» con que la de ahora sigue igual", async () => {
    simularApi(() => json(500, { error: "interno" }));
    render(<CambiarContrasena />);
    llenar();
    guardar();
    expect(
      await screen.findByText("No pudimos guardar tu contraseña."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tu contraseña de ahora sigue igual. Intenta de nuevo."),
    ).toBeInTheDocument();
  });

  it("sin conexión lo dice y conserva lo escrito", async () => {
    simularApi(() => {
      throw new TypeError("sin red");
    });
    render(<CambiarContrasena />);
    llenar();
    guardar();
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tu contraseña de ahora")).toHaveValue(
      "la de ahora que tengo",
    );
  });

  it.each([
    [401, { error: "sin_sesion" }, "/entrar"],
    [403, { error: "verificacion_pendiente" }, "/revisa-tu-correo"],
    [403, { error: "autorizacion_pendiente" }, "/sin-autorizacion"],
  ])("%i %j lleva a %s", async (estado, cuerpo, destino) => {
    simularApi(() => json(estado, cuerpo));
    render(<CambiarContrasena />);
    llenar();
    guardar();
    await waitFor(() => expect(window.location.pathname).toBe(destino));
  });
});
