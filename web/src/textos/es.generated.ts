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
      // E14-PCP 4.16 T1 (D-136; PN-58 y «Reenviar el correo» de PN-59, PN-60 y PN-61)
      titulo: "Hiciste muchos intentos. Espera unos minutos e intenta de nuevo.",
    },
    errorAlCrearCuenta: {
      // E14-PCP 4.1, estado «Error de envío» de PN-58 y 4.16 T6
      titulo: "No pudimos crear la cuenta.",
      // E14-PCP 4.1, estado «Error de envío» de PN-58 y 4.16 T6
      mensaje: "Tus datos no se perdieron. Intenta de nuevo.",
    },
    errorAlEnviarCorreo: {
      // E14-PCP 4.2, estado «Error» de PN-59 («Reenviar el correo»)
      titulo: "No pudimos enviar el correo.",
      // E14-PCP 4.2, estado «Error» de PN-59 («Reenviar el correo»)
      mensaje: "Intenta de nuevo.",
    },
    correoReenviado: {
      // E14-PCP 4.2, estado «Reenviado»
      titulo: "Te enviamos otro correo.",
    },
    correoConfirmado: {
      // E14-PCP 4.2 ter (PN-74), estado «Guardada», y 4.16 T11: se muestra arriba de PN-63 (D-172)
      titulo: "Listo, confirmamos tu correo.",
    },
    enlaceVencido: {
      // E14-PCP 4.2 ter (PN-74), estado «Enlace vencido o ya usado» (D-192); mismo texto que PN-62 (4.5)
      titulo: "Ese enlace ya no sirve.",
      // E14-PCP 4.2 ter (PN-74), estado «Enlace vencido o ya usado» (D-192); mismo texto que PN-62 (4.5)
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
      // E14-PCP 4.5, estado «Error» de PN-62; E14-PCP 4.2 ter (PN-74), estado «Error» y 4.16 T9
      titulo: "No pudimos guardar tu contraseña.",
      // E14-PCP 4.5, estado «Error» de PN-62; E14-PCP 4.2 ter (PN-74), estado «Error» y 4.16 T9
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
      // E14-PCP 4.6, estado «Error de carga» de PN-63; también cuando el catálogo de PN-64 no carga o trae una finalidad que E14 no tiene
      titulo: "No pudimos cargar la información.",
    },
    errorAlGuardarAutorizacion: {
      // E14-PCP 4.7 (PN-64), estado «Error de envío»; también con 409, 422 y 403
      titulo: "No pudimos guardar tu autorización.",
      // E14-PCP 4.7 (PN-64), estado «Error de envío»; también con 409, 422 y 403
      mensaje: "Intenta de nuevo.",
    },
    errorAlBorrarElCorreo: {
      // E14-PCP 4.7 (PN-64), estado «Sin conexión» con «No autorizo»; también con un error del servidor
      titulo: "Todavía no pudimos borrar tu correo. Intenta de nuevo.",
    },
    correoBorrado: {
      // E14-PCP 4.7 (PN-64), estado «No autorizo» (llega a PN-60)
      titulo: "Borramos el correo que nos diste.",
      // E14-PCP 4.7 (PN-64), estado «No autorizo» (llega a PN-60)
      mensaje: "Sin tu autorización no creamos la cuenta. Puedes empezar de nuevo cuando quieras.",
    },
    errorAlCargarMovimientos: {
      // E14-PRR 4.1 (PN-01), estado «Error de carga»
      titulo: "No pudimos cargar tus movimientos.",
      // E14-PRR 4.1 (PN-01), estado «Error de carga»
      mensaje: "Tus datos están a salvo. Intenta de nuevo.",
    },
    cambiosGuardados: {
      // E14-PRR 4.2 (PN-02), «Tras guardar»
      titulo: "Listo, guardamos los cambios.",
    },
    movimientoNoExiste: {
      // E14-PRR 4.2 (PN-02), estado «Ya no existe»
      titulo: "Ese movimiento ya no está.",
    },
    errorAlGuardarCambios: {
      // E14-PRR 4.2 (PN-02), estado «Error de guardado»
      titulo: "No pudimos guardar los cambios.",
      // E14-PRR 4.2 (PN-02), estado «Error de guardado»
      mensaje: "Tu movimiento sigue igual. Intenta de nuevo.",
    },
    errorAlBorrar: {
      // E14-PRR 4.2 (PN-02), estado «Error al borrar»
      titulo: "No pudimos borrar el movimiento.",
      // E14-PRR 4.2 (PN-02), estado «Error al borrar»
      mensaje: "Sigue en tu lista. Intenta de nuevo.",
    },
    borramosGasto: {
      // E14-PRR 4.2 (PN-02), «Tras borrar»
      titulo: "Listo, borramos el gasto de {monto}.",
    },
    borramosIngreso: {
      // E14-PRR 4.2 (PN-02), «Tras borrar»: aviso tras borrar un ingreso, aprobado en E14-PRR 1.9 (D-170)
      titulo: "Listo, borramos el ingreso de {monto}.",
    },
    vasABorrarTuCuenta: {
      // E14-PCP 4.12 (PN-69), fila 2
      titulo: "Vas a borrar tu cuenta",
      // E14-PCP 4.12 (PN-69), fila 2
      mensaje: "Se borran tus datos y no se pueden recuperar.",
    },
    errorAlBorrarLaCuenta: {
      // E14-PCP 4.12 (PN-69), estado «Error»
      titulo: "No pudimos borrar tu cuenta.",
      // E14-PCP 4.12 (PN-69), estado «Error»
      mensaje: "Tus datos siguen ahí. Intenta de nuevo.",
    },
    cuentaBorrada: {
      // E14-PCP 4.12 (PN-69), «Al borrar» y E14-PCP 4.3 (PN-60), estado «Cuenta borrada»
      titulo: "Borramos tu cuenta.",
      // E14-PCP 4.3 (PN-60), estado «Cuenta borrada» (viene de PN-69)
      mensaje: "Gracias por haber usado Alcanzamos.",
    },
    errorAlCargarTusDatos: {
      // E14-PRR PN-72 (05-pantallas-registro-y-regreso.md:865), estado «Error de carga»; reutilizado en PN-69 (D-180)
      titulo: "No pudimos cargar tus datos.",
      // E14-PRR PN-72 (05-pantallas-registro-y-regreso.md:865), estado «Error de carga»; reutilizado en PN-69 (D-180)
      mensaje: "Intenta de nuevo.",
    },
    descargaLista: {
      // E14-PCP 4.12 (PN-69), estado «Descarga lista»
      titulo: "Listo, descargamos tus datos.",
      // E14-PCP 4.12 (PN-69), estado «Descarga lista» y aviso del archivo
      mensaje: "El archivo queda en tu teléfono. Guárdalo en un lugar seguro.",
    },
    errorAlDescargar: {
      // E14-PCP 4.12 (PN-69), estado «Error al descargar»
      titulo: "No pudimos preparar tu archivo.",
      // E14-PCP 4.12 (PN-69), estado «Error al descargar»
      mensaje: "Tu cuenta sigue igual. Intenta de nuevo.",
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
    // E14-PCP 4.2 ter (PN-74), D-142 y D-192 (aprobado): el mismo error en PN-62 y PN-73. Reemplaza «…ni el nombre de la app.»
    contrasena_personal: "Falta una contraseña que no incluya tu correo ni la palabra «Alcanzamos».",
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
    borrarCuenta: {
      // E14-PCP 4.12 (PN-69), errores de campo
      contrasena_vacia: "Falta tu contraseña.",
      // E14-PCP 4.12 (PN-69), errores de campo
      contrasena_incorrecta: "No pudimos confirmar tu contraseña. Escríbela de nuevo.",
      // E14-PCP 4.12 (PN-69), errores de campo: «Falta confirmar lo de Mateo.»; con varios menores, sus nombres juntos (aprobado en D-180)
      confirmacion_requerida: "Falta confirmar lo de {nombres}.",
    },
    crearCuenta: {
      // E14-PCP 4.1 (PN-58)
      mayor_de_edad_requerido: "Falta marcar que eres mayor de edad.",
      // E14-PCP 4.2 ter (PN-74), errores de campo (antes de PN-58)
      contrasena_vacia: "Falta la contraseña.",
      // E14-PCP 4.2 ter (PN-74), errores de campo (antes de PN-58)
      nombre_vacio: "Falta el nombre para mostrar.",
      // E14-PCP 4.16 T5 (D-153)
      nombre_largo: "Escribe un nombre de hasta 60 caracteres.",
    },
  },
  porConfirmar: {
    // E14-PRR 4.1 (PN-01), fila 2a
    titulo: "Por confirmar",
    // E14-PRR 4.1 (PN-01), fila 2a
    textoVarias: "Estos movimientos que se repiten ya llegaron a su fecha. Confírmalos con un toque, o toca «Más» si no pasaron o cambió el monto.",
    // E14-PRR 4.7 (PN-72), fila 4b; aprobado para PN-01 y PN-72 en D-179. Clave única: PN-72 debe reutilizarla
    textoUna: "Esta fecha de un movimiento que se repite ya llegó. Confírmala con un toque, o toca «Más» si no pasó o cambió el monto.",
    // E14-PRR 4.1 (PN-01), «Confirmar un movimiento que se repite», fila «Marca»
    marca: "Por confirmar",
    // E14-PRR 4.1 (PN-01), «Confirmar un movimiento que se repite», fila «Confirmar»
    confirmar: "Confirmar",
    // E14-PRR 4.1 (PN-01), «Confirmar un movimiento que se repite», fila «Más»
    mas: "Más",
    // E14-PRR 4.1 (PN-01), fila 2a; E14-PRR 4.8, fila 1
    confirmarTodos: "Confirmar todos",
    // E14-SDD 5.12 (el ícono Cerrar de toda Hoja inferior, también «Ver todas» y «Otro mes»); E14-PRR 4.1 (PN-01), hojas «Más», «No pasó» y «Cambiar el monto»; E14-PRR 4.2 (PN-02), hoja de borrar, fila 6
    cerrar: "Cerrar",
    // E14-PRR 4.1 (PN-01), fila «Texto de apoyo»: «Ingreso · Transferencia · 16 de noviembre de 2026»
    apoyoConMedio: "{tipo} · {medio} · {fecha}",
    // E14-PRR 4.8 (PN-72, «Confirmar todos»), fila 4: «Gasto · 5 de noviembre de 2026»
    apoyoSinMedio: "{tipo} · {fecha}",
    // Aprobado por el dueño el 2026-11-10 (US-71, bug 231 de Azure Boards, ACC-004), un solo texto para la web y Android; va a E14-PRR 4.1 en la T4 de la US-71: el nombre accesible de E14-PRR 4.1 (PN-01), fila «Confirmar» («Confirmar Salario del 16 de noviembre de 2026»), con el monto, para que dos fechas de la misma categoría y día no se anuncien igual. Android dice el monto con `montoHablado` (D-187): «Confirmar Salario de 1200000 pesos del 16 de noviembre de 2026»; la web, con `formatearPesos`: «Confirmar Salario de $1.200.000 del 16 de noviembre de 2026»
    nombreDeConfirmar: "Confirmar {nombre} de {monto} del {fecha}",
    // Aprobado por el dueño el 2026-11-10 (US-71, bug 231 de Azure Boards, ACC-004), un solo texto para la web y Android; va a E14-PRR 4.1 y 4.8 en la T4 de la US-71: el nombre accesible de E14-PRR 4.1 (PN-01), fila «Más» («Más opciones de Salario del 16 de noviembre de 2026»), y de «Más» en E14-PRR 4.8 (PN-72, «Confirmar todos»), fila 4, con el monto que muestra la fila (el cambiado, si lo hay). Android dice el monto con `montoHablado` (D-187): «Más opciones de Salario de 1200000 pesos del 16 de noviembre de 2026»; la web, con `formatearPesos`: «Más opciones de Salario de $1.200.000 del 16 de noviembre de 2026»
    nombreDeMas: "Más opciones de {nombre} de {monto} del {fecha}",
    hoja: {
      // E14-PRR 4.1 (PN-01), «Hoja «Más»»: «Salario · 16 de noviembre de 2026»
      titulo: "{nombre} · {fecha}",
      // E14-PRR 4.1 (PN-01), «Hoja «Más»»; E14-PRR 4.8 (PN-72, «Confirmar todos»), «Más» → «Cambiar el monto»
      cambiarElMonto: "Cambiar el monto",
      // E14-PRR 4.1 (PN-01), «Hoja «Más»» y «Hoja «No pasó»»; E14-PRR 4.8 (PN-72, «Confirmar todos»), «Más» → «No pasó»
      noPaso: "No pasó",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Más» en una fila «No pasó»
      volverAIncluirla: "Volver a incluirla",
      // E14-PRR 4.1 (PN-01), «Hoja «No pasó»»
      tituloNoPaso: "¿Esta fecha no pasó?",
      // E14-PRR 4.1 (PN-01), «Hoja «No pasó»»
      textoNoPaso: "Dejamos de contarla en tu simulación. Las demás fechas siguen igual. Si después pasó, la registras a mano.",
      // E14-PRR 4.1 (PN-01), «Hoja «Cambiar el monto»»; E14-PRR 4.8 (PN-72, «Confirmar todos»)
      tituloDeIngreso: "¿Cuánto llegó?",
      // E14-PRR 4.1 (PN-01), «Hoja «Cambiar el monto»»; E14-PRR 4.8 (PN-72, «Confirmar todos»)
      tituloDeGasto: "¿Cuánto pagaste?",
      // E14-PRR 4.1 (PN-01), «Hoja «Cambiar el monto»», Botón · Primario
      confirmar: "Confirmar",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Más» → «Cambiar el monto», Botón · Primario
      listo: "Listo",
    },
    avisos: {
      // E14-PRR 4.1 (PN-01), «Después de «Confirmar»»
      confirmamosIngreso: "Listo, confirmamos tu ingreso de {monto}.",
      // E14-PRR 4.1 (PN-01), «Después de «Confirmar»»
      confirmamosGasto: "Listo, confirmamos tu gasto de {monto}.",
      // E14-PRR 4.1 (PN-01), «Hoja «No pasó»»
      yaNoContamos: "Listo, ya no contamos esa fecha.",
      errorAlConfirmar: {
        // E14-PRR 4.1 (PN-01), estado «Error al confirmar»
        titulo: "No pudimos confirmar el movimiento.",
        // E14-PRR 4.1 (PN-01), estado «Error al confirmar»
        mensaje: "Sigue por confirmar. Intenta de nuevo.",
      },
      errorAlOmitir: {
        // E14-PRR 4.1 (PN-01), estado «Error al marcar «No pasó»»
        titulo: "No pudimos guardar el cambio.",
        // E14-PRR 4.1 (PN-01), estado «Error al marcar «No pasó»»
        mensaje: "Sigue por confirmar. Intenta de nuevo.",
      },
      errorAlGuardar: {
        // E14-PRR 4.8 (PN-72, «Confirmar todos»), estado «Error al guardar»
        titulo: "No pudimos guardar tus movimientos.",
        // E14-PRR 4.8 (PN-72, «Confirmar todos»), estado «Error al guardar»
        mensaje: "No se guardó ninguno. Intenta de nuevo.",
      },
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Aviso al guardar»: «Listo, guardamos 13 movimientos.» y «Listo, guardamos 1 movimiento.»
      guardados: { one: "Listo, guardamos {n} movimiento.", other: "Listo, guardamos {n} movimientos." },
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Aviso al guardar»: «Listo, guardamos 12 movimientos y dejamos de contar 1 fecha.»
      guardadosYOmitidas: "Listo, guardamos {guardados} y dejamos de contar {omitidas}.",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Aviso al guardar»: «Listo, dejamos de contar 1 fecha.»; aprobado en D-179 (plural por la regla de D-163)
      soloOmitidas: { one: "Listo, dejamos de contar {n} fecha.", other: "Listo, dejamos de contar {n} fechas." },
    },
    // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Aviso al guardar»: «12 movimientos» y «1 movimiento»
    movimientosGuardados: { one: "{n} movimiento", other: "{n} movimientos" },
    // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Aviso al guardar»: «1 fecha»; aprobado en D-179 (plural por la regla de D-163)
    fechasOmitidas: { one: "{n} fecha", other: "{n} fechas" },
    todos: {
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), fila 2
      explicacion: "Todo viene marcado. Desmarca lo que no quieras confirmar ahora, o toca «Más» si no pasó o cambió el monto.",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), fila 3
      marcados: "{marcados} de {total} marcados",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), fila 5
      aclaracion: "Lo que desmarques sigue por confirmar. Una fecha que marques «No pasó» deja de contarse.",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Desmarcar la casilla»
      siguePorConfirmar: "Sigue por confirmar",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Más» → «Cambiar el monto»
      montoCambiado: "Monto cambiado",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «Más» → «No pasó»
      noPaso: "No pasó",
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «El botón «Guardar»»: «Guardar 13 movimientos» y «Guardar 1 movimiento»; «Guardar 0 movimientos» deshabilitado
      guardar: { one: "Guardar {n} movimiento", other: "Guardar {n} movimientos" },
      // E14-PRR 4.8 (PN-72, «Confirmar todos»), «El botón «Guardar»», «Solo «No pasó»»
      guardarSoloNoPaso: "Guardar",
    },
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
    // E14-PCP 4.5 (PN-62); E14-PCP 4.15 (PN-73)
    guardarLaContrasena: "Guardar la contraseña",
    // E14-PCP 4.2 (PN-59), fila 5, aprobado (D-176): reemplaza «Cambiar el correo»; vuelve a PN-58
    usarOtroCorreo: "Usar otro correo",
  },
  campos: {
    correo: {
      // E14-PCP 4.1 (PN-58); E14-PCP 4.3 (PN-60); E14-PCP 4.4 (PN-61); E14-PCP 4.16
      etiqueta: "Correo electrónico",
      // E14-PCP 4.1 (PN-58), fila 4, aprobado (D-176): reemplaza «Te enviaremos un enlace para confirmarlo.»; también en el formulario de «Reenviar el correo» de PN-59 (4.16 T3)
      ayuda: "Te enviaremos un enlace para confirmarlo y elegir tu contraseña.",
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
    mayorDeEdad: {
      // E14-PCP 4.1 (PN-58); E14-PCP 4.8 (PN-65); E14-PCP 4.16
      etiqueta: "Soy mayor de edad",
    },
    nombre: {
      // E14-PCP 4.1 (PN-58)
      etiqueta: "Nombre para mostrar",
      // E14-PCP 4.1 (PN-58)
      ayuda: "Es el nombre que verás en la app. Puede ser un apodo.",
    },
  },
  crearCuenta: {
    // E14-PCP 4.1 (PN-58)
    titulo: "Crea tu cuenta",
    // E14-PCP 4.1 (PN-58)
    crear: "Crear cuenta",
    // E14-PCP 4.1 (PN-58)
    yaTengoCuenta: "Ya tengo una cuenta",
    // E14-PCP 4.1 (PN-58), fila 3, aprobado (D-176): reemplaza «Solo necesitamos tres datos.»
    intro: "Empecemos por tu correo.",
    // E14-PCP 4.1 (PN-58), fila 8, aprobado (D-176): reemplaza «Después de confirmar tu correo verás cómo cuidamos tus datos y decidirás si los autorizas.»
    nota: "Después de confirmar tu correo elegirás tu contraseña, verás cómo cuidamos tus datos y decidirás si los autorizas.",
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
    noLlego: "¿No llegó? Mira también en el correo no deseado.",
    // E14-PCP 4.2 (PN-59)
    plazo: "Si no lo confirmas en 7 días, borramos esta cuenta.",
    // E14-PCP 4.2 (PN-59)
    espera: "Puedes pedir otro en un momento.",
    // E14-PCP 4.2 (PN-59), fila 2, aprobado (D-176)
    enviadoA: "Te enviamos un correo a {correo}. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
    // E14-PCP 4.2 (PN-59), estado «Sin dirección» y 4.16 T4, aprobado (D-176)
    enviado: "Te enviamos un correo. Ábrelo y sigue el enlace para elegir tu contraseña y confirmar tu cuenta.",
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
  privacidad: {
    // E14-PCP 4.6 (PN-63), fila 1 y barra desde el menú; E14-PCP 4.9 (PN-66), fila 6; E14-PCP 4.10 (PN-67), fila 10; E14-PCP 4.14 (PN-71) y 4.16 T2 ter: entrada provisional a PN-63 desde el menú (bug 260)
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
  registro: {
    // E14-PPN 3.1, fila 1 (barra)
    titulo: "Registrar",
    // E14-PPN 3.1: «Sin el cuadro, el botón dice «Guardar»» (D-164)
    guardar: "Guardar",
    tipo: {
      // E14-PPN 3.1, fila 6
      etiqueta: "Tipo",
      // E14-PPN 3.1, fila 6
      gasto: "Gasto",
      // E14-PPN 3.1, fila 6
      ingreso: "Ingreso",
    },
    monto: {
      // E14-PPN 3.1, fila 7
      etiqueta: "Monto",
    },
    fecha: {
      // E14-PPN 3.1, fila 8
      etiqueta: "Fecha",
      // E14-PPN 3.1, fila 8 (valor inicial)
      hoy: "Hoy",
    },
    categoria: {
      // E14-PPN 3.1, fila 9
      etiqueta: "Categoría",
      // E14-PPN 3.1, fila 9
      verTodas: "Ver todas",
    },
    medio: {
      // E14-PPN 3.1, fila 10
      etiqueta: "Medio de pago",
      // E14-PPN 3.1, fila 10 (sin «Tarjeta» en la US-51, D-164)
      efectivo: "Efectivo",
      // E14-PPN 3.1, fila 10 (sin «Tarjeta» en la US-51, D-164)
      transferencia: "Transferencia",
    },
    quien: {
      // E14-PPN 3.1, fila 11
      etiqueta: "De quién es",
      // E14-PPN 3.1, fila 11 (llega seleccionado; sin «Compartido con el hogar» en la US-51, D-164)
      soloMio: "Solo mío",
    },
    descripcion: {
      // E14-PPN 3.1, fila 12
      etiqueta: "Descripción (opcional)",
      // E14-PPN 3.1, fila 12
      ayuda: "No escribas datos de salud, religión ni de otras personas.",
    },
    seRepite: {
      // E14-PPN 3.1, fila 12a
      etiqueta: "Se repite",
      // E14-PPN 3.1, fila 12a
      cambiar: "Cambiar",
      // E14-PRR 4.3 (PN-03): «Al volver al formulario, la fila «Se repite» dice la periodicidad: «Se repite: Cada quincena»»
      conPeriodicidad: "Se repite: {periodicidad}",
    },
    errores: {
      // E14-PPN 3.1, errores de campo
      montoVacio: "Falta el monto.",
      // E14-PPN 3.1, errores de campo
      montoDecimales: "El monto puede tener hasta dos decimales.",
      // E14-PPN 3.1, errores de campo: plantilla «¿Quisiste decir {valor con punto de miles} o {valor con coma decimal}?» (D-084)
      montoAmbiguo: "¿Quisiste decir {miles} o {decimal}?",
      // E14-PPN 3.1, errores de campo
      montoCero: "El monto debe ser mayor que $0.",
      // E14-PPN 3.1, errores de campo
      tipo: "Falta elegir si es un gasto o un ingreso.",
      // E14-PPN 3.1, errores de campo
      fecha: "Falta la fecha.",
      // E14-PPN 3.1, errores de campo
      medio: "Falta elegir el medio de pago.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: errores de campo del Monto, monto con letras u otros símbolos
      montoIlegible: "Escribe el monto con números, por ejemplo $45.000.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: errores de campo del Monto, monto que no cabe en centavos de 64 bits
      montoGrande: "El monto es demasiado grande. Revisa que no sobren ceros.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: errores de campo de la Categoría, llenando a mano (con el cuadro llega sugerida, D-193)
      categoria: "Falta elegir la categoría.",
    },
    avisos: {
      // E14-PPN 3.1, nota «Tras guardar» (E14-SDD 5.5 para el monto)
      registramosGasto: "Listo, registramos tu gasto de {monto}.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: avisos del registro; con el del gasto de E14-PPN 3.1 «Listo, registramos tu gasto de $45.000.»
      registramosIngreso: "Listo, registramos tu ingreso de {monto}.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: avisos del registro, repetición con una fecha futura (solo se guarda la repetición, D-091; {fecha} en palabras)
      quedaPorConfirmarGasto: "Listo. Tu gasto de {monto} queda por confirmar el {fecha}.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: avisos del registro, repetición con una fecha futura (solo se guarda la repetición, D-091; {fecha} en palabras)
      quedaPorConfirmarIngreso: "Listo. Tu ingreso de {monto} queda por confirmar el {fecha}.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: avisos del registro, error al guardar un gasto; el del ingreso es el de E14-PRR 4.4 (PN-04)
      errorAlGuardarGasto: "No pudimos guardar tu gasto.",
      // E14-PRR 4.4 (PN-04), estado «Error de guardado»
      errorAlGuardarIngreso: "No pudimos guardar tu ingreso.",
      // E14-PPN 1.11 / D-165, aprobado por el dueño: error al guardar un gasto; es también el de E14-PRR 4.4 (PN-04), estado «Error de guardado»
      errorAlGuardarMensaje: "Lo que escribiste sigue ahí. Intenta de nuevo.",
    },
    categorias: {
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 1 del API
      c1: "Alimentación",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 2 del API
      c2: "Bebidas alcohólicas y tabaco",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 3 del API
      c3: "Ropa y calzado",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 4 del API
      c4: "Arriendo o cuota de vivienda",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 5 del API
      c5: "Servicios públicos",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 6 del API
      c6: "Hogar y mantenimiento",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 7 del API
      c7: "Salud",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 8 del API
      c8: "Transporte",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 9 del API
      c9: "Comunicaciones",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 10 del API
      c10: "Suscripciones",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 11 del API
      c11: "Recreación y cultura",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 12 del API
      c12: "Educación",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 13 del API
      c13: "Restaurantes y hoteles",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 14 del API
      c14: "Pagos de deudas",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 15 del API
      c15: "Mesada",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 16 del API
      c16: "Otros gastos",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 17 del API
      c17: "Salario",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 18 del API
      c18: "Trabajo independiente o ventas",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 19 del API
      c19: "Remesas o giros familiares",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 20 del API
      c20: "Ayudas y subsidios",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 21 del API
      c21: "Mesada",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 22 del API
      c22: "Prima de servicios",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 23 del API
      c23: "Intereses de cesantías",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 24 del API
      c24: "Retiro de cesantías",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, ingreso), id 25 del API
      c25: "Otros ingresos",
      // E14-PPN 3.1, fila 9: categoría del catálogo de E09 (02-catalogo-de-categorias.md, gasto), id 26 del API
      c26: "Ayuda a la familia",
    },
    // E14-PPN 3.1, fila 13 (el botón cuando el cuadro llenó el formulario; sin el cuadro es «Guardar»)
    revisarYGuardar: "Revisar y guardar",
    cuadro: {
      // E14-PPN 3.1, fila 3
      etiqueta: "Escribe el gasto o el ingreso",
      // E14-PPN 3.1, fila 3, con «Un movimiento a la vez.» antes del ejemplo (nota provisional de D-196, versión 1.14)
      ayuda: "Un movimiento a la vez. Por ejemplo: mercado 45 mil ayer.",
      // E14-PPN 3.1, fila 4 (NM-12)
      privacidad: "No escribas datos de salud, religión ni de otras personas.",
      // E14-PPN 3.1, fila 5
      llenar: "Llenar el formulario",
      // E14-PPN 3.1, fila 4a y estado «Lleno por el cuadro» (D-084)
      lleno: "Llenamos el formulario con tu texto. Cambia lo que quieras.",
      noEntendido: {
        // E14-PPN 3.1, estado «No se entendió» (CU-03, 2c); también con tiempo agotado (D-084 (2), api/README «Interpretar un texto»)
        titulo: "No pudimos entender el texto.",
        // E14-PPN 3.1, estado «No se entendió» (CU-03, 2c)
        mensaje: "Llena el formulario: lo que escribiste sigue ahí.",
      },
      // E14-PPN 3.1, estado «Pregunta o pedido de recomendación» (RF-044); sin la segunda frase «Tu pregunta se responde en {pantalla}.» hasta que exista esa pantalla
      pregunta: "Aquí solo registramos movimientos.",
      recomendacion: {
        // E14-PPN 3.1, estado «Pregunta o pedido de recomendación» (RF-021)
        titulo: "Aquí no damos recomendaciones sobre créditos ni inversiones.",
        // E14-PPN 3.1, estado «Pregunta o pedido de recomendación» (RF-021)
        mensaje: "Puedes registrar un movimiento cuando quieras.",
      },
      // E14-PPN 3.1, estado «Sin conexión» (ADR-005, sección 6)
      sinConexion: "Sin conexión, puedes registrar con el formulario.",
      // E14-PPN 3.1, errores de campo del cuadro: cuadro vacío al tocar «Llenar el formulario» (`texto_requerido`), aprobado (D-193)
      textoRequerido: "Falta escribir el gasto o el ingreso.",
      // E14-PPN 3.1, errores de campo del cuadro: cuadro con más de 280 caracteres (`texto_largo`), aprobado (D-193)
      textoLargo: "El texto es demasiado largo. Usa hasta 280 caracteres.",
      errorAlInterpretar: {
        // E14-PPN 3.1, estados del cuadro: falla inesperada del servidor al llenar, aprobado (D-193)
        titulo: "No pudimos llenar el formulario.",
        // E14-PPN 3.1, estados del cuadro: falla inesperada del servidor al llenar, aprobado (D-193)
        mensaje: "Llena el formulario: lo que escribiste sigue ahí.",
      },
    },
    revisa: {
      // E14-PPN 3.1, paso «Revisa y confirma», fila 1
      titulo: "Revisa y confirma",
      // E14-PPN 3.1, paso «Revisa y confirma», fila 2 (enlace en cada fila)
      cambiar: "Cambiar",
      // E14-PPN 3.1, paso «Revisa y confirma», fila 4
      confirmar: "Confirmar y guardar",
      // E14-PPN 3.1, paso «Revisa y confirma», fila 5
      volver: "Volver al formulario",
      // E14-PPN 3.1, aviso de varios movimientos (D-077, decisión 5)
      variosTitulo: "Encontramos más de un movimiento",
      // E14-PPN 3.1, aviso de varios movimientos (D-077, decisión 5)
      variosMensaje: "Tomamos solo el primer movimiento. Registra los otros por separado.",
    },
  },
  periodicidad: {
    // E14-PRR 4.3 (PN-03), fila 1 (barra)
    titulo: "Se repite",
    // E14-PRR 4.3 (PN-03), fila 2
    intro: "Lo registras una vez. En cada fecha te pedimos confirmarlo con un toque.",
    // E14-PRR 4.3 (PN-03), fila 3
    etiqueta: "Cada cuánto",
    opciones: {
      // E14-PRR 4.3 (PN-03), fila 3; fila 12a de E14-PPN 3.1
      no_se_repite: "No se repite",
      // E14-PRR 4.3 (PN-03), fila 3
      semanal: "Cada semana",
      // E14-PRR 4.3 (PN-03), fila 3
      quincenal: "Cada quincena",
      // E14-PRR 4.3 (PN-03), fila 3
      mensual: "Cada mes",
      // E14-PRR 4.3 (PN-03), fila 3
      semestral: "Cada semestre",
      // E14-PRR 4.3 (PN-03), fila 3
      anual: "Cada año",
    },
    explicaciones: {
      // E14-PRR 4.3 (PN-03), texto de la fila 4
      no_se_repite: "Se cuenta solo en su fecha.",
      // E14-PRR 4.3 (PN-03), texto de la fila 4
      semanal: "Cada 7 días, desde la fecha en que empieza.",
      // E14-PRR 4.3 (PN-03), texto de la fila 4
      quincenal: "Dos fechas al mes, separadas por 15 días. Si el mes es más corto, usamos su último día.",
      // E14-PRR 4.3 (PN-03), texto de la fila 4
      mensual: "El mismo día de cada mes. Si el mes es más corto, usamos su último día.",
      // E14-PRR 4.3 (PN-03), texto de la fila 4
      semestral: "El mismo día, cada seis meses.",
      // E14-PRR 4.3 (PN-03), texto de la fila 4
      anual: "El mismo día y el mismo mes, cada año.",
    },
    // E14-PRR 4.3 (PN-03), fila 5
    empiezaEl: "Empieza el",
    // E14-PRR 4.3 (PN-03), fila 6
    proximas: "Próximas fechas",
    // E14-PRR 4.3 (PN-03), estado «Sin fechas próximas»
    sinProximas: "No hay fechas próximas.",
    // E14-PRR 4.3 (PN-03), fila 7
    aclaracion: "El monto es el mismo en cada fecha. Al confirmar una fecha puedes escribir otro monto, sin cambiar las demás.",
    // E14-PRR 4.3 (PN-03), fila 8
    listo: "Listo",
    errores: {
      // E14-PRR 4.3 (PN-03), errores de campo
      sinPeriodicidad: "Falta elegir cada cuánto se repite.",
      // E14-PRR 4.3 (PN-03), errores de campo
      sinFecha: "Falta la fecha en que empieza.",
    },
  },
  movimientos: {
    // E14-PRR 4.2 (PN-02), «Categoría oculta al corregir»: la palabra junto al ícono (E14-PRR 1.9, D-170)
    oculta: "Oculta",
    // E14-PRR 4.1 (PN-01), fila 2
    titulo: "Movimientos",
    // E14-PRR 4.1 (PN-01), fila 10 (Botón Registrar fijo en Android; en la web, «Registrar» arriba de la navegación lateral)
    registrar: "Registrar",
    // E14-PRR 4.1 (PN-01), fila 3
    periodo: "Periodo",
    // E14-PRR 4.1 (PN-01), fila 3
    otroMes: "Otro mes",
    // E14-PRR 4.1 (PN-01), fila 4
    todas: "Todas",
    // E14-PRR 4.1 (PN-01), fila 5: «10 movimientos»; la forma singular «1 movimiento» está aprobada en E14-PRR 1.9 (D-170)
    resumen: { one: "{n} movimiento", other: "{n} movimientos" },
    // E14-PRR 4.1 (PN-01), fila 5: «Alimentación: 2 movimientos, $120.000» (plantilla sacada del ejemplo)
    resumenDeCategoria: "{categoria}: {movimientos}, {total}",
    dia: {
      // E14-PRR 4.1 (PN-01), filas 6 y 8; PN-02, hoja de borrar, fila 2
      ayer: "Ayer",
      // E14-PRR 4.1 (PN-01), filas 6 y 8: «Hoy, 2 de noviembre de 2026» y «Ayer, 1 de noviembre de 2026» (plantilla sacada del ejemplo)
      conFecha: "{dia}, {fecha}",
    },
    fila: {
      // E14-PRR 4.1 (PN-01), «Cómo se arma cada fila»: «Gasto · Efectivo»
      apoyo: "{tipo} · {medio}",
      // E14-PRR 4.1 (PN-01), «Cómo se arma cada fila»: la categoría y «· Mercado»
      conDescripcion: "{nombre} · {descripcion}",
      // E14-PRR 4.1 (PN-01), «Cómo se arma cada fila»: «Aporte a una meta · Transferencia»
      aporte: "Aporte a una meta",
      // E14-PRR 4.1 (PN-01), «Aportes y retiros» (CU-07 3a); texto aprobado en E14-PRR 1.9 (D-170)
      retiro: "Retiro de una meta",
      // E14-PRR 4.1 (PN-01), «Cómo se arma cada fila», Marca de propiedad; E14-PRR 2.2, fila 7 (SEG-002, NC-E16-40)
      compartido: "Compartido con el hogar",
    },
    vacio: {
      // E14-PRR 4.1 (PN-01), estado «Sin resultados con el filtro»
      sinResultados: "No hay movimientos con este filtro.",
      // E14-PRR 4.1 (PN-01), estado «Sin resultados con el filtro»
      cambiarFiltro: "Cambia el periodo o la categoría.",
      // E14-PRR 4.1 (PN-01), estado «Sin resultados con el filtro»
      quitarFiltros: "Quitar los filtros",
      // E14-PRR 4.1 (PN-01), estado «Sin ningún movimiento»
      sinMovimientos: "Todavía no hay movimientos",
      // E14-PRR 4.1 (PN-01), estado «Sin ningún movimiento»
      registraElPrimero: "Registra el primero y aquí lo verás.",
      // E14-PRR 4.1 (PN-01), variante web
      elegir: "Elige un movimiento para verlo.",
    },
    detalle: {
      // E14-PRR 4.2 (PN-02), fila 1 (barra)
      titulo: "Movimiento",
      // E14-PRR 4.2 (PN-02), fila 2
      gastoEn: "Gasto en {categoria}",
      // E14-PRR 4.2 (PN-02), fila 2: subtítulo del ingreso, aprobado en E14-PRR 1.9 (D-170)
      ingresoPor: "Ingreso por {categoria}",
      // E14-PRR 4.2 (PN-02), «Un aporte a una meta»: subtítulo del aporte, aprobado en E14-PRR 1.9 (D-170)
      aporteA: "Aporte a «{meta}»",
      // E14-PRR 4.2 (PN-02): subtítulo del retiro de una meta, aprobado en E14-PRR 1.9 (D-170)
      retiroDe: "Retiro de «{meta}»",
      // E14-PRR 4.2 (PN-02), fila 3
      fecha: "Fecha",
      // E14-PRR 4.2 (PN-02), fila 3
      descripcion: "Descripción",
      // E14-PRR 4.2 (PN-02), fila 5
      corregir: "Corregir",
      // E14-PRR 4.2 (PN-02), fila 6
      borrar: "Borrar este movimiento",
      // E14-PRR 4.2 (PN-02), «Corregir», fila 1 (barra)
      corregirTitulo: "Corregir movimiento",
      // E14-PRR 4.2 (PN-02), «Corregir», fila 9
      guardarCambios: "Guardar los cambios",
      // E14-PRR 4.2 (PN-02), «Corregir», fila 10; «Borrar», fila 5
      ahoraNo: "Ahora no",
      // E14-PRR 4.2 (PN-02), «Una fecha de un recurrente» (D-168); E14-PRR 4.1, hoja «Cambiar el monto»
      soloEstaFecha: "Este cambio es solo para esta fecha. Las demás siguen igual.",
      // E14-PRR 4.2 (PN-02), «Una fecha de un recurrente» (D-168, D-169): solo si la fecha vuelve a pendiente
      volveraPorConfirmar: "Esta fecha volverá a quedar por confirmar.",
    },
    borrar: {
      // E14-PRR 4.2 (PN-02), «Borrar», fila 1
      titulo: "¿Borrar este movimiento?",
      // E14-PRR 4.2 (PN-02), «Borrar», fila 2: «Gasto de $45.000 en Alimentación, Ayer.»
      gasto: "Gasto de {monto} en {categoria}, {dia}.",
      // E14-PRR 4.2 (PN-02), «Borrar», fila 2: hoja de borrar un ingreso, aprobada en E14-PRR 1.9 (D-170)
      ingreso: "Ingreso de {monto} por {categoria}, {dia}.",
      // E14-PRR 4.2 (PN-02), «Borrar», fila 3
      quePasa: "Se quita de tu lista y calculamos el mes de nuevo.",
      // E14-PRR 4.2 (PN-02), «Borrar», fila 4
      confirmar: "Borrar el movimiento",
      // E14-PRR 4.2 (PN-02), estado «Ya no existe»
      irAMovimientos: "Ir a Movimientos",
    },
  },
  borrarCuenta: {
    // E14-PCP 4.12 (PN-69), filas 1 y 9; E14-PCP 4.9 (PN-66), fila 8
    borrarMiCuenta: "Borrar mi cuenta",
    // E14-PCP 4.12 (PN-69), fila 10
    ahoraNo: "Ahora no",
    loQueSeBorra: {
      // E14-PCP 4.12 (PN-69), fila 3
      titulo: "Lo que se borra",
      // E14-PCP 4.12 (PN-69), fila 3
      detalle: "Tus movimientos, metas, deudas y presupuestos. Tu correo, tu nombre y tus preferencias.",
      // E14-PCP 4.12 (PN-69), fila 3
      prueba: "Solo guardamos una prueba mínima de tu autorización, sin tu nombre ni tu correo, durante 3 años.",
    },
    hogar: {
      // E14-PCP 4.12 (PN-69), fila 4, «Con otra persona adulta»
      administradora: "Eres quien lo administra. El papel pasa ahora mismo a {nombre}. Lo que compartiste sigue en el hogar, sin tu nombre.",
      // aprobado en D-180: E14-PCP 4.12 (PN-69), fila 4; última frase de «Con otra persona adulta» para quien es miembro sin el papel
      miembro: "Lo que compartiste sigue en el hogar, sin tu nombre.",
      // E14-PCP 4.12 (PN-69), fila 4, «Siendo la única persona adulta»
      unicaAdulta: "Eres la única persona adulta de «{hogar}». El hogar se cierra y lo que compartiste también se borra.",
      // E14-PMH PN-27: «Si lo dejas vacío, se llama «Nuestro hogar»» (D-098 (7)); título de la tarjeta del hogar, E14-PCP 4.12 (PN-69) fila 4
      nombrePorOmision: "Nuestro hogar",
    },
    menores: {
      // E14-PCP 4.12 (PN-69), fila 5
      titulo: "Menores a tu cargo",
      // aprobado en D-180: E14-PCP 4.12 (PN-69), fila 5. Con un menor, el texto de E14; con varios, «{nombre} y {nombre} dependen solo de ti.» y «Sus cuentas y sus datos también se borran.»
      dependen: { one: "{nombres} depende solo de ti. Su cuenta y sus datos también se borran.", other: "{nombres} dependen solo de ti. Sus cuentas y sus datos también se borran." },
      // E14-PCP 4.12 (PN-69), fila 6, con uno y con varios menores
      casilla: { one: "Entiendo que también se borra la cuenta de {nombres}.", other: "Entiendo que también se borran las cuentas de {nombres}." },
      // aprobado en D-180: E14-PCP 4.12 (PN-69), fila 5 da «Mateo y {nombre}» para dos; con tres o más, comas y «y» antes del último
      union: "{anteriores} y {ultimo}",
    },
    contrasena: {
      // E14-PCP 4.12 (PN-69), fila 7
      etiqueta: "Tu contraseña",
      // E14-PCP 4.12 (PN-69), fila 7
      ayuda: "La pedimos para confirmar que eres tú.",
    },
  },
  descargarMisDatos: {
    // E14-PCP 4.12 (PN-69), fila 8
    boton: "Descargar mis datos",
    // E14-PCP 4.12 (PN-69), fila 8
    ayuda: "Un archivo ZIP con tus movimientos, metas, deudas y presupuestos en CSV. Solo trae lo tuyo.",
    // E14-PCP 4.12 (PN-69), estado «Descargando»
    preparando: "Preparando tu archivo…",
  },
  presupuesto: {
    // E14-SDD 5.9 (destino «Presupuesto» de la navegación); E14-PPA 4.1 (PN-06), fila 8; entrada provisional en PN-71 (L3 de la US-77, punto 3)
    destino: "Presupuesto",
    // E14-PPA 4.1 (PN-06), fila 2: «Presupuesto de noviembre» (plantilla sacada del ejemplo); E14-PPA 4.2 (PN-07), fila 2
    titulo: "Presupuesto de {mes}",
    resumen: {
      // E14-PPA 4.1 (PN-06), fila 3; E14-PPA 4.2 (PN-07), fila 3
      titulo: "Tu presupuesto este mes",
      // E14-PPA 4.1 (PN-06), fila 3: «Ingreso registrado $1.200.000»; E14-PPA 4.2 (PN-07), fila 3
      ingresoRegistrado: "Ingreso registrado",
      // E14-PPA 4.1 (PN-06), fila 3: «Asignado $40.000»; E14-PPA 4.2 (PN-07), fila 3
      asignado: "Asignado",
      // E14-PPA 4.1 (PN-06), fila 3: cifra grande «Sin asignar $1.160.000»
      sinAsignar: "Sin asignar",
      // E14-PPA 4.1 (PN-06), fila 3: «Llega después: $1.200.000 (esperado)» (D-094); E14-PPA 4.2 (PN-07), reglas
      llegaDespues: "Llega después: {monto} (esperado)",
      // Aprobado por el dueño (L14 de la US-77, punto 4, 2026-11-11): E14-PPA 4.1 (PN-06), fila 3, nota fechada del 2026-11-11, «Llega después» separa lo esperado de lo por confirmar; línea aparte, solo si lo por confirmar es mayor que cero; también en PN-07
      porConfirmar: "Por confirmar: {monto}",
      // E14-PPA 4.1 (PN-06), fila 3, texto `tipografia.pequeno` (primera frase)
      cuentaLoRegistrado: "Sin asignar cuenta lo que ya registraste.",
      // Propuesto en la US-77 (T3, web) y aprobado por el dueño (L14 de la US-77, punto 3, 2026-11-11): E14 no tiene el texto. Sale de E14-PPA 4.1 (PN-06), fila 3 («El salario del 16 de noviembre de 2026 se suma cuando llegue.»), con el nombre de la categoría tal cual; solo con una fecha esperada
      seSumaCuandoLlegue: "{nombre} del {fecha} se suma cuando llegue.",
      // Aprobado por el dueño (L14 de la US-77, punto 4, 2026-11-11): E14-PPA 4.1 (PN-06), fila 3, nota fechada del 2026-11-11; solo con una fecha por confirmar
      seSumaCuandoLoConfirmes: "{nombre} del {fecha} se suma cuando lo confirmes.",
      // E14-PPA 4.1 (PN-06), fila 3 (abre PN-08); E14-PPA 3 (PN-07 → PN-08)
      verMisIngresos: "Ver mis ingresos",
      // E14-PPA 4.2 (PN-07), fila 3, con ingreso nulo
      nulo: "Puedes repartir lo que llegue o dejar el presupuesto en cero.",
      // E14-PPA 4.2 (PN-07), fila 3, con ingreso bajo: «Lo asignado supera por $10.000 lo que registraste…»
      bajo: "Lo asignado supera por {monto} lo que registraste. Se actualiza cuando registres más ingresos.",
      // E14-PPA 4.2 (PN-07), fila 3b
      dejarEnCero: "Dejar el presupuesto en cero",
    },
    // E14-PPA 4.3 (PN-08), fila 5; E14-PPA 4.2 (PN-07), fila 3a (abren el formulario con Tipo «Ingreso»)
    registrarUnIngreso: "Registrar un ingreso",
    categorias: {
      // E14-PPA 4.1 (PN-06), fila 4
      titulo: "Por categoría",
      // E14-PPA 4.1 (PN-06), estado «Sin presupuestos»
      sinPresupuestos: "Todavía no tienes presupuesto este mes.",
      // E14-PPA 4.1 (PN-06), estado «Sin presupuestos»
      elige: "Elige una categoría y pon cuánto quieres gastar en ella.",
      // E14-PPA 4.2 (PN-07), fila 4, con ingreso nulo
      sinGastos: "Todavía no hay gastos este mes.",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila»: «Presupuesto $40.000 · Gastado $40.000»
      conPresupuesto: "Presupuesto {presupuesto} · Gastado {gastado}",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila»: «Gastado $650.000 · Sin presupuesto»
      sinPresupuesto: "Gastado {gastado} · Sin presupuesto",
      // E14-PPA 4.1 (PN-06), «Estado de una categoría con presupuesto»: «Quedan $180.000 por gastar.»
      quedan: "Quedan {monto} por gastar.",
      // E14-PPA 4.1 (PN-06), «Estado de una categoría con presupuesto»
      usadoTodo: "Ya usaste todo lo presupuestado.",
      // E14-PPA 4.1 (PN-06), «Estado de una categoría con presupuesto»: «Gastado $120.000 de $100.000 presupuestados.»
      superado: "Gastado {gastado} de {presupuesto} presupuestados.",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila», Acción sin presupuesto
      poner: "Poner presupuesto",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila», Acción con presupuesto (D-094)
      corregir: "Corregir",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila», Acción con presupuesto (D-094)
      quitar: "Quitar",
      // Propuesto en la US-77 (T3, web) y aprobado por el dueño (L17 de la US-77, 2026-11-11): E14 no tiene el texto. E14-PPA 4.1 (PN-06) pide el nombre de la categoría en el nombre accesible de «Poner presupuesto» (RNF-019, criterio 6)
      nombreDePoner: "Poner presupuesto a {categoria}",
      // Propuesto en la US-77 (T3, web) y aprobado por el dueño (L17 de la US-77, 2026-11-11): E14 no tiene el texto. E14-PPA 4.1 (PN-06) pide el nombre de la categoría en el nombre accesible de «Quitar» (SC-E21-13); sale del título de la hoja «¿Quitar el presupuesto de Transporte?»
      nombreDeQuitar: "Quitar el presupuesto de {categoria}",
      // E14-PPA 4.1 (PN-06), fila 5 (abre «Ver todas» de E14-PPN 3.1)
      agregarOtra: "Agregar otra categoría",
    },
    hoja: {
      // E14-PPA 4.1 (PN-06), hoja «Poner presupuesto», fila 1: «Presupuesto de Servicios públicos»
      titulo: "Presupuesto de {categoria}",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»: «Corregir el presupuesto de Transporte»; también es el nombre accesible de «Corregir»
      tituloCorregir: "Corregir el presupuesto de {categoria}",
      // E14-PPA 4.1 (PN-06), hoja «Poner presupuesto», fila 2: «Monto para noviembre»
      monto: "Monto para {mes}",
      // E14-PPA 4.1 (PN-06), hoja «Poner presupuesto», fila 5
      guardar: "Guardar",
    },
    quitar: {
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»: «¿Quitar el presupuesto de Transporte?»
      titulo: "¿Quitar el presupuesto de {categoria}?",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»
      explicacion: "Lo que gastaste no cambia. Puedes poner otro cuando quieras.",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar», Botón · Primario
      confirmar: "Quitar presupuesto",
    },
    avisos: {
      // E14-PPA 4.1 (PN-06), «Corregir y quitar» y reglas: «Listo, guardamos tu presupuesto de Servicios públicos.»
      guardamos: "Listo, guardamos tu presupuesto de {categoria}.",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»: «Listo, quitamos tu presupuesto de Transporte.»
      quitamos: "Listo, quitamos tu presupuesto de {categoria}.",
      // E14-PPA 4.2 (PN-07), reglas y estado «En cero»
      enCero: "Listo, tu presupuesto de {mes} queda en cero. Cuando llegue un ingreso, puedes repartirlo.",
      errorAlGuardar: {
        // E14-PPA 4.1 (PN-06), estado «Error de guardado»
        titulo: "No pudimos guardar el presupuesto.",
        // E14-PPA 4.1 (PN-06), estado «Error de guardado»
        mensaje: "Tus datos están a salvo. Intenta de nuevo.",
      },
      errorAlCargar: {
        // E14-PPA 4.1 (PN-06), estado «Error de carga»; E14-PPA 4.2 (PN-07)
        titulo: "No pudimos cargar tu presupuesto.",
        // E14-PPA 4.1 (PN-06), estado «Error de carga»; E14-PPA 4.2 (PN-07)
        mensaje: "Tus datos están a salvo. Intenta de nuevo.",
      },
    },
  },
  ingresos: {
    // E14-PPA 4.3 (PN-08), fila 1 (barra)
    titulo: "Ingresos",
    total: {
      // E14-PPA 4.3 (PN-08), fila 3
      entran: "Entran este mes",
      // E14-PPA 4.3 (PN-08), «Con varias fuentes»: el periodo ya terminó
      entraron: "Entraron este mes",
      // E14-PPA 4.3 (PN-08), fila 3: «Ya registrado $1.200.000»
      yaRegistrado: "Ya registrado",
      // E14-PPA 4.3 (PN-08), fila 3: «Esperado $1.200.000»
      esperado: "Esperado",
    },
    marca: {
      // E14-PPA 4.3 (PN-08), «Cómo se arma cada fila», Marca
      registrado: "Registrado",
      // E14-PPA 4.3 (PN-08), «Cómo se arma cada fila», Marca (D-091)
      esperado: "Esperado",
    },
    // E14-PPA 4.3 (PN-08), «Cómo se arma cada fila», Texto de apoyo: el medio de pago y, si hay, la descripción
    apoyoConDescripcion: "{medio} · {descripcion}",
    vacio: {
      // E14-PPA 4.3 (PN-08), estado «Sin ingresos en el periodo»
      titulo: "Todavía no registras ingresos este mes.",
      // E14-PPA 4.3 (PN-08), estado «Sin ingresos en el periodo»
      mensaje: "Cuando registres uno, aquí lo verás.",
    },
    avisos: {
      errorAlCargar: {
        // E14-PPA 4.3 (PN-08), estado «Error de carga»
        titulo: "No pudimos cargar tus ingresos.",
        // E14-PPA 4.3 (PN-08), estado «Error de carga»
        mensaje: "Tus datos están a salvo. Intenta de nuevo.",
      },
    },
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
  eligeTuContrasena: {
    // E14-PCP 4.2 ter (PN-74), fila 1, aprobado (D-176)
    titulo: "Elige tu contraseña",
    // E14-PCP 4.2 ter (PN-74), fila 2, aprobado (D-176)
    intro: "Un último paso para crear tu cuenta. Elige tu contraseña y dinos cómo quieres que te llamemos.",
    // E14-PCP 4.2 ter (PN-74), estado «Enlace vencido o ya usado» (D-192); mismo botón que PN-62 (4.5), con otro destino
    pedirOtro: "Pedir otro enlace",
  },
  presupuesto: {
    // E14-SDD 5.9 (destino «Presupuesto» de la navegación); E14-PPA 4.1 (PN-06), fila 8; entrada provisional en PN-71 (L3 de la US-77, punto 3)
    destino: "Presupuesto",
    // E14-PPA 4.1 (PN-06), fila 2: «Presupuesto de noviembre» (plantilla sacada del ejemplo); E14-PPA 4.2 (PN-07), fila 2
    titulo: "Presupuesto de {mes}",
    resumen: {
      // E14-PPA 4.1 (PN-06), fila 3; E14-PPA 4.2 (PN-07), fila 3
      titulo: "Tu presupuesto este mes",
      // E14-PPA 4.1 (PN-06), fila 3: «Ingreso registrado $1.200.000»; E14-PPA 4.2 (PN-07), fila 3
      ingresoRegistrado: "Ingreso registrado",
      // E14-PPA 4.1 (PN-06), fila 3: «Asignado $40.000»; E14-PPA 4.2 (PN-07), fila 3
      asignado: "Asignado",
      // E14-PPA 4.1 (PN-06), fila 3: cifra grande «Sin asignar $1.160.000»
      sinAsignar: "Sin asignar",
      // E14-PPA 4.1 (PN-06), fila 3: «Llega después: $1.200.000 (esperado)» (D-094); E14-PPA 4.2 (PN-07), reglas
      llegaDespues: "Llega después: {monto} (esperado)",
      // Aprobado por el dueño (L14 de la US-77, punto 4, 2026-11-11): E14-PPA 4.1 (PN-06), fila 3, nota fechada del 2026-11-11, «Llega después» separa lo esperado de lo por confirmar; línea aparte, solo si lo por confirmar es mayor que cero; también en PN-07
      porConfirmar: "Por confirmar: {monto}",
      // E14-PPA 4.1 (PN-06), fila 3, texto `tipografia.pequeno` (primera frase)
      cuentaLoRegistrado: "Sin asignar cuenta lo que ya registraste.",
      // Propuesto en la US-77 (T3, web) y aprobado por el dueño (L14 de la US-77, punto 3, 2026-11-11): E14 no tiene el texto. Sale de E14-PPA 4.1 (PN-06), fila 3 («El salario del 16 de noviembre de 2026 se suma cuando llegue.»), con el nombre de la categoría tal cual; solo con una fecha esperada
      seSumaCuandoLlegue: "{nombre} del {fecha} se suma cuando llegue.",
      // Aprobado por el dueño (L14 de la US-77, punto 4, 2026-11-11): E14-PPA 4.1 (PN-06), fila 3, nota fechada del 2026-11-11; solo con una fecha por confirmar
      seSumaCuandoLoConfirmes: "{nombre} del {fecha} se suma cuando lo confirmes.",
      // E14-PPA 4.1 (PN-06), fila 3 (abre PN-08); E14-PPA 3 (PN-07 → PN-08)
      verMisIngresos: "Ver mis ingresos",
      // E14-PPA 4.2 (PN-07), fila 3, con ingreso nulo
      nulo: "Puedes repartir lo que llegue o dejar el presupuesto en cero.",
      // E14-PPA 4.2 (PN-07), fila 3, con ingreso bajo: «Lo asignado supera por $10.000 lo que registraste…»
      bajo: "Lo asignado supera por {monto} lo que registraste. Se actualiza cuando registres más ingresos.",
      // E14-PPA 4.2 (PN-07), fila 3b
      dejarEnCero: "Dejar el presupuesto en cero",
    },
    // E14-PPA 4.3 (PN-08), fila 5; E14-PPA 4.2 (PN-07), fila 3a (abren el formulario con Tipo «Ingreso»)
    registrarUnIngreso: "Registrar un ingreso",
    categorias: {
      // E14-PPA 4.1 (PN-06), fila 4
      titulo: "Por categoría",
      // E14-PPA 4.1 (PN-06), estado «Sin presupuestos»
      sinPresupuestos: "Todavía no tienes presupuesto este mes.",
      // E14-PPA 4.1 (PN-06), estado «Sin presupuestos»
      elige: "Elige una categoría y pon cuánto quieres gastar en ella.",
      // E14-PPA 4.2 (PN-07), fila 4, con ingreso nulo
      sinGastos: "Todavía no hay gastos este mes.",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila»: «Presupuesto $40.000 · Gastado $40.000»
      conPresupuesto: "Presupuesto {presupuesto} · Gastado {gastado}",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila»: «Gastado $650.000 · Sin presupuesto»
      sinPresupuesto: "Gastado {gastado} · Sin presupuesto",
      // E14-PPA 4.1 (PN-06), «Estado de una categoría con presupuesto»: «Quedan $180.000 por gastar.»
      quedan: "Quedan {monto} por gastar.",
      // E14-PPA 4.1 (PN-06), «Estado de una categoría con presupuesto»
      usadoTodo: "Ya usaste todo lo presupuestado.",
      // E14-PPA 4.1 (PN-06), «Estado de una categoría con presupuesto»: «Gastado $120.000 de $100.000 presupuestados.»
      superado: "Gastado {gastado} de {presupuesto} presupuestados.",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila», Acción sin presupuesto
      poner: "Poner presupuesto",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila», Acción con presupuesto (D-094)
      corregir: "Corregir",
      // E14-PPA 4.1 (PN-06), «Cómo se arma cada fila», Acción con presupuesto (D-094)
      quitar: "Quitar",
      // Propuesto en la US-77 (T3, web) y aprobado por el dueño (L17 de la US-77, 2026-11-11): E14 no tiene el texto. E14-PPA 4.1 (PN-06) pide el nombre de la categoría en el nombre accesible de «Poner presupuesto» (RNF-019, criterio 6)
      nombreDePoner: "Poner presupuesto a {categoria}",
      // Propuesto en la US-77 (T3, web) y aprobado por el dueño (L17 de la US-77, 2026-11-11): E14 no tiene el texto. E14-PPA 4.1 (PN-06) pide el nombre de la categoría en el nombre accesible de «Quitar» (SC-E21-13); sale del título de la hoja «¿Quitar el presupuesto de Transporte?»
      nombreDeQuitar: "Quitar el presupuesto de {categoria}",
      // E14-PPA 4.1 (PN-06), fila 5 (abre «Ver todas» de E14-PPN 3.1)
      agregarOtra: "Agregar otra categoría",
    },
    hoja: {
      // E14-PPA 4.1 (PN-06), hoja «Poner presupuesto», fila 1: «Presupuesto de Servicios públicos»
      titulo: "Presupuesto de {categoria}",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»: «Corregir el presupuesto de Transporte»; también es el nombre accesible de «Corregir»
      tituloCorregir: "Corregir el presupuesto de {categoria}",
      // E14-PPA 4.1 (PN-06), hoja «Poner presupuesto», fila 2: «Monto para noviembre»
      monto: "Monto para {mes}",
      // E14-PPA 4.1 (PN-06), hoja «Poner presupuesto», fila 5
      guardar: "Guardar",
    },
    quitar: {
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»: «¿Quitar el presupuesto de Transporte?»
      titulo: "¿Quitar el presupuesto de {categoria}?",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»
      explicacion: "Lo que gastaste no cambia. Puedes poner otro cuando quieras.",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar», Botón · Primario
      confirmar: "Quitar presupuesto",
    },
    avisos: {
      // E14-PPA 4.1 (PN-06), «Corregir y quitar» y reglas: «Listo, guardamos tu presupuesto de Servicios públicos.»
      guardamos: "Listo, guardamos tu presupuesto de {categoria}.",
      // E14-PPA 4.1 (PN-06), «Corregir y quitar»: «Listo, quitamos tu presupuesto de Transporte.»
      quitamos: "Listo, quitamos tu presupuesto de {categoria}.",
      // E14-PPA 4.2 (PN-07), reglas y estado «En cero»
      enCero: "Listo, tu presupuesto de {mes} queda en cero. Cuando llegue un ingreso, puedes repartirlo.",
      errorAlGuardar: {
        // E14-PPA 4.1 (PN-06), estado «Error de guardado»
        titulo: "No pudimos guardar el presupuesto.",
        // E14-PPA 4.1 (PN-06), estado «Error de guardado»
        mensaje: "Tus datos están a salvo. Intenta de nuevo.",
      },
      errorAlCargar: {
        // E14-PPA 4.1 (PN-06), estado «Error de carga»; E14-PPA 4.2 (PN-07)
        titulo: "No pudimos cargar tu presupuesto.",
        // E14-PPA 4.1 (PN-06), estado «Error de carga»; E14-PPA 4.2 (PN-07)
        mensaje: "Tus datos están a salvo. Intenta de nuevo.",
      },
    },
  },
  ingresos: {
    // E14-PPA 4.3 (PN-08), fila 1 (barra)
    titulo: "Ingresos",
    total: {
      // E14-PPA 4.3 (PN-08), fila 3
      entran: "Entran este mes",
      // E14-PPA 4.3 (PN-08), «Con varias fuentes»: el periodo ya terminó
      entraron: "Entraron este mes",
      // E14-PPA 4.3 (PN-08), fila 3: «Ya registrado $1.200.000»
      yaRegistrado: "Ya registrado",
      // E14-PPA 4.3 (PN-08), fila 3: «Esperado $1.200.000»
      esperado: "Esperado",
    },
    marca: {
      // E14-PPA 4.3 (PN-08), «Cómo se arma cada fila», Marca
      registrado: "Registrado",
      // E14-PPA 4.3 (PN-08), «Cómo se arma cada fila», Marca (D-091)
      esperado: "Esperado",
    },
    // E14-PPA 4.3 (PN-08), «Cómo se arma cada fila», Texto de apoyo: el medio de pago y, si hay, la descripción
    apoyoConDescripcion: "{medio} · {descripcion}",
    vacio: {
      // E14-PPA 4.3 (PN-08), estado «Sin ingresos en el periodo»
      titulo: "Todavía no registras ingresos este mes.",
      // E14-PPA 4.3 (PN-08), estado «Sin ingresos en el periodo»
      mensaje: "Cuando registres uno, aquí lo verás.",
    },
    avisos: {
      errorAlCargar: {
        // E14-PPA 4.3 (PN-08), estado «Error de carga»
        titulo: "No pudimos cargar tus ingresos.",
        // E14-PPA 4.3 (PN-08), estado «Error de carga»
        mensaje: "Tus datos están a salvo. Intenta de nuevo.",
      },
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
