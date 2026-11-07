import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { avisoDeLlegada } from "../../src/llegada";
import { Verificar } from "../../src/pantallas/Verificar";
import { avisos } from "../../src/textos";
import { json, porTexto, simularApi } from "../ayudas";

function abrir(busqueda: string) {
  window.history.replaceState(null, "", `/verificar${busqueda}`);
  return render(
    <StrictMode>
      <Verificar />
    </StrictMode>,
  );
}

function llenar(contrasena = "lluvia café tren azul", nombre = "Laura") {
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: contrasena },
  });
  fireEvent.change(screen.getByLabelText("Nombre para mostrar"), {
    target: { value: nombre },
  });
}

const guardar = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Guardar la contraseña" }),
  );

const ACTIVA = () => json(200, { estado: "activa" });
const ENLACE_YA_NO_SIRVE = () => json(400, { error: "enlace_invalido" });

describe("PN-74 · Elige tu contraseña (/verificar?t=)", () => {
  it("muestra los textos de E14, sin llamar al API ni mostrar nada de la cuenta", () => {
    const pedidos = simularApi(() => ACTIVA());
    abrir("?t=abc123");
    expect(
      screen.getByRole("heading", { level: 1, name: "Elige tu contraseña" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Un último paso para crear tu cuenta. Elige tu contraseña y dinos cómo quieres que te llamemos.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Usa una frase de tres o cuatro palabras."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Es el nombre que verás en la app. Puede ser un apodo."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("Nombre para mostrar")).toHaveAttribute(
      "autocomplete",
      "name",
    );
    // Un solo campo de contraseña, sin repetición, y con Mostrar la contraseña.
    expect(screen.queryByLabelText(/Repite/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mostrar la contraseña" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar la contraseña" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo electrónico")).toBeNull();
    expect(pedidos).toEqual([]);
  });

  it("al guardar manda el token del enlace con la contraseña y el nombre, una sola vez", async () => {
    let soltar: (r: Response) => void = () => {};
    const pedidos = simularApi(
      () => new Promise<Response>((resolver) => (soltar = resolver)),
    );
    abrir("?t=abc123");
    llenar();
    guardar();
    guardar();
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/cuentas/verificacion",
        cuerpo: {
          token: "abc123",
          contrasena: "lluvia café tren azul",
          nombre: "Laura",
        },
      },
    ]);
    soltar(ACTIVA());
    await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    expect(pedidos).toHaveLength(1);
  });

  // E14-PCP 4.2 ter «Guardada» y 4.16 T11 (D-153): sin espera; el mensaje de estado lo muestra PN-63.
  it("con la sesión ya empezada va enseguida a PN-63, con «Listo, confirmamos tu correo.» como estado", async () => {
    simularApi(() => ACTIVA());
    abrir("?t=abc");
    llenar();
    guardar();
    await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    expect(avisoDeLlegada()).toBe(avisos.correoConfirmado);
    expect(avisos.correoConfirmado.titulo).toBe(
      "Listo, confirmamos tu correo.",
    );
  });

  it("no usa ningún temporizador para avanzar (WCAG 2.2.1, D-153)", async () => {
    vi.useFakeTimers();
    const temporizador = vi.spyOn(window, "setTimeout");
    const intervalo = vi.spyOn(window, "setInterval");
    simularApi(() => ACTIVA());
    abrir("?t=abc");
    llenar();
    guardar();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(window.location.pathname).toBe("/privacidad");
    expect(temporizador).not.toHaveBeenCalled();
    expect(intervalo).not.toHaveBeenCalled();
  });

  describe("errores de campo (D-142), sin gastar el enlace", () => {
    it.each([
      ["contrasena", "contrasena_vacia", "Falta la contraseña."],
      [
        "contrasena",
        "contrasena_corta",
        "Falta que la contraseña tenga al menos 15 caracteres.",
      ],
      [
        "contrasena",
        "contrasena_comun",
        "Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.",
      ],
      [
        "contrasena",
        "contrasena_personal",
        "Falta una contraseña que no incluya tu correo ni la palabra «Alcanzamos».",
      ],
      ["nombre", "nombre_vacio", "Falta el nombre para mostrar."],
      ["nombre", "nombre_largo", "Escribe un nombre de hasta 60 caracteres."],
    ])(
      "%s · %s se muestra con el texto de E14, con el foco en el campo",
      async (campo, codigo, texto) => {
        simularApi(() =>
          json(422, { error: "validacion", campos: { [campo]: codigo } }),
        );
        abrir("?t=abc");
        llenar();
        guardar();
        expect(await screen.findByText(porTexto(texto))).toBeInTheDocument();
        expect(
          screen.getByLabelText(
            campo === "nombre" ? "Nombre para mostrar" : "Contraseña",
          ),
        ).toHaveFocus();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(window.location.pathname).toBe("/verificar");
      },
    );

    it("muestra los dos errores a la vez, conserva lo escrito y deja volver a intentar con el mismo enlace", async () => {
      let intento = 0;
      const pedidos = simularApi(() =>
        ++intento === 1
          ? json(422, {
              error: "validacion",
              campos: {
                contrasena: "contrasena_corta",
                nombre: "nombre_vacio",
              },
            })
          : ACTIVA(),
      );
      abrir("?t=abc");
      llenar("corta", "");
      guardar();
      expect(
        await screen.findByText("Falta el nombre para mostrar."),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          porTexto("Falta que la contraseña tenga al menos 15 caracteres."),
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Contraseña")).toHaveFocus();
      expect(screen.getByLabelText("Contraseña")).toHaveValue("corta");
      llenar("lluvia café tren azul", "Laura");
      guardar();
      await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
      expect(pedidos.map((p) => (p.cuerpo as { token: string }).token)).toEqual(
        ["abc", "abc"],
      );
    });

    it("un código de campo que no conoce cae al aviso de error", async () => {
      simularApi(() =>
        json(422, { error: "validacion", campos: { nombre: "otro_codigo" } }),
      );
      abrir("?t=abc");
      llenar();
      guardar();
      expect(
        await screen.findByText("No pudimos guardar tu contraseña."),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveFocus();
    });
  });

  // D-192 (c) y S7: un enlace vencido, ya usado o reemplazado dice cómo pedir otro, no un error genérico.
  describe("enlace vencido o ya usado (D-192)", () => {
    it.each([
      ["vencido (pasaron 24 horas)"],
      ["ya usado (sirve una sola vez)"],
      ["reemplazado por uno más nuevo"],
    ])(
      "el enlace %s dice «Ese enlace ya no sirve.» y ofrece «Pedir otro enlace»",
      async () => {
        simularApi(() => ENLACE_YA_NO_SIRVE());
        abrir("?t=viejo");
        llenar();
        guardar();
        expect(
          await screen.findByText("Ese enlace ya no sirve."),
        ).toBeInTheDocument();
        expect(screen.getByText("Pide uno nuevo.")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveFocus();
        expect(
          screen.getByRole("link", { name: "Pedir otro enlace" }),
        ).toHaveAttribute("href", "/crear-cuenta");
        expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
        expect(
          screen.queryByLabelText("Nombre para mostrar"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText("No pudimos guardar tu contraseña."),
        ).not.toBeInTheDocument();
      },
    );

    it("«Pedir otro enlace» lleva a PN-58", async () => {
      simularApi(() => ENLACE_YA_NO_SIRVE());
      abrir("?t=viejo");
      llenar();
      guardar();
      fireEvent.click(
        await screen.findByRole("link", { name: "Pedir otro enlace" }),
      );
      expect(window.location.pathname).toBe("/crear-cuenta");
    });

    it("sin token no llama al API y dice lo mismo", () => {
      const pedidos = simularApi(() => ACTIVA());
      abrir("");
      expect(screen.getByText("Ese enlace ya no sirve.")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Pedir otro enlace" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
      expect(pedidos).toEqual([]);
    });
  });

  it("un error del servidor dice «No pudimos guardar tu contraseña.», no que el enlace venció, y conserva lo escrito", async () => {
    simularApi(() => json(500, { error: "interno" }));
    abrir("?t=abc");
    llenar();
    guardar();
    expect(
      await screen.findByText("No pudimos guardar tu contraseña."),
    ).toBeInTheDocument();
    expect(screen.getByText("Intenta de nuevo.")).toBeInTheDocument();
    expect(
      screen.queryByText("Ese enlace ya no sirve."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveValue(
      "lluvia café tren azul",
    );
    expect(window.location.pathname).toBe("/verificar");
  });

  it("sin conexión lo dice, sin decir que el enlace no sirve, y conserva lo escrito", async () => {
    simularApi(() => {
      throw new TypeError("sin red");
    });
    abrir("?t=abc");
    llenar();
    guardar();
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Ese enlace ya no sirve."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nombre para mostrar")).toHaveValue("Laura");
  });

  it("429 muestra el texto de espera", async () => {
    simularApi(() => json(429, { error: "demasiados_intentos" }));
    abrir("?t=abc");
    llenar();
    guardar();
    expect(
      await screen.findByText(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      ),
    ).toBeInTheDocument();
  });
});
