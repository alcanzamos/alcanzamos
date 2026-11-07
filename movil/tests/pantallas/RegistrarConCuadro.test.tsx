import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TextInput } from "react-native";
import {
  cambiarBorrador,
  reiniciarBorrador,
} from "../../src/borradorDeRegistro";
import { Registrar } from "../../src/pantallas/Registrar";
import { tokens } from "../../src/tokens/tokens.generated";
import { respuestaJson } from "../ayudas/fetchFalso";
import { navegacionFalsa, propiedades } from "../ayudas/pantalla";
import { fijarHoy } from "../ayudas/reloj";
import type { crearSecureStoreFalso } from "../ayudas/secureStoreFalso";

jest.mock("expo-secure-store", () =>
  jest.requireActual("../ayudas/secureStoreFalso").crearSecureStoreFalso(),
);
const almacen = jest.requireMock("expo-secure-store") as ReturnType<
  typeof crearSecureStoreFalso
>;
jest.mock("@react-native-community/datetimepicker", () => ({
  DateTimePickerAndroid: { open: jest.fn() },
}));

const BASE = "http://api.prueba:18090";
const RUTA_DE_INTERPRETAR = "/api/v1/movimientos/interpretacion";

// E14-PPN 3.1 filas 3 a 5, el paso «Revisa y confirma» y sus estados, en Android (US-62, RN-001, D-084, D-077).
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

type Pedido = { metodo: string; ruta: string; cuerpo: string | undefined };
type Respuestas = {
  interpretar?: (p: Pedido) => Response | Promise<Response>;
  guardar?: (p: Pedido) => Response | Promise<Response>;
};
function api({ interpretar, guardar }: Respuestas = {}) {
  const pedidos: Pedido[] = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const pedido = {
      metodo: String(init.method),
      ruta: url.replace(BASE, ""),
      cuerpo: init.body as string | undefined,
    };
    pedidos.push(pedido);
    if (pedido.metodo === "GET") return respuestaJson(200, catalogo);
    if (pedido.ruta === RUTA_DE_INTERPRETAR)
      return (interpretar ?? (() => respuestaJson(200, propuesta)))(pedido);
    return (guardar ?? (() => respuestaJson(201, creado)))(pedido);
  }) as unknown as typeof fetch;
  return pedidos;
}
const interpretaciones = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.ruta === RUTA_DE_INTERPRETAR);
const guardados = (pedidos: Pedido[]) =>
  pedidos.filter(
    (p) => p.metodo === "POST" && p.ruta === "/api/v1/movimientos",
  );

async function abrir() {
  const navegacion = navegacionFalsa();
  await render(
    <Registrar {...propiedades("FormularioDeRegistro", navegacion)} />,
  );
  await screen.findByLabelText("Monto");
  return navegacion;
}
const CUADRO = "Escribe el gasto o el ingreso";
const escribir = (texto: string) =>
  fireEvent.changeText(screen.getByLabelText(CUADRO), texto);
const tocar = (nombre: string) =>
  fireEvent.press(screen.getByRole("button", { name: nombre }));
const elegir = (nombre: string) =>
  fireEvent.press(screen.getByRole("radio", { name: nombre }));
const fondoDe = (nombre: string) =>
  screen.getByRole("button", { name: nombre });
const PRIMARIO = { backgroundColor: tokens.color.accion.primaria.fondo };
const SECUNDARIO = { backgroundColor: tokens.color.fondo.superficie };
/** `a` se dibuja antes que `b` en la pantalla (el orden de la lectura y del foco). */
const antes = (a: string, b: string) => {
  const arbol = JSON.stringify(screen.toJSON());
  return (
    arbol.indexOf(`"${a}"`) >= 0 &&
    arbol.indexOf(`"${a}"`) < arbol.indexOf(`"${b}"`)
  );
};
const enfocados = () =>
  jest
    .mocked(TextInput.prototype.focus)
    .mock.contexts.map(
      (c: { props: { accessibilityLabel: string } }) =>
        c.props.accessibilityLabel,
    );

/** Escribe, interpreta y espera el aviso de «Llenamos el formulario…». */
async function interpretarYLlenar(texto = "mercado 45 mil ayer") {
  const navegacion = await abrir();
  await escribir(texto);
  await tocar("Llenar el formulario");
  await screen.findByText(
    "Llenamos el formulario con tu texto. Cambia lo que quieras.",
  );
  return navegacion;
}
async function irAlPaso() {
  const navegacion = await interpretarYLlenar();
  await elegir("Efectivo");
  await tocar("Revisar y guardar");
  await screen.findByRole("header", { name: "Revisa y confirma" });
  return navegacion;
}

describe("El cuadro de lenguaje natural, Android (E14-PPN 3.1, filas 3 a 5)", () => {
  beforeEach(() => {
    fijarHoy(new Date("2026-10-26T15:00:00Z"));
    process.env.EXPO_PUBLIC_URL_API = BASE;
    almacen.guardado.clear();
    almacen.guardado.set("sesion", "tk-activa");
    reiniciarBorrador();
    jest.mocked(TextInput.prototype.focus).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  describe("el cuadro y el formulario", () => {
    it("trae la etiqueta, la ayuda, la advertencia de NM-12 y «Llenar el formulario», de varias líneas y arriba del formulario", async () => {
      api();
      await abrir();
      const cuadro = screen.getByLabelText(CUADRO);
      expect(cuadro.props.multiline).toBe(true);
      expect(cuadro.props.maxLength).toBe(280);
      expect(cuadro.props.accessibilityHint).toBe(
        "Por ejemplo: mercado 45 mil ayer.",
      );
      expect(
        screen.getByText("Por ejemplo: mercado 45 mil ayer."),
      ).toBeOnTheScreen();
      // La advertencia está dos veces: bajo el cuadro (fila 4) y como ayuda de la descripción (fila 12).
      expect(
        screen.getAllByText(
          "No escribas datos de salud, religión ni de otras personas.",
        ),
      ).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: "Llenar el formulario" }),
      ).toBeOnTheScreen();
      expect(antes(CUADRO, "Tipo")).toBe(true);
    });

    it("sin texto el botón dice «Guardar» y es el primario; «Llenar el formulario» es secundario (RF-002)", async () => {
      api();
      await abrir();
      expect(fondoDe("Guardar")).toHaveStyle(PRIMARIO);
      expect(fondoDe("Llenar el formulario")).toHaveStyle(SECUNDARIO);
      expect(
        screen.queryByRole("button", { name: "Revisar y guardar" }),
      ).not.toBeOnTheScreen();
    });

    it("con texto escrito «Llenar el formulario» pasa a primario y «Guardar» a secundario: un solo primario", async () => {
      api();
      await abrir();
      await escribir("mercado 45 mil ayer");
      expect(fondoDe("Llenar el formulario")).toHaveStyle(PRIMARIO);
      expect(fondoDe("Guardar")).toHaveStyle(SECUNDARIO);
    });

    it("llenar a mano y guardar sigue guardando directo, sin interpretar y sin «Revisa y confirma» (RF-002)", async () => {
      const pedidos = api();
      const navegacion = await abrir();
      await fireEvent.changeText(screen.getByLabelText("Monto"), "45.000");
      await elegir("Alimentación");
      await elegir("Efectivo");
      await tocar("Guardar");
      await act(async () => {});
      expect(guardados(pedidos)).toHaveLength(1);
      expect(interpretaciones(pedidos)).toHaveLength(0);
      expect(screen.queryByText("Revisa y confirma")).not.toBeOnTheScreen();
      expect(navegacion.popTo.mock.calls[0][1].aviso.titulo).toBe(
        "Listo, registramos tu gasto de $45.000.",
      );
    });

    it("escribir en el cuadro no llama al API ni guarda nada (RN-001)", async () => {
      const pedidos = api();
      await abrir();
      await escribir("mercado 45 mil ayer");
      expect(pedidos.filter((p) => p.metodo !== "GET")).toEqual([]);
    });
  });

  describe("«Llenar el formulario»: una propuesta (CU-03, RN-001)", () => {
    it("manda el texto al API, llena el formulario con la propuesta, avisa y no guarda nada", async () => {
      const pedidos = api();
      await interpretarYLlenar();
      expect(
        interpretaciones(pedidos).map((p) => [p.metodo, JSON.parse(p.cuerpo!)]),
      ).toEqual([["POST", { texto: "mercado 45 mil ayer" }]]);
      expect(screen.getByRole("radio", { name: "Gasto" })).toBeChecked();
      expect(screen.getByLabelText("Monto").props.value).toBe("$45.000");
      expect(
        screen.getByRole("button", { name: "Fecha, 25 de octubre de 2026" }),
      ).toBeOnTheScreen();
      expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
      expect(screen.getByLabelText(CUADRO).props.value).toBe(
        "mercado 45 mil ayer",
      );
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("el aviso es una región viva de información, encima del formulario (antes de «Tipo»)", async () => {
      api();
      await interpretarYLlenar();
      const aviso = screen.getByRole("alert");
      expect(aviso.props.accessibilityLiveRegion).toBe("polite");
      expect(
        within(aviso).getByText(
          "Llenamos el formulario con tu texto. Cambia lo que quieras.",
        ),
      ).toBeOnTheScreen();
      expect(
        antes(
          "Llenamos el formulario con tu texto. Cambia lo que quieras.",
          "Tipo",
        ),
      ).toBe(true);
    });

    it("con una propuesta el botón dice «Revisar y guardar» y es el primario", async () => {
      api();
      await interpretarYLlenar();
      expect(fondoDe("Revisar y guardar")).toHaveStyle(PRIMARIO);
      expect(fondoDe("Llenar el formulario")).toHaveStyle(SECUNDARIO);
      expect(
        screen.queryByRole("button", { name: "Guardar" }),
      ).not.toBeOnTheScreen();
    });

    it("un ingreso propuesto elige «Ingreso»; sin categoría propuesta ninguna llega elegida (RN-011)", async () => {
      api({
        interpretar: () =>
          respuestaJson(200, {
            ...propuesta,
            tipo: "ingreso",
            categoria: null,
          }),
      });
      await interpretarYLlenar("me pagaron 2 millones");
      expect(screen.getByRole("radio", { name: "Ingreso" })).toBeChecked();
      for (const chip of within(
        screen.getByText("Categoría").parent!,
      ).getAllByRole("radio"))
        expect(chip).not.toBeChecked();
    });

    it("con el cuadro la categoría llega sugerida y la persona la cambia; se guarda la que dejó (D-193)", async () => {
      const pedidos = api();
      await interpretarYLlenar();
      await elegir("Efectivo");
      expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
      await elegir("Otros gastos");
      expect(
        screen.getByRole("radio", { name: "Alimentación" }),
      ).not.toBeChecked();
      await tocar("Revisar y guardar");
      await screen.findByRole("header", { name: "Revisa y confirma" });
      await tocar("Confirmar y guardar");
      await waitFor(() => expect(guardados(pedidos)).toHaveLength(1));
      expect(JSON.parse(guardados(pedidos)[0]!.cuerpo!)).toMatchObject({
        categoria_id: 16,
      });
    });

    it("con el cuadro pero sin categoría sugerida la categoría sigue siendo obligatoria: «Falta elegir la categoría.» y no pasa al paso (D-193)", async () => {
      const pedidos = api({
        interpretar: () =>
          respuestaJson(200, { ...propuesta, categoria: null }),
      });
      await interpretarYLlenar();
      await elegir("Efectivo");
      await tocar("Revisar y guardar");
      expect(
        await screen.findByText("Falta elegir la categoría."),
      ).toBeOnTheScreen();
      expect(
        screen.queryByRole("header", { name: "Revisa y confirma" }),
      ).not.toBeOnTheScreen();
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("no toca el medio de pago ni la descripción: el motor no los propone", async () => {
      api();
      await interpretarYLlenar();
      expect(screen.getByRole("radio", { name: "Efectivo" })).not.toBeChecked();
      expect(
        screen.getByRole("radio", { name: "Transferencia" }),
      ).not.toBeChecked();
      expect(screen.getByLabelText("Descripción (opcional)").props.value).toBe(
        "",
      );
    });
  });

  describe("el paso «Revisa y confirma» (RF-004, RN-001, D-084)", () => {
    it("«Revisar y guardar» revisa el formulario antes: sin medio de pago muestra el error y no pasa ni guarda", async () => {
      const pedidos = api();
      await interpretarYLlenar();
      await tocar("Revisar y guardar");
      expect(
        screen.getByText("Falta elegir el medio de pago."),
      ).toBeOnTheScreen();
      expect(screen.queryByText("Revisa y confirma")).not.toBeOnTheScreen();
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("muestra el título y las seis filas, cada una con «Cambiar», y todavía no guarda (RN-001)", async () => {
      const pedidos = api();
      await irAlPaso();
      for (const [etiqueta, valor] of [
        ["Tipo", "Gasto"],
        ["Monto", "$45.000"],
        ["Categoría", "Alimentación"],
        ["Fecha", "Ayer"],
        ["Medio de pago", "Efectivo"],
        ["De quién es", "Solo mío"],
      ]) {
        expect(screen.getByText(etiqueta!)).toBeOnTheScreen();
        expect(screen.getByText(valor!)).toBeOnTheScreen();
      }
      expect(screen.getAllByRole("button", { name: "Cambiar" })).toHaveLength(
        6,
      );
      expect(fondoDe("Confirmar y guardar")).toHaveStyle(PRIMARIO);
      expect(fondoDe("Volver al formulario")).toHaveStyle(SECUNDARIO);
      // El formulario y el cuadro salen: el paso ocupa la pantalla.
      expect(screen.queryByLabelText("Monto")).not.toBeOnTheScreen();
      expect(screen.queryByLabelText(CUADRO)).not.toBeOnTheScreen();
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("«Confirmar y guardar» guarda una sola vez, con lo que la persona confirmó, y vuelve a PN-01 con «Listo»", async () => {
      const pedidos = api();
      const navegacion = await irAlPaso();
      await tocar("Confirmar y guardar");
      await act(async () => {});
      expect(guardados(pedidos)).toHaveLength(1);
      expect(JSON.parse(guardados(pedidos)[0]!.cuerpo!)).toEqual({
        monto_centavos: 4500000,
        tipo: "gasto",
        fecha: "2026-10-25",
        categoria_id: 1,
        medio: "efectivo",
      });
      expect(navegacion.popTo).toHaveBeenCalledTimes(1);
      expect(navegacion.popTo.mock.calls[0][0]).toBe("ListaDeMovimientos");
      expect(navegacion.popTo.mock.calls[0][1].aviso.titulo).toBe(
        "Listo, registramos tu gasto de $45.000.",
      );
    });

    it("«Volver al formulario» muestra el formulario con lo mismo, sin guardar, y el paso vuelve con lo nuevo", async () => {
      const pedidos = api();
      await irAlPaso();
      await tocar("Volver al formulario");
      expect(screen.getByLabelText("Monto").props.value).toBe("$45.000");
      expect(screen.getByRole("radio", { name: "Efectivo" })).toBeChecked();
      expect(screen.queryByText("Revisa y confirma")).not.toBeOnTheScreen();
      expect(guardados(pedidos)).toHaveLength(0);
      await fireEvent.changeText(screen.getByLabelText("Monto"), "46.000");
      await tocar("Revisar y guardar");
      expect(screen.getByText("$46.000")).toBeOnTheScreen();
    });

    it("«Cambiar» en la fila «Monto» vuelve al formulario con el foco en el monto; las demás vuelven sin guardar", async () => {
      const pedidos = api();
      await irAlPaso();
      jest.mocked(TextInput.prototype.focus).mockClear();
      await fireEvent.press(
        screen.getAllByRole("button", { name: "Cambiar" })[1]!,
      );
      expect(screen.getByLabelText("Monto")).toBeOnTheScreen();
      expect(enfocados()).toEqual(["Monto"]);
      await tocar("Revisar y guardar");
      await fireEvent.press(
        screen.getAllByRole("button", { name: "Cambiar" })[4]!,
      );
      expect(screen.getByRole("radio", { name: "Efectivo" })).toBeChecked();
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("cada «Cambiar» se describe con su fila, para que TalkBack las distinga", async () => {
      api();
      await irAlPaso();
      const botones = screen.getAllByRole("button", { name: "Cambiar" });
      expect(botones[0]!.props.accessibilityHint).toBe("Tipo: Gasto");
      expect(botones[1]!.props.accessibilityHint).toBe("Monto: 45000 pesos");
      expect(botones[3]!.props.accessibilityHint).toBe("Fecha: Ayer");
    });

    it("el título del paso es un encabezado", async () => {
      api();
      await irAlPaso();
      expect(
        screen.getByRole("header", { name: "Revisa y confirma" }),
      ).toBeOnTheScreen();
    });

    it("varios movimientos: el aviso de D-077 va encima de la tarjeta y la propuesta sigue siendo la del primero", async () => {
      api({
        interpretar: () =>
          respuestaJson(200, { ...propuesta, varios_movimientos: true }),
      });
      await interpretarYLlenar();
      await elegir("Efectivo");
      await tocar("Revisar y guardar");
      const aviso = await screen.findByText("Encontramos más de un movimiento");
      expect(
        screen.getByText(
          "Tomamos solo el primer movimiento. Registra los otros por separado.",
        ),
      ).toBeOnTheScreen();
      expect(aviso).toBeOnTheScreen();
      expect(screen.getByRole("alert").props.accessibilityLiveRegion).toBe(
        "polite",
      );
      expect(antes("Encontramos más de un movimiento", "Tipo")).toBe(true);
    });

    it("sin varios movimientos no hay aviso", async () => {
      api();
      await irAlPaso();
      expect(
        screen.queryByText("Encontramos más de un movimiento"),
      ).not.toBeOnTheScreen();
    });

    it("un error de campo al guardar vuelve al formulario con el error en su campo", async () => {
      api({
        guardar: () =>
          respuestaJson(422, {
            error: "datos_invalidos",
            campos: { monto_centavos: "monto_no_positivo" },
          }),
      });
      await irAlPaso();
      await tocar("Confirmar y guardar");
      await act(async () => {});
      expect(screen.getByLabelText("Monto")).toBeOnTheScreen();
      expect(
        screen.getByText("El monto debe ser mayor que $0."),
      ).toBeOnTheScreen();
    });

    it("si guardar falla, el paso sigue ahí con el aviso y «Intentar de nuevo» vuelve a guardar sin interpretar", async () => {
      let intentos = 0;
      const pedidos = api({
        guardar: () =>
          intentos++ === 0
            ? respuestaJson(500, { error: "error_interno" })
            : respuestaJson(201, creado),
      });
      const navegacion = await irAlPaso();
      await tocar("Confirmar y guardar");
      await act(async () => {});
      expect(
        screen.getByText("No pudimos guardar tu gasto."),
      ).toBeOnTheScreen();
      expect(
        screen.getByRole("header", { name: "Revisa y confirma" }),
      ).toBeOnTheScreen();
      await tocar("Intentar de nuevo");
      await act(async () => {});
      expect(guardados(pedidos)).toHaveLength(2);
      expect(interpretaciones(pedidos)).toHaveLength(1);
      expect(navegacion.popTo).toHaveBeenCalledTimes(1);
    });

    it("el borrador sobrevive a «Se repite»: con lo del cuadro, el botón sigue siendo «Revisar y guardar» y no guarda directo (RN-001)", async () => {
      const pedidos = api();
      cambiarBorrador({
        monto: "$45.000",
        categoriaId: 1,
        medio: "efectivo",
        delCuadro: true,
      });
      await abrir();
      await tocar("Revisar y guardar");
      expect(
        screen.getByRole("header", { name: "Revisa y confirma" }),
      ).toBeOnTheScreen();
      expect(guardados(pedidos)).toHaveLength(0);
    });

    it("después de guardar el borrador se reinicia: el cuadro y el paso no vuelven (RN-001)", async () => {
      api();
      await irAlPaso();
      await tocar("Confirmar y guardar");
      await act(async () => {});
      await abrir();
      expect(screen.getByLabelText(CUADRO).props.value).toBe("");
      expect(screen.getByRole("button", { name: "Guardar" })).toBeOnTheScreen();
    });
  });

  describe("«Llenar el formulario»: lo que no es una propuesta", () => {
    it("un monto ambiguo no se adivina: el Monto queda vacío con la pregunta de D-084 y el foco", async () => {
      const pedidos = api({
        interpretar: () =>
          respuestaJson(200, {
            ...propuesta,
            resultado: "monto_ambiguo",
            monto_centavos: null,
            lecturas_del_monto: {
              con_punto_de_miles: "12.500",
              con_coma_decimal: "12,50",
            },
          }),
      });
      jest.mocked(TextInput.prototype.focus).mockClear();
      await interpretarYLlenar("mercado 12.5");
      expect(screen.getByLabelText("Monto").props.value).toBe("");
      expect(
        screen.getByText("¿Quisiste decir $12.500 o $12,50?"),
      ).toBeOnTheScreen();
      expect(enfocados()).toEqual(["Monto"]);
      // Lo demás sí se propone.
      expect(screen.getByRole("radio", { name: "Alimentación" })).toBeChecked();
      // Sin monto no hay paso ni guardado.
      await elegir("Efectivo");
      await tocar("Revisar y guardar");
      expect(screen.getByText("Falta el monto.")).toBeOnTheScreen();
      expect(screen.queryByText("Revisa y confirma")).not.toBeOnTheScreen();
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
        const pedidos = api({
          interpretar: () => respuestaJson(200, { resultado }),
        });
        await abrir();
        await escribir("hola");
        await tocar("Llenar el formulario");
        await screen.findByText(titulo);
        const aviso = screen.getByRole("alert");
        expect(aviso.props.accessibilityLiveRegion).toBe("polite");
        if (mensaje) expect(within(aviso).getByText(mensaje)).toBeOnTheScreen();
        expect(screen.getByLabelText("Monto").props.value).toBe("");
        expect(
          screen.queryByText(
            "Llenamos el formulario con tu texto. Cambia lo que quieras.",
          ),
        ).not.toBeOnTheScreen();
        expect(screen.getByLabelText(CUADRO).props.value).toBe("hola");
        // El formulario sin cambios: sigue guardando directo.
        expect(
          screen.getByRole("button", { name: "Guardar" }),
        ).toBeOnTheScreen();
        expect(guardados(pedidos)).toHaveLength(0);
      },
    );

    it("una respuesta sin propuesta después de una con propuesta no deja el paso por el cuadro", async () => {
      let n = 0;
      api({
        interpretar: () =>
          respuestaJson(
            200,
            n++ === 0 ? propuesta : { resultado: "no_entendido" },
          ),
      });
      await interpretarYLlenar();
      await escribir("otra cosa");
      await tocar("Llenar el formulario");
      await screen.findByText("No pudimos entender el texto.");
      // El formulario ya tenía lo que llenó el cuadro: sigue siendo del cuadro.
      expect(
        screen.getByRole("button", { name: "Revisar y guardar" }),
      ).toBeOnTheScreen();
    });

    it("sin texto no llama al API: «Falta escribir el gasto o el ingreso.» en el cuadro, con el foco", async () => {
      const pedidos = api();
      await abrir();
      jest.mocked(TextInput.prototype.focus).mockClear();
      await tocar("Llenar el formulario");
      expect(
        screen.getByText("Falta escribir el gasto o el ingreso."),
      ).toBeOnTheScreen();
      expect(enfocados()).toEqual([CUADRO]);
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
            respuestaJson(422, {
              error: "datos_invalidos",
              campos: { texto: codigo },
            }),
        });
        await abrir();
        await escribir("mercado");
        jest.mocked(TextInput.prototype.focus).mockClear();
        await tocar("Llenar el formulario");
        await screen.findByText(texto);
        expect(enfocados()).toEqual([CUADRO]);
        expect(screen.getByLabelText(CUADRO).props.value).toBe("mercado");
        // Es un error de campo, no el aviso de la falla del servidor.
        expect(
          screen.queryByText("No pudimos llenar el formulario."),
        ).not.toBeOnTheScreen();
      },
    );

    it("sin conexión: «Sin conexión, puedes registrar con el formulario.» y el formulario sigue", async () => {
      api({
        interpretar: () => {
          throw new Error("sin red");
        },
      });
      await abrir();
      await escribir("mercado");
      await tocar("Llenar el formulario");
      await screen.findByText(
        "Sin conexión, puedes registrar con el formulario.",
      );
      expect(screen.getByLabelText("Monto")).toBeOnTheScreen();
    });

    it("un fallo del servidor es un aviso, no un error del cuadro: «No pudimos llenar el formulario.» con «Llena el formulario: lo que escribiste sigue ahí.» y el texto intacto (E14-PPN 1.13, D-193)", async () => {
      api({
        interpretar: () => respuestaJson(500, { error: "error_interno" }),
      });
      await abrir();
      await escribir("mercado");
      jest.mocked(TextInput.prototype.focus).mockClear();
      await tocar("Llenar el formulario");
      await screen.findByText("No pudimos llenar el formulario.");
      expect(
        screen.getByText("Llena el formulario: lo que escribiste sigue ahí."),
      ).toBeOnTheScreen();
      expect(screen.queryByText(/Llénalo tú/)).not.toBeOnTheScreen();
      expect(screen.getByLabelText(CUADRO).props.value).toBe("mercado");
      expect(enfocados()).toEqual([]);
    });

    it("no manda otro pedido mientras espera la respuesta", async () => {
      let soltar: (r: Response) => void = () => undefined;
      const pedidos = api({
        interpretar: () =>
          new Promise<Response>((resolver) => (soltar = resolver)),
      });
      await abrir();
      await escribir("mercado 45 mil");
      await tocar("Llenar el formulario");
      await tocar("Llenar el formulario");
      expect(interpretaciones(pedidos)).toHaveLength(1);
      await act(async () => soltar(respuestaJson(200, propuesta)));
      await screen.findByText(
        "Llenamos el formulario con tu texto. Cambia lo que quieras.",
      );
    });
  });
});
