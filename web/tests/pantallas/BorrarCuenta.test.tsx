import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { avisoDeLlegada } from "../../src/llegada";
import { BorrarCuenta } from "../../src/pantallas/BorrarCuenta";
import { avisos } from "../../src/textos";
import { json, simularApi, type Pedido } from "../ayudas";

const sinHogar = { hogar: null, menores: [] };
const conOtraAdulta = {
  hogar: {
    nombre: "Nuestro hogar",
    es_administradora: true,
    unica_adulta: false,
    nuevo_administrador: "Camilo",
  },
  menores: ["Mateo"],
};

/** El API de PN-69: el resumen al abrir y la respuesta al borrar. */
function api(resumen: unknown, borrar: () => Response = () => json(200, {})) {
  return simularApi((pedido: Pedido) =>
    pedido.metodo === "GET" ? json(200, resumen) : borrar(),
  );
}

const contrasena = () => screen.getByLabelText("Tu contraseña");
const botonBorrar = () =>
  screen.getByRole("button", { name: "Borrar mi cuenta" });

async function abrir(resumen: unknown = sinHogar, borrar?: () => Response) {
  const pedidos = api(resumen, borrar);
  render(<BorrarCuenta />);
  await screen.findByRole("button", { name: "Borrar mi cuenta" });
  return pedidos;
}

const escribir = (clave = "lluvia café tren azul") =>
  fireEvent.change(contrasena(), { target: { value: clave } });

describe("PN-69 · Borrar la cuenta", () => {
  it("sin hogar ni menores trae solo lo de E14: aviso, qué se borra, contraseña, borrar y «Ahora no»", async () => {
    const pedidos = await abrir();
    expect(pedidos[0]).toEqual({
      metodo: "GET",
      ruta: "/api/v1/cuenta/borrado",
      cuerpo: undefined,
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Borrar mi cuenta" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/cuenta/seguridad",
    );
    expect(screen.getByText("Vas a borrar tu cuenta")).toBeInTheDocument();
    expect(
      screen.getByText("Se borran tus datos y no se pueden recuperar."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Lo que se borra" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Tus movimientos, metas, deudas y presupuestos. Tu correo, tu nombre y tus preferencias.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Solo guardamos una prueba mínima de tu autorización, sin tu nombre ni tu correo, durante 3 años.",
      ),
    ).toBeInTheDocument();
    expect(contrasena()).toHaveAttribute("autocomplete", "current-password");
    expect(contrasena()).toHaveValue("");
    expect(
      screen.getByText("La pedimos para confirmar que eres tú."),
    ).toBeInTheDocument();
    expect(botonBorrar()).toHaveClass("boton--destructivo");
    expect(screen.getByRole("link", { name: "Ahora no" })).toHaveAttribute(
      "href",
      "/cuenta/seguridad",
    );
    // Sin hogar no hay fila 4 y sin menores no hay filas 5 y 6.
    expect(screen.queryByText("Menores a tu cargo")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/Eres quien lo administra/)).toBeNull();
    // «Descargar mis datos» (RF-032, D-102) no está en esta historia.
    expect(screen.queryByText("Descargar mis datos")).toBeNull();
  });

  it("al administrar un hogar con otra persona adulta dice a quién pasa el papel", async () => {
    await abrir({ ...conOtraAdulta, menores: [] });
    expect(
      screen.getByRole("heading", { level: 2, name: "Nuestro hogar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Eres quien lo administra. El papel pasa ahora mismo a Camilo. Lo que compartiste sigue en el hogar, sin tu nombre.",
      ),
    ).toBeInTheDocument();
  });

  it("siendo la única persona adulta dice que el hogar se cierra", async () => {
    await abrir({
      hogar: {
        nombre: "Nuestro hogar",
        es_administradora: true,
        unica_adulta: true,
        nuevo_administrador: null,
      },
      menores: [],
    });
    expect(
      screen.getByText(
        "Eres la única persona adulta de «Nuestro hogar». El hogar se cierra y lo que compartiste también se borra.",
      ),
    ).toBeInTheDocument();
  });

  it("siendo miembro sin el papel solo dice que lo compartido sigue sin su nombre (propuesto)", async () => {
    await abrir({
      hogar: {
        nombre: "Nuestro hogar",
        es_administradora: false,
        unica_adulta: false,
        nuevo_administrador: null,
      },
      menores: [],
    });
    expect(
      screen.getByText("Lo que compartiste sigue en el hogar, sin tu nombre."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Eres quien lo administra/)).toBeNull();
  });

  it("un hogar sin nombre se titula «Tu hogar» (propuesto) y la única adulta lo nombra igual", async () => {
    await abrir({
      hogar: {
        nombre: null,
        es_administradora: true,
        unica_adulta: true,
        nuevo_administrador: null,
      },
      menores: [],
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "Tu hogar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Eres la única persona adulta de «Tu hogar»\./),
    ).toBeInTheDocument();
  });

  it("con un menor que depende solo de ella lo nombra y pide la casilla, sin marcar", async () => {
    await abrir(conOtraAdulta);
    expect(
      screen.getByRole("heading", { level: 2, name: "Menores a tu cargo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Mateo depende solo de ti. Su cuenta y sus datos también se borran.",
      ),
    ).toBeInTheDocument();
    const casilla = screen.getByRole("checkbox", {
      name: "Entiendo que también se borra la cuenta de Mateo.",
    });
    expect(casilla).not.toBeChecked();
  });

  it.each([
    [
      ["Mateo", "Sofía"],
      "Mateo y Sofía dependen solo de ti. Sus cuentas y sus datos también se borran.",
      "Entiendo que también se borran las cuentas de Mateo y Sofía.",
    ],
    [
      ["Mateo", "Sofía", "Tomás"],
      "Mateo, Sofía y Tomás dependen solo de ti. Sus cuentas y sus datos también se borran.",
      "Entiendo que también se borran las cuentas de Mateo, Sofía y Tomás.",
    ],
  ])(
    "con varios menores (%j) los nombra a todos",
    async (menores, aviso, casilla) => {
      await abrir({ hogar: null, menores });
      expect(screen.getByText(aviso)).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: casilla }),
      ).toBeInTheDocument();
    },
  );

  it("borra con la contraseña: manda el cuerpo y va a entrar con «Borramos tu cuenta.»", async () => {
    const pedidos = await abrir();
    escribir();
    fireEvent.click(botonBorrar());
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(pedidos[1]).toEqual({
      metodo: "POST",
      ruta: "/api/v1/cuenta/borrado",
      cuerpo: { contrasena: "lluvia café tren azul", confirma_menores: false },
    });
    expect(avisoDeLlegada()).toBe(avisos.cuentaBorrada);
    expect(avisos.cuentaBorrada).toEqual({
      tipo: "informacion",
      titulo: "Borramos tu cuenta.",
      mensaje: "Gracias por haber usado Alcanzamos.",
    });
  });

  it("con la casilla marcada manda confirma_menores", async () => {
    const pedidos = await abrir(conOtraAdulta);
    escribir();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(botonBorrar());
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(pedidos[1]?.cuerpo).toEqual({
      contrasena: "lluvia café tren azul",
      confirma_menores: true,
    });
  });

  it("sin marcar la casilla del menor el API dice 422 y la pantalla pide confirmar lo de Mateo", async () => {
    await abrir(conOtraAdulta, () =>
      json(422, {
        error: "validacion",
        campos: { confirma_menores: "confirmacion_requerida" },
      }),
    );
    escribir();
    fireEvent.click(botonBorrar());
    expect(
      await screen.findByText("Falta confirmar lo de Mateo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(window.location.pathname).not.toBe("/entrar");
  });

  it("con varios menores el error los nombra a todos", async () => {
    await abrir({ hogar: null, menores: ["Mateo", "Sofía"] }, () =>
      json(422, {
        error: "validacion",
        campos: { confirma_menores: "confirmacion_requerida" },
      }),
    );
    escribir();
    fireEvent.click(botonBorrar());
    expect(
      await screen.findByText("Falta confirmar lo de Mateo y Sofía."),
    ).toBeInTheDocument();
  });

  it("la contraseña vacía (422) da «Falta tu contraseña.» y el foco va al campo", async () => {
    await abrir(sinHogar, () =>
      json(422, {
        error: "validacion",
        campos: { contrasena: "contrasena_vacia" },
      }),
    );
    fireEvent.click(botonBorrar());
    expect(await screen.findByText("Falta tu contraseña.")).toBeInTheDocument();
    expect(contrasena()).toHaveFocus();
  });

  it("los dos errores de campo juntos: el foco va al primero, la contraseña", async () => {
    await abrir(conOtraAdulta, () =>
      json(422, {
        error: "validacion",
        campos: {
          contrasena: "contrasena_vacia",
          confirma_menores: "confirmacion_requerida",
        },
      }),
    );
    fireEvent.click(botonBorrar());
    await screen.findByText("Falta tu contraseña.");
    expect(
      screen.getByText("Falta confirmar lo de Mateo."),
    ).toBeInTheDocument();
    expect(contrasena()).toHaveFocus();
  });

  it("una contraseña que no coincide (400) se muestra en su campo, conserva lo escrito y no borra", async () => {
    await abrir(sinHogar, () => json(400, { error: "contrasena_incorrecta" }));
    escribir("la que no es");
    fireEvent.click(botonBorrar());
    expect(
      await screen.findByText(
        "No pudimos confirmar tu contraseña. Escríbela de nuevo.",
      ),
    ).toBeInTheDocument();
    expect(contrasena()).toHaveFocus();
    expect(contrasena()).toHaveValue("la que no es");
    expect(window.location.pathname).not.toBe("/entrar");
  });

  it("429 dice el texto de espera", async () => {
    await abrir(sinHogar, () => json(429, { error: "demasiados_intentos" }));
    escribir();
    fireEvent.click(botonBorrar());
    expect(
      await screen.findByText(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    [500, { error: "error_interno" }],
    [403, { error: "cuenta_de_menor" }],
  ])("un error (%i) dice que los datos siguen ahí", async (estado, cuerpo) => {
    await abrir(sinHogar, () => json(estado, cuerpo));
    escribir();
    fireEvent.click(botonBorrar());
    expect(
      await screen.findByText("No pudimos borrar tu cuenta."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tus datos siguen ahí. Intenta de nuevo."),
    ).toBeInTheDocument();
    expect(contrasena()).toHaveValue("lluvia café tren azul");
  });

  it("sin conexión al borrar lo dice y conserva lo escrito", async () => {
    await abrir(sinHogar, () => {
      throw new TypeError("sin red");
    });
    escribir();
    fireEvent.click(botonBorrar());
    expect(
      await screen.findByText(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      ),
    ).toBeInTheDocument();
    expect(contrasena()).toHaveValue("lluvia café tren azul");
  });

  it.each([
    [401, { error: "sin_sesion" }, "/entrar"],
    [403, { error: "verificacion_pendiente" }, "/revisa-tu-correo"],
    [403, { error: "autorizacion_pendiente" }, "/privacidad"],
  ])("al borrar, %i %j lleva a %s", async (estado, cuerpo, destino) => {
    await abrir(sinHogar, () => json(estado, cuerpo));
    escribir();
    fireEvent.click(botonBorrar());
    await waitFor(() => expect(window.location.pathname).toBe(destino));
  });

  it("mientras borra no manda un segundo pedido", async () => {
    let soltar: (r: Response) => void = () => {};
    const pedidos = simularApi((pedido) =>
      pedido.metodo === "GET"
        ? json(200, sinHogar)
        : new Promise<Response>((resolver) => (soltar = resolver)),
    );
    render(<BorrarCuenta />);
    await screen.findByRole("button", { name: "Borrar mi cuenta" });
    escribir();
    fireEvent.click(botonBorrar());
    fireEvent.click(botonBorrar());
    await waitFor(() => expect(pedidos).toHaveLength(2));
    soltar(json(200, {}));
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    expect(pedidos).toHaveLength(2);
  });

  describe("al abrir", () => {
    it("sin el resumen no se puede borrar: avisa (propuesto) y deja intentar de nuevo", async () => {
      let intento = 0;
      const pedidos = simularApi(() =>
        ++intento === 1
          ? json(500, { error: "error_interno" })
          : json(200, sinHogar),
      );
      render(<BorrarCuenta />);
      expect(
        await screen.findByText("No pudimos cargar lo que se borra."),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Borrar mi cuenta" }),
      ).toBeNull();
      expect(screen.queryByLabelText("Tu contraseña")).toBeNull();
      expect(screen.getByRole("link", { name: "Ahora no" })).toHaveAttribute(
        "href",
        "/cuenta/seguridad",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Intentar de nuevo" }),
      );
      expect(await screen.findByLabelText("Tu contraseña")).toBeInTheDocument();
      expect(pedidos.map((p) => p.metodo)).toEqual(["GET", "GET"]);
    });

    it("sin conexión lo dice", async () => {
      simularApi(() => {
        throw new TypeError("sin red");
      });
      render(<BorrarCuenta />);
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Borrar mi cuenta" }),
      ).toBeNull();
    });

    it.each([
      [401, { error: "sin_sesion" }, "/entrar"],
      [403, { error: "verificacion_pendiente" }, "/revisa-tu-correo"],
      [403, { error: "autorizacion_pendiente" }, "/privacidad"],
    ])("%i %j lleva a %s", async (estado, cuerpo, destino) => {
      simularApi(() => json(estado, cuerpo));
      render(<BorrarCuenta />);
      await waitFor(() => expect(window.location.pathname).toBe(destino));
    });

    it("mientras carga solo muestra el título", () => {
      simularApi(() => new Promise<Response>(() => {}));
      render(<BorrarCuenta />);
      expect(
        screen.getByRole("heading", { level: 1, name: "Borrar mi cuenta" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Tu contraseña")).toBeNull();
    });
  });
});
