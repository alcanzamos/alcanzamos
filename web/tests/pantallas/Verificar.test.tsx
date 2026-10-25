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
import { json, simularApi } from "../ayudas";

function abrir(busqueda: string) {
  window.history.replaceState(null, "", `/verificar${busqueda}`);
  return render(
    <StrictMode>
      <Verificar />
    </StrictMode>,
  );
}

describe("/verificar?t= · enlace del correo", () => {
  it("manda el token una sola vez, aun con StrictMode", async () => {
    const pedidos = simularApi(() =>
      json(200, { estado: "verificado", con_sesion: true }),
    );
    abrir("?t=abc123");
    await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/cuentas/verificacion",
        cuerpo: { token: "abc123" },
      },
    ]);
  });

  // E14-PCP 4.16 T11 (D-153): sin espera. Se va enseguida y el mensaje de estado lo muestra el destino.
  it("con sesión va enseguida a PN-63, con «Listo, confirmamos tu correo.» como estado", async () => {
    simularApi(() => json(200, { estado: "verificado", con_sesion: true }));
    abrir("?t=abc");
    await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    expect(avisoDeLlegada()).toBe(avisos.correoConfirmado);
    expect(avisos.correoConfirmado.titulo).toBe(
      "Listo, confirmamos tu correo.",
    );
  });

  it("sin sesión (otro dispositivo) va enseguida a entrar con el mismo estado", async () => {
    simularApi(() => json(200, { estado: "verificado", con_sesion: false }));
    abrir("?t=abc");
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(avisoDeLlegada()).toBe(avisos.correoConfirmado);
  });

  it("no usa ningún temporizador para avanzar (WCAG 2.2.1, D-153)", async () => {
    vi.useFakeTimers();
    const temporizador = vi.spyOn(window, "setTimeout");
    const intervalo = vi.spyOn(window, "setInterval");
    simularApi(() => json(200, { estado: "verificado", con_sesion: true }));
    abrir("?t=abc");
    // Solo se resuelven las promesas del pedido: ningún reloj corre.
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(window.location.pathname).toBe("/privacidad");
    expect(temporizador).not.toHaveBeenCalled();
    expect(intervalo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("el error del servidor (5xx) dice T9 y no dice que el enlace venció", async () => {
    simularApi(() => json(500, { error: "interno" }));
    abrir("?t=abc");
    expect(
      await screen.findByText("No pudimos confirmar tu correo."),
    ).toBeInTheDocument();
    expect(screen.getByText("Intenta de nuevo.")).toBeInTheDocument();
    expect(
      screen.queryByText("Ese enlace ya no sirve."),
    ).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/verificar");
  });

  it("un enlace inválido dice «Ese enlace ya no sirve.» y ofrece reenviar", async () => {
    simularApi(() => json(400, { error: "enlace_invalido" }));
    abrir("?t=viejo");
    expect(
      await screen.findByText("Ese enlace ya no sirve."),
    ).toBeInTheDocument();
    expect(screen.getByText("Pide uno nuevo.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reenviar el correo" }),
    ).toBeInTheDocument();
  });

  it("sin token no llama al API y dice lo mismo", () => {
    const pedidos = simularApi(() => json(200, {}));
    abrir("");
    expect(screen.getByText("Ese enlace ya no sirve.")).toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });

  it("reenviar con sesión va a PN-59; con 429 también; sin sesión va a entrar", async () => {
    let respuesta = () => json(202, { estado: "verificacion_pendiente" });
    simularApi((pedido) =>
      pedido.ruta.endsWith("reenvio")
        ? respuesta()
        : json(400, { error: "enlace_invalido" }),
    );
    const { unmount } = abrir("?t=x");
    fireEvent.click(
      await screen.findByRole("button", { name: "Reenviar el correo" }),
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/revisa-tu-correo"),
    );
    unmount();

    respuesta = () => json(429, { error: "demasiados_intentos" });
    const segunda = abrir("?t=x");
    fireEvent.click(
      await screen.findByRole("button", { name: "Reenviar el correo" }),
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/revisa-tu-correo"),
    );
    segunda.unmount();

    respuesta = () => json(401, { error: "sin_sesion" });
    abrir("?t=x");
    fireEvent.click(
      await screen.findByRole("button", { name: "Reenviar el correo" }),
    );
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
  });

  it("si el reenvío falla muestra el aviso de error del correo", async () => {
    simularApi((pedido) =>
      pedido.ruta.endsWith("reenvio")
        ? json(500, { error: "interno" })
        : json(400, { error: "enlace_invalido" }),
    );
    abrir("?t=x");
    fireEvent.click(
      await screen.findByRole("button", { name: "Reenviar el correo" }),
    );
    expect(
      await screen.findByText("No pudimos enviar el correo."),
    ).toBeInTheDocument();
  });

  it("sin conexión lo dice, sin decir que el enlace no sirve", async () => {
    simularApi(() => {
      throw new TypeError("sin red");
    });
    abrir("?t=x");
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Ese enlace ya no sirve."),
    ).not.toBeInTheDocument();
  });
});
