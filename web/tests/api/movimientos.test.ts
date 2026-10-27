import { describe, expect, it } from "vitest";
import { listarMovimientos } from "../../src/api/movimientos";
import { json, simularApi } from "../ayudas";

describe("API de movimientos (PN-01)", () => {
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
});
