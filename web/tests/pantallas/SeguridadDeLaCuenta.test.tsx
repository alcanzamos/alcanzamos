import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { irConAviso, irConMensaje } from "../../src/llegada";
import { SeguridadDeLaCuenta } from "../../src/pantallas/SeguridadDeLaCuenta";
import { json, porTexto, simularApi } from "../ayudas";

describe("PN-71 · Seguridad de la cuenta", () => {
  it("con ingreso anterior lo dice en palabras, en Bogotá, con las filas 3 y 4", async () => {
    simularApi(() => json(200, { ingreso_anterior: "2026-11-02T02:40:00Z" }));
    render(<SeguridadDeLaCuenta />);
    expect(
      await screen.findByText(
        porTexto(
          "Tu ingreso anterior fue el 1 de noviembre de 2026, a las 9:40 p. m.",
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Tu último ingreso" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Es la fecha de tu ingreso anterior, no la de ahora."),
    ).toBeInTheDocument();
    expect(screen.getByText("¿No reconoces este ingreso?")).toBeInTheDocument();
    expect(
      screen.getByText("Cambia tu contraseña y cerramos tus otras sesiones."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Cambiar mi contraseña" }),
    ).toHaveAttribute("href", "/cuenta/contrasena");
  });

  // D-164 (S3): el botón provisional de entrada al formulario, con el texto de E14-PRR PN-72.
  it("trae el botón provisional «Registrar un movimiento», que lleva a /registrar", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    const boton = screen.getByRole("link", { name: "Registrar un movimiento" });
    expect(boton).toHaveAttribute("href", "/registrar");
    expect(boton).toHaveClass("boton--secundario");
    fireEvent.click(boton);
    expect(window.location.pathname).toBe("/registrar");
  });

  it("anuncia como mensaje de estado el aviso con que vuelve el formulario", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    irConMensaje("/cuenta/seguridad", {
      tipo: "informacion",
      titulo: "Listo, registramos tu gasto de $45.000.",
    });
    render(<SeguridadDeLaCuenta />);
    const estado = await screen.findByRole("status");
    await waitFor(() =>
      expect(estado).toHaveTextContent(
        "Listo, registramos tu gasto de $45.000.",
      ),
    );
  });

  // E14-PCP 4.16 T2
  it("«Cerrar sesión» es un botón de texto", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toHaveClass(
      "boton--texto",
    );
  });

  it("los números de la fecha van en Figtree (clase cifra)", async () => {
    simularApi(() => json(200, { ingreso_anterior: "2026-11-02T02:40:00Z" }));
    const { container } = render(<SeguridadDeLaCuenta />);
    await screen.findByText(/Tu ingreso anterior/);
    expect(
      [...container.querySelectorAll(".cifra")].map((n) => n.textContent),
    ).toEqual(["1", "2026", "9:40"]);
  });

  it("el primer ingreso dice «Este es tu primer ingreso.» sin fecha ni las filas 3 y 4", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    expect(
      await screen.findByText("Este es tu primer ingreso."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Es la fecha de tu ingreso anterior/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("¿No reconoces este ingreso?"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Cambiar mi contraseña" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeInTheDocument();
  });

  it("al volver de PN-73 muestra el logro de contraseña cambiada", async () => {
    irConAviso("/cuenta/seguridad", "contrasena_cambiada");
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    expect(
      screen.getByText("Listo, cambiamos tu contraseña."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cerramos tus otras sesiones. Esta sigue abierta."),
    ).toBeInTheDocument();
  });

  it.each([
    [401, { error: "sin_sesion" }, "/entrar"],
    [403, { error: "verificacion_pendiente" }, "/revisa-tu-correo"],
    [403, { error: "autorizacion_pendiente" }, "/privacidad"],
  ])("%i %j lleva a %s", async (estado, cuerpo, destino) => {
    simularApi(() => json(estado, cuerpo));
    render(<SeguridadDeLaCuenta />);
    await waitFor(() => expect(window.location.pathname).toBe(destino));
  });

  it("un error de carga dice «No pudimos cargar tu último ingreso.» y «Intentar de nuevo» vuelve a pedir", async () => {
    let intento = 0;
    const pedidos = simularApi(() =>
      ++intento === 1
        ? json(500, { error: "interno" })
        : json(200, { ingreso_anterior: null }),
    );
    render(<SeguridadDeLaCuenta />);
    expect(
      await screen.findByText("No pudimos cargar tu último ingreso."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(
      await screen.findByText("Este es tu primer ingreso."),
    ).toBeInTheDocument();
    expect(pedidos).toHaveLength(2);
  });

  it("sin conexión y una fecha ilegible también son error de carga", async () => {
    simularApi(() => {
      throw new TypeError("sin red");
    });
    const { unmount } = render(<SeguridadDeLaCuenta />);
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    unmount();
    simularApi(() => json(200, { ingreso_anterior: "ayer" }));
    render(<SeguridadDeLaCuenta />);
    expect(
      await screen.findByText("No pudimos cargar tu último ingreso."),
    ).toBeInTheDocument();
  });

  it("Cerrar sesión llama al API y lleva a entrar; un 401 también sale", async () => {
    const pedidos = simularApi((p) =>
      p.metodo === "DELETE"
        ? new Response(null, { status: 204 })
        : json(200, { ingreso_anterior: null }),
    );
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(pedidos.at(-1)).toMatchObject({
      metodo: "DELETE",
      ruta: "/api/v1/sesiones/actual",
    });
  });

  it("Cerrar sesión sin conexión se queda y lo dice", async () => {
    simularApi((p) => {
      if (p.metodo === "DELETE") throw new TypeError("sin red");
      return json(200, { ingreso_anterior: null });
    });
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
