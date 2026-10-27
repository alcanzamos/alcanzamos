import { describe, expect, it, vi } from "vitest";
import {
  borrarMovimiento,
  corregirMovimiento,
  listarMovimientos,
  type Movimiento,
} from "../../src/api/movimientos";
import type { Solicitud } from "../../src/api/registro";
import { json, simularApi } from "../ayudas";

const base: Solicitud = {
  tipo: "gasto",
  montoCentavos: 4000000n,
  fecha: "2026-10-24",
  categoriaId: 5,
  medio: "efectivo",
  descripcion: "",
  periodicidad: null,
};

const suelto: Movimiento = {
  id: "m1",
  tipo: "gasto",
  monto_centavos: "4500000",
  fecha: "2026-10-25",
  categoria_id: 1,
  medio: "transferencia",
  descripcion: null,
  compartido: false,
  meta: null,
  sentido: null,
  recurrente: null,
};

// `simularApi` lee el cuerpo con JSON.parse (pasa por number): aquí se mira el texto que viaja.
const cuerpoEnviado = () =>
  String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body);

describe("API de movimientos (PN-01 y PN-02)", () => {
  it("pide la lista del mes de hoy sin filtros, y con periodo y categoría cuando se eligen", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await listarMovimientos(null, null);
    await listarMovimientos("2026-10", 4);
    expect(pedidos.map((p) => p.ruta)).toEqual([
      "/api/v1/movimientos?",
      "/api/v1/movimientos?periodo=2026-10&categoria=4",
    ]);
  });

  it("los montos de la lista llegan exactos: un entero de 64 bits no pasa por number", async () => {
    simularApi(
      () =>
        new Response(
          '{"resumen":{"movimientos":2,"total_centavos":9223372036854775807},"movimientos":[{"monto_centavos":9223372036854775806,"descripcion":"\\"monto_centavos\\":5"}]}',
        ),
    );
    const respuesta = await listarMovimientos(null, null);
    expect(respuesta).toMatchObject({
      ok: true,
      cuerpo: {
        resumen: { total_centavos: "9223372036854775807" },
        movimientos: [
          {
            monto_centavos: "9223372036854775806",
            descripcion: '"monto_centavos":5',
          },
        ],
      },
    });
  });

  it("borra con DELETE y acepta el 204 sin cuerpo", async () => {
    const pedidos = simularApi(() => json(204));
    expect(await borrarMovimiento("m1")).toMatchObject({ ok: true });
    expect(pedidos).toEqual([
      { metodo: "DELETE", ruta: "/api/v1/movimientos/m1", cuerpo: undefined },
    ]);
  });

  it("corrige con PUT y manda todos los campos, con los centavos enteros", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await corregirMovimiento(
      {
        ...base,
        montoCentavos: 9223372036854775807n,
        descripcion: " Mercado ",
      },
      suelto,
    );
    expect(cuerpoEnviado()).toBe(
      '{"monto_centavos":9223372036854775807,"tipo":"gasto","fecha":"2026-10-24","categoria_id":5,"medio":"efectivo","descripcion":"Mercado"}',
    );
    expect(pedidos[0]).toMatchObject({
      metodo: "PUT",
      ruta: "/api/v1/movimientos/m1",
    });
  });

  it("una descripción vacía no se manda (el API la borra: es un reemplazo)", async () => {
    simularApi(() => json(200, {}));
    await corregirMovimiento(base, suelto);
    expect(cuerpoEnviado()).not.toContain("descripcion");
  });

  it("D-168: la fecha de un recurrente no se manda", async () => {
    simularApi(() => json(200, {}));
    const recurrente: Movimiento = {
      ...suelto,
      recurrente: {
        recurrente_id: "r1",
        fecha_programada: "2026-10-25",
        periodicidad: "quincenal",
        vuelve_a_pendiente: true,
      },
    };
    await corregirMovimiento(base, recurrente);
    expect(JSON.parse(cuerpoEnviado())).toEqual({
      monto_centavos: 4000000,
      tipo: "gasto",
      categoria_id: 5,
      medio: "efectivo",
    });
  });

  it("un aporte manda su tipo y no lleva categoría", async () => {
    simularApi(() => json(200, {}));
    const aporte: Movimiento = {
      ...suelto,
      tipo: "aporte",
      categoria_id: null,
      meta: { id: "g1", nombre: "Arriendo de enero" },
      sentido: "entrada",
    };
    await corregirMovimiento({ ...base, categoriaId: null }, aporte);
    expect(JSON.parse(cuerpoEnviado())).toEqual({
      monto_centavos: 4000000,
      tipo: "aporte",
      fecha: "2026-10-24",
      medio: "efectivo",
    });
  });
});
