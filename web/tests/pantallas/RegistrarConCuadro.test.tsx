import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cambiarBorrador,
  reiniciarBorrador,
} from "../../src/borradorDeRegistro";
import { avisoDeLlegada } from "../../src/llegada";
import {
  FormularioDeMovimiento,
  Registrar,
} from "../../src/pantallas/Registrar";
import { json, porTexto, simularApi, type Pedido } from "../ayudas";

// E14-PPN 3.1 filas 3 a 5, el paso «Revisa y confirma» y sus estados (US-62, RN-001, D-084, D-077).
const catalogo = {
  gasto: [
    { id: 1, nombre: "x", general: false },
    { id: 16, nombre: "x", general: true },
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
const propuesta = {
  resultado: "propuesta",
  tipo: "gasto",
  monto_centavos: 4500000,
  categoria: { id: 1, nombre: "Alimentación" },
  fecha: "2026-10-25",
  varios_movimientos: false,
};

beforeEach(() => {
  reiniciarBorrador();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
});

type Respuestas = {
  interpretar?: (p: Pedido) => Response;
  guardar?: (p: Pedido) => Response;
};
function api({ interpretar, guardar }: Respuestas = {}) {
  return simularApi((p) => {
    if (p.metodo === "GET") return json(200, catalogo);
    if (p.ruta === "/api/v1/movimientos/interpretacion")
      return (interpretar ?? (() => json(200, propuesta)))(p);
    return (guardar ?? (() => json(201, creado)))(p);
  });
}
const interpretaciones = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.ruta === "/api/v1/movimientos/interpretacion");
const guardados = (pedidos: Pedido[]) =>
  pedidos.filter(
    (p) => p.metodo === "POST" && p.ruta === "/api/v1/movimientos",
  );

async function abrir() {
  render(<Registrar />);
  await screen.findByLabelText("Monto");
}
const escribir = (texto: string) =>
  fireEvent.change(screen.getByLabelText("Escribe el gasto o el ingreso"), {
    target: { value: texto },
  });
const llenar = () =>
  fireEvent.click(screen.getByRole("button", { name: "Llenar el formulario" }));
const revisar = () =>
  fireEvent.click(screen.getByRole("button", { name: "Revisar y guardar" }));
const elegir = (nombre: string) =>
  fireEvent.click(screen.getByRole("radio", { name: nombre }));

/** Escribe, interpreta y espera el aviso de «Llenamos el formulario…». */
async function interpretarYLlenar(texto = "mercado 45 mil ayer") {
  await abrir();
  escribir(texto);
  llenar();
  await screen.findByText(
    "Llenamos el formulario con tu texto. Cambia lo que quieras.",
  );
}
async function irAlPaso() {
  await interpretarYLlenar();
  elegir("Efectivo");
  revisar();
  await screen.findByRole("heading", { name: "Revisa y confirma" });
}

describe("El cuadro de lenguaje natural (E14-PPN 3.1, filas 3 a 5)", () => {
  it("trae la etiqueta, la ayuda, la advertencia de NM-12 y «Llenar el formulario», antes del formulario", async () => {
    api();
    await abrir();
    const cuadro = screen.getByLabelText("Escribe el gasto o el ingreso");
    expect(cuadro.tagName).toBe("TEXTAREA");
    // La ayuda pide un movimiento a la vez, antes del ejemplo (D-196, paso 1); el «45» va en cifras (D-123).
    expect(cuadro).toHaveAccessibleDescription(
      "Un movimiento a la vez. Por ejemplo: mercado 45 mil ayer.",
    );
    expect(document.querySelector("#cuadro-ayuda .cifra")).toHaveTextContent(
      /^45$/,
    );
    expect(cuadro).toHaveAttribute("maxlength", "280");
    expect(
      screen.getAllByText(
        "No escribas datos de salud, religión ni de otras personas.",
      ),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Llenar el formulario" }),
    ).toHaveClass("boton--secundario");
    expect(
      cuadro.compareDocumentPosition(screen.getByLabelText("Monto")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sin texto el botón de guardar sigue diciendo «Guardar» y es el primario (RF-002)", async () => {
    api();
    await abrir();
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveClass(
      "boton--primario",
    );
    expect(
      screen.queryByRole("button", { name: "Revisar y guardar" }),
    ).not.toBeInTheDocument();
  });

  it("con texto escrito «Llenar el formulario» pasa a primario y «Guardar» a secundario: un solo primario", async () => {
    api();
    await abrir();
    escribir("mercado 45 mil ayer");
    expect(
      screen.getByRole("button", { name: "Llenar el formulario" }),
    ).toHaveClass("boton--primario");
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveClass(
      "boton--secundario",
    );
  });

  it("llenar a mano y guardar sigue guardando directo, sin interpretar y sin «Revisa y confirma» (RF-002)", async () => {
    const pedidos = api();
    await abrir();
    fireEvent.change(screen.getByLabelText("Monto"), {
      target: { value: "45.000" },
    });
    elegir("Alimentación");
    elegir("Efectivo");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(guardados(pedidos)).toHaveLength(1));
    expect(interpretaciones(pedidos)).toHaveLength(0);
    expect(
      screen.queryByRole("heading", { name: "Revisa y confirma" }),
    ).not.toBeInTheDocument();
    expect(avisoDeLlegada()?.titulo).toBe(
      "Listo, registramos tu gasto de $45.000.",
    );
  });

  it("«Corregir» de PN-02 no lleva el cuadro ni el paso (US-62 no cambia PN-02)", async () => {
    simularApi(() => json(200, catalogo));
    render(
      <FormularioDeMovimiento
        corregir={{
          movimiento: {
            id: "m1",
            tipo: "gasto",
            monto_centavos: "4500000",
            fecha: "2026-10-25",
            categoria_id: 1,
            medio: "efectivo",
            descripcion: null,
            compartido: false,
            meta: null,
            sentido: null,
            recurrente: null,
          },
          alTerminar: () => undefined,
          alCancelar: () => undefined,
        }}
      />,
    );
    await screen.findByLabelText("Monto");
    expect(
      screen.queryByLabelText("Escribe el gasto o el ingreso"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Llenar el formulario" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar los cambios" }),
    ).toBeInTheDocument();
  });
});

describe("«Llenar el formulario»: una propuesta (CU-03, RN-001)", () => {
  it("manda el texto al API, llena el formulario con la propuesta, avisa y no guarda nada", async () => {
    const pedidos = api();
    await interpretarYLlenar();
    expect(interpretaciones(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/movimientos/interpretacion",
        cuerpo: { texto: "mercado 45 mil ayer" },
      },
    ]);
    expect(screen.getByRole("radio", { name: "Gasto" })).toBeChecked();
    expect(screen.getByLabelText("Monto")).toHaveValue("$45.000");
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-10-25");
    expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
    // El aviso es un mensaje de estado, con el foco, y el texto del cuadro sigue ahí.
    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent(
      "Llenamos el formulario con tu texto. Cambia lo que quieras.",
    );
    expect(aviso).toHaveFocus();
    expect(screen.getByLabelText("Escribe el gasto o el ingreso")).toHaveValue(
      "mercado 45 mil ayer",
    );
    expect(guardados(pedidos)).toHaveLength(0);
  });

  it("el aviso va encima del formulario, antes de «Tipo»", async () => {
    api();
    await interpretarYLlenar();
    const aviso = screen.getByRole("status");
    expect(
      aviso.compareDocumentPosition(
        screen.getByRole("group", { name: "Tipo" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("con una propuesta el botón dice «Revisar y guardar» y es el primario", async () => {
    api();
    await interpretarYLlenar();
    expect(
      screen.getByRole("button", { name: "Revisar y guardar" }),
    ).toHaveClass("boton--primario");
    expect(
      screen.getByRole("button", { name: "Llenar el formulario" }),
    ).toHaveClass("boton--secundario");
    expect(
      screen.queryByRole("button", { name: "Guardar" }),
    ).not.toBeInTheDocument();
  });

  it("un ingreso propuesto elige «Ingreso» y sus categorías; sin categoría propuesta ninguna llega elegida (RN-011)", async () => {
    api({
      interpretar: () =>
        json(200, { ...propuesta, tipo: "ingreso", categoria: null }),
    });
    await interpretarYLlenar("me pagaron 2 millones");
    expect(screen.getByRole("radio", { name: "Ingreso" })).toBeChecked();
    for (const chip of within(
      screen.getByRole("group", { name: "Categoría" }),
    ).getAllByRole("radio"))
      expect(chip).not.toBeChecked();
  });

  it("con el cuadro la categoría llega sugerida y la persona la cambia; se guarda la que dejó (D-193)", async () => {
    const pedidos = api();
    await interpretarYLlenar();
    elegir("Efectivo");
    expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
    elegir("Otros gastos");
    expect(
      screen.getByRole("radio", { name: "Alimentación" }),
    ).not.toBeChecked();
    revisar();
    await screen.findByRole("heading", { name: "Revisa y confirma" });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    );
    await waitFor(() => expect(guardados(pedidos)).toHaveLength(1));
    expect(guardados(pedidos)[0]?.cuerpo).toMatchObject({ categoria_id: 16 });
  });

  it("con el cuadro pero sin categoría sugerida la categoría sigue siendo obligatoria: «Falta elegir la categoría.» y no pasa al paso (D-193)", async () => {
    const pedidos = api({
      interpretar: () => json(200, { ...propuesta, categoria: null }),
    });
    await interpretarYLlenar();
    elegir("Efectivo");
    revisar();
    expect(
      await screen.findByText("Falta elegir la categoría."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Revisa y confirma" }),
    ).not.toBeInTheDocument();
    expect(guardados(pedidos)).toHaveLength(0);
  });

  it("no toca el medio de pago ni la descripción: el motor no los propone", async () => {
    api();
    await interpretarYLlenar();
    expect(screen.getByRole("radio", { name: "Efectivo" })).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Transferencia" }),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Descripción (opcional)")).toHaveValue("");
  });
});

describe("El paso «Revisa y confirma» (RF-004, RN-001, D-084)", () => {
  it("«Revisar y guardar» revisa el formulario antes: sin medio de pago muestra el error y no pasa ni guarda", async () => {
    const pedidos = api();
    await interpretarYLlenar();
    revisar();
    expect(
      await screen.findByText("Falta elegir el medio de pago."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Revisa y confirma" }),
    ).not.toBeInTheDocument();
    expect(guardados(pedidos)).toHaveLength(0);
  });

  it("muestra el título con el foco y las seis filas, cada una con «Cambiar», y todavía no guarda (RN-001)", async () => {
    const pedidos = api();
    await irAlPaso();
    const titulo = screen.getByRole("heading", { name: "Revisa y confirma" });
    expect(titulo.tagName).toBe("H2");
    expect(titulo).toHaveFocus();
    const filas = within(screen.getByRole("main")).getAllByRole("listitem");
    expect(filas.map((f) => f.textContent?.replace(/Cambiar$/, ""))).toEqual([
      "TipoGasto",
      "Monto$45.000",
      "CategoríaAlimentación",
      "FechaAyer",
      "Medio de pagoEfectivo",
      "De quién esSolo mío",
    ]);
    expect(screen.getAllByRole("button", { name: "Cambiar" })).toHaveLength(6);
    expect(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    ).toHaveClass("boton--primario");
    expect(
      screen.getByRole("button", { name: "Volver al formulario" }),
    ).toHaveClass("boton--secundario");
    // El formulario sale; el cuadro se queda.
    expect(screen.queryByLabelText("Monto")).not.toBeInTheDocument();
    expect(guardados(pedidos)).toHaveLength(0);
  });

  it("enviar el formulario con Enter no guarda: lleva al paso (RN-001)", async () => {
    const pedidos = api();
    await interpretarYLlenar();
    elegir("Efectivo");
    fireEvent.submit(screen.getByLabelText("Monto").closest("form")!);
    await screen.findByRole("heading", { name: "Revisa y confirma" });
    expect(guardados(pedidos)).toHaveLength(0);
  });

  it("«Confirmar y guardar» guarda una sola vez, con lo que la persona confirmó, y vuelve con «Listo»", async () => {
    const pedidos = api();
    await irAlPaso();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    );
    await waitFor(() => expect(guardados(pedidos)).toHaveLength(1));
    expect(guardados(pedidos)[0]!.cuerpo).toEqual({
      monto_centavos: 4500000,
      tipo: "gasto",
      fecha: "2026-10-25",
      categoria_id: 1,
      medio: "efectivo",
    });
    await waitFor(() =>
      expect(avisoDeLlegada()?.titulo).toBe(
        "Listo, registramos tu gasto de $45.000.",
      ),
    );
  });

  it("«Volver al formulario» muestra el formulario con lo mismo, sin guardar", async () => {
    const pedidos = api();
    await irAlPaso();
    fireEvent.click(
      screen.getByRole("button", { name: "Volver al formulario" }),
    );
    expect(await screen.findByLabelText("Monto")).toHaveValue("$45.000");
    expect(screen.getByRole("radio", { name: "Efectivo" })).toBeChecked();
    expect(
      screen.queryByRole("heading", { name: "Revisa y confirma" }),
    ).not.toBeInTheDocument();
    expect(guardados(pedidos)).toHaveLength(0);
    // Y se puede cambiar lo que se quiera: el paso vuelve con lo nuevo.
    fireEvent.change(screen.getByLabelText("Monto"), {
      target: { value: "46.000" },
    });
    revisar();
    await screen.findByRole("heading", { name: "Revisa y confirma" });
    expect(screen.getByText(porTexto("$46.000"))).toBeInTheDocument();
  });

  it("marca el paso para que por debajo de 768 px el cuadro tampoco quede, sin perder su texto (bug 266)", async () => {
    api();
    await irAlPaso();
    const cuadro = screen.getByLabelText("Escribe el gasto o el ingreso", {
      selector: "textarea",
    });
    expect(cuadro.closest(".registro")).toHaveClass("registro--en-paso");
    fireEvent.click(
      screen.getByRole("button", { name: "Volver al formulario" }),
    );
    await screen.findByLabelText("Monto");
    expect(cuadro.closest(".registro")).not.toHaveClass("registro--en-paso");
    expect(cuadro).toHaveValue("mercado 45 mil ayer");
  });

  it("durante el paso, «Atrás» de la barra hace lo de «Volver al formulario»: todo como estaba, sin guardar ni salir", async () => {
    const pedidos = api();
    window.history.replaceState(null, "", "/registrar");
    await irAlPaso();
    expect(
      screen.queryByRole("link", { name: "Atrás" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(await screen.findByLabelText("Monto")).toHaveValue("$45.000");
    expect(
      screen.queryByRole("heading", { name: "Revisa y confirma" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Escribe el gasto o el ingreso")).toHaveValue(
      "mercado 45 mil ayer",
    );
    expect(
      screen.getByText(
        "Llenamos el formulario con tu texto. Cambia lo que quieras.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Efectivo" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Gasto" })).toHaveFocus();
    expect(window.location.pathname).toBe("/registrar");
    expect(guardados(pedidos)).toHaveLength(0);
    // Fuera del paso, «Atrás» vuelve a ser el enlace a PN-01.
    expect(screen.getByRole("link", { name: "Atrás" })).toHaveAttribute(
      "href",
      "/movimientos",
    );
    expect(
      screen.queryByRole("button", { name: "Atrás" }),
    ).not.toBeInTheDocument();
  });

  it("«Atrás» durante el paso también quita el aviso de un guardado fallido, como «Volver al formulario»", async () => {
    api({ guardar: () => json(500, { error: "error_interno" }) });
    await irAlPaso();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    );
    await screen.findByText("No pudimos guardar tu gasto.");
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await screen.findByLabelText("Monto");
    expect(
      screen.queryByText("No pudimos guardar tu gasto."),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["Tipo", "tipo-gasto"],
    ["Monto", "monto"],
    ["Categoría", "ver-todas"],
    ["Fecha", "fecha"],
    ["Medio de pago", "medio-efectivo"],
    ["De quién es", "quien-solo_mio"],
  ])(
    "«Cambiar» en la fila «%s» vuelve a ese campo, con el foco en él",
    async (fila, id) => {
      api();
      await irAlPaso();
      const filaCompleta = within(screen.getByRole("main"))
        .getAllByRole("listitem")
        .find((f) => f.textContent?.startsWith(fila))!;
      fireEvent.click(
        within(filaCompleta).getByRole("button", { name: "Cambiar" }),
      );
      await screen.findByLabelText("Monto");
      expect(document.getElementById(id)).toHaveFocus();
    },
  );

  it("cada «Cambiar» se describe con su fila, para que el lector de pantalla las distinga", async () => {
    api();
    await irAlPaso();
    const botones = screen.getAllByRole("button", { name: "Cambiar" });
    expect(botones[1]).toHaveAccessibleDescription("Monto $45.000");
  });

  it("varios movimientos: el aviso de D-077 va encima de la tarjeta y la propuesta sigue siendo la del primero", async () => {
    // Con varios montos el API manda la categoría vacía (D-196, paso 1): la persona la elige antes del paso.
    api({
      interpretar: () =>
        json(200, { ...propuesta, categoria: null, varios_movimientos: true }),
    });
    await interpretarYLlenar("mercado 45 mil ayer y 12 mil de pasajes");
    elegir("Efectivo");
    elegir("Alimentación");
    revisar();
    await screen.findByRole("heading", { name: "Revisa y confirma" });
    const aviso = screen.getByText("Encontramos más de un movimiento");
    expect(
      screen.getByText(
        "Tomamos solo el primer movimiento. Registra los otros por separado.",
      ),
    ).toBeInTheDocument();
    expect(aviso.closest(".aviso")).toHaveClass("aviso--informacion");
    expect(
      aviso.compareDocumentPosition(
        within(screen.getByRole("main")).getAllByRole("listitem")[0]!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("varios movimientos (D-196, paso 1): el formulario llega sin categoría y «Revisar y guardar» pide elegirla, con el foco en ella, sin pasar al paso", async () => {
    const pedidos = api({
      interpretar: () =>
        json(200, { ...propuesta, categoria: null, varios_movimientos: true }),
    });
    await interpretarYLlenar("mercado 45 mil ayer y 12 mil de pasajes");
    expect(screen.getByLabelText("Monto")).toHaveValue("$45.000");
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-10-25");
    for (const chip of within(
      screen.getByRole("group", { name: "Categoría" }),
    ).getAllByRole("radio"))
      expect(chip).not.toBeChecked();
    elegir("Efectivo");
    revisar();
    expect(
      await screen.findByText("Falta elegir la categoría."),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^Falta/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Ver todas" })).toHaveFocus();
    expect(
      screen.queryByRole("heading", { name: "Revisa y confirma" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Encontramos más de un movimiento"),
    ).not.toBeInTheDocument();
    // Con la categoría elegida, el paso abre con el aviso de varios movimientos y guarda la que ella eligió.
    elegir("Otros gastos");
    revisar();
    await screen.findByRole("heading", { name: "Revisa y confirma" });
    expect(
      screen.getByText("Encontramos más de un movimiento"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    );
    await waitFor(() => expect(guardados(pedidos)).toHaveLength(1));
    expect(guardados(pedidos)[0]?.cuerpo).toMatchObject({
      categoria_id: 16,
      monto_centavos: 4500000,
      fecha: "2026-10-25",
    });
  });

  it("sin varios movimientos no hay aviso", async () => {
    api();
    await irAlPaso();
    expect(
      screen.queryByText("Encontramos más de un movimiento"),
    ).not.toBeInTheDocument();
  });

  it("un error de campo al guardar vuelve al formulario con el error en su campo", async () => {
    api({
      guardar: () =>
        json(422, {
          error: "datos_invalidos",
          campos: { monto_centavos: "monto_no_positivo" },
        }),
    });
    await irAlPaso();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    );
    expect(await screen.findByLabelText("Monto")).toBeInTheDocument();
  });

  it("si guardar falla, el paso sigue ahí con el aviso y «Intentar de nuevo» no pasa por el cuadro", async () => {
    const pedidos = api({
      guardar: () => json(500, { error: "error_interno" }),
    });
    await irAlPaso();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar y guardar" }),
    );
    expect(
      await screen.findByText("No pudimos guardar tu gasto."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Revisa y confirma" }),
    ).toBeInTheDocument();
    expect(interpretaciones(pedidos)).toHaveLength(1);
  });

  it("el borrador sobrevive a «Se repite»: al volver sigue el paso por el cuadro (RN-001)", async () => {
    const pedidos = api();
    cambiarBorrador({
      monto: "$45.000",
      categoriaId: 1,
      medio: "efectivo",
      delCuadro: true,
    });
    await abrir();
    expect(
      screen.getByRole("button", { name: "Revisar y guardar" }),
    ).toBeInTheDocument();
    revisar();
    await screen.findByRole("heading", { name: "Revisa y confirma" });
    expect(guardados(pedidos)).toHaveLength(0);
  });
});

describe("«Llenar el formulario»: lo que no es una propuesta", () => {
  it("un monto ambiguo no se adivina: el Monto queda vacío con la pregunta de D-084 y el foco", async () => {
    const pedidos = api({
      interpretar: () =>
        json(200, {
          ...propuesta,
          resultado: "monto_ambiguo",
          monto_centavos: null,
          lecturas_del_monto: {
            con_punto_de_miles: "12.500",
            con_coma_decimal: "12,50",
          },
        }),
    });
    await interpretarYLlenar("mercado 12.5");
    expect(screen.getByLabelText("Monto")).toHaveValue("");
    expect(
      screen.getByText(porTexto("¿Quisiste decir $12.500 o $12,50?")),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Monto")).toHaveFocus();
    // Lo demás sí se propone.
    expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
    // Sin monto no hay paso ni guardado.
    elegir("Efectivo");
    revisar();
    expect(await screen.findByText("Falta el monto.")).toBeInTheDocument();
    expect(guardados(pedidos)).toHaveLength(0);
  });

  it.each([
    [
      "recomendacion",
      "Aquí no damos recomendaciones sobre créditos ni inversiones.",
      "Puedes registrar un movimiento cuando quieras.",
    ],
    ["pregunta", "Aquí solo registramos movimientos.", undefined],
    [
      "no_entendido",
      "No pudimos entender el texto.",
      "Llena el formulario: lo que escribiste sigue ahí.",
    ],
    [
      "tiempo_agotado",
      "No pudimos entender el texto.",
      "Llena el formulario: lo que escribiste sigue ahí.",
    ],
  ])(
    "«%s»: un aviso de información con su texto de E14, sin propuesta, el formulario vacío y el texto en el cuadro",
    async (resultado, titulo, mensaje) => {
      const pedidos = api({ interpretar: () => json(200, { resultado }) });
      await abrir();
      escribir("hola");
      llenar();
      const aviso = (await screen.findByText(titulo)).closest(".aviso")!;
      expect(aviso).toHaveClass("aviso--informacion");
      expect(aviso).toHaveAttribute("role", "status");
      expect(aviso).toHaveFocus();
      if (mensaje) expect(aviso).toHaveTextContent(mensaje);
      expect(screen.getByLabelText("Monto")).toHaveValue("");
      expect(
        screen.queryByText(
          "Llenamos el formulario con tu texto. Cambia lo que quieras.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByLabelText("Escribe el gasto o el ingreso"),
      ).toHaveValue("hola");
      // El formulario sin cambios: sigue guardando directo.
      expect(
        screen.getByRole("button", { name: "Guardar" }),
      ).toBeInTheDocument();
      expect(guardados(pedidos)).toHaveLength(0);
    },
  );

  it("una respuesta sin propuesta después de una con propuesta no deja el paso por el cuadro", async () => {
    let n = 0;
    api({
      interpretar: () =>
        json(200, n++ === 0 ? propuesta : { resultado: "no_entendido" }),
    });
    await interpretarYLlenar();
    escribir("otra cosa");
    llenar();
    await screen.findByText("No pudimos entender el texto.");
    // El formulario ya tenía lo que llenó el cuadro: sigue siendo del cuadro.
    expect(
      screen.getByRole("button", { name: "Revisar y guardar" }),
    ).toBeInTheDocument();
  });

  it("sin texto no llama al API: «Falta escribir el gasto o el ingreso.» en el cuadro, con el foco", async () => {
    const pedidos = api();
    await abrir();
    llenar();
    expect(
      await screen.findByText("Falta escribir el gasto o el ingreso."),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Escribe el gasto o el ingreso"),
    ).toHaveFocus();
    expect(interpretaciones(pedidos)).toHaveLength(0);
  });

  it.each([
    ["texto_requerido", "Falta escribir el gasto o el ingreso."],
    ["texto_largo", "El texto es demasiado largo. Usa hasta 280 caracteres."],
  ])(
    "el 422 «%s» deja el cuadro en Error con su texto, conserva lo escrito y le da el foco (E14-PPN 1.13, D-193)",
    async (codigo, texto) => {
      api({
        interpretar: () =>
          json(422, { error: "datos_invalidos", campos: { texto: codigo } }),
      });
      await abrir();
      escribir("mercado");
      llenar();
      expect(await screen.findByText(porTexto(texto))).toBeInTheDocument();
      const campo = screen.getByLabelText("Escribe el gasto o el ingreso");
      expect(campo).toHaveAttribute("aria-invalid", "true");
      expect(campo).toHaveValue("mercado");
      expect(campo).toHaveFocus();
      // Es un error de campo, no un aviso: no hay mensaje de estado del cuadro.
      expect(
        screen.queryByText("No pudimos llenar el formulario."),
      ).not.toBeInTheDocument();
    },
  );

  it("sin conexión: «Sin conexión, puedes registrar con el formulario.» y el formulario sigue", async () => {
    simularApi((p) => {
      if (p.metodo === "GET") return json(200, catalogo);
      throw new Error("sin red");
    });
    await abrir();
    escribir("mercado");
    llenar();
    expect(
      await screen.findByText(
        "Sin conexión, puedes registrar con el formulario.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toBeInTheDocument();
  });

  it("un fallo del servidor es un aviso, no un error del cuadro: «No pudimos llenar el formulario.» con «Llena el formulario: lo que escribiste sigue ahí.» y el texto intacto (E14-PPN 1.13, D-193)", async () => {
    api({ interpretar: () => json(500, { error: "error_interno" }) });
    await abrir();
    escribir("mercado");
    llenar();
    const aviso = await screen.findByRole("status");
    expect(aviso).toHaveTextContent("No pudimos llenar el formulario.");
    expect(aviso).toHaveTextContent(
      "Llena el formulario: lo que escribiste sigue ahí.",
    );
    expect(aviso).not.toHaveTextContent("Llénalo tú");
    expect(aviso).toHaveFocus();
    const campo = screen.getByLabelText("Escribe el gasto o el ingreso");
    expect(campo).toHaveValue("mercado");
    expect(campo).not.toHaveAttribute("aria-invalid", "true");
  });

  it("no manda otro pedido mientras espera la respuesta", async () => {
    let soltar: (r: Response) => void = () => undefined;
    const pedidos = simularApi((p) =>
      p.metodo === "GET"
        ? json(200, catalogo)
        : (new Promise<Response>((resolver) => (soltar = resolver)) as never),
    );
    await abrir();
    escribir("mercado 45 mil");
    llenar();
    llenar();
    expect(interpretaciones(pedidos)).toHaveLength(1);
    soltar(json(200, propuesta));
    await screen.findByText(
      "Llenamos el formulario con tu texto. Cambia lo que quieras.",
    );
  });
});
