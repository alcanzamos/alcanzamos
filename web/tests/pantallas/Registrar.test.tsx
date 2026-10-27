import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cambiarBorrador } from "../../src/borradorDeRegistro";
import { avisoDeLlegada } from "../../src/llegada";
import { Registrar } from "../../src/pantallas/Registrar";
import { json, porTexto, simularApi, type Pedido } from "../ayudas";

// El API manda `id` y `nombre`; el texto de la pantalla sale de es.json por `id` (el 99 no tiene texto de E14).
const catalogo = {
  gasto: [
    { id: 1, nombre: "x", general: false },
    { id: 4, nombre: "x", general: false },
    { id: 99, nombre: "Sin texto", general: false },
    { id: 16, nombre: "x", general: true },
    { id: 26, nombre: "x", general: false },
  ],
  ingreso: [
    { id: 17, nombre: "x", general: false },
    { id: 25, nombre: "x", general: true },
  ],
};
const creado = {
  movimiento_id: "m1",
  recurrente_id: null,
  proximas: [],
  pendientes: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
});

function api(guardar: (p: Pedido) => Response = () => json(201, creado)) {
  return simularApi((p) =>
    p.metodo === "GET" ? json(200, catalogo) : guardar(p),
  );
}
const guardados = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.metodo === "POST");

async function abrir() {
  render(<Registrar />);
  await screen.findByLabelText("Monto");
}
const escribirMonto = (valor: string) =>
  fireEvent.change(screen.getByLabelText("Monto"), {
    target: { value: valor },
  });
const elegir = (nombre: string) =>
  fireEvent.click(screen.getByRole("radio", { name: nombre }));
const guardar = () =>
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
const chips = (grupo: string) =>
  within(screen.getByRole("group", { name: grupo }))
    .getAllByRole("radio")
    .map((c) => (c as HTMLInputElement).labels?.[0]?.textContent);

describe("PN-01 · Formulario de registro (E14-PPN 3.1, D-164)", () => {
  it("trae los campos de D-164 en su orden, con «Gasto», «Hoy» y «Solo mío» elegidos", async () => {
    api();
    await abrir();
    expect(
      screen.getByRole("heading", { level: 1, name: "Registrar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/movimientos",
    );
    const etiquetas = [
      ...document.querySelectorAll("legend, label.campo__etiqueta"),
    ].map((n) => n.textContent);
    expect(etiquetas).toEqual([
      "Tipo",
      "Monto",
      "Fecha",
      "Categoría",
      "Medio de pago",
      "De quién es",
      "Descripción (opcional)",
    ]);
    expect(screen.getByRole("radio", { name: "Gasto" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Solo mío" })).toBeChecked();
    expect(screen.getByText("Hoy")).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-10-26");
    expect(
      screen.getByText(
        "No escribas datos de salud, religión ni de otras personas.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No se repite")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cambiar" })).toHaveAttribute(
      "href",
      "/registrar/se-repite",
    );
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveClass(
      "boton--primario",
    );
  });

  it("no dibuja las filas omitidas por D-164", async () => {
    api();
    await abrir();
    for (const omitido of [
      /Tarjeta/,
      /Cuotas/,
      /Compartido/,
      /Llenar el formulario/,
      /Escribe el gasto/,
      /Prima, cesantías/,
      /Elegir cuáles ver/,
      /faltan/,
    ]) {
      expect(screen.queryByText(omitido)).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText("Descripción (opcional)")).toHaveAttribute(
      "maxlength",
      "280",
    );
  });

  it("el medio de pago es solo «Efectivo» y «Transferencia», con gasto y con ingreso", async () => {
    api();
    await abrir();
    expect(chips("Medio de pago")).toEqual(["Efectivo", "Transferencia"]);
    elegir("Ingreso");
    expect(chips("Medio de pago")).toEqual(["Efectivo", "Transferencia"]);
    expect(
      screen.queryByRole("radio", { name: "Tarjeta" }),
    ).not.toBeInTheDocument();
  });

  it("las categorías salen del API por id, con el texto de E14, y cambian con el tipo", async () => {
    api();
    await abrir();
    expect(chips("Categoría")).toEqual([
      "Alimentación",
      "Arriendo o cuota de vivienda",
      "Otros gastos",
      "Ayuda a la familia",
    ]);
    // Sin motor de reglas no hay categoría sugerida (D-165): ninguna llega elegida.
    for (const chip of within(
      screen.getByRole("group", { name: "Categoría" }),
    ).getAllByRole("radio"))
      expect(chip).not.toBeChecked();
    elegir("Ingreso");
    expect(chips("Categoría")).toEqual(["Salario", "Otros ingresos"]);
    for (const chip of within(
      screen.getByRole("group", { name: "Categoría" }),
    ).getAllByRole("radio"))
      expect(chip).not.toBeChecked();
  });

  it("«Ver todas» abre la lista, elegir una la selecciona y la cierra", async () => {
    api();
    await abrir();
    const ver = screen.getByRole("button", { name: "Ver todas" });
    expect(ver).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(ver);
    expect(ver).toHaveAttribute("aria-expanded", "true");
    const lista = screen.getByRole("list");
    expect(within(lista).getAllByRole("button")).toHaveLength(4);
    expect(
      within(lista).getByRole("button", { name: "Otros gastos" }),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(
      within(lista).getByRole("button", { name: "Ayuda a la familia" }),
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Ayuda a la familia" }),
    ).toBeChecked();
    fireEvent.click(ver);
    fireEvent.click(ver);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("muestra la fecha en palabras, y «Hoy» si es hoy", async () => {
    api();
    await abrir();
    fireEvent.change(screen.getByLabelText("Fecha"), {
      target: { value: "2026-12-20" },
    });
    expect(
      screen.getByText(porTexto("20 de diciembre de 2026")),
    ).toBeInTheDocument();
    expect(screen.queryByText("Hoy")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Fecha"), {
      target: { value: "2026-10-26" },
    });
    expect(screen.getByText("Hoy")).toBeInTheDocument();
  });

  it("el monto se muestra con la regla de 5.5 al salir del campo", async () => {
    api();
    await abrir();
    escribirMonto("123456,78");
    fireEvent.blur(screen.getByLabelText("Monto"));
    expect(screen.getByLabelText("Monto")).toHaveValue("$123.456,78");
    escribirMonto("12.5");
    fireEvent.blur(screen.getByLabelText("Monto"));
    expect(screen.getByLabelText("Monto")).toHaveValue("12.5");
  });

  describe("validación antes de enviar", () => {
    it("muestra todos los errores a la vez, enfoca el primero y no llama al API", async () => {
      const pedidos = api();
      await abrir();
      fireEvent.change(screen.getByLabelText("Fecha"), {
        target: { value: "" },
      });
      guardar();
      expect(await screen.findByText("Falta el monto.")).toBeInTheDocument();
      expect(screen.getByText("Falta la fecha.")).toBeInTheDocument();
      expect(
        screen.getByText("Falta elegir la categoría."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Falta elegir el medio de pago."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Monto")).toHaveFocus();
      expect(screen.getByLabelText("Monto")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("sin categoría: «Falta elegir la categoría.», con el foco en ella, sin llamar al API (D-165)", async () => {
      const pedidos = api();
      await abrir();
      escribirMonto("45.000");
      elegir("Efectivo");
      guardar();
      expect(
        await screen.findByText("Falta elegir la categoría."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ver todas" })).toHaveFocus();
      expect(guardados(pedidos)).toHaveLength(0);
      elegir("Otros gastos");
      guardar();
      await waitFor(() => expect(guardados(pedidos)).toHaveLength(1));
    });

    it("la categoría de un tipo no vale para el otro: al cambiar de tipo vuelve a faltar", async () => {
      const pedidos = api();
      await abrir();
      elegir("Otros gastos");
      elegir("Ingreso");
      escribirMonto("45.000");
      elegir("Efectivo");
      guardar();
      expect(
        await screen.findByText("Falta elegir la categoría."),
      ).toBeInTheDocument();
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("el foco va al medio de pago si es lo único que falta", async () => {
      api();
      await abrir();
      escribirMonto("45.000");
      elegir("Otros gastos");
      guardar();
      await screen.findByText("Falta elegir el medio de pago.");
      expect(screen.getByRole("radio", { name: "Efectivo" })).toHaveFocus();
    });

    it.each([
      ["12,345", "El monto puede tener hasta dos decimales."],
      ["12.5", "¿Quisiste decir $12.500 o $12,50?"],
      ["0", "El monto debe ser mayor que $0."],
      ["mucho", "Escribe el monto con números, por ejemplo $45.000."],
      [
        "92.233.720.368.547.758,08",
        "El monto es demasiado grande. Revisa que no sobren ceros.",
      ],
    ])("monto «%s»: %s", async (monto, error) => {
      api();
      await abrir();
      elegir("Efectivo");
      escribirMonto(monto);
      guardar();
      expect(await screen.findByText(porTexto(error))).toBeInTheDocument();
    });
  });

  describe("guardar", () => {
    it("un gasto en efectivo: manda centavos enteros y vuelve a PN-01 con «Listo, registramos tu gasto de $45.000.»", async () => {
      const pedidos = api();
      await abrir();
      escribirMonto("45.000");
      elegir("Otros gastos");
      elegir("Efectivo");
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      expect(guardados(pedidos)).toEqual([
        {
          metodo: "POST",
          ruta: "/api/v1/movimientos",
          cuerpo: {
            monto_centavos: 4500000,
            tipo: "gasto",
            fecha: "2026-10-26",
            categoria_id: 16,
            medio: "efectivo",
          },
        },
      ]);
      expect(avisoDeLlegada()).toEqual({
        tipo: "informacion",
        titulo: "Listo, registramos tu gasto de $45.000.",
      });
    });

    it("con centavos: «Listo, registramos tu gasto de $123.456,78.» y la descripción", async () => {
      const pedidos = api();
      await abrir();
      escribirMonto("123.456,78");
      elegir("Transferencia");
      elegir("Alimentación");
      fireEvent.change(screen.getByLabelText("Descripción (opcional)"), {
        target: { value: "Mercado" },
      });
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      expect(guardados(pedidos)[0]?.cuerpo).toMatchObject({
        monto_centavos: 12345678,
        medio: "transferencia",
        categoria_id: 1,
        descripcion: "Mercado",
      });
      expect(avisoDeLlegada()?.titulo).toBe(
        "Listo, registramos tu gasto de $123.456,78.",
      );
    });

    it("un ingreso: usa las categorías de ingreso y su aviso de E14-PPN 1.11", async () => {
      const pedidos = api();
      await abrir();
      elegir("Ingreso");
      escribirMonto("1.200.000");
      elegir("Transferencia");
      elegir("Salario");
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      expect(guardados(pedidos)[0]?.cuerpo).toMatchObject({
        tipo: "ingreso",
        categoria_id: 17,
        monto_centavos: 120000000,
      });
      expect(avisoDeLlegada()?.titulo).toBe(
        "Listo, registramos tu ingreso de $1.200.000.",
      );
    });

    // L3: el gasto de Navidad del 20 de diciembre, registrado el 2 de noviembre, se guarda con su fecha.
    it("una fecha futura sin repetición se acepta y se manda con su fecha", async () => {
      const pedidos = api();
      await abrir();
      fireEvent.change(screen.getByLabelText("Fecha"), {
        target: { value: "2026-12-20" },
      });
      escribirMonto("150.000");
      elegir("Otros gastos");
      elegir("Efectivo");
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      expect(guardados(pedidos)[0]?.cuerpo).toMatchObject({
        fecha: "2026-12-20",
      });
      expect(guardados(pedidos)[0]?.cuerpo).not.toHaveProperty("repeticion");
      expect(avisoDeLlegada()?.titulo).toBe(
        "Listo, registramos tu gasto de $150.000.",
      );
    });

    it("el borrador se borra al guardar: el formulario siguiente sale vacío", async () => {
      api();
      await abrir();
      escribirMonto("45.000");
      elegir("Otros gastos");
      elegir("Efectivo");
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      document.body.innerHTML = "";
      render(<Registrar />);
      await screen.findByRole("radio", { name: "Alimentación" });
      expect(screen.getByLabelText("Monto")).toHaveValue("");
      expect(screen.getByRole("radio", { name: "Efectivo" })).not.toBeChecked();
    });

    it("no manda dos veces si se toca otra vez mientras guarda", async () => {
      let salir: (r: Response) => void = () => undefined;
      const pedidos = simularApi((p) =>
        p.metodo === "GET"
          ? json(200, catalogo)
          : new Promise<Response>((r) => (salir = r)),
      );
      await abrir();
      escribirMonto("45.000");
      elegir("Otros gastos");
      elegir("Efectivo");
      guardar();
      await waitFor(() => expect(guardados(pedidos)).toHaveLength(1));
      guardar();
      expect(guardados(pedidos)).toHaveLength(1);
      salir(json(201, creado));
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
    });
  });

  describe("«Se repite»", () => {
    it("con una periodicidad la fila dice «Se repite: Cada mes» y se manda la repetición", async () => {
      const pedidos = api();
      cambiarBorrador({
        periodicidad: "mensual",
        fecha: "2026-08-15",
        monto: "650.000",
        categoriaId: 4,
        medio: "transferencia",
      });
      await abrir();
      expect(screen.getByText("Se repite: Cada mes")).toBeInTheDocument();
      expect(screen.queryByText("No se repite")).not.toBeInTheDocument();
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      expect(guardados(pedidos)[0]?.cuerpo).toMatchObject({
        fecha: "2026-08-15",
        repeticion: { periodicidad: "mensual" },
      });
      expect(avisoDeLlegada()?.titulo).toBe(
        "Listo, registramos tu gasto de $650.000.",
      );
    });

    it("con una fecha futura solo se guarda la repetición: «queda por confirmar el {fecha}» y no «registramos»", async () => {
      api(() =>
        json(201, {
          movimiento_id: null,
          recurrente_id: "r1",
          proximas: ["2026-12-20"],
          pendientes: [],
        }),
      );
      cambiarBorrador({
        periodicidad: "semestral",
        fecha: "2026-12-20",
        monto: "1.200.000",
        categoriaId: 17,
        medio: "transferencia",
        tipo: "ingreso",
      });
      await abrir();
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      expect(avisoDeLlegada()?.titulo).toBe(
        "Listo. Tu ingreso de $1.200.000 queda por confirmar el 20 de diciembre de 2026.",
      );
    });

    it("con un gasto futuro que se repite dice «Listo. Tu gasto de… queda por confirmar el…»", async () => {
      api(() => json(201, { ...creado, movimiento_id: null }));
      cambiarBorrador({
        periodicidad: "mensual",
        fecha: "2026-11-01",
        monto: "90.000",
        categoriaId: 1,
        medio: "efectivo",
      });
      await abrir();
      guardar();
      await waitFor(() =>
        expect(window.location.pathname).toBe("/movimientos"),
      );
      expect(avisoDeLlegada()?.titulo).toBe(
        "Listo. Tu gasto de $90.000 queda por confirmar el 1 de noviembre de 2026.",
      );
    });

    it("«Cambiar» lleva a PN-03 sin perder lo escrito", async () => {
      api();
      await abrir();
      escribirMonto("45.000");
      fireEvent.click(screen.getByRole("link", { name: "Cambiar" }));
      expect(window.location.pathname).toBe("/registrar/se-repite");
    });
  });

  describe("fallos del API", () => {
    async function llenarYGuardar() {
      await abrir();
      escribirMonto("45.000");
      elegir("Otros gastos");
      elegir("Efectivo");
      guardar();
    }

    it.each([
      [{ tipo: "tipo_requerido" }, "Falta elegir si es un gasto o un ingreso."],
      [{ monto_centavos: "monto_requerido" }, "Falta el monto."],
      [
        { monto_centavos: "monto_no_positivo" },
        "El monto debe ser mayor que $0.",
      ],
      [
        { monto_centavos: "monto_invalido" },
        "Escribe el monto con números, por ejemplo $45.000.",
      ],
      [{ categoria_id: "categoria_requerida" }, "Falta elegir la categoría."],
      [{ fecha: "fecha_requerida" }, "Falta la fecha."],
      [{ fecha: "fecha_invalida" }, "Falta la fecha."],
      [{ medio: "medio_requerido" }, "Falta elegir el medio de pago."],
      [
        { repeticion: "periodicidad_requerida" },
        "Falta elegir cada cuánto se repite.",
      ],
    ])("un 422 %o muestra «%s» en su campo", async (campos, texto) => {
      api(() => json(422, { error: "datos_invalidos", campos }));
      await llenarYGuardar();
      expect(await screen.findByText(porTexto(texto))).toBeInTheDocument();
      expect(window.location.pathname).toBe("/");
      expect(
        screen.queryByText("No pudimos guardar tu gasto."),
      ).not.toBeInTheDocument();
    });

    it("un 422 con varios campos los muestra todos y enfoca el primero de la pantalla", async () => {
      api(() =>
        json(422, {
          error: "datos_invalidos",
          campos: {
            medio: "medio_requerido",
            monto_centavos: "monto_requerido",
          },
        }),
      );
      await llenarYGuardar();
      expect(await screen.findByText("Falta el monto.")).toBeInTheDocument();
      expect(
        screen.getByText("Falta elegir el medio de pago."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Monto")).toHaveFocus();
    });

    it("el error de la repetición sale junto a la fila «Se repite» y enfoca «Cambiar»", async () => {
      api(() =>
        json(422, {
          error: "datos_invalidos",
          campos: { repeticion: "periodicidad_requerida" },
        }),
      );
      await llenarYGuardar();
      await screen.findByText("Falta elegir cada cuánto se repite.");
      expect(screen.getByRole("link", { name: "Cambiar" })).toHaveFocus();
    });

    it.each([
      [{ categoria_id: "categoria_invalida" }],
      [{ descripcion: "descripcion_larga" }],
      [{ tipo: "tipo_invalido" }],
      [{ medio: "medio_requerido", categoria_id: "categoria_invalida" }],
    ])(
      "un 422 con un código sin texto de E14 (%o) da el aviso de error al guardar",
      async (campos) => {
        api(() => json(422, { error: "datos_invalidos", campos }));
        await llenarYGuardar();
        expect(
          await screen.findByText("No pudimos guardar tu gasto."),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Lo que escribiste sigue ahí. Intenta de nuevo."),
        ).toBeInTheDocument();
      },
    );

    it("un 422 sin campos también da el aviso", async () => {
      api(() => json(422, { error: "datos_invalidos" }));
      await llenarYGuardar();
      expect(
        await screen.findByText("No pudimos guardar tu gasto."),
      ).toBeInTheDocument();
    });

    it("un 500 con un ingreso dice «No pudimos guardar tu ingreso.», enfoca el aviso y deja «Intentar de nuevo»", async () => {
      const pedidos = api(() => json(500, { error: "error_interno" }));
      await abrir();
      elegir("Ingreso");
      escribirMonto("45.000");
      elegir("Otros ingresos");
      elegir("Efectivo");
      guardar();
      expect(
        await screen.findByText("No pudimos guardar tu ingreso."),
      ).toBeInTheDocument();
      expect(document.getElementById("aviso")).toHaveFocus();
      expect(screen.getByLabelText("Monto")).toHaveValue("45.000");
      fireEvent.click(
        screen.getByRole("button", { name: "Intentar de nuevo" }),
      );
      await waitFor(() => expect(guardados(pedidos)).toHaveLength(2));
    });

    it("un 500 con un gasto dice «No pudimos guardar tu gasto.»", async () => {
      api(() => json(500, { error: "error_interno" }));
      await llenarYGuardar();
      expect(
        await screen.findByText("No pudimos guardar tu gasto."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Lo que escribiste sigue ahí. Intenta de nuevo."),
      ).toBeInTheDocument();
    });

    it("sin conexión dice el aviso de siempre", async () => {
      simularApi((p) => {
        if (p.metodo === "GET") return json(200, catalogo);
        throw new Error("sin red");
      });
      await llenarYGuardar();
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
    });

    it("demasiados intentos (429) dice el aviso de siempre", async () => {
      api(() => json(429, { error: "demasiados_intentos" }));
      await llenarYGuardar();
      expect(
        await screen.findByText(
          "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
        ),
      ).toBeInTheDocument();
    });

    it("un 401 al guardar lleva a PN-60 con «Tu sesión se cerró»", async () => {
      api(() => json(401, { error: "no_autenticado" }));
      await llenarYGuardar();
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
      expect(avisoDeLlegada()?.titulo).toMatch(/sesión se cerró/);
    });

    it("un 403 sin autorización lleva a PN-63", async () => {
      api(() => json(403, { error: "autorizacion_pendiente" }));
      await llenarYGuardar();
      await waitFor(() => expect(window.location.pathname).toBe("/privacidad"));
    });
  });

  describe("las categorías", () => {
    it("un 401 al pedirlas lleva a PN-60", async () => {
      simularApi(() => json(401, { error: "no_autenticado" }));
      render(<Registrar />);
      await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
    });

    it("un fallo muestra el error de carga y «Intentar de nuevo» las pide otra vez", async () => {
      let n = 0;
      const pedidos = simularApi(() =>
        ++n === 1 ? json(500, { error: "error_interno" }) : json(200, catalogo),
      );
      render(<Registrar />);
      expect(
        await screen.findByText("No pudimos cargar la información."),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Monto")).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Intentar de nuevo" }),
      );
      expect(
        await screen.findByRole("radio", { name: "Alimentación" }),
      ).toBeInTheDocument();
      expect(pedidos).toHaveLength(2);
    });

    it("sin conexión lo dice", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("sin red"))),
      );
      render(<Registrar />);
      expect(
        await screen.findByText(
          "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
        ),
      ).toBeInTheDocument();
    });

    it("mientras cargan, solo la barra y el título", () => {
      simularApi(() => new Promise<Response>(() => undefined));
      render(<Registrar />);
      expect(
        screen.getByRole("heading", { level: 1, name: "Registrar" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Monto")).not.toBeInTheDocument();
    });
  });

  it("los números van en Figtree: el monto y la fecha usan la clase de cifras", async () => {
    api();
    await abrir();
    for (const id of ["monto", "fecha"])
      expect(document.getElementById(id)?.closest(".campo__caja")).toHaveClass(
        "campo__caja--cifra",
      );
  });
});
