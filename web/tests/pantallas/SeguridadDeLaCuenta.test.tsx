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

  // D-164: el botón provisional «Registrar un movimiento» se quitó; PN-01 es la entrada al formulario y PN-71 solo lleva
  // a PN-01 (el destino «Movimientos» de la navegación, E14-SDD 5.9).
  it("ya no trae «Registrar un movimiento»: solo el enlace a PN-01, que lleva a /movimientos", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    expect(
      screen.queryByRole("link", { name: "Registrar un movimiento" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Registrar" })).toBeNull();
    const enlace = screen.getByRole("link", { name: "Movimientos" });
    expect(enlace).toHaveAttribute("href", "/movimientos");
    fireEvent.click(enlace);
    expect(window.location.pathname).toBe("/movimientos");
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
  it("«Borrar mi cuenta» es un botón de texto que abre PN-69, debajo de «Cerrar sesión»", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    const enlace = screen.getByRole("link", { name: "Borrar mi cuenta" });
    expect(enlace).toHaveAttribute("href", "/cuenta/borrar");
    expect(enlace).toHaveClass("boton--texto");
    expect(
      screen
        .getByRole("button", { name: "Cerrar sesión" })
        .compareDocumentPosition(enlace) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(enlace);
    expect(window.location.pathname).toBe("/cuenta/borrar");
  });

  // E14-PCP 4.14, nota del 2026-11-08 (bug 260, USA-003) y 4.16 T2 ter: mientras no exista PN-66, PN-71 lleva la entrada
  // provisional a PN-63 desde el menú arriba de «Cerrar sesión», y «Borrar mi cuenta» queda última, como en PN-66.
  it("«Cómo cuidamos tus datos» es un botón de texto que abre PN-63 desde el menú", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    const enlace = screen.getByRole("link", {
      name: "Cómo cuidamos tus datos",
    });
    expect(enlace).toHaveAttribute("href", "/cuenta/privacidad");
    expect(enlace).toHaveClass("boton--texto");
    fireEvent.click(enlace);
    expect(window.location.pathname).toBe("/cuenta/privacidad");
  });

  // L3 de la US-77 (punto 3): «Presupuesto» es una entrada provisional, como «Movimientos», justo después de ella.
  it("orden: «Movimientos», «Presupuesto», «Cómo cuidamos tus datos», «Cerrar sesión» y, última, «Borrar mi cuenta»", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    expect(
      [...document.querySelectorAll("main a, main button")].map(
        (elemento) => elemento.textContent,
      ),
    ).toEqual([
      "Movimientos",
      "Presupuesto",
      "Cómo cuidamos tus datos",
      "Cerrar sesión",
      "Borrar mi cuenta",
    ]);
  });

  it("«Presupuesto» es un enlace con aspecto de «Movimientos» que abre PN-06", async () => {
    simularApi(() => json(200, { ingreso_anterior: null }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("Este es tu primer ingreso.");
    const enlace = screen.getByRole("link", { name: "Presupuesto" });
    expect(enlace).toHaveAttribute("href", "/presupuesto");
    expect(enlace).toHaveClass(
      screen.getByRole("link", { name: "Movimientos" }).className,
    );
    fireEvent.click(enlace);
    expect(window.location.pathname).toBe("/presupuesto");
  });

  it("la entrada a PN-63 también está con el error de carga", async () => {
    simularApi(() => json(500, { error: "interno" }));
    render(<SeguridadDeLaCuenta />);
    await screen.findByText("No pudimos cargar tu último ingreso.");
    expect(
      screen.getByRole("link", { name: "Cómo cuidamos tus datos" }),
    ).toHaveAttribute("href", "/cuenta/privacidad");
  });

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
