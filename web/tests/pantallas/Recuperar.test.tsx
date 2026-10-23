import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { avisoDeLlegada } from "../../src/llegada";
import { Recuperar } from "../../src/pantallas/Recuperar";
import { avisos } from "../../src/textos";
import { json, porTexto, simularApi } from "../ayudas";

function abrir(busqueda = "?t=tok123") {
  window.history.replaceState(null, "", `/recuperar${busqueda}`);
  return render(<Recuperar />);
}
function llenar(nueva: string, repeticion: string) {
  fireEvent.change(screen.getByLabelText("Contraseña nueva"), {
    target: { value: nueva },
  });
  fireEvent.change(screen.getByLabelText("Repite la contraseña nueva"), {
    target: { value: repeticion },
  });
}
const guardar = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar la contraseña" }),
  );

describe("PN-62 · Elegir la contraseña nueva", () => {
  it("tiene los dos campos con new-password y la ayuda", () => {
    abrir();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Elige tu contraseña nueva",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña nueva")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("Repite la contraseña nueva")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(
      screen.getByText("Usa una frase de tres o cuatro palabras."),
    ).toBeInTheDocument();
  });

  it("guardada: manda token y contraseña, y va a PN-60 con el logro", async () => {
    const pedidos = simularApi(() =>
      json(200, { estado: "contrasena_cambiada" }),
    );
    abrir();
    llenar("lluvia café tren azul", "lluvia café tren azul");
    guardar();
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(avisoDeLlegada()).toBe(avisos.contrasenaRecuperada);
    expect(pedidos[0]).toEqual({
      metodo: "POST",
      ruta: "/api/v1/recuperacion/contrasena",
      cuerpo: { token: "tok123", contrasena: "lluvia café tren azul" },
    });
  });

  it("si las dos no coinciden lo dice sin llamar al API", () => {
    const pedidos = simularApi(() => json(200, {}));
    abrir();
    llenar("lluvia café tren azul", "otra cosa distinta");
    guardar();
    expect(
      screen.getByText("Falta que las dos contraseñas sean iguales."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Repite la contraseña nueva")).toHaveFocus();
    expect(pedidos).toEqual([]);
  });

  it("con la repetición vacía lo dice sin llamar al API", () => {
    const pedidos = simularApi(() => json(200, {}));
    abrir();
    llenar("lluvia café tren azul", "");
    guardar();
    expect(
      screen.getByText("Falta repetir la contraseña."),
    ).toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });

  it("con todo vacío muestra los dos errores y el foco va a la contraseña", () => {
    const pedidos = simularApi(() => json(200, {}));
    abrir();
    guardar();
    expect(screen.getByText("Falta la contraseña nueva.")).toBeInTheDocument();
    expect(
      screen.getByText("Falta repetir la contraseña."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña nueva")).toHaveFocus();
    expect(pedidos).toEqual([]);
  });

  it.each([
    ["contrasena_vacia", "Falta la contraseña nueva."],
    [
      "contrasena_corta",
      "Falta que la contraseña tenga al menos 15 caracteres.",
    ],
    [
      "contrasena_comun",
      "Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.",
    ],
    [
      "contrasena_personal",
      "Falta una contraseña que no incluya tu correo ni el nombre de la app.",
    ],
  ])(
    "el código %s se muestra con su texto y conserva lo escrito",
    async (codigo, texto) => {
      simularApi(() =>
        json(422, { error: "validacion", campos: { contrasena: codigo } }),
      );
      abrir();
      llenar("corta", "corta");
      guardar();
      expect(await screen.findByText(porTexto(texto))).toBeInTheDocument();
      expect(screen.getByLabelText("Contraseña nueva")).toHaveFocus();
      expect(screen.getByLabelText("Contraseña nueva")).toHaveValue("corta");
    },
  );

  it("enlace inválido: «Ese enlace ya no sirve.», sin campos y con «Pedir otro enlace»", async () => {
    simularApi(() => json(400, { error: "enlace_invalido" }));
    abrir();
    llenar("lluvia café tren azul", "lluvia café tren azul");
    guardar();
    expect(
      await screen.findByText("Ese enlace ya no sirve."),
    ).toBeInTheDocument();
    expect(screen.getByText("Pide uno nuevo.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña nueva")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Pedir otro enlace" }),
    ).toHaveAttribute("href", "/recuperar-acceso");
  });

  it("sin token es lo mismo, sin llamar al API", () => {
    const pedidos = simularApi(() => json(200, {}));
    abrir("");
    expect(screen.getByText("Ese enlace ya no sirve.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar la contraseña" }),
    ).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });

  it("un error dice «No pudimos guardar tu contraseña.» y sin conexión lo dice", async () => {
    simularApi(() => json(500, { error: "interno" }));
    const { unmount } = abrir();
    llenar("lluvia café tren azul", "lluvia café tren azul");
    guardar();
    expect(
      await screen.findByText("No pudimos guardar tu contraseña."),
    ).toBeInTheDocument();
    unmount();
    simularApi(() => {
      throw new TypeError("sin red");
    });
    abrir();
    llenar("lluvia café tren azul", "lluvia café tren azul");
    guardar();
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
  });
});
