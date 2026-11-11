import { describe, expect, it, vi } from "vitest";
import {
  corregirPresupuesto,
  dejarEnCero,
  leerPresupuesto,
  listarIngresos,
  ponerPresupuesto,
  quitarPresupuesto,
} from "../../src/api/presupuesto";
import type { FechaQueLlegaDespues } from "../../src/api/presupuesto";
import { json, simularApi } from "../ayudas";

// `simularApi` lee el cuerpo con JSON.parse (pasa por number): aquí se mira el texto que viaja.
const llamada = () => vi.mocked(fetch).mock.calls.at(-1);
const cuerpoEnviado = () => String(llamada()?.[1]?.body);
const cabeceras = () => llamada()?.[1]?.headers as Record<string, string>;

describe("API del presupuesto (PN-06 y PN-07)", () => {
  it("pide el presupuesto del mes en curso con GET, sin periodo ni cuerpo", async () => {
    const pedidos = simularApi(() => json(200, {}));
    const respuesta = await leerPresupuesto();
    expect(pedidos).toEqual([
      { metodo: "GET", ruta: "/api/v1/presupuestos", cuerpo: undefined },
    ]);
    expect(respuesta).toMatchObject({ ok: true, estado: 200 });
  });

  it("los montos y las sumas llegan exactos: un entero de 64 bits no pasa por number (D-082)", async () => {
    simularApi(
      () =>
        new Response(
          '{"resumen":{"ingreso_registrado_centavos":9223372036854775807,"sin_asignar_centavos":null,"llega_despues_centavos":0},"categorias":[{"presupuesto":{"id":"p1","monto_centavos":9223372036854775806},"gastado_centavos":18446744073709551614}]}',
        ),
    );
    const respuesta = await leerPresupuesto();
    expect(respuesta).toMatchObject({
      ok: true,
      cuerpo: {
        resumen: {
          ingreso_registrado_centavos: "9223372036854775807",
          sin_asignar_centavos: null,
          llega_despues_centavos: "0",
        },
        categorias: [
          {
            presupuesto: { monto_centavos: "9223372036854775806" },
            gastado_centavos: "18446744073709551614",
          },
        ],
      },
    });
  });

  it("«Poner presupuesto» manda el periodo, la categoría y los centavos como entero exacto, con Content-Type JSON", async () => {
    const pedidos = simularApi(() => json(201, {}));
    await ponerPresupuesto("2026-11", 5, 9223372036854775807n);
    expect(cuerpoEnviado()).toBe(
      '{"periodo":"2026-11","categoria_id":5,"monto_centavos":9223372036854775807}',
    );
    expect(pedidos[0]).toMatchObject({
      metodo: "POST",
      ruta: "/api/v1/presupuestos",
    });
    expect(cabeceras()["Content-Type"]).toBe("application/json");
  });

  it("«Corregir» manda solo el monto con PUT al id, codificado en la ruta", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await corregirPresupuesto("a/b", 4000000n);
    expect(cuerpoEnviado()).toBe('{"monto_centavos":4000000}');
    expect(pedidos[0]).toMatchObject({
      metodo: "PUT",
      ruta: "/api/v1/presupuestos/a%2Fb",
    });
    expect(cabeceras()["Content-Type"]).toBe("application/json");
  });

  it("«Quitar presupuesto» es un DELETE sin cuerpo, con Content-Type JSON (D-194)", async () => {
    const pedidos = simularApi(() => json(204));
    const respuesta = await quitarPresupuesto("p1");
    expect(pedidos).toEqual([
      { metodo: "DELETE", ruta: "/api/v1/presupuestos/p1", cuerpo: undefined },
    ]);
    expect(cabeceras()["Content-Type"]).toBe("application/json");
    expect(respuesta).toMatchObject({ ok: true, estado: 204 });
  });

  it("«Dejar el presupuesto en cero» manda el periodo a la ruta de la marca", async () => {
    const pedidos = simularApi(() => json(204));
    await dejarEnCero("2026-11");
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/presupuestos/en-cero",
        cuerpo: { periodo: "2026-11" },
      },
    ]);
  });

  it("los errores de campo y de estado llegan con su código", async () => {
    simularApi(() =>
      json(422, {
        error: "datos_invalidos",
        campos: { monto_centavos: "monto_no_positivo" },
      }),
    );
    expect(await ponerPresupuesto("2026-11", 5, 1n)).toEqual({
      ok: false,
      estado: 422,
      codigo: "datos_invalidos",
      campos: { monto_centavos: "monto_no_positivo" },
    });
    simularApi(() => json(409, { error: "periodo_con_ingreso_o_presupuesto" }));
    expect(await dejarEnCero("2026-11")).toMatchObject({
      estado: 409,
      codigo: "periodo_con_ingreso_o_presupuesto",
    });
  });
});

describe("API de los ingresos del periodo (PN-08)", () => {
  it("sin periodo pide el mes en curso; con periodo, ese mes", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await listarIngresos(null);
    await listarIngresos("2026-10");
    expect(pedidos.map((p) => [p.metodo, p.ruta])).toEqual([
      ["GET", "/api/v1/ingresos"],
      ["GET", "/api/v1/ingresos?periodo=2026-10"],
    ]);
  });

  it("los totales y los montos de cada fecha llegan exactos (D-082)", async () => {
    simularApi(
      () =>
        new Response(
          '{"total":{"entran_centavos":18446744073709551614,"registrado_centavos":9223372036854775807,"esperado_centavos":9223372036854775807,"por_confirmar":2},"fuentes":[{"total_centavos":120000000,"ingresos":[{"monto_centavos":120000000}]}]}',
        ),
    );
    expect(await listarIngresos(null)).toMatchObject({
      ok: true,
      cuerpo: {
        total: {
          entran_centavos: "18446744073709551614",
          registrado_centavos: "9223372036854775807",
          por_confirmar: 2,
        },
        fuentes: [
          {
            total_centavos: "120000000",
            ingresos: [{ monto_centavos: "120000000" }],
          },
        ],
      },
    });
  });

  it("«Llega después» solo admite lo esperado (L12 (1) de la US-77)", () => {
    const fecha: FechaQueLlegaDespues = {
      recurrente_id: "r1",
      fecha: "2026-11-16",
      categoria_id: 1,
      monto_centavos: "100000000",
      // @ts-expect-error lo por confirmar sigue en Movimientos y en PN-08
      marca: "por_confirmar",
    };
    expect(fecha.recurrente_id).toBe("r1");
  });
});
