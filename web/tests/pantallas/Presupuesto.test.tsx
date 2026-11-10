import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Presupuesto } from "../../src/pantallas/Presupuesto";
import { json, porTexto, simularApi, type Pedido } from "../ayudas";

// El escenario de E14-PPA 2.2 (Laura, 2 de noviembre de 2026, caso F) y el caso P de 2.3 (PN-07).
type Fila = {
  categoria_id: number;
  presupuesto: { id: string; monto_centavos: number } | null;
  gastado_centavos: number;
  estado: "quedan" | "usado_todo" | "superado" | null;
  quedan_centavos: number | null;
  oculta?: boolean;
};
const fila = (f: Fila) => ({ nombre: "x", oculta: false, ...f });
const sinPresupuesto = (id: number, gastado: number) =>
  fila({
    categoria_id: id,
    presupuesto: null,
    gastado_centavos: gastado,
    estado: null,
    quedan_centavos: null,
  });
const transporte = fila({
  categoria_id: 8,
  presupuesto: { id: "p8", monto_centavos: 4000000 },
  gastado_centavos: 4000000,
  estado: "usado_todo",
  quedan_centavos: null,
});

type Resumen = {
  modo: "normal" | "ingreso_bajo" | "ingreso_nulo";
  en_cero?: boolean;
  ingreso_registrado_centavos: number;
  asignado_centavos: number;
  sin_asignar_centavos: number | null;
  asignado_supera_por_centavos: number | null;
  llega_despues_centavos: number;
};
const datos = (
  resumen: Resumen,
  categorias: unknown[],
  llegaDespues: unknown[] = [],
) => ({
  periodo_actual: "2026-11",
  periodo: "2026-11",
  editable: true,
  resumen: { en_cero: false, ...resumen },
  llega_despues: llegaDespues,
  categorias,
});

// El salario del 16 de noviembre de 2026: esperado, no cuenta en «Sin asignar» (D-094, P-1).
const salarioEsperado = {
  recurrente_id: "r1",
  fecha: "2026-11-16",
  categoria_id: 17,
  monto_centavos: 120000000,
  marca: "esperado",
};

const laura = datos(
  {
    modo: "normal",
    ingreso_registrado_centavos: 120000000,
    asignado_centavos: 4000000,
    sin_asignar_centavos: 116000000,
    asignado_supera_por_centavos: null,
    llega_despues_centavos: 120000000,
  },
  [
    transporte,
    sinPresupuesto(4, 65000000),
    sinPresupuesto(1, 12000000),
    sinPresupuesto(13, 2500000),
    sinPresupuesto(11, 1500000),
  ],
  [salarioEsperado],
);

const nulo = (enCero = false, categorias: unknown[] = []) =>
  datos(
    {
      modo: "ingreso_nulo",
      en_cero: enCero,
      ingreso_registrado_centavos: 0,
      asignado_centavos: 0,
      sin_asignar_centavos: null,
      asignado_supera_por_centavos: null,
      llega_despues_centavos: 0,
    },
    categorias,
  );

const bajo = datos(
  {
    modo: "ingreso_bajo",
    ingreso_registrado_centavos: 15000000,
    asignado_centavos: 16000000,
    sin_asignar_centavos: null,
    asignado_supera_por_centavos: 1000000,
    llega_despues_centavos: 0,
  },
  [
    fila({
      categoria_id: 1,
      presupuesto: { id: "p1", monto_centavos: 10000000 },
      gastado_centavos: 0,
      estado: "quedan",
      quedan_centavos: 10000000,
    }),
    fila({
      categoria_id: 8,
      presupuesto: { id: "p8", monto_centavos: 6000000 },
      gastado_centavos: 0,
      estado: "quedan",
      quedan_centavos: 6000000,
    }),
  ],
);

const catalogo = {
  gasto: [
    { id: 1, nombre: "x", general: false },
    { id: 4, nombre: "x", general: false },
    { id: 5, nombre: "x", general: false },
    { id: 8, nombre: "x", general: false },
    { id: 11, nombre: "x", general: false },
    { id: 13, nombre: "x", general: false },
    { id: 16, nombre: "x", general: true },
  ],
  ingreso: [{ id: 17, nombre: "x", general: false }],
};

/** El API de PN-06: cada lectura del presupuesto da la siguiente de `lecturas` (la última se repite). */
function api(
  lecturas: unknown[],
  escribir: (p: Pedido) => Response | Promise<Response> = () => json(201, {}),
) {
  let n = 0;
  return simularApi((p) => {
    if (p.ruta === "/api/v1/categorias") return json(200, catalogo);
    if (p.metodo === "GET" && p.ruta === "/api/v1/presupuestos")
      return json(200, lecturas[Math.min(n++, lecturas.length - 1)]);
    return escribir(p);
  });
}
const escrituras = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.metodo !== "GET");
const lecturasDelPresupuesto = (pedidos: Pedido[]) =>
  pedidos.filter((p) => p.metodo === "GET" && p.ruta === "/api/v1/presupuestos")
    .length;

async function abrir() {
  render(<Presupuesto />);
  await screen.findByRole("heading", { level: 2, name: "Por categoría" });
}
const tarjeta = (titulo: string) =>
  screen.getByRole("heading", { level: 2, name: titulo }).closest("section")!;
const filasDeCategoria = () =>
  within(tarjeta("Por categoría"))
    .getAllByRole("listitem")
    .map((f) => f.textContent);
const boton = (nombre: string) => screen.getByRole("button", { name: nombre });
const hoja = (nombre: string) => screen.getByRole("dialog", { name: nombre });
const escribirMonto = (valor: string) =>
  fireEvent.change(screen.getByLabelText("Monto para noviembre"), {
    target: { value: valor },
  });

describe("PN-06 · Presupuesto del periodo por categorías (E14-PPA 4.1)", () => {
  it("Laura en noviembre: título, resumen con «Llega después», «Ver mis ingresos» y «Registrar»", async () => {
    api([laura]);
    await abrir();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Presupuesto de noviembre",
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Presupuesto de noviembre · Alcanzamos");
    expect(tarjeta("Tu presupuesto este mes")).toHaveTextContent(
      [
        "Tu presupuesto este mes",
        "Ingreso registrado$1.200.000",
        "Asignado$40.000",
        "Sin asignar$1.160.000",
        "Llega después: $1.200.000 (esperado)",
        "Sin asignar cuenta lo que ya registraste. Salario del 16 de noviembre de 2026 se suma cuando llegue.",
        "Ver mis ingresos",
      ].join(""),
    );
    expect(
      screen.getByRole("link", { name: "Ver mis ingresos" }),
    ).toHaveAttribute("href", "/ingresos");
    expect(screen.getByRole("link", { name: "Registrar" })).toHaveAttribute(
      "href",
      "/registrar",
    );
    // PN-06 no es PN-07: sin «Registrar un ingreso» ni «Dejar el presupuesto en cero».
    expect(screen.queryByText("Registrar un ingreso")).toBeNull();
    expect(screen.queryByText("Dejar el presupuesto en cero")).toBeNull();
  });

  it("los números van en Figtree (D-123) y la cifra grande es «Sin asignar»", async () => {
    api([laura]);
    await abrir();
    const grande = document.querySelector(".monto-grande");
    expect(grande).toHaveTextContent("$1.160.000");
    expect(grande).toHaveClass("cifra");
  });

  it("«Por categoría»: primero las que tienen presupuesto, en el orden del API, cada una con su texto", async () => {
    api([laura]);
    await abrir();
    expect(filasDeCategoria()).toEqual([
      "TransportePresupuesto $40.000 · Gastado $40.000Ya usaste todo lo presupuestado.CorregirQuitar",
      "Arriendo o cuota de viviendaGastado $650.000 · Sin presupuestoPoner presupuesto",
      "AlimentaciónGastado $120.000 · Sin presupuestoPoner presupuesto",
      "Restaurantes y hotelesGastado $25.000 · Sin presupuestoPoner presupuesto",
      "Recreación y culturaGastado $15.000 · Sin presupuestoPoner presupuesto",
    ]);
  });

  it("los botones de cada fila llevan el nombre de la categoría en su nombre accesible (D-094, RNF-019)", async () => {
    api([laura]);
    await abrir();
    expect(boton("Corregir el presupuesto de Transporte")).toHaveTextContent(
      "Corregir",
    );
    expect(boton("Quitar el presupuesto de Transporte")).toHaveTextContent(
      "Quitar",
    );
    expect(
      boton("Poner presupuesto a Arriendo o cuota de vivienda"),
    ).toHaveTextContent("Poner presupuesto");
  });

  it("sin fechas esperadas no hay «Llega después» ni la frase del salario", async () => {
    api([
      {
        ...laura,
        resumen: { ...laura.resumen, llega_despues_centavos: 0 },
        llega_despues: [],
      },
    ]);
    await abrir();
    expect(screen.queryByText(/Llega después/)).toBeNull();
    expect(screen.queryByText(/se suma cuando llegue/)).toBeNull();
    expect(
      screen.getByText("Sin asignar cuenta lo que ya registraste."),
    ).toBeInTheDocument();
  });

  it("con dos fechas esperadas suma «Llega después» y no nombra una sola", async () => {
    api([
      {
        ...laura,
        resumen: { ...laura.resumen, llega_despues_centavos: 240000000 },
        llega_despues: [
          salarioEsperado,
          { ...salarioEsperado, fecha: "2026-11-30" },
        ],
      },
    ]);
    await abrir();
    expect(
      screen.getByText(porTexto("Llega después: $2.400.000 (esperado)")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/se suma cuando llegue/)).toBeNull();
  });

  it("los tres estados describen sin calificar y una oculta lleva el ícono y la palabra «Oculta» (RN-011)", async () => {
    api([
      datos(laura.resumen, [
        fila({
          categoria_id: 1,
          presupuesto: { id: "p1", monto_centavos: 30000000 },
          gastado_centavos: 12000000,
          estado: "quedan",
          quedan_centavos: 18000000,
        }),
        fila({
          categoria_id: 13,
          presupuesto: { id: "p13", monto_centavos: 10000000 },
          gastado_centavos: 12000000,
          estado: "superado",
          quedan_centavos: null,
          oculta: true,
        }),
      ]),
    ]);
    await abrir();
    expect(filasDeCategoria()).toEqual([
      "AlimentaciónPresupuesto $300.000 · Gastado $120.000Quedan $180.000 por gastar.CorregirQuitar",
      "Restaurantes y hoteles OcultaPresupuesto $100.000 · Gastado $120.000Gastado $120.000 de $100.000 presupuestados.CorregirQuitar",
    ]);
  });

  it("sin presupuestos: «Todavía no tienes presupuesto este mes.» y las categorías con gasto con «Poner presupuesto»", async () => {
    api([datos(laura.resumen, [sinPresupuesto(4, 65000000)])]);
    await abrir();
    expect(tarjeta("Por categoría")).toHaveTextContent(
      "Por categoríaTodavía no tienes presupuesto este mes.Elige una categoría y pon cuánto quieres gastar en ella.Arriendo o cuota de vivienda",
    );
  });

  it("un error de carga dice el texto de E14 y «Intentar de nuevo» vuelve a pedir", async () => {
    let fallar = true;
    simularApi((p) => {
      if (p.ruta === "/api/v1/categorias") return json(200, catalogo);
      return fallar ? json(500, { error: "error_interno" }) : json(200, laura);
    });
    render(<Presupuesto />);
    expect(
      await screen.findByText("No pudimos cargar tu presupuesto."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tus datos están a salvo. Intenta de nuevo."),
    ).toBeInTheDocument();
    fallar = false;
    fireEvent.click(boton("Intentar de nuevo"));
    await screen.findByRole("heading", { level: 2, name: "Por categoría" });
  });

  it("sin sesión va a PN-60", async () => {
    simularApi(() => json(401, { error: "sin_sesion" }));
    render(<Presupuesto />);
    await waitFor(() => expect(window.location.pathname).toBe("/entrar"));
  });
});

describe("PN-07 · Presupuesto con ingreso bajo o nulo (E14-PPA 4.2)", () => {
  // RNF-017: ni Atención, ni rojo, ni signo menos, ni ninguna frase de la tabla «Lo que esta pantalla no dice nunca».
  const prohibidas =
    /sin ingresos|no tienes plata|no hay plata|te pasaste|de más|déficit|no alcanza|debes registrar|gasta menos|ahorra|-\$/i;
  const sinReproche = () => {
    expect(document.body.textContent).not.toMatch(prohibidas);
    expect(document.querySelector(".aviso--atencion")).toBeNull();
  };

  it("con ingreso nulo: «Ingreso registrado $0», el texto, «Registrar un ingreso» y «Dejar el presupuesto en cero», sin «Sin asignar»", async () => {
    api([nulo()]);
    await abrir();
    expect(tarjeta("Tu presupuesto este mes")).toHaveTextContent(
      "Tu presupuesto este mesIngreso registrado$0Puedes repartir lo que llegue o dejar el presupuesto en cero.Ver mis ingresos",
    );
    expect(screen.queryByText("Sin asignar")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Registrar un ingreso" }),
    ).toHaveAttribute("href", "/registrar?tipo=ingreso");
    expect(boton("Dejar el presupuesto en cero")).toHaveClass("boton--texto");
    expect(tarjeta("Por categoría")).toHaveTextContent(
      "Por categoríaTodavía no hay gastos este mes.",
    );
    sinReproche();
  });

  it("con ingreso bajo: las dos filas y la frase de E14, sin «Dejar el presupuesto en cero»", async () => {
    api([bajo]);
    await abrir();
    expect(tarjeta("Tu presupuesto este mes")).toHaveTextContent(
      "Tu presupuesto este mesIngreso registrado$150.000Asignado$160.000Lo asignado supera por $10.000 lo que registraste. Se actualiza cuando registres más ingresos.Ver mis ingresos",
    );
    expect(
      screen.getByRole("link", { name: "Registrar un ingreso" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dejar el presupuesto en cero")).toBeNull();
    expect(filasDeCategoria()).toEqual([
      "AlimentaciónPresupuesto $100.000 · Gastado $0Quedan $100.000 por gastar.CorregirQuitar",
      "TransportePresupuesto $60.000 · Gastado $0Quedan $60.000 por gastar.CorregirQuitar",
    ]);
    sinReproche();
  });

  it("con ingreso nulo y algo asignado no ofrece dejarlo en cero", async () => {
    api([
      {
        ...nulo(),
        resumen: { ...nulo().resumen, asignado_centavos: 6000000 },
      },
    ]);
    await abrir();
    expect(screen.queryByText("Dejar el presupuesto en cero")).toBeNull();
  });

  it("ya en cero (`en_cero`), el botón no vuelve a salir", async () => {
    api([nulo(true)]);
    await abrir();
    expect(screen.queryByText("Dejar el presupuesto en cero")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Registrar un ingreso" }),
    ).toBeInTheDocument();
  });

  it("«Dejar el presupuesto en cero» guarda la marca del mes, avisa por la región viva y el botón se va", async () => {
    const pedidos = api([nulo(), nulo(true)], () => json(204));
    await abrir();
    fireEvent.click(boton("Dejar el presupuesto en cero"));
    const estado = await screen.findByRole("status");
    await waitFor(() =>
      expect(estado).toHaveTextContent(
        "Listo, tu presupuesto de noviembre queda en cero. Cuando llegue un ingreso, puedes repartirlo.",
      ),
    );
    expect(escrituras(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/presupuestos/en-cero",
        cuerpo: { periodo: "2026-11" },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByText("Dejar el presupuesto en cero")).toBeNull(),
    );
    expect(document.activeElement).toHaveAttribute("id", "titulo-de-pagina");
    sinReproche();
  });

  it("si no se pudo dejar en cero, el aviso de error de guardado y el botón sigue", async () => {
    api([nulo()], () => json(500, { error: "error_interno" }));
    await abrir();
    fireEvent.click(boton("Dejar el presupuesto en cero"));
    expect(
      await screen.findByText("No pudimos guardar el presupuesto."),
    ).toBeInTheDocument();
    expect(boton("Dejar el presupuesto en cero")).toBeInTheDocument();
    sinReproche();
  });
});

describe("Hojas «Poner presupuesto», «Corregir» y «Quitar» (E14-PPA 4.1)", () => {
  it("«Poner presupuesto» abre la hoja con el título, el monto vacío, «Guardar», «Ahora no» y «Cerrar»", async () => {
    api([laura]);
    await abrir();
    fireEvent.click(boton("Poner presupuesto a Arriendo o cuota de vivienda"));
    const h = hoja("Presupuesto de Arriendo o cuota de vivienda");
    expect(within(h).getByLabelText("Monto para noviembre")).toHaveValue("");
    expect(within(h).getByRole("button", { name: "Guardar" })).toHaveClass(
      "boton--primario",
    );
    expect(within(h).getByRole("button", { name: "Ahora no" })).toBeVisible();
    expect(within(h).getByRole("button", { name: "Cerrar" })).toBeVisible();
    expect(document.activeElement).toHaveTextContent(
      "Presupuesto de Arriendo o cuota de vivienda",
    );
  });

  it("sin monto dice «Falta el monto.» y no manda nada; con «$0» dice el de E14-PPN 3.1", async () => {
    const pedidos = api([laura]);
    await abrir();
    fireEvent.click(boton("Poner presupuesto a Arriendo o cuota de vivienda"));
    fireEvent.click(boton("Guardar"));
    expect(await screen.findByText("Falta el monto.")).toBeInTheDocument();
    expect(screen.getByLabelText("Monto para noviembre")).toHaveFocus();
    escribirMonto("0");
    fireEvent.click(boton("Guardar"));
    expect(
      await screen.findByText(porTexto("El monto debe ser mayor que $0.")),
    ).toBeInTheDocument();
    escribirMonto("12,345");
    fireEvent.click(boton("Guardar"));
    expect(
      await screen.findByText("El monto puede tener hasta dos decimales."),
    ).toBeInTheDocument();
    expect(escrituras(pedidos)).toEqual([]);
  });

  it("al guardar manda los centavos del mes en curso, avisa y vuelve a pedir el presupuesto", async () => {
    const pedidos = api([laura]);
    await abrir();
    fireEvent.click(boton("Poner presupuesto a Arriendo o cuota de vivienda"));
    escribirMonto("650.000");
    fireEvent.click(boton("Guardar"));
    const estado = await screen.findByRole("status");
    await waitFor(() =>
      expect(estado).toHaveTextContent(
        "Listo, guardamos tu presupuesto de Arriendo o cuota de vivienda.",
      ),
    );
    expect(escrituras(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/presupuestos",
        cuerpo: {
          periodo: "2026-11",
          categoria_id: 4,
          monto_centavos: 65000000,
        },
      },
    ]);
    await waitFor(() => expect(lecturasDelPresupuesto(pedidos)).toBe(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mientras guarda, otro toque a «Guardar» no manda otro pedido", async () => {
    let soltar: (r: Response) => void = () => undefined;
    const pedidos = api(
      [laura],
      () => new Promise<Response>((r) => (soltar = r)),
    );
    await abrir();
    fireEvent.click(boton("Poner presupuesto a Arriendo o cuota de vivienda"));
    escribirMonto("650.000");
    fireEvent.click(boton("Guardar"));
    await waitFor(() =>
      expect(boton("Guardar")).toHaveAttribute("aria-disabled", "true"),
    );
    fireEvent.click(boton("Guardar"));
    expect(escrituras(pedidos)).toHaveLength(1);
    soltar(json(201, {}));
    await screen.findByRole("status");
  });

  it("«Corregir» abre la hoja con el monto actual escrito y manda un PUT al presupuesto", async () => {
    const pedidos = api([laura], () => json(200, {}));
    await abrir();
    fireEvent.click(boton("Corregir el presupuesto de Transporte"));
    const h = hoja("Corregir el presupuesto de Transporte");
    expect(within(h).getByLabelText("Monto para noviembre")).toHaveValue(
      "$40.000",
    );
    escribirMonto("45.000");
    fireEvent.click(within(h).getByRole("button", { name: "Guardar" }));
    const estado = await screen.findByRole("status");
    await waitFor(() =>
      expect(estado).toHaveTextContent(
        "Listo, guardamos tu presupuesto de Transporte.",
      ),
    );
    expect(escrituras(pedidos)).toEqual([
      {
        metodo: "PUT",
        ruta: "/api/v1/presupuestos/p8",
        cuerpo: { monto_centavos: 4500000 },
      },
    ]);
  });

  it("un error de campo del API va al campo; uno de servidor, al aviso de E14 dentro de la hoja", async () => {
    let respuesta = json(422, {
      error: "datos_invalidos",
      campos: { monto_centavos: "monto_no_positivo" },
    });
    api([laura], () => respuesta);
    await abrir();
    fireEvent.click(boton("Corregir el presupuesto de Transporte"));
    fireEvent.click(boton("Guardar"));
    expect(
      await screen.findByText(porTexto("El monto debe ser mayor que $0.")),
    ).toBeInTheDocument();
    respuesta = json(500, { error: "error_interno" });
    fireEvent.click(boton("Guardar"));
    const h = hoja("Corregir el presupuesto de Transporte");
    expect(
      await within(h).findByText("No pudimos guardar el presupuesto."),
    ).toBeInTheDocument();
    expect(
      within(h).getByText("Tus datos están a salvo. Intenta de nuevo."),
    ).toBeInTheDocument();
  });

  it("«Ahora no» y «Cerrar» cierran sin pedir nada y el foco vuelve al botón que la abrió", async () => {
    const pedidos = api([laura]);
    await abrir();
    fireEvent.click(boton("Corregir el presupuesto de Transporte"));
    fireEvent.click(boton("Ahora no"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(boton("Corregir el presupuesto de Transporte")).toHaveFocus();
    fireEvent.click(boton("Quitar el presupuesto de Transporte"));
    fireEvent.click(boton("Cerrar"));
    expect(boton("Quitar el presupuesto de Transporte")).toHaveFocus();
    expect(escrituras(pedidos)).toEqual([]);
  });

  it("«Quitar» pide confirmación; al confirmar borra el presupuesto, avisa y la fila vuelve a «Sin presupuesto»", async () => {
    const sinTransporte = datos(laura.resumen, [
      sinPresupuesto(4, 65000000),
      sinPresupuesto(8, 4000000),
    ]);
    const pedidos = api([laura, sinTransporte], () => json(204));
    await abrir();
    fireEvent.click(boton("Quitar el presupuesto de Transporte"));
    const h = hoja("¿Quitar el presupuesto de Transporte?");
    expect(h).toHaveTextContent(
      "Lo que gastaste no cambia. Puedes poner otro cuando quieras.",
    );
    expect(escrituras(pedidos)).toEqual([]);
    fireEvent.click(
      within(h).getByRole("button", { name: "Quitar presupuesto" }),
    );
    const estado = await screen.findByRole("status");
    await waitFor(() =>
      expect(estado).toHaveTextContent(
        "Listo, quitamos tu presupuesto de Transporte.",
      ),
    );
    expect(escrituras(pedidos)).toEqual([
      { metodo: "DELETE", ruta: "/api/v1/presupuestos/p8", cuerpo: undefined },
    ]);
    await waitFor(() =>
      expect(filasDeCategoria()).toContain(
        "TransporteGastado $40.000 · Sin presupuestoPoner presupuesto",
      ),
    );
  });

  it("si no se pudo quitar, la hoja sigue con el aviso de error", async () => {
    api([laura], () => json(500, { error: "error_interno" }));
    await abrir();
    fireEvent.click(boton("Quitar el presupuesto de Transporte"));
    fireEvent.click(boton("Quitar presupuesto"));
    const h = hoja("¿Quitar el presupuesto de Transporte?");
    expect(
      await within(h).findByText("No pudimos guardar el presupuesto."),
    ).toBeInTheDocument();
  });

  it("«Agregar otra categoría» lista las de gasto que no están en «Por categoría» y abre «Poner presupuesto» con la elegida", async () => {
    const pedidos = api([laura]);
    await abrir();
    const agregar = boton("Agregar otra categoría");
    expect(agregar).toHaveClass("boton--secundario");
    expect(agregar).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(agregar);
    expect(agregar).toHaveAttribute("aria-expanded", "true");
    const lista = screen.getByRole("list", { name: "Agregar otra categoría" });
    expect(
      within(lista)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Servicios públicos", "Otros gastos"]);
    fireEvent.click(
      within(lista).getByRole("button", { name: "Servicios públicos" }),
    );
    const h = hoja("Presupuesto de Servicios públicos");
    fireEvent.change(within(h).getByLabelText("Monto para noviembre"), {
      target: { value: "400.000" },
    });
    fireEvent.click(within(h).getByRole("button", { name: "Guardar" }));
    await screen.findByRole("status");
    expect(escrituras(pedidos)).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/presupuestos",
        cuerpo: {
          periodo: "2026-11",
          categoria_id: 5,
          monto_centavos: 40000000,
        },
      },
    ]);
  });

  it("un mes que no es el en curso (`editable` falso) no ofrece poner, corregir, quitar ni agregar", async () => {
    api([{ ...laura, editable: false }]);
    await abrir();
    expect(screen.queryByText("Corregir")).toBeNull();
    expect(screen.queryByText("Poner presupuesto")).toBeNull();
    expect(screen.queryByText("Agregar otra categoría")).toBeNull();
  });
});
