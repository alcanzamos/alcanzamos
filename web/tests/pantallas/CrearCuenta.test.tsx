import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { leerCorreo } from "../../src/correoPendiente";
import { CrearCuenta } from "../../src/pantallas/CrearCuenta";
import { json, porTexto, simularApi } from "../ayudas";

function llenar({ marcar = true } = {}) {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "laura@ejemplo.com" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), {
    target: { value: "lluvia café tren azul" },
  });
  fireEvent.change(screen.getByLabelText("Nombre para mostrar"), {
    target: { value: "Laura" },
  });
  if (marcar) fireEvent.click(screen.getByLabelText("Soy mayor de edad"));
}

const crear = () =>
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

describe("PN-58 · Crear la cuenta", () => {
  it("muestra los textos de E14 con la casilla sin marcar", () => {
    render(<CrearCuenta />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Crea tu cuenta" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Solo necesitamos tres datos."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Te enviaremos un enlace para confirmarlo."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Usa una frase de tres o cuatro palabras."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Es el nombre que verás en la app. Puede ser un apodo."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Después de confirmar tu correo verás cómo cuidamos tus datos y decidirás si los autorizas.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Soy mayor de edad")).not.toBeChecked();
    expect(
      screen.getByRole("link", { name: "Ya tengo una cuenta" }),
    ).toHaveAttribute("href", "/entrar");
  });

  it("los campos llevan su autocompletar", () => {
    render(<CrearCuenta />);
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText("Nombre para mostrar")).toHaveAttribute(
      "autocomplete",
      "name",
    );
  });

  it("con 202 manda los cuatro datos, guarda el correo para mostrarlo y va a PN-59", async () => {
    const pedidos = simularApi(() =>
      json(202, { estado: "verificacion_pendiente" }),
    );
    render(<CrearCuenta />);
    llenar();
    crear();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/revisa-tu-correo"),
    );
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/cuentas",
        cuerpo: {
          correo: "laura@ejemplo.com",
          contrasena: "lluvia café tren azul",
          nombre: "Laura",
          mayor_de_edad: true,
        },
      },
    ]);
    expect(leerCorreo()).toBe("laura@ejemplo.com");
  });

  it("manda mayor_de_edad falso si no se marca y muestra el error del API en la casilla", async () => {
    const pedidos = simularApi(() =>
      json(422, {
        error: "validacion",
        campos: { mayor_de_edad: "mayor_de_edad_requerido" },
      }),
    );
    render(<CrearCuenta />);
    llenar({ marcar: false });
    crear();
    expect(
      await screen.findByText("Falta marcar que eres mayor de edad."),
    ).toBeInTheDocument();
    expect(
      (pedidos[0]?.cuerpo as { mayor_de_edad: boolean }).mayor_de_edad,
    ).toBe(false);
    expect(screen.getByLabelText("Soy mayor de edad")).toHaveFocus();
    expect(window.location.pathname).toBe("/");
  });

  it("muestra todos los errores de campo a la vez, lleva el foco al primero y conserva lo escrito", async () => {
    simularApi(() =>
      json(422, {
        error: "validacion",
        campos: {
          correo: "correo_invalido",
          contrasena: "contrasena_corta",
          nombre: "nombre_vacio",
        },
      }),
    );
    render(<CrearCuenta />);
    llenar();
    crear();
    expect(
      await screen.findByText(
        "Falta completar el correo. Por ejemplo, nombre@correo.com.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        porTexto("Falta que la contraseña tenga al menos 15 caracteres."),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Falta el nombre para mostrar."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveFocus();
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue(
      "laura@ejemplo.com",
    );
    expect(screen.getByLabelText("Contraseña")).toHaveValue(
      "lluvia café tren azul",
    );
  });

  it.each([
    ["correo_vacio", "Falta el correo electrónico."],
    ["contrasena_vacia", "Falta la contraseña."],
    [
      "contrasena_comun",
      "Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.",
    ],
    [
      "contrasena_personal",
      "Falta una contraseña que no incluya tu correo ni el nombre de la app.",
    ],
  ])("el código %s se muestra con el texto de E14", async (codigo, texto) => {
    const campo = codigo.startsWith("correo") ? "correo" : "contrasena";
    simularApi(() =>
      json(422, { error: "validacion", campos: { [campo]: codigo } }),
    );
    render(<CrearCuenta />);
    crear();
    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  // E14-PCP 4.16 T5 (D-153)
  it("nombre_largo da el error del campo, con el foco en el nombre", async () => {
    simularApi(() =>
      json(422, { error: "validacion", campos: { nombre: "nombre_largo" } }),
    );
    render(<CrearCuenta />);
    crear();
    expect(
      await screen.findByText(
        porTexto("Escribe un nombre de hasta 60 caracteres."),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre para mostrar")).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("un código de campo que no conoce cae al aviso de error de envío", async () => {
    simularApi(() =>
      json(422, { error: "validacion", campos: { nombre: "otro_codigo" } }),
    );
    render(<CrearCuenta />);
    crear();
    expect(
      await screen.findByText("No pudimos crear la cuenta."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("429 muestra el texto de espera, con el foco en el aviso, sin decir nada del correo", async () => {
    simularApi(() => json(429, { error: "demasiados_intentos" }));
    render(<CrearCuenta />);
    llenar();
    crear();
    expect(
      await screen.findByText(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue(
      "laura@ejemplo.com",
    );
  });

  it("sin conexión muestra su aviso y conserva lo escrito", async () => {
    simularApi(() => {
      throw new TypeError("sin red");
    });
    render(<CrearCuenta />);
    llenar();
    crear();
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre para mostrar")).toHaveValue("Laura");
  });

  it("un error del servidor da «No pudimos crear la cuenta» y «Intentar de nuevo» reenvía", async () => {
    let intento = 0;
    const pedidos = simularApi(() =>
      ++intento === 1 ? json(500, { error: "interno" }) : json(202, {}),
    );
    render(<CrearCuenta />);
    llenar();
    crear();
    expect(
      await screen.findByText("Tus datos no se perdieron. Intenta de nuevo."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    await waitFor(() =>
      expect(window.location.pathname).toBe("/revisa-tu-correo"),
    );
    expect(pedidos).toHaveLength(2);
  });

  it("no manda dos pedidos si se toca dos veces mientras envía", async () => {
    let soltar: (r: Response) => void = () => {};
    const pedidos = simularApi(
      () => new Promise<Response>((resolver) => (soltar = resolver)),
    );
    render(<CrearCuenta />);
    llenar();
    crear();
    crear();
    expect(pedidos).toHaveLength(1);
    soltar(json(202, {}));
    await waitFor(() =>
      expect(window.location.pathname).toBe("/revisa-tu-correo"),
    );
  });
});
