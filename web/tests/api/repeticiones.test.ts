import { describe, expect, it, vi } from "vitest";
import {
  confirmarFecha,
  decidir,
  listarPendientes,
  omitirFecha,
} from "../../src/api/repeticiones";
import { json, simularApi } from "../ayudas";

// `simularApi` lee el cuerpo con JSON.parse (pasa por number): aquí se mira el texto que viaja.
const llamada = () => vi.mocked(fetch).mock.calls.at(-1);
const cuerpoEnviado = () => String(llamada()?.[1]?.body);
const cabeceras = () => llamada()?.[1]?.headers as Record<string, string>;

describe("API de «Por confirmar» (PN-01 y «Confirmar todos»)", () => {
  it("pide las fechas pendientes con GET y sin cuerpo", async () => {
    const pedidos = simularApi(() =>
      json(200, {
        pendientes: [],
        resumen: { total: 0, ingresos: 0, gastos: 0 },
      }),
    );
    const respuesta = await listarPendientes();
    expect(pedidos).toEqual([
      {
        metodo: "GET",
        ruta: "/api/v1/repeticiones/pendientes",
        cuerpo: undefined,
      },
    ]);
    expect(respuesta).toMatchObject({ ok: true, estado: 200 });
  });

  it("el monto habitual y las sumas llegan exactos: un entero de 64 bits no pasa por number", async () => {
    simularApi(
      () =>
        new Response(
          '{"pendientes":[{"recurrente_id":"r1","fecha":"2026-11-26","monto_habitual_centavos":9223372036854775806}],"resumen":{"total":1,"ingresos":1,"gastos":0}}',
        ),
    );
    const respuesta = await listarPendientes();
    expect(respuesta).toMatchObject({
      ok: true,
      cuerpo: {
        pendientes: [{ monto_habitual_centavos: "9223372036854775806" }],
      },
    });
  });

  it("confirmar con el monto habitual manda solo la fecha, con Content-Type JSON", async () => {
    const pedidos = simularApi(() => json(201, {}));
    await confirmarFecha("r1", "2026-11-26");
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r1/confirmacion",
        cuerpo: { fecha: "2026-11-26" },
      },
    ]);
    expect(cabeceras()["Content-Type"]).toBe("application/json");
  });

  it("confirmar con otro monto manda los centavos como entero exacto (D-082)", async () => {
    simularApi(() => json(201, {}));
    await confirmarFecha("r1", "2026-11-26", 9223372036854775807n);
    expect(cuerpoEnviado()).toBe(
      '{"fecha":"2026-11-26","monto_centavos":9223372036854775807}',
    );
    expect(cabeceras()["Content-Type"]).toBe("application/json");
  });

  it("«No pasó» manda la fecha, sin monto, con Content-Type JSON", async () => {
    const pedidos = simularApi(() => json(204));
    const respuesta = await omitirFecha("r1", "2026-11-12");
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/repeticiones/r1/omision",
        cuerpo: { fecha: "2026-11-12" },
      },
    ]);
    expect(cabeceras()["Content-Type"]).toBe("application/json");
    expect(respuesta).toMatchObject({ ok: true, estado: 204 });
  });

  it("el id de la repetición va codificado en la ruta", async () => {
    const pedidos = simularApi(() => json(204));
    await omitirFecha("a/b", "2026-11-12");
    expect(pedidos[0]?.ruta).toBe("/api/v1/repeticiones/a%2Fb/omision");
  });

  it("«Confirmar todos» manda cada decisión: el monto solo si cambió y «omitida» solo en «No pasó»", async () => {
    simularApi(() => json(200, {}));
    await decidir([
      { recurrenteId: "r1", fecha: "2026-11-05" },
      { recurrenteId: "r2", fecha: "2026-12-01", montoCentavos: 110000000n },
      { recurrenteId: "r3", fecha: "2026-11-12", omitida: true },
    ]);
    expect(cuerpoEnviado()).toBe(
      '{"decisiones":[{"recurrente_id":"r1","fecha":"2026-11-05"},{"recurrente_id":"r2","fecha":"2026-12-01","monto_centavos":110000000},{"recurrente_id":"r3","fecha":"2026-11-12","omitida":true}]}',
    );
    expect(llamada()?.[0]).toBe("/api/v1/repeticiones/decisiones");
    expect(llamada()?.[1]?.method).toBe("POST");
    expect(cabeceras()["Content-Type"]).toBe("application/json");
  });

  it("un conflicto y una fecha que ya no está pendiente llegan con su código", async () => {
    simularApi(() => json(409, { error: "conflicto_concurrente" }));
    expect(
      await decidir([{ recurrenteId: "r1", fecha: "2026-11-05" }]),
    ).toEqual({
      ok: false,
      estado: 409,
      codigo: "conflicto_concurrente",
      campos: {},
    });
    simularApi(() => json(409, { error: "fecha_no_pendiente" }));
    expect(await confirmarFecha("r1", "2026-11-05")).toMatchObject({
      codigo: "fecha_no_pendiente",
    });
  });
});
