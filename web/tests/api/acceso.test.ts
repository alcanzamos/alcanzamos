import { describe, expect, it } from "vitest";
import {
  cambiarContrasena,
  ingresoAnterior,
  iniciarSesion,
} from "../../src/api/acceso";
import { json, simularApi } from "../ayudas";

describe("pedidos de acceso", () => {
  it("cada función llama a su ruta del contrato", async () => {
    const pedidos = simularApi(() => json(200, {}));
    await iniciarSesion({ identificador: "a@b.co", contrasena: "x" });
    await ingresoAnterior();
    await cambiarContrasena({ contrasena_actual: "a", contrasena_nueva: "b" });
    expect(pedidos).toEqual([
      {
        metodo: "POST",
        ruta: "/api/v1/sesiones",
        cuerpo: { identificador: "a@b.co", contrasena: "x" },
      },
      { metodo: "GET", ruta: "/api/v1/cuenta/seguridad", cuerpo: undefined },
      {
        metodo: "POST",
        ruta: "/api/v1/cuenta/contrasena",
        cuerpo: { contrasena_actual: "a", contrasena_nueva: "b" },
      },
    ]);
  });
});
