import { SIN_CONEXION, SIN_CONFIGURACION } from '../src/api/cliente';
import { avisoDeFallo, avisos, resumenPorConfirmar, textoDeErrorDeCampo, textosDeEdad } from '../src/textos';

const fallo = (estado: number, codigo: string) => ({ ok: false as const, estado, codigo, campos: {} });

describe('textoDeErrorDeCampo (E14-PCP 4.1, 4.3, 4.5 y 4.15)', () => {
  it.each([
    ['correo_vacio', 'Falta el correo electrónico.'],
    ['correo_invalido', 'Falta completar el correo. Por ejemplo, nombre@correo.com.'],
    ['contrasena_vacia', 'Falta la contraseña.'],
    ['contrasena_corta', 'Falta que la contraseña tenga al menos 15 caracteres.'],
    ['contrasena_comun', 'Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.'],
    ['contrasena_personal', 'Falta una contraseña que no incluya tu correo ni el nombre de la app.'],
    ['nombre_vacio', 'Falta el nombre para mostrar.'],
    ['nombre_largo', 'Escribe un nombre de hasta 60 caracteres.'],
  ])('PN-58: %s', (codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo)).toBe(texto);
  });

  it.each([
    ['identificador_vacio', 'Falta el correo electrónico.'],
    ['contrasena_vacia', 'Falta la contraseña.'],
  ])('PN-60: %s', (codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo, 'entrar')).toBe(texto);
  });

  it.each([
    ['contrasena_vacia', 'Falta la contraseña nueva.'],
    ['contrasena_corta', 'Falta que la contraseña tenga al menos 15 caracteres.'],
    ['contrasena_comun', 'Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.'],
    ['contrasena_personal', 'Falta una contraseña que no incluya tu correo ni el nombre de la app.'],
  ])('PN-62 y PN-73 (contraseña nueva): %s', (codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo, 'contrasenaNueva')).toBe(texto);
  });

  it.each([
    ['contrasena_vacia', 'Falta tu contraseña de ahora.'],
    ['contrasena_actual_incorrecta', 'No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.'],
  ])('PN-73 (contraseña de ahora): %s', (codigo, texto) => {
    expect(textoDeErrorDeCampo(codigo, 'contrasenaDeAhora')).toBe(texto);
  });

  it('PN-61 y «Cambiar el correo» usan los dos errores del correo', () => {
    expect(textoDeErrorDeCampo('correo_vacio', 'correo')).toBe('Falta el correo electrónico.');
    expect(textoDeErrorDeCampo('correo_invalido', 'correo')).toBe(
      'Falta completar el correo. Por ejemplo, nombre@correo.com.',
    );
  });

  it('un código sin texto da undefined: el API no manda textos y la app no inventa ninguno', () => {
    expect(textoDeErrorDeCampo('codigo_nuevo')).toBeUndefined();
    expect(textoDeErrorDeCampo('correo_vacio', 'entrar')).toBeUndefined();
  });

  it('la fecha de nacimiento de PN-65 tiene sus dos textos', () => {
    expect(textosDeEdad).toEqual({
      vacia: 'Falta la fecha de nacimiento.',
      futura: 'Falta una fecha que ya haya pasado.',
    });
  });
});

describe('avisoDeFallo', () => {
  const generico = avisos.errorAlCrearCuenta;

  it('sin conexión (o sin dirección del API) es el aviso de sin conexión', () => {
    expect(avisoDeFallo(fallo(0, SIN_CONEXION), generico)).toBe(avisos.sinConexion);
    expect(avisoDeFallo(fallo(0, SIN_CONFIGURACION), generico)).toBe(avisos.sinConexion);
  });

  it('un 429 es «Hiciste muchos intentos…», con el mismo código o con otro', () => {
    expect(avisoDeFallo(fallo(429, 'demasiados_intentos'), generico)).toBe(avisos.demasiadosIntentos);
    expect(avisos.demasiadosIntentos.titulo).toBe('Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.');
  });

  it('lo demás es el aviso propio de la pantalla', () => {
    expect(avisoDeFallo(fallo(500, 'desconocido'), generico)).toBe(generico);
    expect(avisoDeFallo(fallo(400, 'solicitud_invalida'), generico)).toBe(generico);
  });
});

describe('avisos', () => {
  it('trae los textos aprobados de E14-PCP 4.16 (T1 a T11)', () => {
    expect(avisos.sinConexion.titulo).toBe('Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.');
    expect(avisos.errorAlCrearCuenta).toMatchObject({
      titulo: 'No pudimos crear la cuenta.',
      mensaje: 'Tus datos no se perdieron. Intenta de nuevo.',
    });
    expect(avisos.errorAlIniciarSesion).toMatchObject({
      titulo: 'No pudimos iniciar tu sesión.',
      mensaje: 'El problema es de nuestro lado. Intenta de nuevo en un momento.',
    });
    expect(avisos.errorAlRevisarElCorreo.titulo).toBe('No pudimos revisar si confirmaste tu correo.');
    expect(avisos.errorAlConfirmarElCorreo.titulo).toBe('No pudimos confirmar tu correo.');
    expect(avisos.correoConfirmado).toEqual({ tipo: 'logro', titulo: 'Listo, confirmamos tu correo.' });
  });

  it('cada aviso tiene un tipo de E14-SDD 5.4 y un título', () => {
    for (const aviso of Object.values(avisos)) {
      expect(['informacion', 'atencion', 'logro']).toContain(aviso.tipo);
      expect(aviso.titulo.length).toBeGreaterThan(0);
    }
  });
});

describe('recuento de PN-72 (US-59, S4, D-093)', () => {
  it('da exactamente el resumen de E14-PRR: 13 por confirmar, 2 ingresos y 11 gastos', () => {
    expect(resumenPorConfirmar(2, 11)).toBe('13 por confirmar: 2 ingresos y 11 gastos');
  });

  // «1 ingreso» es el ejemplo del dueño; «1 gasto» y los ceros no están en E14: son propuestos (ver el PR).
  it.each([
    [1, 2, '3 por confirmar: 1 ingreso y 2 gastos'],
    [2, 1, '3 por confirmar: 2 ingresos y 1 gasto'],
    [0, 13, '13 por confirmar: 0 ingresos y 13 gastos'],
  ])('con %d ingresos y %d gastos: %s', (ingresos, gastos, esperado) => {
    expect(resumenPorConfirmar(ingresos, gastos)).toBe(esperado);
  });
});
