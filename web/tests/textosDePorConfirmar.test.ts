import { describe, expect, it } from "vitest";
import type { Movimiento } from "../src/api/movimientos";
import type { Pendiente } from "../src/api/repeticiones";
import {
  avisoDeConfirmado,
  avisoDeGuardado,
  avisosDePorConfirmar,
  textosDeFilaPorConfirmar,
} from "../src/textosDePorConfirmar";

const salario: Pendiente = {
  recurrente_id: "r1",
  fecha: "2026-11-16",
  tipo: "ingreso",
  categoria_id: 17,
  medio: "transferencia",
  monto_habitual_centavos: "120000000",
  periodicidad: "mensual",
};
const arriendo: Pendiente = {
  ...salario,
  recurrente_id: "r2",
  fecha: "2026-12-01",
  tipo: "gasto",
  categoria_id: 4,
};

describe("textos de una fila «Por confirmar» (E14-PRR 4.1 y 4.8)", () => {
  it("la fila de un ingreso: categoría, apoyo con medio, y los nombres accesibles de E14", () => {
    expect(textosDeFilaPorConfirmar(salario)).toEqual({
      principal: "Salario",
      fecha: "16 de noviembre de 2026",
      apoyo: "Ingreso · Transferencia · 16 de noviembre de 2026",
      apoyoSinMedio: "Ingreso · 16 de noviembre de 2026",
      nombreDeConfirmar: "Confirmar Salario del 16 de noviembre de 2026",
      nombreDeMas: "Más opciones de Salario del 16 de noviembre de 2026",
      tituloDeLaHoja: "Salario · 16 de noviembre de 2026",
      tituloDelMonto: "¿Cuánto llegó?",
    });
  });

  it("la fila de un gasto dice «Gasto» y pregunta «¿Cuánto pagaste?»", () => {
    expect(textosDeFilaPorConfirmar(arriendo)).toMatchObject({
      principal: "Arriendo o cuota de vivienda",
      apoyo: "Gasto · Transferencia · 1 de diciembre de 2026",
      apoyoSinMedio: "Gasto · 1 de diciembre de 2026",
      tituloDelMonto: "¿Cuánto pagaste?",
    });
  });

  it("una fecha o una categoría que no se conocen no rompen la fila", () => {
    const rara = { ...salario, fecha: "no", categoria_id: 999 };
    expect(textosDeFilaPorConfirmar(rara)).toMatchObject({
      principal: "",
      fecha: "no",
    });
  });
});

const mov = (cambios: Partial<Movimiento>): Movimiento => ({
  id: "m1",
  tipo: "ingreso",
  monto_centavos: "120000000",
  fecha: "2026-11-16",
  categoria_id: 17,
  medio: "transferencia",
  descripcion: null,
  compartido: false,
  meta: null,
  sentido: null,
  recurrente: null,
  ...cambios,
});

describe("avisos de «Por confirmar»", () => {
  it("después de confirmar, con el monto del movimiento guardado", () => {
    expect(avisoDeConfirmado(mov({}))).toEqual({
      tipo: "informacion",
      titulo: "Listo, confirmamos tu ingreso de $1.200.000.",
    });
    expect(
      avisoDeConfirmado(mov({ tipo: "gasto", monto_centavos: "65000000" })),
    ).toEqual({
      tipo: "informacion",
      titulo: "Listo, confirmamos tu gasto de $650.000.",
    });
  });

  it.each([
    [12, 1, "Listo, guardamos 12 movimientos y dejamos de contar 1 fecha."],
    [13, 0, "Listo, guardamos 13 movimientos."],
    [1, 0, "Listo, guardamos 1 movimiento."],
    [0, 1, "Listo, dejamos de contar 1 fecha."],
    [1, 2, "Listo, guardamos 1 movimiento y dejamos de contar 2 fechas."],
    [0, 2, "Listo, dejamos de contar 2 fechas."],
  ])(
    "al guardar %i movimientos y %i «No pasó»",
    (guardados, omitidas, esperado) => {
      expect(avisoDeGuardado(guardados, omitidas)).toEqual({
        tipo: "informacion",
        titulo: esperado,
      });
    },
  );

  it("los errores llevan el título y el mensaje de E14", () => {
    expect(avisosDePorConfirmar.errorAlConfirmar).toEqual({
      tipo: "informacion",
      titulo: "No pudimos confirmar el movimiento.",
      mensaje: "Sigue por confirmar. Intenta de nuevo.",
    });
    expect(avisosDePorConfirmar.errorAlOmitir).toMatchObject({
      titulo: "No pudimos guardar el cambio.",
      mensaje: "Sigue por confirmar. Intenta de nuevo.",
    });
    expect(avisosDePorConfirmar.errorAlGuardar).toMatchObject({
      titulo: "No pudimos guardar tus movimientos.",
      mensaje: "No se guardó ninguno. Intenta de nuevo.",
    });
    expect(avisosDePorConfirmar.yaNoContamos).toEqual({
      tipo: "informacion",
      titulo: "Listo, ya no contamos esa fecha.",
    });
  });
});
