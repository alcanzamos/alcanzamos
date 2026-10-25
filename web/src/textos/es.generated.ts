// Archivo generado por `npm run textos` (diseno/generar-textos.mjs) desde diseno/textos/es.json: secciones «comun» y
// «solo_web». No editar a mano: un cambio de texto va primero a E14 y después a es.json (E17-ECO 4.13).
// Cada texto lleva encima su referencia de E14. Los marcadores son `{nombre}`; se llenan con `formatear` y `plural`.

export const textos = {
  avisos: {
    sinConexion: {
      // E14-PCP 4.16 T10 (PN-58, PN-60, PN-64, PN-69 y PN-73)
      titulo: "Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.",
    },
    demasiadosIntentos: {
      // E14-PCP 4.16 T1 (D-136; PN-58, «Cambiar el correo» de PN-59, PN-60 y PN-61)
      titulo: "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
    },
    errorAlCrearCuenta: {
      // E14-PCP 4.1, estado «Error de envío» de PN-58 y 4.16 T6
      titulo: "No pudimos crear la cuenta.",
      // E14-PCP 4.1, estado «Error de envío» de PN-58 y 4.16 T6
      mensaje: "Tus datos no se perdieron. Intenta de nuevo.",
    },
    errorAlEnviarCorreo: {
      // E14-PCP 4.2, estado «Error» de PN-59 (reenviar y cambiar el correo)
      titulo: "No pudimos enviar el correo.",
      // E14-PCP 4.2, estado «Error» de PN-59 (reenviar y cambiar el correo)
      mensaje: "Intenta de nuevo.",
    },
    errorAlRevisarElCorreo: {
      // E14-PCP 4.16 T8: «Ya lo confirmé» no pudo revisar el estado (5xx)
      titulo: "No pudimos revisar si confirmaste tu correo.",
      // E14-PCP 4.16 T8: «Ya lo confirmé» no pudo revisar el estado (5xx)
      mensaje: "Intenta de nuevo.",
    },
    errorAlConfirmarElCorreo: {
      // E14-PCP 4.16 T9: el enlace de verificación falló del lado del servidor (5xx), distinto del enlace vencido
      titulo: "No pudimos confirmar tu correo.",
      // E14-PCP 4.16 T9: el enlace de verificación falló del lado del servidor (5xx), distinto del enlace vencido
      mensaje: "Intenta de nuevo.",
    },
    sinConfirmarTodavia: {
      // E14-PCP 4.2, «Ya lo confirmé» sin confirmar
      titulo: "Todavía no confirmaste tu correo.",
      // E14-PCP 4.2, «Ya lo confirmé» sin confirmar
      mensaje: "Abre el enlace que te enviamos.",
    },
    correoReenviado: {
      // E14-PCP 4.2, estado «Reenviado»
      titulo: "Te enviamos otro correo.",
    },
    correoConfirmado: {
      // E14-PCP 4.2, estado «Confirmado», y 4.16 T11: se muestra arriba de la pantalla a la que se llega
      titulo: "Listo, confirmamos tu correo.",
    },
    enlaceVencido: {
      // E14-PCP 4.2, estado «Enlace vencido»
      titulo: "Ese enlace ya no sirve.",
      // E14-PCP 4.2, estado «Enlace vencido»
      mensaje: "Pide uno nuevo.",
    },
    datosNoCoinciden: {
      // E14-PCP 4.3, estado «Error» de PN-60 con credenciales que no coinciden (401)
      titulo: "No pudimos entrar con esos datos.",
      // E14-PCP 4.3, estado «Error» de PN-60 con credenciales que no coinciden (401)
      mensaje: "Revisa lo que escribiste e intenta de nuevo.",
    },
    errorAlIniciarSesion: {
      // E14-PCP 4.16 T7 (D-153): error del servidor (5xx) en PN-60; nunca dice que los datos están mal (RNF-017)
      titulo: "No pudimos iniciar tu sesión.",
      // E14-PCP 4.16 T7 (D-153): error del servidor (5xx) en PN-60; nunca dice que los datos están mal (RNF-017)
      mensaje: "El problema es de nuestro lado. Intenta de nuevo en un momento.",
    },
    errorAlCambiarContrasena: {
      // E14-PCP 4.15, estado «Error» de PN-73
      titulo: "No pudimos guardar tu contraseña.",
      // E14-PCP 4.15, estado «Error» de PN-73
      mensaje: "Tu contraseña de ahora sigue igual. Intenta de nuevo.",
    },
    contrasenaCambiada: {
      // E14-PCP 4.15, estado «Guardada» de PN-73 (llega a PN-71)
      titulo: "Listo, cambiamos tu contraseña.",
      // E14-PCP 4.15, estado «Guardada» de PN-73 (llega a PN-71)
      mensaje: "Cerramos tus otras sesiones. Esta sigue abierta.",
    },
    errorAlCargarIngreso: {
      // E14-PCP 4.14, estado «Error» de PN-71
      titulo: "No pudimos cargar tu último ingreso.",
    },
    noReconoceElIngreso: {
      // E14-PCP 4.14, PN-71
      titulo: "¿No reconoces este ingreso?",
      // E14-PCP 4.14, PN-71
      mensaje: "Cambia tu contraseña y cerramos tus otras sesiones.",
    },
    enlaceDeRecuperacionEnviado: {
      // E14-PCP 4.4, estado «Enlace enviado» de PN-61: es el mismo con o sin cuenta
      titulo: "Si ese correo tiene una cuenta, te enviamos un enlace.",
      // E14-PCP 4.4, estado «Enlace enviado» de PN-61: es el mismo con o sin cuenta
      mensaje: "Revisa también el correo no deseado.",
    },
    errorAlEnviarEnlace: {
      // E14-PCP 4.4, estado «Error» de PN-61
      titulo: "No pudimos enviar el enlace.",
      // E14-PCP 4.4, estado «Error» de PN-61
      mensaje: "Intenta de nuevo.",
    },
    errorAlGuardarContrasena: {
      // E14-PCP 4.5, estado «Error» de PN-62
      titulo: "No pudimos guardar tu contraseña.",
      // E14-PCP 4.5, estado «Error» de PN-62
      mensaje: "Intenta de nuevo.",
    },
    contrasenaRecuperada: {
      // E14-PCP 4.5, estado «Guardada» de PN-62 (llega a PN-60)
      titulo: "Listo, cambiaste tu contraseña.",
    },
    sesionCerrada: {
      // E14-PCP 4.3, PN-60 (se llega a ella cuando el API niega el paso por falta de sesión)
      titulo: "Tu sesión se cerró. Entra de nuevo.",
    },
    errorAlCargarInformacion: {
      // E14-PCP 4.6, estado «Error de carga» de PN-63; en la web también cuando el catálogo de PN-64 no carga o trae una finalidad que E14 no tiene
      titulo: "No pudimos cargar la información.",
    },
    errorAlGuardarAutorizacion: {
      // E14-PCP 4.7 (PN-64), estado «Error de envío»; también con 409, 422 y 403
      titulo: "No pudimos guardar tu autorización.",
      // E14-PCP 4.7 (PN-64), estado «Error de envío»; también con 409, 422 y 403
      mensaje: "Intenta de nuevo.",
    },
    errorAlBorrarElCorreo: {
      // E14-PCP 4.7 (PN-64), estado «Sin conexión» con «No autorizo»; en la web también con un error del servidor
      titulo: "Todavía no pudimos borrar tu correo. Intenta de nuevo.",
    },
    correoBorrado: {
      // E14-PCP 4.7 (PN-64), estado «No autorizo» (llega a PN-60)
      titulo: "Borramos el correo que nos diste.",
      // E14-PCP 4.7 (PN-64), estado «No autorizo» (llega a PN-60)
      mensaje: "Sin tu autorización no creamos la cuenta. Puedes empezar de nuevo cuando quieras.",
    },
  },
  correo: {
    // E14-PCP 4.1 (errores de campo de PN-58): el campo del correo es el mismo en PN-58, en «Cambiar el correo» de PN-59 (4.16 T3) y en PN-61.
    correo_vacio: "Falta el correo electrónico.",
    // E14-PCP 4.1 (errores de campo de PN-58): el campo del correo es el mismo en PN-58, en «Cambiar el correo» de PN-59 (4.16 T3) y en PN-61.
    correo_invalido: "Falta completar el correo. Por ejemplo, nombre@correo.com.",
  },
  contrasenaNueva: {
    // E14-PCP 4.1 (PN-58). La contraseña nueva tiene los mismos errores en PN-62 y PN-73.
    contrasena_corta: "Falta que la contraseña tenga al menos 15 caracteres.",
    // E14-PCP 4.1 (PN-58). La contraseña nueva tiene los mismos errores en PN-62 y PN-73.
    contrasena_comun: "Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.",
    // E14-PCP 4.1 (PN-58). La contraseña nueva tiene los mismos errores en PN-62 y PN-73.
    contrasena_personal: "Falta una contraseña que no incluya tu correo ni el nombre de la app.",
  },
  erroresDeCampo: {
    entrar: {
      // E14-PCP 4.3 (PN-60)
      identificador_vacio: "Falta el correo electrónico.",
      // E14-PCP 4.3 (PN-60)
      contrasena_vacia: "Falta la contraseña.",
    },
    contrasenaNueva: {
      // E14-PCP 4.5 (PN-62) y 4.15 (PN-73)
      contrasena_vacia: "Falta la contraseña nueva.",
    },
    contrasenaDeAhora: {
      // E14-PCP 4.15 (PN-73)
      contrasena_vacia: "Falta tu contraseña de ahora.",
      // E14-PCP 4.15 (PN-73)
      contrasena_actual_incorrecta: "No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.",
    },
    crearCuenta: {
      // E14-PCP 4.1 (PN-58)
      contrasena_vacia: "Falta la contraseña.",
      // E14-PCP 4.1 (PN-58)
      nombre_vacio: "Falta el nombre para mostrar.",
      // E14-PCP 4.16 T5 (D-153)
      nombre_largo: "Escribe un nombre de hasta 60 caracteres.",
      // E14-PCP 4.1 (PN-58)
      mayor_de_edad_requerido: "Falta marcar que eres mayor de edad.",
    },
  },
  porConfirmar: {
    // E14-PRR 1.6 (PN-72, D-093, aprobado en D-163): «13 por confirmar: 2 ingresos y 11 gastos»
    resumen: "{total} por confirmar: {ingresos} y {gastos}",
    // E14-PRR 1.6 (PN-72, D-163): «2 ingresos» y «1 ingreso», con los dos tipos
    ingresos: { one: "{n} ingreso", other: "{n} ingresos" },
    // E14-PRR 1.6 (PN-72, D-163): «11 gastos» y «1 gasto», con los dos tipos
    gastos: { one: "{n} gasto", other: "{n} gastos" },
    // E14-PRR 1.6 (PN-72, D-163): con un solo tipo, sin el cero y sin repetir el número: «13 ingresos por confirmar», «1 ingreso por confirmar»
    soloIngresos: { one: "{n} ingreso por confirmar", other: "{n} ingresos por confirmar" },
    // E14-PRR 1.6 (PN-72, D-163): con un solo tipo, sin el cero y sin repetir el número: «13 gastos por confirmar», «1 gasto por confirmar»
    soloGastos: { one: "{n} gasto por confirmar", other: "{n} gastos por confirmar" },
  },
  pagina: {
    // E14-PCP 4.2 bis; E14-PCP 4.3 (PN-60); E14-PCP 4.4 bis; E14-PCP 4.6 (PN-63); E14-PCP 4.10 (PN-67); E14-PCP 4.11 (PN-68); E14-PCP 4.13 (PN-70); E14-PCP 4.16
    logo: "Alcanzamos",
    // E14-PCP 4.4 (PN-61); E14-PCP 4.6 (PN-63); E14-PCP 4.7 (PN-64); E14-PCP 4.9 (PN-66); E14-PCP 4.10 (PN-67); E14-PCP 4.11 (PN-68); E14-PCP 4.12 (PN-69); E14-PCP 4.13 (PN-70); E14-PCP 4.14 (PN-71); E14-PCP 4.15 (PN-73); E14-PCP 4.16
    atras: "Atrás",
    // E14-PCP 1.19 (título de la pestaña del navegador, aprobado en D-163)
    titulo_del_documento: "{titulo} · Alcanzamos",
  },
  acciones: {
    // E14-PCP 4.9 (PN-66); E14-PCP 4.16
    cerrarSesion: "Cerrar sesión",
    // E14-PCP 4.1 (PN-58); E14-PCP 4.6 (PN-63); E14-PCP 4.9 (PN-66); E14-PCP 4.10 (PN-67); E14-PCP 4.11 (PN-68); E14-PCP 4.13 (PN-70); E14-PCP 4.14 (PN-71)
    intentarDeNuevo: "Intentar de nuevo",
    // E14-PCP 4.2 (PN-59); E14-PCP 4.3 (PN-60)
    reenviarElCorreo: "Reenviar el correo",
    // E14-PCP 4.2 (PN-59); E14-PCP 4.16
    cambiarElCorreo: "Cambiar el correo",
    // E14-PCP 4.5 (PN-62); E14-PCP 4.15 (PN-73)
    guardarLaContrasena: "Guardar la contraseña",
  },
  campos: {
    correo: {
      // E14-PCP 4.1 (PN-58); E14-PCP 4.3 (PN-60); E14-PCP 4.4 (PN-61); E14-PCP 4.16
      etiqueta: "Correo electrónico",
      // E14-PCP 4.1 (PN-58)
      ayuda: "Te enviaremos un enlace para confirmarlo.",
    },
    contrasena: {
      // E14-PCP 4.1 (PN-58); E14-PCP 4.3 (PN-60); E14-PCP 4.5 (PN-62); E14-PCP 4.12 (PN-69); E14-PCP 4.14 (PN-71); E14-PCP 4.15 (PN-73); E14-PCP 4.16
      etiqueta: "Contraseña",
      // E14-PCP 4.1 (PN-58); E14-PCP 4.5 (PN-62); E14-PCP 4.15 (PN-73); E14-PCP 4.16
      ayuda: "Usa una frase de tres o cuatro palabras.",
      // E14-SDD 5.18 (nombre accesible del botón Ver y Ocultar)
      mostrar: "Mostrar la contraseña",
      // E14-SDD 5.18 (nombre accesible del botón Ver y Ocultar)
      ocultar: "Ocultar la contraseña",
    },
    contrasenaNueva: {
      // E14-PCP 4.15 (PN-73)
      etiquetaPropia: "Tu contraseña nueva",
      // E14-PCP 4.5 (PN-62); E14-PCP 4.15 (PN-73)
      etiqueta: "Contraseña nueva",
      // E14-PCP 4.5 (PN-62)
      repeticion: "Repite la contraseña nueva",
    },
    contrasenaDeAhora: {
      // E14-PCP 4.15 (PN-73)
      etiqueta: "Tu contraseña de ahora",
    },
    nombre: {
      // E14-PCP 4.1 (PN-58)
      etiqueta: "Nombre para mostrar",
      // E14-PCP 4.1 (PN-58)
      ayuda: "Es el nombre que verás en la app. Puede ser un apodo.",
    },
    mayorDeEdad: {
      // E14-PCP 4.1 (PN-58); E14-PCP 4.8 (PN-65); E14-PCP 4.16
      etiqueta: "Soy mayor de edad",
    },
  },
  crearCuenta: {
    // E14-PCP 4.1 (PN-58)
    titulo: "Crea tu cuenta",
    // E14-PCP 4.1 (PN-58)
    intro: "Solo necesitamos tres datos.",
    // E14-PCP 4.1 (PN-58)
    crear: "Crear cuenta",
    // E14-PCP 4.1 (PN-58)
    yaTengoCuenta: "Ya tengo una cuenta",
    // E14-PCP 4.1 (PN-58)
    nota: "Después de confirmar tu correo verás cómo cuidamos tus datos y decidirás si los autorizas.",
  },
  entrar: {
    // E14-PCP 4.3 (PN-60)
    titulo: "Inicia sesión",
    // E14-PCP 4.3 (PN-60)
    olvidaste: "¿Olvidaste tu contraseña?",
    // E14-PCP 4.3 (PN-60)
    entrar: "Iniciar sesión",
    // E14-PCP 4.3 (PN-60)
    crearCuenta: "Crear una cuenta",
  },
  recuperarAcceso: {
    // E14-PCP 4.4 (PN-61)
    titulo: "Recuperar el acceso",
    // E14-PCP 4.4 (PN-61)
    intro: "Escribe el correo de tu cuenta. Te enviamos un enlace para elegir una contraseña nueva.",
    // E14-PCP 4.4 (PN-61)
    enviar: "Enviar el enlace",
    // E14-PCP 4.4 (PN-61)
    volver: "Volver a iniciar sesión",
  },
  cambiarContrasena: {
    // E14-PCP 4.15 (PN-73)
    titulo: "Cambiar mi contraseña",
    // E14-PCP 4.15 (PN-73)
    intro: "Escribe tu contraseña de ahora y la nueva.",
    // E14-PCP 4.15 (PN-73)
    ahoraNo: "Ahora no",
  },
  revisaTuCorreo: {
    // E14-PCP 4.2 (PN-59)
    titulo: "Revisa tu correo",
    // E14-PCP 4.2 (PN-59)
    enviadoA: "Te enviamos un enlace a {correo}. Ábrelo para confirmar tu cuenta.",
    // E14-PCP 4.2 (PN-59)
    enviado: "Te enviamos un enlace a tu correo. Ábrelo para confirmar tu cuenta.",
    // E14-PCP 4.2 (PN-59)
    noLlego: "¿No llegó? Mira también en el correo no deseado.",
    // E14-PCP 4.2 (PN-59)
    plazo: "Si no lo confirmas en 7 días, borramos esta cuenta.",
    // E14-PCP 4.2 (PN-59)
    yaLoConfirme: "Ya lo confirmé",
    // E14-PCP 4.2 (PN-59)
    espera: "Puedes pedir otro en un momento.",
  },
  seguridadDeLaCuenta: {
    // E14-PCP 4.14 (PN-71)
    titulo: "Seguridad de la cuenta",
    // E14-PCP 4.14 (PN-71)
    tarjeta: "Tu último ingreso",
    // E14-PCP 4.14 (PN-71)
    ingresoAnterior: "Tu ingreso anterior fue {fecha}",
    // E14-PCP 4.14 (PN-71)
    ingresoAclaracion: "Es la fecha de tu ingreso anterior, no la de ahora.",
    // E14-PCP 4.14 (PN-71)
    primerIngreso: "Este es tu primer ingreso.",
    // E14-PCP 4.14 (PN-71)
    cambiarContrasena: "Cambiar mi contraseña",
  },
  recuperar: {
    // E14-PCP 4.5 (PN-62)
    titulo: "Elige tu contraseña nueva",
    // E14-PCP 4.5 (PN-62)
    pedirOtro: "Pedir otro enlace",
  },
  textosDeRepeticion: {
    // E14-PCP 4.5: la repetición solo existe en la pantalla de PN-62
    vacia: "Falta repetir la contraseña.",
    // E14-PCP 4.5: la repetición solo existe en la pantalla de PN-62
    distinta: "Falta que las dos contraseñas sean iguales.",
  },
  privacidad: {
    // E14-PCP 4.6 (PN-63), fila 1
    titulo: "Cómo cuidamos tus datos",
    // E14-PCP 4.6 (PN-63), fila 2
    intro: "Antes de seguir, esto es lo que hacemos con tu información.",
    // E14-PCP 4.6 (PN-63), fila 11 (solo en el primer uso; lleva a PN-64)
    continuar: "Continuar",
    tarjetas: {
      queGuardamos: {
        // E14-PCP 4.6 (PN-63), fila 3
        titulo: "Lo que guardamos",
        // E14-PCP 4.6 (PN-63), fila 3
        cuerpo: "Tu correo, tu contraseña y tu nombre para mostrar. Y lo que tú registras: movimientos, metas, deudas y presupuestos.",
      },
      paraQue: {
        // E14-PCP 4.6 (PN-63), fila 4
        titulo: "Para qué lo usamos",
        // E14-PCP 4.6 (PN-63), fila 4
        cuerpo: "Para mostrarte tu plata disponible, avisarte de un faltante y explicarte por qué.",
      },
      loTuyo: {
        // E14-PCP 4.6 (PN-63), fila 5
        titulo: "Lo tuyo es solo tuyo",
        // E14-PCP 4.6 (PN-63), fila 5
        cuerpo: "Solo se comparte con tu hogar lo que tú marcas como compartido.",
      },
      avisos: {
        // E14-PCP 4.6 (PN-63), fila 6
        titulo: "Los avisos no cuentan nada",
        // E14-PCP 4.6 (PN-63), fila 6
        cuerpo: "La notificación solo dice «Tienes un aviso en Alcanzamos.» Las cifras las ves dentro de la app.",
      },
      cuidado: {
        // E14-PCP 4.6 (PN-63), fila 7
        titulo: "Cuida lo que escribes",
        // E14-PCP 4.6 (PN-63), fila 7
        cuerpo: "No escribas datos de salud, religión ni de otras personas.",
      },
      derechos: {
        // E14-PCP 4.6 (PN-63), fila 8
        titulo: "Tus derechos",
        // E14-PCP 4.6 (PN-63), fila 8
        cuerpo: "Puedes conocer, corregir y borrar tus datos, y retirar tu autorización cuando quieras.",
      },
      quienResponde: {
        // E14-PCP 4.6 (PN-63), fila 9
        titulo: "Quién responde",
        // E14-PCP 4.6 (PN-63), fila 9
        cuerpo: "Andrés Jiménez es el responsable. Escríbele a privacidad@alcanzamos.co.",
      },
      dondeSeGuardan: {
        // E14-PCP 4.6 (PN-63), fila 9 b (D-126; sujeto a la revisión jurídica de D-071)
        titulo: "Dónde se guardan",
        // E14-PCP 4.6 (PN-63), fila 9 b (D-126; sujeto a la revisión jurídica de D-071)
        cuerpo: "En Azure, en México. El correo que te enviamos sale por un servicio que guarda sus datos en Francia, y lo que escribes a privacidad@alcanzamos.co queda en Estados Unidos. Los detalles están en la política.",
      },
    },
  },
  autorizacion: {
    // E14-PCP 4.7 (PN-64), fila 1
    titulo: "Tu autorización",
    // E14-PCP 4.7 (PN-64), fila 2
    explicacion: "Necesitamos tu permiso para usar algunos datos. Lee con calma y decide.",
    necesarias: {
      // E14-PCP 4.7 (PN-64), fila 3
      titulo: "Lo necesario para usar la app",
      // E14-PCP 4.7 (PN-64), fila 4
      casilla: "Autorizo el uso de mis datos para estas finalidades necesarias.",
      // E14-PCP 4.7 (PN-64), fila 5
      nota: "Sin esta autorización no podemos darte la cuenta. Si no autorizas, borramos al momento el correo que nos diste.",
      // E14-PCP 4.7 (PN-64), errores de campo
      error: "Falta tu autorización para lo necesario.",
    },
    opcionales: {
      // E14-PCP 4.7 (PN-64), fila 6
      titulo: "Lo que puedes elegir",
      // E14-PCP 4.7 (PN-64), fila 8
      nota: "Puedes decir que no. La app funciona igual. Lo cambias cuando quieras en Preferencias.",
    },
    // E14-PCP 4.7 (PN-64), fila 9; la fecha en palabras (D-090)
    version: "Texto versión {numero} del {fecha}.",
    // E14-PCP 4.7 (PN-64), fila 11
    autorizar: "Autorizar y continuar",
    // E14-PCP 4.7 (PN-64), fila 12
    noAutorizo: "No autorizo",
  },
  finalidades: {
    cuenta_y_acceso: {
      // E14-PCP 5 (PN-64)
      nombre: "Cuenta y acceso",
      // E14-PCP 5 (PN-64)
      descripcion: "Usamos tu correo, tu contraseña y tu nombre para crear tu cuenta, dejarte entrar y ayudarte a recuperar el acceso.",
    },
    funciones_financieras: {
      // E14-PCP 5 (PN-64)
      nombre: "Funciones financieras",
      // E14-PCP 5 (PN-64)
      descripcion: "Usamos lo que registras —movimientos, presupuestos, deudas y metas— para calcular tu plata disponible, avisarte de un faltante y mostrarte tus resúmenes.",
    },
    avisos: {
      // E14-PCP 5 (PN-64)
      nombre: "Avisos con la app cerrada",
      // E14-PCP 5 (PN-64)
      descripcion: "Usamos un código de tu teléfono para enviarte avisos aunque la app esté cerrada. El aviso solo dice «Tienes un aviso en Alcanzamos.» y no lleva cifras ni nombres.",
      // E14-PCP 4.7 (PN-64), fila 7
      casilla: "Autorizo los avisos con la app cerrada.",
    },
    horas_de_vida: {
      // E14-PCP 5 (PN-64)
      nombre: "Horas de vida",
      // E14-PCP 5 (PN-64)
      descripcion: "Usamos tu ingreso y tus horas de trabajo para mostrarte cuánto tiempo de tu vida cuesta un gasto. Está apagado hasta que lo actives. Es solo para personas adultas.",
      // E14-PCP 4.7 (PN-64), fila 7
      casilla: "Autorizo mostrar el costo de un gasto en horas de vida.",
    },
  },
} as const;

// Ayudas de los textos con datos y de los plurales (US-59, D-160). Esta es la única copia: el generador
// (diseno/generar-textos.mjs) la pega al final del módulo de cada app, así web y móvil tienen el mismo código.
// No se compila aquí: se compila dentro de la app que la recibe.

/** Los marcadores `{nombre}` de un texto, leídos del tipo literal del propio texto. */
export type Marcadores<T extends string> = T extends `${string}{${infer M}}${infer R}`
  ? M | Marcadores<R>
  : never;

/** Los datos que `formatear` pide para un texto: exactamente sus marcadores, ni uno más ni uno menos. */
export type Datos<T extends string> = { [M in Marcadores<T>]: string };

type Argumentos<T extends string> = [Marcadores<T>] extends [never] ? [] : [datos: Datos<T>];

/** Las dos formas de un plural: `one` para 1 y `other` para todo lo demás. */
export type FormasDePlural = { readonly one: string; readonly other: string };

type MarcadoresDePlural<F extends FormasDePlural> = Exclude<
  Marcadores<F['one']> | Marcadores<F['other']>,
  'n'
>;

type ArgumentosDePlural<F extends FormasDePlural> = [MarcadoresDePlural<F>] extends [never]
  ? []
  : [datos: Record<MarcadoresDePlural<F>, string>];

const MARCADOR = /\{([^{}]*)\}/g;

function nombresDe(texto: string): string[] {
  return [...texto.matchAll(MARCADOR)].map((coincidencia) => coincidencia[1] ?? '');
}

/**
 * Pone los datos en los marcadores `{nombre}` del texto. Los datos llegan ya como texto: los montos y las fechas
 * se formatean antes con las funciones comunes, nunca aquí. Falla si falta un dato o sobra uno; el tipo ya lo
 * impide al compilar, y esta guarda cubre lo que el compilador no ve.
 */
export function formatear<T extends string>(texto: T, ...argumentos: Argumentos<T>): string {
  const datos: Record<string, string> = argumentos[0] ?? {};
  const esperados = new Set(nombresDe(texto));
  const dados = new Set(Object.keys(datos));
  const faltan = [...esperados].filter((nombre) => !dados.has(nombre));
  const sobran = [...dados].filter((nombre) => !esperados.has(nombre));
  if (faltan.length > 0 || sobran.length > 0) {
    throw new Error(
      `Marcadores de «${texto}»: faltan [${faltan.join(', ')}] y sobran [${sobran.join(', ')}]`,
    );
  }
  return texto.replace(MARCADOR, (_, nombre: string) => datos[nombre] ?? '');
}

/**
 * Elige la forma del plural y pone el número en `{n}`. La convención usa solo `one` y `other`, con la regla manual del
 * español para enteros: `one` solo para 1 y `other` para todo lo demás (también 0 y los millones). No usa
 * `Intl.PluralRules`: Hermes (Android) no la implementa (facebook/hermes#1462) y así web y Android siguen un mismo
 * camino (D-163). El número va tal cual (sin separador de miles): son recuentos pequeños.
 */
export function plural<F extends FormasDePlural>(
  formas: F,
  n: number,
  ...argumentos: ArgumentosDePlural<F>
): string {
  const forma = n === 1 ? formas.one : formas.other;
  const datos: Record<string, string> = { ...(argumentos[0] ?? {}) };
  if (nombresDe(forma).includes('n')) datos.n = String(n);
  return (formatear as (texto: string, datos: Record<string, string>) => string)(forma, datos);
}
