import { describe, expect, it } from "vitest";
import {
  borrarLaCuenta,
  cambiarCorreo,
  cerrarSesion,
  crearCuenta,
  descargarMisDatos,
  estadoDeLaCuenta,
  reenviarCorreo,
  resumenDeBorrado,
  verificarCorreo,
} from "../../src/api/cuentas";
import { json, simularApi } from "../ayudas";

describe("pedidos de cuenta", () => {
  it("cada función llama a su ruta del contrato", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await crearCuenta({
      correo: "a@b.co",
      contrasena: "x",
      nombre: "n",
      mayor_de_edad: true,
    });
    await verificarCorreo("tok");
    await estadoDeLaCuenta();
    await reenviarCorreo();
    await cambiarCorreo("c@d.co");
    await cerrarSesion();
    expect(pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      "POST /api/v1/cuentas",
      "POST /api/v1/cuentas/verificacion",
      "GET /api/v1/cuentas/estado",
      "POST /api/v1/cuentas/verificacion/reenvio",
      "POST /api/v1/cuentas/correo",
      "DELETE /api/v1/sesiones/actual",
    ]);
    expect(pedidos[0]?.cuerpo).toEqual({
      correo: "a@b.co",
      contrasena: "x",
      nombre: "n",
      mayor_de_edad: true,
    });
    expect(pedidos[1]?.cuerpo).toEqual({ token: "tok" });
    expect(pedidos[4]?.cuerpo).toEqual({ correo: "c@d.co" });
  });
});

describe("pedidos de PN-69", () => {
  it("el resumen y el borrado llaman a su ruta del contrato", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await resumenDeBorrado();
    await borrarLaCuenta({
      contrasena: "x",
      confirma_menores: true,
      menores: ["id-1"],
    });
    expect(pedidos).toEqual([
      { metodo: "GET", ruta: "/api/v1/cuenta/borrado", cuerpo: undefined },
      {
        metodo: "POST",
        ruta: "/api/v1/cuenta/borrado",
        cuerpo: { contrasena: "x", confirma_menores: true, menores: ["id-1"] },
      },
    ]);
  });
});

describe("descarga de los datos (PN-69, D-180)", () => {
  it("entrega el ZIP como blob con el nombre del encabezado", async () => {
    simularApi(
      () =>
        new Response(new Uint8Array([80, 75]), {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="datos.zip"',
          },
        }),
    );
    const r = await descargarMisDatos();
    expect(r.ok && r.cuerpo.size).toBe(2);
    expect(r.ok && r.nombre).toBe("datos.zip");
  });

  it("sin nombre en el encabezado usa el neutro; un fallo trae estado y código", async () => {
    simularApi(() => new Response(new Uint8Array([80, 75]), { status: 200 }));
    const r = await descargarMisDatos();
    expect(r.ok && r.nombre).toBe("alcanzamos-mis-datos.zip");
    simularApi(() => json(403, { error: "autorizacion_pendiente" }));
    expect(await descargarMisDatos()).toMatchObject({
      ok: false,
      estado: 403,
      codigo: "autorizacion_pendiente",
    });
    simularApi(() => new Response("no es json", { status: 500 }));
    expect(await descargarMisDatos()).toMatchObject({
      ok: false,
      codigo: "desconocido",
    });
    simularApi(() => {
      throw new TypeError("sin red");
    });
    expect(await descargarMisDatos()).toMatchObject({
      ok: false,
      estado: 0,
      codigo: "sin_conexion",
    });
  });
});
