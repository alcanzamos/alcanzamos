import { describe, expect, it } from "vitest";
import { interpretarTexto } from "../../src/api/movimientos";
import { json, simularApi } from "../ayudas";

// api/README.md, «Interpretar un texto»: el API no guarda nada y el cliente solo manda el texto y muestra lo que recibe.
describe("API de la interpretación (api/README.md, POST /api/v1/movimientos/interpretacion)", () => {
  it("manda solo el texto y devuelve la propuesta con los centavos como texto (D-082)", async () => {
    const pedidos = simularApi(
      () =>
        new Response(
          '{"resultado":"propuesta","tipo":"gasto","monto_centavos":9223372036854775807,"categoria":{"id":1,"nombre":"x"},"fecha":"2026-11-01","varios_movimientos":false}',
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const respuesta = await interpretarTexto("mercado 45 mil ayer");
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/movimientos/interpretacion",
        cuerpo: { texto: "mercado 45 mil ayer" },
      },
    ]);
    expect(respuesta).toMatchObject({
      ok: true,
      cuerpo: {
        resultado: "propuesta",
        monto_centavos: "9223372036854775807",
        categoria: { id: 1 },
      },
    });
  });

  it("un monto ambiguo trae las dos lecturas y ningún monto", async () => {
    simularApi(() =>
      json(200, {
        resultado: "monto_ambiguo",
        tipo: "gasto",
        monto_centavos: null,
        categoria: null,
        fecha: "2026-11-01",
        varios_movimientos: false,
        lecturas_del_monto: {
          con_punto_de_miles: "12.500",
          con_coma_decimal: "12,50",
        },
      }),
    );
    expect(await interpretarTexto("12.5")).toMatchObject({
      ok: true,
      cuerpo: { monto_centavos: null },
    });
  });

  it("un 422 vuelve con el código del campo texto", async () => {
    simularApi(() =>
      json(422, { error: "datos_invalidos", campos: { texto: "texto_largo" } }),
    );
    expect(await interpretarTexto("x")).toEqual({
      ok: false,
      estado: 422,
      codigo: "datos_invalidos",
      campos: { texto: "texto_largo" },
    });
  });
});
