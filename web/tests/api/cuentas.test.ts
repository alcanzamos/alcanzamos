import { describe, expect, it } from "vitest";
import {
  cambiarCorreo,
  cerrarSesion,
  crearCuenta,
  estadoDeLaCuenta,
  reenviarCorreo,
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
