import { describe, expect, it } from "vitest";
import {
  avisoDeFallo,
  avisos,
  textoDeErrorDeCampo,
  textosDeRepeticion,
} from "../src/textos";

const fallo = (estado: number, codigo: string) =>
  ({ ok: false, estado, codigo, campos: {} }) as const;

const generico = { tipo: "informacion", titulo: "Genérico" } as const;

describe("textos de E14", () => {
  it.each([
    ["correo_vacio", "Falta el correo electrónico."],
    [
      "correo_invalido",
      "Falta completar el correo. Por ejemplo, nombre@correo.com.",
    ],
  ])("el código %s da su texto", (codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo)).toBe(texto);
  });

  it.each([
    ["contrasena_vacia", "Falta la contraseña."],
    [
      "contrasena_corta",
      "Falta que la contraseña tenga al menos 15 caracteres.",
    ],
    [
      "contrasena_comun",
      "Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.",
    ],
    [
      "contrasena_personal",
      "Falta una contraseña que no incluya tu correo ni el nombre de la app.",
    ],
    ["nombre_vacio", "Falta el nombre para mostrar."],
    // E14-PCP 4.16 T5 (D-153)
    ["nombre_largo", "Escribe un nombre de hasta 60 caracteres."],
    ["mayor_de_edad_requerido", "Falta marcar que eres mayor de edad."],
  ])("en PN-58 el código %s da su texto", (codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo, "crearCuenta")).toBe(texto);
  });

  it.each([
    ["entrar", "identificador_vacio", "Falta el correo electrónico."],
    ["entrar", "contrasena_vacia", "Falta la contraseña."],
    ["contrasenaNueva", "contrasena_vacia", "Falta la contraseña nueva."],
    ["contrasenaDeAhora", "contrasena_vacia", "Falta tu contraseña de ahora."],
    [
      "contrasenaDeAhora",
      "contrasena_actual_incorrecta",
      "No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.",
    ],
  ] as const)("en %s el código %s da su texto", (pantalla, codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo, pantalla)).toBe(texto);
  });

  it("PN-62 tiene los textos de la repetición", () => {
    expect(textosDeRepeticion).toEqual({
      vacia: "Falta repetir la contraseña.",
      distinta: "Falta que las dos contraseñas sean iguales.",
    });
  });

  it("el campo del correo de PN-59 solo tiene los errores del correo", () => {
    expect(textoDeErrorDeCampo("correo_vacio", "correo")).toBe(
      "Falta el correo electrónico.",
    );
    expect(textoDeErrorDeCampo("nombre_vacio", "correo")).toBeUndefined();
  });

  it("un código sin texto en E14 no inventa uno", () => {
    expect(textoDeErrorDeCampo("desconocido")).toBeUndefined();
  });

  // Textos de avisos de E14-PCP 4.1, 4.2 y 4.16 (T6, T8, T9, T11), palabra por palabra.
  it.each([
    [
      avisos.errorAlCrearCuenta,
      "No pudimos crear la cuenta.",
      "Tus datos no se perdieron. Intenta de nuevo.",
    ],
    [
      avisos.errorAlEnviarCorreo,
      "No pudimos enviar el correo.",
      "Intenta de nuevo.",
    ],
    [
      avisos.errorAlRevisarElCorreo,
      "No pudimos revisar si confirmaste tu correo.",
      "Intenta de nuevo.",
    ],
    [
      avisos.errorAlConfirmarElCorreo,
      "No pudimos confirmar tu correo.",
      "Intenta de nuevo.",
    ],
    [
      avisos.sinConfirmarTodavia,
      "Todavía no confirmaste tu correo.",
      "Abre el enlace que te enviamos.",
    ],
    [avisos.correoReenviado, "Te enviamos otro correo.", undefined],
    [avisos.correoConfirmado, "Listo, confirmamos tu correo.", undefined],
    [avisos.enlaceVencido, "Ese enlace ya no sirve.", "Pide uno nuevo."],
    [avisos.sesionCerrada, "Tu sesión se cerró. Entra de nuevo.", undefined],
    [
      avisos.datosNoCoinciden,
      "No pudimos entrar con esos datos.",
      "Revisa lo que escribiste e intenta de nuevo.",
    ],
    // E14-PCP 4.16 T7 (D-153)
    [
      avisos.errorAlIniciarSesion,
      "No pudimos iniciar tu sesión.",
      "El problema es de nuestro lado. Intenta de nuevo en un momento.",
    ],
    [
      avisos.errorAlCambiarContrasena,
      "No pudimos guardar tu contraseña.",
      "Tu contraseña de ahora sigue igual. Intenta de nuevo.",
    ],
    [
      avisos.contrasenaCambiada,
      "Listo, cambiamos tu contraseña.",
      "Cerramos tus otras sesiones. Esta sigue abierta.",
    ],
    [
      avisos.enlaceDeRecuperacionEnviado,
      "Si ese correo tiene una cuenta, te enviamos un enlace.",
      "Revisa también el correo no deseado.",
    ],
    [
      avisos.errorAlEnviarEnlace,
      "No pudimos enviar el enlace.",
      "Intenta de nuevo.",
    ],
    [
      avisos.errorAlGuardarContrasena,
      "No pudimos guardar tu contraseña.",
      "Intenta de nuevo.",
    ],
    [avisos.contrasenaRecuperada, "Listo, cambiaste tu contraseña.", undefined],
    [
      avisos.errorAlCargarIngreso,
      "No pudimos cargar tu último ingreso.",
      undefined,
    ],
    [
      avisos.noReconoceElIngreso,
      "¿No reconoces este ingreso?",
      "Cambia tu contraseña y cerramos tus otras sesiones.",
    ],
  ] as const)("el aviso «%j» dice lo de E14", (aviso, titulo, mensaje) => {
    expect(aviso.titulo).toBe(titulo);
    expect("mensaje" in aviso ? aviso.mensaje : undefined).toBe(mensaje);
  });

  it("el aviso de «Listo, confirmamos tu correo.» es de logro", () => {
    expect(avisos.correoConfirmado.tipo).toBe("logro");
  });

  it("T1 y T10 (E14-PCP 4.16) son los textos aprobados, palabra por palabra", () => {
    expect(avisos.demasiadosIntentos.titulo).toBe(
      "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
    );
    expect(avisos.sinConexion.titulo).toBe(
      "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
    );
  });

  it("avisoDeFallo distingue sin conexión, demasiados intentos y el resto", () => {
    expect(avisoDeFallo(fallo(0, "sin_conexion"), generico)).toBe(
      avisos.sinConexion,
    );
    expect(avisoDeFallo(fallo(429, "demasiados_intentos"), generico)).toBe(
      avisos.demasiadosIntentos,
    );
    expect(avisoDeFallo(fallo(500, "x"), generico)).toBe(generico);
  });
});
