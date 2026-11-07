import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { guardarCorreo, leerCorreo } from "../../src/correoPendiente";
import { RevisaTuCorreo } from "../../src/pantallas/RevisaTuCorreo";
import { json, porTexto, simularApi } from "../ayudas";

const boton = (nombre: string) => screen.getByRole("button", { name: nombre });
const reenviar = () => fireEvent.click(boton("Reenviar el correo"));

describe("PN-59 · Revisa tu correo (sin sesión, D-172)", () => {
  it("muestra el correo escrito, la línea de 7 días, «Reenviar el correo» y «Usar otro correo»", () => {
    guardarCorreo("laura@ejemplo.com");
    const pedidos = simularApi(() => json(200, {}));
    render(<RevisaTuCorreo />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Revisa tu correo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Te enviamos un correo a laura@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("¿No llegó? Mira también en el correo no deseado."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        porTexto("Si no lo confirmas en 7 días, borramos esta cuenta."),
      ),
    ).toBeInTheDocument();
    expect(boton("Reenviar el correo")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Usar otro correo" }),
    ).toHaveAttribute("href", "/crear-cuenta");
    // Sin sesión no hay nada que consultar al abrirla.
    expect(pedidos).toEqual([]);
  });

  it("ya no tiene «Ya lo confirmé» ni «Cambiar el correo»", () => {
    guardarCorreo("laura@ejemplo.com");
    render(<RevisaTuCorreo />);
    expect(screen.queryByText("Ya lo confirmé")).not.toBeInTheDocument();
    expect(screen.queryByText("Cambiar el correo")).not.toBeInTheDocument();
  });

  it("«Usar otro correo» vuelve a PN-58 con lo escrito guardado para corregirlo", () => {
    guardarCorreo("laura@ejemplo.com");
    render(<RevisaTuCorreo />);
    fireEvent.click(screen.getByRole("link", { name: "Usar otro correo" }));
    expect(window.location.pathname).toBe("/crear-cuenta");
    expect(leerCorreo()).toBe("laura@ejemplo.com");
  });

  describe("sin la dirección (se abrió de nuevo o se recargó)", () => {
    it("usa el texto sin dirección y no muestra el formulario hasta pedir el reenvío", () => {
      render(<RevisaTuCorreo />);
      expect(
        screen.getByText(
          "Te enviamos un correo. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Correo electrónico"),
      ).not.toBeInTheDocument();
    });

    // E14-PCP 4.2 y 4.16 T3
    it("«Reenviar el correo» abre en la misma pantalla el campo con la ayuda de PN-58 y el botón primario", () => {
      const pedidos = simularApi(() => json(202, {}));
      render(<RevisaTuCorreo />);
      reenviar();
      expect(window.location.pathname).toBe("/");
      const campo = screen.getByLabelText("Correo electrónico");
      expect(campo).toHaveFocus();
      expect(campo).toHaveAccessibleDescription(
        "Te enviaremos un enlace para confirmarlo y elegir tu contraseña.",
      );
      expect(boton("Reenviar el correo")).toHaveClass("boton--primario");
      expect(pedidos).toEqual([]);
    });

    it("manda el correo escrito al reenvío público, lo muestra y avisa", async () => {
      const pedidos = simularApi(() =>
        json(202, { estado: "verificacion_pendiente" }),
      );
      render(<RevisaTuCorreo />);
      reenviar();
      fireEvent.change(screen.getByLabelText("Correo electrónico"), {
        target: { value: "otro@ejemplo.com" },
      });
      reenviar();
      expect(
        await screen.findByText(
          "Te enviamos un correo a otro@ejemplo.com. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Te enviamos otro correo.")).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Correo electrónico"),
      ).not.toBeInTheDocument();
      expect(pedidos).toEqual([
        {
          metodo: "POST",
          ruta: "/api/v1/cuentas/verificacion/reenvio",
          cuerpo: { correo: "otro@ejemplo.com" },
        },
      ]);
      expect(leerCorreo()).toBe("otro@ejemplo.com");
    });

    it.each([
      ["correo_vacio", "Falta el correo electrónico."],
      [
        "correo_invalido",
        "Falta completar el correo. Por ejemplo, nombre@correo.com.",
      ],
    ])(
      "el código %s se muestra bajo el campo, con el foco en él",
      async (codigo, texto) => {
        simularApi(() =>
          json(422, { error: "validacion", campos: { correo: codigo } }),
        );
        render(<RevisaTuCorreo />);
        reenviar();
        reenviar();
        expect(await screen.findByText(texto)).toBeInTheDocument();
        expect(screen.getByLabelText("Correo electrónico")).toHaveFocus();
      },
    );

    it("429 muestra el texto de espera y conserva el formulario", async () => {
      simularApi(() => json(429, { error: "demasiados_intentos" }));
      render(<RevisaTuCorreo />);
      reenviar();
      fireEvent.change(screen.getByLabelText("Correo electrónico"), {
        target: { value: "otro@ejemplo.com" },
      });
      reenviar();
      expect(
        await screen.findByText(
          "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Correo electrónico")).toHaveValue(
        "otro@ejemplo.com",
      );
    });
  });

  describe("Reenviar el correo", () => {
    it("manda el correo guardado sin sesión, avisa, queda deshabilitado 30 segundos con su explicación y luego se libera", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      guardarCorreo("laura@ejemplo.com");
      const pedidos = simularApi(() =>
        json(202, { estado: "verificacion_pendiente" }),
      );
      render(<RevisaTuCorreo />);
      reenviar();
      expect(
        await screen.findByText("Te enviamos otro correo."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Puedes pedir otro en un momento."),
      ).toBeInTheDocument();
      expect(boton("Reenviar el correo")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(boton("Reenviar el correo")).toHaveAccessibleDescription(
        "Puedes pedir otro en un momento.",
      );
      reenviar();
      expect(pedidos).toEqual([
        {
          metodo: "POST",
          ruta: "/api/v1/cuentas/verificacion/reenvio",
          cuerpo: { correo: "laura@ejemplo.com" },
        },
      ]);
      act(() => void vi.advanceTimersByTime(29_000));
      expect(boton("Reenviar el correo")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      act(() => void vi.advanceTimersByTime(1_500));
      expect(boton("Reenviar el correo")).not.toHaveAttribute("aria-disabled");
      expect(
        screen.queryByText("Puedes pedir otro en un momento."),
      ).not.toBeInTheDocument();
    });

    // E14-PCP 4.2 y 4.16 T1: el 429 es la espera corta o el límite de la hora; el API da el mismo código.
    it("429 muestra «Hiciste muchos intentos…» como mensaje de estado y deja la espera de 30 segundos", async () => {
      guardarCorreo("laura@ejemplo.com");
      simularApi(() => json(429, { error: "demasiados_intentos" }));
      render(<RevisaTuCorreo />);
      reenviar();
      expect(
        await screen.findByText(
          "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveFocus();
      expect(boton("Reenviar el correo")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(
        screen.queryByText("Te enviamos otro correo."),
      ).not.toBeInTheDocument();
    });

    it("sin conexión lo dice y no deja el botón en espera", async () => {
      guardarCorreo("laura@ejemplo.com");
      simularApi(() => {
        throw new TypeError("sin red");
      });
      render(<RevisaTuCorreo />);
      reenviar();
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
      expect(boton("Reenviar el correo")).not.toHaveAttribute("aria-disabled");
    });

    it("un error del servidor muestra «No pudimos enviar el correo.» y la pantalla sigue sin sesión", async () => {
      guardarCorreo("laura@ejemplo.com");
      simularApi(() => json(500, { error: "interno" }));
      render(<RevisaTuCorreo />);
      reenviar();
      expect(
        await screen.findByText("No pudimos enviar el correo."),
      ).toBeInTheDocument();
      expect(screen.getByText("Intenta de nuevo.")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveFocus();
      expect(window.location.pathname).toBe("/");
    });

    it("un 401 no lleva a entrar: esta pantalla no tiene sesión", async () => {
      guardarCorreo("laura@ejemplo.com");
      simularApi(() => json(401, { error: "sin_sesion" }));
      render(<RevisaTuCorreo />);
      reenviar();
      expect(
        await screen.findByText("No pudimos enviar el correo."),
      ).toBeInTheDocument();
      await waitFor(() => expect(window.location.pathname).toBe("/"));
    });

    it("no manda dos pedidos si se toca dos veces mientras envía", async () => {
      guardarCorreo("laura@ejemplo.com");
      let soltar: (r: Response) => void = () => {};
      const pedidos = simularApi(
        () => new Promise<Response>((resolver) => (soltar = resolver)),
      );
      render(<RevisaTuCorreo />);
      reenviar();
      reenviar();
      expect(pedidos).toHaveLength(1);
      soltar(json(202, {}));
      expect(
        await screen.findByText("Te enviamos otro correo."),
      ).toBeInTheDocument();
    });
  });
});
