import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cambiarBorrador } from "../../src/borradorDeRegistro";
import { SeRepite } from "../../src/pantallas/SeRepite";
import { json, porTexto, simularApi } from "../ayudas";

// Hoy es el 26 de octubre de 2026 (el día de la prueba del dueño, S4). Las fechas las calcula el API (D-165): cada
// prueba simula lo que el endpoint de L6 contesta para su periodicidad y su fecha de inicio.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
});

const URL_DE_PROXIMAS = "/api/v1/repeticiones/proximas";
const opcion = (nombre: string) => screen.getByRole("radio", { name: nombre });
const fechas = () =>
  screen.queryAllByRole("listitem").map((f) => f.textContent);
const listo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Listo" }));

/** El API responde con estas fechas a cualquier pedido de próximas. */
const responderCon = (proximas: string[]) =>
  simularApi(() => json(200, { proximas }));

describe("PN-03 · Se repite (E14-PRR 4.3)", () => {
  it("trae la barra con Atrás al formulario, la explicación y las seis opciones en el orden de la tabla", () => {
    const pedidos = responderCon([]);
    render(<SeRepite />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Se repite" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/registrar",
    );
    expect(
      screen.getByText(
        "Lo registras una vez. En cada fecha te pedimos confirmarlo con un toque.",
      ),
    ).toBeInTheDocument();
    const grupo = screen.getByRole("group", { name: "Cada cuánto" });
    expect(
      within(grupo)
        .getAllByRole("radio")
        .map((c) => (c as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([
      "No se repite",
      "Cada semana",
      "Cada quincena",
      "Cada mes",
      "Cada semestre",
      "Cada año",
    ]);
    expect(
      screen.queryByRole("button", { name: "Dejar de repetir" }),
    ).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });

  it("sin repetir: «No se repite» elegido, su explicación, sin las filas 5 a 7 y sin llamar al API", () => {
    const pedidos = responderCon([]);
    render(<SeRepite />);
    expect(opcion("No se repite")).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Se cuenta solo en su fecha.",
    );
    expect(screen.queryByLabelText("Empieza el")).not.toBeInTheDocument();
    expect(screen.queryByText("Próximas fechas")).not.toBeInTheDocument();
    expect(screen.queryByText(/El monto es el mismo/)).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });

  it.each([
    ["Cada semana", "Cada 7 días, desde la fecha en que empieza."],
    [
      "Cada quincena",
      "Dos fechas al mes, separadas por 15 días. Si el mes es más corto, usamos su último día.",
    ],
    [
      "Cada mes",
      "El mismo día de cada mes. Si el mes es más corto, usamos su último día.",
    ],
    ["Cada semestre", "El mismo día, cada seis meses."],
    ["Cada año", "El mismo día y el mismo mes, cada año."],
  ])("«%s» explica «%s»", async (nombre, explicacion) => {
    responderCon(["2026-11-26"]);
    render(<SeRepite />);
    fireEvent.click(opcion(nombre));
    expect(screen.getByRole("status")).toHaveTextContent(explicacion);
    expect(screen.getByLabelText("Empieza el")).toHaveAttribute("readonly");
    expect(
      screen.getByText(
        "El monto es el mismo en cada fecha. Al confirmar una fecha puedes escribir otro monto, sin cambiar las demás.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
  });

  it("«Empieza el» es la fecha del formulario, en palabras, y esa fecha va al API con la periodicidad", async () => {
    cambiarBorrador({ fecha: "2026-10-01" });
    const pedidos = responderCon(["2026-11-16", "2026-12-01", "2026-12-16"]);
    render(<SeRepite />);
    fireEvent.click(opcion("Cada quincena"));
    expect(screen.getByLabelText("Empieza el")).toHaveValue(
      "1 de octubre de 2026",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Próximas fechas" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fechas()).toEqual([
        "16 de noviembre de 2026",
        "1 de diciembre de 2026",
        "16 de diciembre de 2026",
      ]),
    );
    expect(pedidos).toEqual([
      {
        metodo: "GET",
        ruta: `${URL_DE_PROXIMAS}?periodicidad=quincenal&inicio=2026-10-01`,
        cuerpo: undefined,
      },
    ]);
  });

  // S4 (D-164, D-165): el arriendo del 15 de agosto escrito el 26 de octubre; septiembre y octubre son historia.
  it("el arriendo del 15 de agosto, mensual, escrito el 26 de octubre: muestra lo que manda el API, el 15 de noviembre, el 15 de diciembre y el 15 de enero", async () => {
    cambiarBorrador({ fecha: "2026-08-15" });
    const pedidos = responderCon(["2026-11-15", "2026-12-15", "2027-01-15"]);
    render(<SeRepite />);
    fireEvent.click(opcion("Cada mes"));
    expect(screen.getByLabelText("Empieza el")).toHaveValue(
      "15 de agosto de 2026",
    );
    await waitFor(() =>
      expect(fechas()).toEqual([
        "15 de noviembre de 2026",
        "15 de diciembre de 2026",
        "15 de enero de 2027",
      ]),
    );
    expect(pedidos[0]?.ruta).toBe(
      `${URL_DE_PROXIMAS}?periodicidad=mensual&inicio=2026-08-15`,
    );
  });

  it("sin cambiar la fecha del formulario, «Empieza el» es hoy y se manda hoy", async () => {
    const pedidos = responderCon(["2026-11-26"]);
    render(<SeRepite />);
    fireEvent.click(opcion("Cada mes"));
    expect(screen.getByLabelText("Empieza el")).toHaveValue(
      "26 de octubre de 2026",
    );
    await screen.findByText(porTexto("26 de noviembre de 2026"));
    expect(pedidos[0]?.ruta).toBe(
      `${URL_DE_PROXIMAS}?periodicidad=mensual&inicio=2026-10-26`,
    );
  });

  it("muestra solo lo que recibe: sin fechas, «No hay fechas próximas.»", async () => {
    responderCon([]);
    render(<SeRepite />);
    fireEvent.click(opcion("Cada mes"));
    expect(await screen.findByText("No hay fechas próximas.")).toBeVisible();
  });

  it("mientras llegan las fechas la tarjeta está ocupada y no dice nada", async () => {
    let contestar: (r: Response) => void = () => undefined;
    simularApi(() => new Promise<Response>((r) => (contestar = r)));
    render(<SeRepite />);
    fireEvent.click(opcion("Cada mes"));
    const tarjeta = screen
      .getByRole("heading", { name: "Próximas fechas" })
      .closest("section");
    expect(tarjeta).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("No hay fechas próximas.")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    contestar(json(200, { proximas: ["2026-11-26"] }));
    await screen.findByText(porTexto("26 de noviembre de 2026"));
    expect(tarjeta).toHaveAttribute("aria-busy", "false");
  });

  it("al cambiar de periodicidad no deja las fechas de la elección anterior ni una respuesta tardía", async () => {
    const respuestas: Record<string, (r: Response) => void> = {};
    simularApi(
      (p) =>
        new Promise<Response>((r) => {
          respuestas[p.ruta.includes("semanal") ? "semanal" : "anual"] = r;
        }),
    );
    render(<SeRepite />);
    fireEvent.click(opcion("Cada semana"));
    fireEvent.click(opcion("Cada año"));
    respuestas.anual?.(json(200, { proximas: ["2027-10-26"] }));
    await screen.findByText(porTexto("26 de octubre de 2027"));
    respuestas.semanal?.(json(200, { proximas: ["2026-11-02"] }));
    await Promise.resolve();
    expect(fechas()).toEqual(["26 de octubre de 2027"]);
  });

  it("los números de las fechas van en Figtree", async () => {
    cambiarBorrador({ fecha: "2026-10-01" });
    responderCon(["2026-11-01"]);
    const { container } = render(<SeRepite />);
    fireEvent.click(opcion("Cada mes"));
    await screen.findByText(porTexto("1 de noviembre de 2026"));
    expect(container.querySelector(".lista-de-fechas .cifra")).not.toBeNull();
    expect(
      document.getElementById("empieza-el")?.closest(".campo__caja"),
    ).toHaveClass("campo__caja--cifra");
  });

  describe("cuando el API no contesta bien", () => {
    it("sin conexión: el aviso de siempre y «Intentar de nuevo» vuelve a pedir; «Listo» no se bloquea", async () => {
      let falla = true;
      const pedidos = simularApi(() => {
        if (falla) throw new Error("sin red");
        return json(200, { proximas: ["2026-11-26"] });
      });
      render(<SeRepite />);
      fireEvent.click(opcion("Cada mes"));
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.getByRole("button", { name: "Listo" })).not.toHaveAttribute(
        "aria-disabled",
      );
      falla = false;
      fireEvent.click(
        screen.getByRole("button", { name: "Intentar de nuevo" }),
      );
      await screen.findByText(porTexto("26 de noviembre de 2026"));
      expect(
        screen.queryByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeNull();
      expect(pedidos).toHaveLength(2);
    });

    it("un error del servidor da «No pudimos cargar la información.» y «Listo» sigue sirviendo", async () => {
      simularApi(() => json(500, { error: "interno" }));
      render(<SeRepite />);
      fireEvent.click(opcion("Cada mes"));
      expect(
        await screen.findByText("No pudimos cargar la información."),
      ).toBeInTheDocument();
      listo();
      expect(window.location.pathname).toBe("/registrar");
    });

    it("un 422 del endpoint y una respuesta que no son fechas dan el mismo aviso", async () => {
      simularApi(() =>
        json(422, {
          error: "datos_invalidos",
          campos: { inicio: "fecha_invalida" },
        }),
      );
      const { unmount } = render(<SeRepite />);
      fireEvent.click(opcion("Cada mes"));
      expect(
        await screen.findByText("No pudimos cargar la información."),
      ).toBeInTheDocument();
      unmount();
      simularApi(() => json(200, { proximas: ["no es una fecha"] }));
      render(<SeRepite />);
      fireEvent.click(opcion("Cada mes"));
      expect(
        await screen.findByText("No pudimos cargar la información."),
      ).toBeInTheDocument();
    });

    it("sin sesión (401) va a PN-60", async () => {
      simularApi(() => json(401, { error: "no_autenticado" }));
      render(<SeRepite />);
      fireEvent.click(opcion("Cada mes"));
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    });
  });

  describe("«Listo»", () => {
    it("vuelve al formulario con la periodicidad en el borrador", () => {
      responderCon([]);
      render(<SeRepite />);
      fireEvent.click(opcion("Cada mes"));
      listo();
      expect(window.location.pathname).toBe("/registrar");
    });

    it("con «No se repite» vuelve sin repetición, también si había una", () => {
      responderCon([]);
      cambiarBorrador({ periodicidad: "anual" });
      render(<SeRepite />);
      expect(opcion("Cada año")).toBeChecked();
      fireEvent.click(opcion("No se repite"));
      listo();
      expect(window.location.pathname).toBe("/registrar");
    });

    it("sin fecha de inicio: no llama al API, «Falta la fecha en que empieza.» con el foco en el campo, y no vuelve", () => {
      cambiarBorrador({ fecha: "" });
      const pedidos = responderCon([]);
      render(<SeRepite />);
      fireEvent.click(opcion("Cada mes"));
      expect(screen.getByLabelText("Empieza el")).toHaveValue("");
      listo();
      expect(
        screen.getByText(porTexto("Falta la fecha en que empieza.")),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Empieza el")).toHaveFocus();
      expect(window.location.pathname).toBe("/");
      fireEvent.click(opcion("Cada año"));
      expect(
        screen.queryByText("Falta la fecha en que empieza."),
      ).not.toBeInTheDocument();
      expect(pedidos).toEqual([]);
    });

    it("sin repetir no pide la fecha", () => {
      cambiarBorrador({ fecha: "" });
      render(<SeRepite />);
      listo();
      expect(window.location.pathname).toBe("/registrar");
    });
  });
});
