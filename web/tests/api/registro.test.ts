import { describe, expect, it, vi } from "vitest";
import {
  guardarMovimiento,
  obtenerCategorias,
  obtenerProximas,
  type Solicitud,
} from "../../src/api/registro";
import { json, simularApi } from "../ayudas";

const base: Solicitud = {
  tipo: "gasto",
  montoCentavos: 4500000n,
  fecha: "2026-10-26",
  categoriaId: 1,
  medio: "efectivo",
  descripcion: "",
  periodicidad: null,
};

// El cuerpo crudo que viaja: `simularApi` lo lee con JSON.parse, que pasa por number; aquí se mira el texto.
function cuerpoEnviado(): string {
  const llamada = vi.mocked(fetch).mock.calls.at(-1);
  return String(llamada?.[1]?.body);
}

describe("API del registro", () => {
  it("pide las categorías", async () => {
    const catalogo = { gasto: [], ingreso: [] };
    const pedidos = simularApi(() => json(200, catalogo));
    expect(await obtenerCategorias()).toMatchObject({
      ok: true,
      cuerpo: catalogo,
    });
    expect(pedidos).toEqual([
      { metodo: "GET", ruta: "/api/v1/categorias", cuerpo: undefined },
    ]);
  });

  it("pide las próximas fechas con la periodicidad y el inicio, y no las calcula", async () => {
    const pedidos = simularApi(() =>
      json(200, { proximas: ["2026-11-15", "2026-12-15", "2027-01-15"] }),
    );
    expect(await obtenerProximas("mensual", "2026-08-15")).toMatchObject({
      ok: true,
      cuerpo: { proximas: ["2026-11-15", "2026-12-15", "2027-01-15"] },
    });
    expect(pedidos).toEqual([
      {
        metodo: "GET",
        ruta: "/api/v1/repeticiones/proximas?periodicidad=mensual&inicio=2026-08-15",
        cuerpo: undefined,
      },
    ]);
  });

  it("manda los centavos enteros, la fecha y los ids, sin descripción ni repetición", async () => {
    const pedidos = simularApi(() => json(201, {}));
    await guardarMovimiento(base);
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/movimientos",
        cuerpo: {
          monto_centavos: 4500000,
          tipo: "gasto",
          fecha: "2026-10-26",
          categoria_id: 1,
          medio: "efectivo",
        },
      },
    ]);
  });

  it("manda la descripción recortada y la periodicidad", async () => {
    const pedidos = simularApi(() => json(201, {}));
    await guardarMovimiento({
      ...base,
      tipo: "ingreso",
      medio: "transferencia",
      descripcion: "  Arriendo  ",
      periodicidad: "mensual",
    });
    expect(pedidos[0]?.cuerpo).toEqual({
      monto_centavos: 4500000,
      tipo: "ingreso",
      fecha: "2026-10-26",
      categoria_id: 1,
      medio: "transferencia",
      descripcion: "Arriendo",
      repeticion: { periodicidad: "mensual" },
    });
  });

  it("una descripción de solo espacios no se manda", async () => {
    const pedidos = simularApi(() => json(201, {}));
    await guardarMovimiento({ ...base, descripcion: "   " });
    expect(pedidos[0]?.cuerpo).not.toHaveProperty("descripcion");
  });

  it("escribe un monto de 64 bits con todos sus dígitos (EXA-001)", async () => {
    simularApi(() => json(201, {}));
    await guardarMovimiento({
      ...base,
      montoCentavos: 9223372036854775807n,
    });
    expect(cuerpoEnviado()).toContain('"monto_centavos":9223372036854775807,');
    await guardarMovimiento({ ...base, montoCentavos: 9007199254740993n });
    expect(cuerpoEnviado()).toContain('"monto_centavos":9007199254740993,');
    // Sigue siendo un JSON válido.
    expect(() => JSON.parse(cuerpoEnviado())).not.toThrow();
  });

  it("una descripción que parece JSON no rompe el cuerpo", async () => {
    simularApi(() => json(201, {}));
    await guardarMovimiento({
      ...base,
      descripcion: '"},"monto_centavos":1,"',
    });
    const cuerpo = JSON.parse(cuerpoEnviado()) as Record<string, unknown>;
    expect(cuerpo.monto_centavos).toBe(4500000);
    expect(cuerpo.descripcion).toBe('"},"monto_centavos":1,"');
  });
});
