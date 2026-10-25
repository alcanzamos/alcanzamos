import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Autorizacion } from "../../src/pantallas/Autorizacion";
import { json, porTexto, simularApi, type Pedido } from "../ayudas";

const finalidad = (codigo: string, tipo: string) => ({
  codigo,
  tipo,
  otorgada: false,
});
const catalogo = (extra: unknown[] = [], fecha = "2026-10-30") => ({
  version: { numero: "1.0", fecha },
  finalidades: [
    finalidad("cuenta_y_acceso", "necesaria"),
    finalidad("funciones_financieras", "necesaria"),
    finalidad("avisos", "accesoria"),
    finalidad("horas_de_vida", "accesoria"),
    ...extra,
  ],
});

const NECESARIAS =
  "Autorizo el uso de mis datos para estas finalidades necesarias.";
const AVISOS = "Autorizo los avisos con la app cerrada.";
const HORAS = "Autorizo mostrar el costo de un gasto en horas de vida.";

/** El API de PN-64: el catálogo y lo demás según `otros`. */
const api = (
  otros: (pedido: Pedido) => Response = () =>
    json(200, { estado: "autorizada" }),
  cat: unknown = catalogo(),
) =>
  simularApi((pedido) =>
    pedido.metodo === "GET" ? json(200, cat) : otros(pedido),
  );

async function cargada() {
  render(<Autorizacion />);
  await screen.findByRole("checkbox", { name: NECESARIAS });
}
const marcar = (nombre: string) =>
  fireEvent.click(screen.getByRole("checkbox", { name: nombre }));
const tocar = (nombre: string) =>
  fireEvent.click(screen.getByRole("button", { name: nombre }));

describe("PN-64 · Autorización de datos", () => {
  describe("lo que se ve", () => {
    it("pide el catálogo y muestra los textos de E14 (filas 1 a 12)", async () => {
      const pedidos = api();
      await cargada();
      expect(pedidos[0]).toMatchObject({
        metodo: "GET",
        ruta: "/api/v1/autorizaciones",
      });
      expect(
        screen.getByRole("heading", { level: 1, name: "Tu autorización" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.",
        ),
      ).toBeInTheDocument();
      for (const texto of [
        "Cuenta y acceso",
        "Usamos tu correo, tu contraseña y tu nombre para crear tu cuenta, dejarte entrar y ayudarte a recuperar el acceso.",
        "Funciones financieras",
        "Usamos lo que registras —movimientos, presupuestos, deudas y metas— para calcular tu plata disponible, avisarte de un faltante y mostrarte tus resúmenes.",
        "Avisos con la app cerrada",
        "Usamos un código de tu teléfono para enviarte avisos aunque la app esté cerrada. El aviso solo dice «Tienes un aviso en Alcanzamos.» y no lleva cifras ni nombres.",
        "Horas de vida",
        "Usamos tu ingreso y tus horas de trabajo para mostrarte cuánto tiempo de tu vida cuesta un gasto. Está apagado hasta que lo actives. Es solo para personas adultas.",
        "Sin esta autorización no podemos darte la cuenta. Si no autorizas, borramos al momento el correo que nos diste.",
        "Puedes decir que no. La app funciona igual. Lo cambias cuando quieras en Preferencias.",
      ])
        expect(screen.getByText(texto)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Autorizar y continuar" }),
      ).toHaveClass("boton--primario");
      expect(screen.getByRole("button", { name: "No autorizo" })).toHaveClass(
        "boton--secundario",
      );
    });

    it("lleva dos tarjetas separadas: lo necesario y lo que se puede elegir", async () => {
      api();
      await cargada();
      const necesario = screen.getByRole("region", {
        name: "Lo necesario para usar la app",
      });
      const opcional = screen.getByRole("region", {
        name: "Lo que puedes elegir",
      });
      expect(necesario).toHaveTextContent("Funciones financieras");
      expect(necesario).not.toHaveTextContent("Horas de vida");
      expect(opcional).toHaveTextContent("Avisos con la app cerrada");
      expect(opcional).toHaveTextContent("Horas de vida");
      expect(opcional).not.toHaveTextContent("Cuenta y acceso");
    });

    it("ninguna casilla viene marcada (RF-063): la de lo necesario y una por cada accesoria", async () => {
      api();
      await cargada();
      const casillas = screen.getAllByRole("checkbox");
      expect(casillas.map((c) => c.getAttribute("id"))).toEqual([
        "necesarias",
        "finalidad-avisos",
        "finalidad-horas_de_vida",
      ]);
      for (const c of casillas) expect(c).not.toBeChecked();
      marcar(NECESARIAS);
      expect(screen.getByRole("checkbox", { name: AVISOS })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: HORAS })).not.toBeChecked();
    });

    it("las casillas tienen etiqueta y no traen error al llegar", async () => {
      api();
      await cargada();
      for (const nombre of [NECESARIAS, AVISOS, HORAS])
        expect(
          screen.getByRole("checkbox", { name: nombre }),
        ).not.toBeInvalid();
      expect(
        screen.queryByText(/Falta tu autorización/),
      ).not.toBeInTheDocument();
    });

    it("la versión sale del API y la fecha va en palabras, con las cifras en Figtree (D-090, D-123)", async () => {
      const { container } = (api(), render(<Autorizacion />));
      expect(
        await screen.findByText(
          porTexto("Texto versión 1.0 del 30 de octubre de 2026."),
        ),
      ).toBeInTheDocument();
      expect(
        [...container.querySelectorAll(".cifra")].map((n) => n.textContent),
      ).toContain("2026");
    });

    it("otra versión del API cambia la frase", async () => {
      simularApi(() =>
        json(200, {
          ...catalogo(),
          version: { numero: "2.1", fecha: "2027-01-05" },
        }),
      );
      render(<Autorizacion />);
      expect(
        await screen.findByText(
          porTexto("Texto versión 2.1 del 5 de enero de 2027."),
        ),
      ).toBeInTheDocument();
    });

    it("la barra lleva Atrás a PN-63 y no hay «Leer la política completa» (PN-68 no existe)", async () => {
      api();
      await cargada();
      expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
        "href",
        "/privacidad",
      );
      expect(
        screen.queryByText("Leer la política completa"),
      ).not.toBeInTheDocument();
    });
  });

  describe("autorizar", () => {
    it("sin lo necesario muestra el error junto a la casilla y no pide nada", async () => {
      const pedidos = api();
      await cargada();
      tocar("Autorizar y continuar");
      const casilla = screen.getByRole("checkbox", { name: NECESARIAS });
      expect(casilla).toBeInvalid();
      const error = screen.getByText(
        "Falta tu autorización para lo necesario.",
      );
      expect(casilla).toHaveAccessibleDescription(
        "Falta tu autorización para lo necesario.",
      );
      expect(error.closest("p")).toHaveAttribute("id", "necesarias-error");
      expect(casilla).toHaveFocus();
      expect(pedidos).toHaveLength(1);
      expect(window.location.pathname).toBe("/");
    });

    it("el botón no se deshabilita con el error y el error se va al marcar lo necesario", async () => {
      api();
      await cargada();
      tocar("Autorizar y continuar");
      expect(
        screen.getByRole("button", { name: "Autorizar y continuar" }),
      ).not.toHaveAttribute("aria-disabled");
      marcar(NECESARIAS);
      expect(
        screen.queryByText("Falta tu autorización para lo necesario."),
      ).not.toBeInTheDocument();
    });

    it("marcar solo una accesoria no basta: sigue pidiendo lo necesario", async () => {
      const pedidos = api();
      await cargada();
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      expect(
        screen.getByText("Falta tu autorización para lo necesario."),
      ).toBeInTheDocument();
      expect(pedidos).toHaveLength(1);
    });

    it("con lo necesario manda las dos necesarias y la versión, sin accesorias, y va a PN-71", async () => {
      const pedidos = api();
      await cargada();
      marcar(NECESARIAS);
      tocar("Autorizar y continuar");
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
      expect(pedidos[1]).toEqual({
        metodo: "POST",
        ruta: "/api/v1/autorizaciones",
        cuerpo: {
          finalidades: ["cuenta_y_acceso", "funciones_financieras"],
          version: "1.0",
        },
      });
    });

    it("suma solo las accesorias que la persona marcó", async () => {
      const pedidos = api();
      await cargada();
      marcar(NECESARIAS);
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      expect(pedidos[1]?.cuerpo).toEqual({
        finalidades: ["cuenta_y_acceso", "funciones_financieras", "avisos"],
        version: "1.0",
      });
    });

    it("una accesoria desmarcada no se manda", async () => {
      const pedidos = api();
      await cargada();
      marcar(NECESARIAS);
      marcar(HORAS);
      marcar(HORAS);
      tocar("Autorizar y continuar");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      expect(pedidos[1]?.cuerpo).toEqual({
        finalidades: ["cuenta_y_acceso", "funciones_financieras"],
        version: "1.0",
      });
    });

    it("no manda dos veces mientras el pedido está en curso", async () => {
      let soltar: () => void = () => {};
      const pedidos = simularApi((pedido) =>
        pedido.metodo === "GET"
          ? json(200, catalogo())
          : (new Promise<Response>((resolver) => {
              soltar = () => resolver(json(200, { estado: "autorizada" }));
            }) as unknown as Response),
      );
      await cargada();
      marcar(NECESARIAS);
      tocar("Autorizar y continuar");
      tocar("Autorizar y continuar");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      soltar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
      expect(pedidos).toHaveLength(2);
    });
  });

  describe("errores al autorizar", () => {
    const errorDeGuardar = "No pudimos guardar tu autorización.";

    async function enviarConError(respuesta: () => Response) {
      const pedidos = api(respuesta);
      await cargada();
      marcar(NECESARIAS);
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      return pedidos;
    }

    it.each([
      [422, { error: "faltan_necesarias" }],
      [422, { error: "finalidad_invalida" }],
      [500, { error: "interno" }],
      [403, { error: "otro" }],
    ])(
      "%i %j: el error de envío de E14, con lo marcado conservado",
      async (estado, cuerpo) => {
        await enviarConError(() => json(estado, cuerpo));
        const aviso = await screen.findByRole("status");
        expect(aviso).toHaveTextContent(errorDeGuardar);
        expect(aviso).toHaveTextContent("Intenta de nuevo.");
        expect(aviso).toHaveFocus();
        expect(
          screen.getByRole("checkbox", { name: NECESARIAS }),
        ).toBeChecked();
        expect(screen.getByRole("checkbox", { name: AVISOS })).toBeChecked();
        expect(window.location.pathname).toBe("/");
      },
    );

    it("409 version_desactualizada: vuelve a pedir el catálogo y usa la versión nueva", async () => {
      let versión = "1.0";
      let publicada = "2026-10-30";
      const pedidos = simularApi((pedido) => {
        if (pedido.metodo === "GET")
          return json(200, {
            ...catalogo([], publicada),
            version: { numero: versión, fecha: publicada },
          });
        if ((pedido.cuerpo as { version: string }).version === "1.0") {
          versión = "1.1";
          publicada = "2026-11-15";
          return json(409, { error: "version_desactualizada" });
        }
        return json(200, { estado: "autorizada" });
      });
      await cargada();
      marcar(NECESARIAS);
      marcar(AVISOS);
      tocar("Autorizar y continuar");
      expect(await screen.findByRole("status")).toHaveTextContent(
        errorDeGuardar,
      );
      expect(
        await screen.findByText(
          porTexto("Texto versión 1.1 del 15 de noviembre de 2026."),
        ),
      ).toBeInTheDocument();
      expect(pedidos.map((p) => p.metodo)).toEqual(["GET", "POST", "GET"]);
      // Lo marcado se conserva y la persona reintenta con la versión nueva.
      expect(screen.getByRole("checkbox", { name: AVISOS })).toBeChecked();
      tocar("Autorizar y continuar");
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
      expect(pedidos[3]?.cuerpo).toMatchObject({ version: "1.1" });
    });

    it("sin conexión: el aviso de T10 y las casillas conservan lo marcado", async () => {
      simularApi((pedido) => {
        if (pedido.metodo === "GET") return json(200, catalogo());
        throw new TypeError("sin red");
      });
      await cargada();
      marcar(NECESARIAS);
      tocar("Autorizar y continuar");
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
      );
      expect(screen.getByRole("checkbox", { name: NECESARIAS })).toBeChecked();
    });

    it("429: demasiados intentos", async () => {
      await enviarConError(() => json(429, { error: "demasiados_intentos" }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      );
    });

    it("401 lleva a PN-60 («Tu sesión se cerró»)", async () => {
      await enviarConError(() => json(401, { error: "sin_sesion" }));
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(window.history.state).toEqual({ llegada: "sesion_cerrada" });
    });

    it("403 verificacion_pendiente lleva a PN-59", async () => {
      await enviarConError(() =>
        json(403, { error: "verificacion_pendiente" }),
      );
      await waitFor(() =>
        expect(window.location.pathname).toBe("/revisa-tu-correo"),
      );
    });
  });

  describe("«No autorizo»", () => {
    const rechazo = { metodo: "POST", ruta: "/api/v1/autorizaciones/rechazo" };

    it("llama al rechazo, sin cuerpo, y va a PN-60 con «Borramos el correo que nos diste.»", async () => {
      const pedidos = api(() => new Response(null, { status: 204 }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(pedidos[1]).toMatchObject({ ...rechazo, cuerpo: undefined });
      expect(window.history.state).toEqual({ llegada: "cuenta_borrada" });
    });

    it("no pide una confirmación extra ni exige marcar nada", async () => {
      const pedidos = api(() => new Response(null, { status: 204 }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() => expect(pedidos).toHaveLength(2));
      expect(
        screen.queryByText("Falta tu autorización para lo necesario."),
      ).not.toBeInTheDocument();
    });

    it.each([
      ["sin conexión", undefined],
      ["error del servidor", json(500, { error: "interno" })],
    ])(
      "%s: dice que todavía no pudo borrar y no sigue",
      async (_caso, respuesta) => {
        simularApi((pedido) => {
          if (pedido.metodo === "GET") return json(200, catalogo());
          if (!respuesta) throw new TypeError("sin red");
          return respuesta;
        });
        await cargada();
        tocar("No autorizo");
        const aviso = await screen.findByRole("status");
        expect(aviso).toHaveTextContent(
          "Todavía no pudimos borrar tu correo. Intenta de nuevo.",
        );
        expect(aviso).toHaveFocus();
        expect(window.location.pathname).toBe("/");
      },
    );

    it("429: demasiados intentos", async () => {
      api(() => json(429, { error: "demasiados_intentos" }));
      await cargada();
      tocar("No autorizo");
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
      );
    });

    it("401 lleva a PN-60 («Tu sesión se cerró»)", async () => {
      api(() => json(401, { error: "sin_sesion" }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(window.history.state).toEqual({ llegada: "sesion_cerrada" });
    });

    it("403 ya_autorizada (otra pestaña autorizó): la cuenta sigue y va a PN-71", async () => {
      api(() => json(403, { error: "ya_autorizada" }));
      await cargada();
      tocar("No autorizo");
      await waitFor(() =>
        expect(window.location.pathname).toBe("/cuenta/seguridad"),
      );
    });
  });

  describe("el catálogo no carga o no se entiende", () => {
    const errorDeCarga = "No pudimos cargar la información.";

    it.each([
      ["500", () => json(500, { error: "interno" })],
      [
        "una finalidad que E14 no tiene",
        () => json(200, catalogo([finalidad("otra", "accesoria")])),
      ],
      [
        "un tipo desconocido",
        () => json(200, catalogo([finalidad("avisos", "rara")])),
      ],
      [
        "una accesoria de la que E14 no tiene casilla",
        () => json(200, catalogo([finalidad("cuenta_y_acceso", "accesoria")])),
      ],
      [
        "sin necesarias",
        () =>
          json(200, {
            version: { numero: "1.0", fecha: "2026-10-30" },
            finalidades: [finalidad("avisos", "accesoria")],
          }),
      ],
      ["una fecha que no es fecha", () => json(200, catalogo([], "mañana"))],
      ["sin versión", () => json(200, { finalidades: [] })],
      [
        "finalidades que no son una lista",
        () =>
          json(200, {
            version: { numero: "1.0", fecha: "2026-10-30" },
            finalidades: "x",
          }),
      ],
    ])("%s: error de carga, sin formulario", async (_caso, respuesta) => {
      simularApi(respuesta);
      render(<Autorizacion />);
      expect(await screen.findByText(errorDeCarga)).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Intentar de nuevo" }),
      ).toBeInTheDocument();
    });

    it("sin conexión dice T10", async () => {
      simularApi(() => {
        throw new TypeError("sin red");
      });
      render(<Autorizacion />);
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
    });

    it("«Intentar de nuevo» vuelve a pedir y muestra el formulario", async () => {
      let intento = 0;
      const pedidos = simularApi(() =>
        ++intento === 1
          ? json(500, { error: "interno" })
          : json(200, catalogo()),
      );
      render(<Autorizacion />);
      await screen.findByText(errorDeCarga);
      tocar("Intentar de nuevo");
      expect(
        await screen.findByRole("checkbox", { name: NECESARIAS }),
      ).not.toBeChecked();
      expect(pedidos).toHaveLength(2);
    });

    it.each([
      [401, { error: "sin_sesion" }, "/entrar"],
      [403, { error: "verificacion_pendiente" }, "/revisa-tu-correo"],
    ])("%i %j lleva a %s", async (estado, cuerpo, destino) => {
      simularApi(() => json(estado, cuerpo));
      render(<Autorizacion />);
      await waitFor(() => expect(window.location.pathname).toBe(destino));
    });
  });
});
