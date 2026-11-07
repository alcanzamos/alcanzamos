import { describe, expect, it } from "vitest";
import {
  borrarLaCuenta,
  cerrarSesion,
  completarCuenta,
  crearCuenta,
  descargarMisDatos,
  reenviarCorreo,
  resumenDeBorrado,
} from "../../src/api/cuentas";
import { json, simularApi } from "../ayudas";

describe("pedidos de cuenta (verificar primero, D-172)", () => {
  it("cada función llama a su ruta del contrato", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await crearCuenta({ correo: "a@b.co", mayor_de_edad: true });
    await reenviarCorreo("c@d.co");
    await completarCuenta({
      token: "tok",
      contrasena: "lluvia café tren azul",
      nombre: "Laura",
    });
    await cerrarSesion();
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/cuentas",
        cuerpo: { correo: "a@b.co", mayor_de_edad: true },
      },
      {
        metodo: "POST",
        ruta: "/api/v1/cuentas/verificacion/reenvio",
        cuerpo: { correo: "c@d.co" },
      },
      {
        metodo: "POST",
        ruta: "/api/v1/cuentas/verificacion",
        cuerpo: {
          token: "tok",
          contrasena: "lluvia café tren azul",
          nombre: "Laura",
        },
      },
      {
        metodo: "DELETE",
        ruta: "/api/v1/sesiones/actual",
        cuerpo: undefined,
      },
    ]);
  });

  it("el cliente ya no tiene «Ya lo confirmé» ni «Cambiar el correo» (rutas retiradas)", async () => {
    const cuentas: Record<string, unknown> =
      await import("../../src/api/cuentas");
    expect(cuentas.estadoDeLaCuenta).toBeUndefined();
    expect(cuentas.cambiarCorreo).toBeUndefined();
    expect(cuentas.verificarCorreo).toBeUndefined();
  });

  it("completar la cuenta entrega el estado y los fallos traen su código", async () => {
    simularApi(() => json(200, { estado: "activa" }));
    expect(
      await completarCuenta({ token: "t", contrasena: "x", nombre: "n" }),
    ).toMatchObject({ ok: true, estado: 200, cuerpo: { estado: "activa" } });
    simularApi(() => json(400, { error: "enlace_invalido" }));
    expect(
      await completarCuenta({ token: "t", contrasena: "x", nombre: "n" }),
    ).toMatchObject({ ok: false, estado: 400, codigo: "enlace_invalido" });
    simularApi(() =>
      json(422, {
        error: "validacion",
        campos: { contrasena: "contrasena_personal" },
      }),
    );
    expect(
      await completarCuenta({ token: "t", contrasena: "x", nombre: "n" }),
    ).toMatchObject({
      ok: false,
      estado: 422,
      codigo: "validacion",
      campos: { contrasena: "contrasena_personal" },
    });
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
