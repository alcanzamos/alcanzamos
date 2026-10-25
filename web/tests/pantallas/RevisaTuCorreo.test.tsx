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

describe("PN-59 · Verificar el correo", () => {
  it("muestra el correo escrito, la línea de 7 días y los tres botones", () => {
    guardarCorreo("laura@ejemplo.com");
    render(<RevisaTuCorreo />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Revisa tu correo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Te enviamos un enlace a laura@ejemplo.com. Ábrelo para confirmar tu cuenta.",
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
    for (const nombre of [
      "Ya lo confirmé",
      "Reenviar el correo",
      "Cambiar el correo",
    ])
      expect(boton(nombre)).toBeInTheDocument();
  });

  it("sin correo conocido no muestra una dirección", () => {
    render(<RevisaTuCorreo />);
    expect(
      screen.getByText(
        "Te enviamos un enlace a tu correo. Ábrelo para confirmar tu cuenta.",
      ),
    ).toBeInTheDocument();
  });

  describe("Ya lo confirmé", () => {
    it("si ya está verificada sigue a PN-63", async () => {
      const pedidos = simularApi(() => json(200, { verificada: true }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Ya lo confirmé"));
      await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
      expect(pedidos[0]).toMatchObject({
        metodo: "GET",
        ruta: "/api/v1/cuentas/estado",
      });
    });

    it("si todavía no, muestra el aviso y le lleva el foco", async () => {
      simularApi(() => json(200, { verificada: false }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Ya lo confirmé"));
      expect(
        await screen.findByText("Todavía no confirmaste tu correo."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Abre el enlace que te enviamos."),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveFocus();
      expect(window.location.pathname).toBe("/");
    });

    it("sin sesión (401) lleva a entrar", async () => {
      simularApi(() => json(401, { error: "sin_sesion" }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Ya lo confirmé"));
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    });

    it("sin conexión lo dice", async () => {
      simularApi(() => {
        throw new TypeError("sin red");
      });
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Ya lo confirmé"));
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
    });

    // E14-PCP 4.16 T8
    it("un error del servidor dice que no pudo revisar, no que no pudo enviar", async () => {
      simularApi(() => json(500, { error: "interno" }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Ya lo confirmé"));
      expect(
        await screen.findByText("No pudimos revisar si confirmaste tu correo."),
      ).toBeInTheDocument();
      expect(screen.getByText("Intenta de nuevo.")).toBeInTheDocument();
      expect(
        screen.queryByText("No pudimos enviar el correo."),
      ).not.toBeInTheDocument();
    });
  });

  describe("Reenviar el correo", () => {
    it("avisa, queda deshabilitado 30 segundos con su explicación y luego se libera", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const pedidos = simularApi(() =>
        json(202, { estado: "verificacion_pendiente" }),
      );
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Reenviar el correo"));
      expect(
        await screen.findByText("Te enviamos otro correo."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Puedes pedir otro en un momento."),
      ).toBeInTheDocument();
      const reenviar = boton("Reenviar el correo");
      expect(reenviar).toHaveAttribute("aria-disabled", "true");
      expect(reenviar).toHaveAccessibleDescription(
        "Puedes pedir otro en un momento.",
      );
      fireEvent.click(reenviar);
      expect(pedidos).toHaveLength(1);
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

    it("429 deja la espera con «Puedes pedir otro en un momento.»", async () => {
      simularApi(() => json(429, { error: "demasiados_intentos" }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Reenviar el correo"));
      expect(
        await screen.findByText("Puedes pedir otro en un momento."),
      ).toBeInTheDocument();
      expect(boton("Reenviar el correo")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    it("409 ya_verificada sigue a PN-63", async () => {
      simularApi(() => json(409, { error: "ya_verificada" }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Reenviar el correo"));
      await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    });

    it("401 lleva a entrar", async () => {
      simularApi(() => json(401, { error: "sin_sesion" }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Reenviar el correo"));
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    });

    it("un error muestra «No pudimos enviar el correo.»", async () => {
      simularApi(() => json(500, { error: "interno" }));
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Reenviar el correo"));
      expect(
        await screen.findByText("No pudimos enviar el correo."),
      ).toBeInTheDocument();
      expect(screen.getByText("Intenta de nuevo.")).toBeInTheDocument();
    });
  });

  describe("Cambiar el correo", () => {
    function abrir() {
      fireEvent.click(boton("Cambiar el correo"));
      fireEvent.change(screen.getByLabelText("Correo electrónico"), {
        target: { value: "otro@ejemplo.com" },
      });
    }

    // E14-PCP 4.16 T3
    it("se abre en la misma pantalla, con la etiqueta, la ayuda y el botón primario de PN-58", () => {
      render(<RevisaTuCorreo />);
      expect(
        screen.queryByLabelText("Correo electrónico"),
      ).not.toBeInTheDocument();
      fireEvent.click(boton("Cambiar el correo"));
      expect(window.location.pathname).toBe("/");
      expect(
        screen.getByRole("heading", { level: 1, name: "Revisa tu correo" }),
      ).toBeInTheDocument();
      const campo = screen.getByLabelText("Correo electrónico");
      expect(campo).toHaveFocus();
      expect(campo).toHaveAccessibleDescription(
        "Te enviaremos un enlace para confirmarlo.",
      );
      expect(boton("Cambiar el correo")).toHaveClass("boton--primario");
      expect(boton("Ya lo confirmé")).toBeInTheDocument();
    });

    it("sin escribir nada muestra el error de PN-58 del correo vacío", async () => {
      simularApi(() =>
        json(422, { error: "validacion", campos: { correo: "correo_vacio" } }),
      );
      render(<RevisaTuCorreo />);
      fireEvent.click(boton("Cambiar el correo"));
      fireEvent.click(boton("Cambiar el correo"));
      expect(
        await screen.findByText("Falta el correo electrónico."),
      ).toBeInTheDocument();
    });

    it("manda el correo nuevo, lo muestra y avisa del correo enviado", async () => {
      guardarCorreo("laura@ejemplo.com");
      const pedidos = simularApi(() =>
        json(202, { estado: "verificacion_pendiente" }),
      );
      render(<RevisaTuCorreo />);
      abrir();
      fireEvent.click(boton("Cambiar el correo"));
      expect(
        await screen.findByText(
          "Te enviamos un enlace a otro@ejemplo.com. Ábrelo para confirmar tu cuenta.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Te enviamos otro correo.")).toBeInTheDocument();
      expect(pedidos[0]).toEqual({
        metodo: "POST",
        ruta: "/api/v1/cuentas/correo",
        cuerpo: { correo: "otro@ejemplo.com" },
      });
      expect(leerCorreo()).toBe("otro@ejemplo.com");
    });

    it("muestra el error de campo del API y lleva el foco al campo", async () => {
      simularApi(() =>
        json(422, {
          error: "validacion",
          campos: { correo: "correo_invalido" },
        }),
      );
      render(<RevisaTuCorreo />);
      abrir();
      fireEvent.click(boton("Cambiar el correo"));
      expect(
        await screen.findByText(
          "Falta completar el correo. Por ejemplo, nombre@correo.com.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Correo electrónico")).toHaveFocus();
    });

    it("429 muestra el texto de espera", async () => {
      simularApi(() => json(429, { error: "demasiados_intentos" }));
      render(<RevisaTuCorreo />);
      abrir();
      fireEvent.click(boton("Cambiar el correo"));
      expect(
        await screen.findByText(
          "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
        ),
      ).toBeInTheDocument();
    });

    it("409 ya_verificada sigue a PN-63 y 401 a entrar", async () => {
      simularApi(() => json(409, { error: "ya_verificada" }));
      const { unmount } = render(<RevisaTuCorreo />);
      abrir();
      fireEvent.click(boton("Cambiar el correo"));
      await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
      unmount();
      simularApi(() => json(401, { error: "sin_sesion" }));
      render(<RevisaTuCorreo />);
      abrir();
      fireEvent.click(boton("Cambiar el correo"));
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    });
  });
});
