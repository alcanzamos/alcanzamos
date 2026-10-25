import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { leerCorreo } from "../../src/correoPendiente";
import { irConAviso } from "../../src/llegada";
import { Entrar } from "../../src/pantallas/Entrar";
import { json, simularApi } from "../ayudas";

function llenar(
  correo = "laura@ejemplo.com",
  contrasena = "lluvia café tren azul",
) {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: correo },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: contrasena },
  });
}
const entrar = () =>
  fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

describe("PN-60 · Iniciar sesión", () => {
  it("tiene los textos de E14, sin la entrada del menor, y sus autocompletar", () => {
    render(<Entrar />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Inicia sesión" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(
      screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" }),
    ).toHaveAttribute("href", "/recuperar-acceso");
    expect(
      screen.getByRole("link", { name: "Crear una cuenta" }),
    ).toHaveAttribute("href", "/crear-cuenta");
    expect(
      screen.queryByText("Entro con mi nombre de usuario"),
    ).not.toBeInTheDocument();
  });

  it("una cuenta activa manda el correo como identificador y va a la seguridad de la cuenta", async () => {
    const pedidos = simularApi(() => json(200, { estado: "activa" }));
    render(<Entrar />);
    llenar();
    entrar();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/cuenta/seguridad"),
    );
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/sesiones",
        cuerpo: {
          identificador: "laura@ejemplo.com",
          contrasena: "lluvia café tren azul",
        },
      },
    ]);
  });

  it("una cuenta sin verificar va a PN-59 con su correo", async () => {
    simularApi(() => json(200, { estado: "verificacion_pendiente" }));
    render(<Entrar />);
    llenar();
    entrar();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/revisa-tu-correo"),
    );
    expect(leerCorreo()).toBe("laura@ejemplo.com");
  });

  it("401 dice «No pudimos entrar con esos datos.» sin decir qué dato falló y conserva lo escrito", async () => {
    simularApi(() => json(401, { error: "credenciales_invalidas" }));
    render(<Entrar />);
    llenar();
    entrar();
    expect(
      await screen.findByText("No pudimos entrar con esos datos."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Revisa lo que escribiste e intenta de nuevo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue(
      "laura@ejemplo.com",
    );
    expect(screen.getByLabelText("Contraseña")).toHaveValue(
      "lluvia café tren azul",
    );
  });

  it("422 muestra los errores de campo de E14 y el foco va al primero", async () => {
    simularApi(() =>
      json(422, {
        error: "validacion",
        campos: {
          identificador: "identificador_vacio",
          contrasena: "contrasena_vacia",
        },
      }),
    );
    render(<Entrar />);
    entrar();
    expect(
      await screen.findByText("Falta el correo electrónico."),
    ).toBeInTheDocument();
    expect(screen.getByText("Falta la contraseña.")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveFocus();
  });

  it("422 solo de la contraseña lleva el foco a la contraseña", async () => {
    simularApi(() =>
      json(422, {
        error: "validacion",
        campos: { contrasena: "contrasena_vacia" },
      }),
    );
    render(<Entrar />);
    entrar();
    await screen.findByText("Falta la contraseña.");
    expect(screen.getByLabelText("Contraseña")).toHaveFocus();
  });

  it("429 dice «Hiciste muchos intentos…» y conserva los campos", async () => {
    simularApi(() => json(429, { error: "demasiados_intentos" }));
    render(<Entrar />);
    llenar();
    entrar();
    expect(
      await screen.findByText(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue(
      "laura@ejemplo.com",
    );
  });

  it("sin conexión lo dice", async () => {
    simularApi(() => {
      throw new TypeError("sin red");
    });
    render(<Entrar />);
    llenar();
    entrar();
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
  });

  // E14-PCP 4.16 T7 (D-153): un 5xx nunca dice que los datos están mal.
  it("un error del servidor (5xx) dice que el problema es nuestro, no que los datos no coinciden", async () => {
    simularApi(() => json(500, { error: "interno" }));
    render(<Entrar />);
    llenar();
    entrar();
    expect(
      await screen.findByText("No pudimos iniciar tu sesión."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "El problema es de nuestro lado. Intenta de nuevo en un momento.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No pudimos entrar con esos datos."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("otro error que no es del servidor (401 con otro código) usa el aviso de datos que no coinciden", async () => {
    simularApi(() => json(403, { error: "otro" }));
    render(<Entrar />);
    llenar();
    entrar();
    expect(
      await screen.findByText("No pudimos entrar con esos datos."),
    ).toBeInTheDocument();
  });

  it.each([
    ["sesion_cerrada", "Tu sesión se cerró. Entra de nuevo."],
    // E14-PCP 4.16 T11: el enlace de verificación abierto sin sesión
    ["correo_confirmado", "Listo, confirmamos tu correo."],
    // E14-PCP 4.7, estado «No autorizo» de PN-64
    ["cuenta_borrada", "Borramos el correo que nos diste."],
  ] as const)(
    "al llegar con %s muestra su mensaje de estado arriba, sin mover el foco",
    async (llegada, texto) => {
      irConAviso("/entrar", llegada);
      render(<Entrar />);
      const estado = await screen.findByRole("status");
      expect(estado).toHaveTextContent(texto);
      expect(estado).not.toHaveFocus();
      expect(
        estado.compareDocumentPosition(
          screen.getByRole("heading", { level: 1 }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("lleva el logo con su texto alternativo", () => {
    render(<Entrar />);
    expect(screen.getByRole("img", { name: "Alcanzamos" })).toBeInTheDocument();
  });

  it("no manda dos pedidos si se toca dos veces mientras envía", async () => {
    let soltar: (r: Response) => void = () => {};
    const pedidos = simularApi(
      () => new Promise<Response>((resolver) => (soltar = resolver)),
    );
    render(<Entrar />);
    llenar();
    entrar();
    entrar();
    expect(pedidos).toHaveLength(1);
    soltar(json(200, { estado: "activa" }));
    await waitFor(() =>
      expect(window.location.pathname).toBe("/cuenta/seguridad"),
    );
  });
});
