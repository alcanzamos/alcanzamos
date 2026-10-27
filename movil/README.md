# movil/

App móvil en React Native con Expo, primero Android y después iOS (ADR-003). Las notificaciones usan FCM sin pasar por el servicio de notificaciones de Expo.

- Archivo de construcción: `package.json` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), misma configuración de TypeScript y ESLint que `web/` (Prettier no está configurado en `movil/`). Código en `src/` y pruebas en `tests/`.
- Los tokens de diseño vienen de [`diseno/`](../diseno/) y se convierten con `npm run tokens`.

## Estado

Desde la US-49 la app tiene las pantallas de cuenta y acceso (ver las secciones de abajo) y abre en PN-60. La pantalla de prueba de cifras (`src/PantallaCifras.tsx`, con cifras inventadas) sigue en el código. No hay otra lógica de negocio. ESLint ya está configurado (ver «Pipeline»); Prettier no.

## Base de la cuenta y el acceso (US-49, A1)

Rama `feat/us-49-movil-base` (D-155). Es la base de las pantallas de cuenta y acceso: navegación, cliente del API, token en el Keystore, textos y logo. La pantalla de prueba de cifras sigue en `src/PantallaCifras.tsx` y `src/fuentes.ts`, pero la app abre ya en `PN-60`.

- **Navegación nativa** (`src/navegacion/`): `@react-navigation/native` y `@react-navigation/native-stack`, que usan las pantallas del sistema (ADR-003 condición 1, D-078). El Atrás de Android vuelve a la pantalla anterior y, en la primera, sale de la app. `reemplazarPila` (`llegada.ts`) deja una pantalla como la única de la pila, para las que no deben poder volverse con Atrás (después de entrar, de cerrar sesión o de crear la cuenta). La marca va encima: fondo de página y sin barra salvo en las pantallas que la piden. Se llega a PN-60 al abrir la app: la edad nunca se pregunta antes de iniciar sesión (E14-PCP 3).
- **Cliente del API** (`src/api/cliente.ts`): único lugar con `fetch`. Manda siempre `X-Alcanzamos-Cliente: android` y, si hay sesión, `Authorization: Bearer <token>`. **Nunca** manda `Origin` ni `Sec-Fetch-Site`: React Native no las agrega y el API rechaza el modo Android si llegan (D-143 (3)); una prueba lo comprueba.
- **Dirección del API** (`src/config.ts`): sale de `EXPO_PUBLIC_URL_API`, sin dominio fijo en el código (D-129; ESLint lo prohíbe). Expo la copia al paquete al arrancar, así que se define al correr `expo start`, no en un archivo del repositorio. Ejemplo solo para probar en la red local (no es una dirección del producto): `EXPO_PUBLIC_URL_API=http://192.168.1.20:18090 npx expo start --lan`. Sin ella, la app no hace ningún pedido y muestra «Sin conexión…».
- **Token de la sesión** (`src/sesion/token.ts`): solo en `expo-secure-store`, que en Android lo cifra con el Keystore (ADR-003, AC-3). No se usa `AsyncStorage` ni archivos para el token, y las pantallas nunca lo ven: el cliente lo guarda al recibirlo y lo borra con un `401 sin_sesion`. `tests/sesion/almacenamiento.test.ts` revisa el código.
- **Textos** (`src/textos.ts`): desde la US-59 los textos salen de `diseno/textos/es.json` (secciones `comun` y `solo_android`, D-160) y llegan por `src/textos/es.generated.ts` (`npm run textos`, no se edita a mano); `src/textos.ts` solo guarda lo que no es texto: el tipo de cada aviso, la tabla de códigos del API a texto y `resumenPorConfirmar` (PN-72). Los textos y códigos son los de E14-PCP (4.16, aprobados en D-153), palabra por palabra. El archivo generado es un módulo de TypeScript dentro de `src/`: `movil/` no importa nada de otra carpeta.
- **Logo** (`src/componentes/Logo.tsx`, `assets/marca/`): el Logo horizontal en color de E14-IDV 5.1, dibujado con `react-native-svg`. El XML de `marca/logo-horizontal-color.svg` va copiado en `assets/marca/logoHorizontalColor.ts` y una prueba comprueba que es idéntico al archivo. Se eligió sobre `react-native-svg-transformer` (otro paquete y otra configuración de Metro) y sobre un PNG (un archivo derivado que se ve borroso en pantallas densas). `react-native-svg` también dibujará los íconos de E14-SDD 5.1 (A2). El logo **no** está bajo la AGPLv3: sigue bajo la política de marca (`TRADEMARK.md`).

Dependencias nuevas (todas MIT, versiones fijadas sin `~` ni `^`, las que `npx expo install` eligió para el SDK 57, verificadas en el registro de npm el 2026-10-23): `@react-navigation/native` 7.5.1 (2026-10-13), `@react-navigation/native-stack` 7.21.0 (2026-10-13), `react-native-screens` 4.26.2 (2026-07-16), `react-native-safe-area-context` 5.7.0 (2026-02-24), `expo-secure-store` 57.0.4 (2026-09-11), `react-native-svg` 15.15.4 (2026-03-18) y, solo para las pruebas, `@types/node` 24.19.2 (2026-10-09; la misma versión que `web/`).

## Componentes de E14-SDD (US-49, A2)

Rama `feat/us-49-movil-componentes` (D-155). Los componentes de E14-SDD 5 en React Native, solo con tokens (E17-ECO 4.5; ESLint lo revisa) y con el nombre accesible que pide RNF-019. Cada uno vive en `src/componentes/` y su prueba en `tests/componentes/`:

| Componente | E14-SDD | Notas |
|---|---|---|
| `Boton`, `BotonDeTexto` | 5.2 | Primario, secundario y de texto. Alto y ancho mínimos de 48 dp (`tamano.tactil-minimo`), estado presionado, deshabilitado (`accessibilityState.disabled`) y foco con el anillo de `color.borde.foco` |
| `CampoDeTexto` (`MarcoDeCampo`) | 5.3 | Etiqueta siempre visible (el lector de pantalla la lee del `accessibilityLabel` del campo, no dos veces), ayuda como `accessibilityHint`, error con el ícono de Atención en una región viva cortés, autocompletado de Android |
| `CampoDeContrasena` | 5.18 | Puntos, botón Ver y Ocultar de 48 × 48 dp con nombre «Mostrar la contraseña» u «Ocultar la contraseña». Permite pegar: no se oculta el menú del campo ni se intercepta el pegado |
| `Aviso` | 5.4 | Información, atención y logro; ícono, título y mensaje como un solo elemento para TalkBack; `accessibilityLiveRegion="polite"` y `accessibilityRole="alert"` |
| `MensajeDeEstado` | E14-PCP 4.16 T11 | Región viva cortés que se pinta primero y recibe el aviso un instante después, para que TalkBack lo anuncie sin mover el foco |
| `CampoDeFecha` | E14-PCP 4.8 | Campo con el ícono Calendario que abre el **selector de fecha nativo** de Android (ADR-003, condición 1) |
| `Iconos`, `Cifras`, `Pantalla` | 5.1, D-123 | Íconos con `react-native-svg`; números en Figtree con cifras tabulares y sin `ss02`; base de pantalla con fondo de página, desplazamiento y márgenes de la barra de estado |

- **Selector de fecha:** `@react-native-community/datetimepicker` 9.1.0 en el SDK 57 y **9.2.1** en el 58 (MIT, 2026-09-07; la que `expo/bundledNativeModules.json` pide para el SDK 57 y la que documenta Expo: <https://docs.expo.dev/versions/v57.0.0/sdk/date-time-picker/>, que lista Expo Go). `DateTimePickerAndroid.open` abre el diálogo del sistema. El diálogo siempre se abre en una fecha (hoy o la última elegida): no se puede abrir «sin elegir nada» como pide E14-PCP 4.8. El campo sí queda vacío hasta que la persona confirma, y no se fija fecha máxima ni mínima. La fecha se recibe con `onValueChange` y el cierre sin confirmar con `onDismiss`; `onChange` está obsoleto en 9.2.1 y no se usa.
- **`accessibilityRole="alert"`:** React Native no tiene un rol de estado (`role="status"` no llega a Android), así que el aviso usa `alert` con la región viva cortés. La región cortés evita que interrumpa lo que TalkBack está diciendo.
- **`accessibilityHint`:** E14 no define pistas; se usa el texto de ayuda del campo donde existe. El plugin de ESLint (`has-accessibility-hint`) exige la pista junto a todo `accessibilityLabel`; dos casos la omiten con la razón escrita (el logo y el botón Ver y Ocultar, de los que E14 fija solo el nombre).
- **Pruebas:** `tests/ayudas/preparar.ts` mockea los márgenes del sistema (`react-native-safe-area-context`) para todas las pruebas.

### Por qué el selector de fecha aparece en la auditoría

`@react-native-community/datetimepicker` declara `expo` como dependencia par opcional y `npm audit` lo lista como «vulnerable» solo por esa vía (sin aviso propio), así que la excepción de `zod` de `auditoria-excepciones.json` sumó el camino que entra por el selector (D-156). Desde el 2026-10-27 ese camino ya no se reporta y la excepción solo lista `expo > @expo/cli > zod` (D-166); la comprobación del paquete sigue cubriendo que no entren en la app.

## Crear la cuenta y verificar el correo (US-49, A3)

Rama `feat/us-49-movil-cuenta` (D-155). Flujo: PN-60 → «Crear una cuenta» → **PN-65** → **PN-58** → **PN-59** → PN-63 (desde la US-50; en la US-49 era una pantalla provisional).

- **PN-65 · Edad** (`src/pantallas/Edad.tsx`, `src/edad/`): solo se abre desde «Crear una cuenta» de PN-60. La edad se calcula en el teléfono (`calculo.ts`, corte en 18 años, por día del calendario local: quien cumple 18 hoy es mayor; quien los cumple mañana, no). **La fecha no se envía ni se guarda** (D-089; el dueño citó D-134): vive solo en el estado de la pantalla. El teléfono recuerda únicamente `{"resultado":"menor","hasta":<hora>}` durante 24 horas, en AsyncStorage (no es un secreto; `recuerdo.ts`). Un resultado de persona adulta no se recuerda: E14-PCP 4.8 solo define el estado «Resultado recordado» para menores. Con menos de 18 años muestra el aviso de E14 **sin** el botón «Ya tengo un usuario: iniciar sesión» (D-137); el Atrás del sistema vuelve a PN-60. Es la única regla de negocio del cliente (excepción a ADR-005 escrita en E14).
- **PN-58 · Crear la cuenta** (`CrearCuenta.tsx`): los tres datos, sin casilla de edad. Manda `mayor_de_edad: true` solo si viene de PN-65 (el tipo de la ruta solo admite `mayorDeEdad: true`; sin eso la pantalla vuelve a PN-60 y no hace ningún pedido). Los errores `422` salen de `textos.ts`; un código sin texto muestra el aviso general y no se inventa uno. La fila «Política de tratamiento de datos» (PN-68) no está: esa pantalla no existe todavía.
- **PN-59 · Verificar el correo** (`RevisaTuCorreo.tsx`): T3 (cambiar el correo en la misma pantalla), T4, T8, espera de 30 s entre reenvíos y la línea de los 7 días. Los enlaces del correo abren la web en el navegador del teléfono (D-155): la pantalla no dice nada nuevo y la persona vuelve y toca «Ya lo confirmé». Los App Links llegan con I08.
- **Pantalla provisional:** la reemplazó la US-50 (ver «Información de privacidad y autorización de datos»); `SinAutorizacion.tsx` ya no existe.
- **Atrás de Android:** PN-65 se apila sobre PN-60; PN-58 reemplaza a PN-65; de PN-58 a PN-59 y a PN-63 se usa `reemplazarPila`, así que desde ahí el Atrás sale de la app y no vuelve al formulario ni a una pantalla sin sesión (`tests/navegacion/flujoDeCuenta.test.tsx` toca el Atrás de verdad).
- **Lo que no se guarda:** `tests/sesion/almacenamiento.test.ts` comprueba que `AsyncStorage` solo aparece en `src/edad/` y que `expo-secure-store` solo aparece en `src/sesion/token.ts`.

Dependencia nueva: `@react-native-async-storage/async-storage` 2.2.0 (MIT, 2025-06-05), la versión de `expo/bundledNativeModules.json` para el SDK 57; no suma ningún aviso a la auditoría.

## Iniciar sesión, seguridad de la cuenta y cambiar la contraseña (US-49, A4)

Rama `feat/us-49-movil-sesion` (D-155).

- **PN-60 · Iniciar sesión** (`Entrar.tsx`): solo con correo; **no** hay «Entro con mi nombre de usuario» (D-137, queda para I11 junto con el botón de PN-65). El API recibe un `identificador` genérico. Con la cuenta activa va a PN-71; con la cuenta sin verificar (sesión limitada, D-138), a PN-59 con el correo escrito. Los errores: `422` por campo, `401` «No pudimos entrar con esos datos.» (sin decir cuál falló), `429` «Hiciste muchos intentos…», `5xx` T7 («No pudimos iniciar tu sesión.», que nunca dice que los datos están mal), sin conexión. Muestra arriba, como mensaje de estado, la llegada («Tu sesión se cerró…», «Listo, confirmamos tu correo.», «Listo, cambiaste tu contraseña.»). Faltan dos filas de E14 cuyas pantallas no existen todavía: «¿Olvidaste tu contraseña?» (PN-61, llega con A5) y «Política de tratamiento y consultas» (PN-68).
- **Arranque** (`Navegacion.tsx`): con un token en el Keystore la primera pantalla es PN-71, que le pregunta al API si la sesión sigue valiendo; sin token, PN-60. Lo que decide es el API: `401` → PN-60 con «Tu sesión se cerró», `403 verificacion_pendiente` → PN-59, `403 autorizacion_pendiente` → PN-63 (`accesoNegado.ts`, que ya usaba PN-59 en A3).
- **PN-71 · Seguridad de la cuenta** (`SeguridadDeLaCuenta.tsx`): la fecha del ingreso **anterior** en palabras y en la hora de Colombia, con los números en Figtree con cifras tabulares y sin `ss02` (D-123, D-085). `fechaEnPalabras` (`fechas.ts`) resta cinco horas a mano y lee los campos en UTC: Colombia no tiene horario de verano, y así no depende de `Intl.DateTimeFormat` con zona en Hermes ni de la zona del teléfono. Con «Cerrar sesión» (T2): `DELETE /api/v1/sesiones/actual` y borra el token del Keystore.
- **PN-73 · Cambiar la contraseña** (`CambiarContrasena.tsx`): dos campos, sin la nota del menor (llega con I11). Al guardar vuelve a PN-71 con «Listo, cambiamos tu contraseña.»; el token no cambia (la sesión de ahora sigue abierta y las demás las cierra el API).
- **Barra superior** (`barra.ts`): PN-71 y PN-73 usan la barra nativa de la pila con el título en `tipografia.titulo-2` (E14-SDD 5.10). El Atrás es el del sistema.

## Recuperar el acceso (US-49, A5)

Rama `feat/us-49-movil-recuperacion` (D-155).

- **PN-61 · Recuperar el acceso: pedir el enlace** (`RecuperarAcceso.tsx`): se abre desde «¿Olvidaste tu contraseña?» de PN-60 (Atrás vuelve a PN-60). La respuesta es la misma con o sin cuenta («Si ese correo tiene una cuenta, te enviamos un enlace.»); errores de campo, `429`, `5xx` y sin conexión con los textos de E14-PCP 4.4. **No** muestra la «Nota del menor» de la fila 5 («¿Entras con nombre de usuario? Pide a tu tutor que restablezca tu acceso.», solo Android): apunta a un ingreso con nombre de usuario que no existe todavía y entra en I11 con la fila 8 de PN-60 y el botón de PN-65 (D-137, D-156). `tests/pantallas/RecuperarAcceso.test.tsx` comprueba que no se muestra.
- **PN-62 · Elegir la contraseña nueva: no se construye en la app.** E14-PCP 4.5 sí tiene su tabla de Android, pero no se puede llegar a ella: el enlace del correo es `URL_PUBLICA/recuperar?t=<token>` y abre la web en el navegador del teléfono (D-155). Un esquema propio (`alcanzamos://`) se descartó (otra app puede registrarlo y recibir el token) y los App Links dependen de la huella del certificado de firma de la app publicada, que llega en I08. Hasta entonces PN-62 vive en la web; la persona vuelve a la app y entra con la contraseña nueva. Con App Links (I08) se suma PN-62 en la app, con los textos de E14-PCP 4.5 que ya están en `textos.ts` (`textosDeRepeticion`, `avisos.enlaceVencido`, `avisos.errorAlGuardarContrasena` y `avisos.contrasenaRecuperada`).

## Información de privacidad y autorización de datos (US-50)

Rama `feat/us-50-movil`, apilada sobre la web (#43) y el API (#42). Reemplaza la pantalla provisional. Mismo flujo, mismos textos de E14-PCP 4.6, 4.7 y 5 y mismo mapeo de errores que la web.

- **PN-63 · Información de privacidad** (`InformacionDePrivacidad.tsx`): solo el primer uso. Título, frase de entrada, las ocho tarjetas (con el ícono Propio y el de Información donde E14 los pide) y «Continuar» a PN-64. Sin Atrás en la barra. «Leer la política completa» no se muestra: abre PN-68, que no existe. «Desde el menú» (PN-66) tampoco se construye. «Listo, confirmamos tu correo.» llega arriba como mensaje de estado (T11).
- **PN-64 · Autorización de datos** (`AutorizacionDeDatos.tsx`): `GET /api/v1/autorizaciones` (con el token en `Authorization: Bearer`, como todo `src/api/`) y cada `codigo` se asocia con su texto de E14-PCP 5 (`finalidadesDeE14` en `textos.ts`). Un código que E14 no tiene, un tipo desconocido, una accesoria sin casilla, un catálogo sin necesarias o una fecha que no se puede escribir son un error de carga («No pudimos cargar la información.» e «Intentar de nuevo»), nunca una omisión en silencio. Dos tarjetas, una casilla para lo necesario y una por finalidad accesoria; **ninguna viene marcada**. La versión sale del API y la fecha se escribe con `diaEnPalabras` (`fechas.ts`, igual que en la web): «Texto versión 1.0 del 30 de octubre de 2026.»
  - «Autorizar y continuar» sin la casilla de lo necesario: «Falta tu autorización para lo necesario.» junto a la casilla y **sin pedido**; el botón no se deshabilita (E14). Con ella: `POST /api/v1/autorizaciones` con las dos necesarias, las accesorias marcadas y la `version.numero` del catálogo → PN-71 **en la misma sesión**: mismo token, sin volver a iniciar sesión (S2).
  - «No autorizo»: `POST /api/v1/autorizaciones/rechazo`; con la respuesta correcta se borra el token del Keystore y se va a PN-60 con «Borramos el correo que nos diste.». Sin conexión o con un error del servidor, «Todavía no pudimos borrar tu correo. Intenta de nuevo.» (el token se conserva). `403 ya_autorizada` (otro teléfono ya autorizó) lleva a PN-71.
  - Errores de «Autorizar»: `409 version_desactualizada` muestra el error de envío de E14 y vuelve a pedir el catálogo conservando lo marcado; `422` y `5xx`, «No pudimos guardar tu autorización.»; `401` → PN-60 con «Tu sesión se cerró»; `403 verificacion_pendiente` → PN-59; `429` y sin conexión, los avisos de siempre.
- **Casilla** (`Casilla.tsx`, E14-SDD 5.17): fila de al menos 48 dp, caja de 24 con check, `accessibilityRole="checkbox"` y `accessibilityState.checked` (TalkBack dice «marcada» o «sin marcar»), el texto como nombre. Con error: ícono de Atención y texto en una región viva cortés, y el texto del error como `accessibilityHint` (React Native no tiene `aria-describedby`); el foco no se mueve solo. **Tarjeta** (`Tarjeta.tsx`, 5.7) la comparten las dos pantallas.
- **Atrás de Android:** PN-63 es la única pantalla de su pila (la deja `reemplazarPila` desde PN-59, el arranque o el inicio de sesión): el Atrás del sistema **sale de la app**, no hay pantalla anterior (E14: «la barra no lleva Atrás»). PN-64 se apila sobre PN-63 y su Atrás, el de la barra y el del sistema, vuelve a PN-63. Tras «Autorizar y continuar» (a PN-71) y tras «No autorizo» (a PN-60) se cambia con `reemplazarPila`: el Atrás no vuelve a PN-64 ni a una cuenta borrada. `tests/navegacion/flujoDeAutorizacion.test.tsx` toca el Atrás de verdad.
- **Prueba de S2** (dueño, 2026-10-24): `tests/navegacion/flujoDeAutorizacion.test.tsx`, «S2: una persona nueva que entra, autoriza en PN-64 y llega a PN-71 en la misma sesión ve «Este es tu primer ingreso.»»: inicio de sesión → `403 autorizacion_pendiente` → PN-63 → «Continuar» → PN-64 → lo necesario → «Autorizar y continuar» → PN-71. Comprueba un solo `POST /api/v1/sesiones` y que autorizar y PN-71 llevan el token del inicio de sesión. Contra el API de verdad, lo cubre `npm run integracion:api` (abajo).
- **Textos:** los de PN-63, PN-64, las finalidades y los cuatro avisos pasaron de `solo_web` a `comun` (los usan las dos apps y la prueba de claves lo exige); `sinAutorizacion.titulo` se quitó de `solo_android` porque ya nadie lo usa. E14 no tiene diferencias de texto para Android en estas dos pantallas.

## Registro de movimientos (US-51, D-164, D-165)

Ramas `feat/us-51-movil-logica` (monto, cliente del API y PN-03) y `feat/us-51-movil` (el formulario, PN-71 y los textos), apiladas sobre la web (#48 y #49). Mismo flujo, mismos textos y mismo mapeo de errores del API que la web (`web/src/pantallas/Registrar.tsx` y `SeRepite.tsx`).

- **Entrada y salida (D-164; cambiadas por la US-52).** Registrar (E14-PPN 3.1) se abre desde «Registrar» de PN-01 (ver «Movimientos» abajo), que empieza vacío (`reiniciarBorrador` al tocar el botón); al guardar vuelve a PN-01 con el aviso («Listo, registramos tu gasto de $45.000.») como **mensaje de estado** (`MensajeDeEstado`, el mismo de las llegadas de la US-49: región viva cortés que TalkBack anuncia sin mover el foco). El aviso lleva el monto, así que viaja como parámetro de la ruta (`aviso`), nunca se guarda. El botón provisional «Registrar un movimiento» de PN-71 se quitó en la US-52.
- **Campos (`src/pantallas/Registrar.tsx`).** Tipo, Monto (teclado numérico con coma, valor en Figtree sin `ss02`, D-123), Fecha («Hoy» al inicio; al tocarla abre el selector de fecha nativo de `CampoDeFecha`; una fecha futura sin repetición se acepta y se guarda con su fecha), Categoría (chips en una fila que se desplaza, y «Ver todas», que abre una hoja inferior con la lista), Medio de pago, De quién es, Descripción (hasta 280) y la fila «Se repite» con «Cambiar», que abre PN-03. **Categoría obligatoria (D-165):** la sugerida sale del motor de reglas, que no existe; sin elegir una, «Falta elegir la categoría.» y no se manda nada. Sin categoría sugerida el gasto en efectivo cuesta **cinco interacciones** desde PN-71 (abrir, monto, categoría, «Efectivo», «Guardar»; USA-004), lo que cuenta `tests/navegacion/flujoDeRegistro.test.tsx`.
- **Filas que no se construyen (D-164), cada una con la historia que la trae.** El cuadro de lenguaje natural con «Llenar el formulario», su aviso y el paso «Revisa y confirma» (motor de reglas, ADR-005); el aviso de faltante (simulación); el enlace «Prima, cesantías o intereses» (PN-04); «Elegir cuáles ver» (PN-05); «Compartido con el hogar» (hogares). **Por pedido del dueño (S2), tampoco el chip «Tarjeta» ni la fila «Cuotas»:** el medio de pago es solo «Efectivo» y «Transferencia», también para gastos; llegan con las tarjetas en I07.
- **PN-03 · Se repite (`src/pantallas/SeRepite.tsx`).** En Android E14-PRR 4.3 lo dibuja como pantalla con Barra superior (no es un destino), no como hoja: se apila sobre Registrar. Las seis opciones, la explicación de cada una, «Empieza el» (la fecha del formulario), «Próximas fechas» y «Listo». **Las fechas no se calculan en la app (D-165, E17-ECO 4.7):** llama a `GET /api/v1/repeticiones/proximas?periodicidad=&inicio=` y muestra lo que recibe, en palabras. Mientras llegan, la tarjeta queda ocupada y no dice nada; si el API falla, el aviso de siempre con «Intentar de nuevo», y **«Listo» sigue sirviendo**; una respuesta tardía de una elección anterior no pisa la actual. Con «Se repite» y fecha de hoy o pasada se guarda el movimiento escrito y la repetición empieza en esa fecha; con una futura solo se guarda la repetición y esa fecha queda pendiente (D-091). Las fechas entre la de inicio y hoy son historia (E15 5.2): el arriendo del 15 de agosto, mensual, escrito el 26 de octubre, registra el 15 de agosto y la próxima pendiente es el 15 de noviembre (la prueba lo cubre con el API simulado y `npm run integracion:api` con el de verdad).
- **El monto (`src/dinero.ts`).** `leerMonto` pasa «45.000» o «123.456,78» a centavos con `BigInt`, sin `Number` ni `parseFloat` (D-082, EXA-001), hasta 2^63 − 1; «12.5» se rechaza con «¿Quisiste decir $12.500 o $12,50?». Es el mismo código de `web/src/dinero.ts` y se portó porque es solo lectura y formato de lo que escribe la persona, no una regla de negocio: el API vuelve a validar todo (el tope de 2^63 − 1 solo sirve para dar el mensaje «El monto es demasiado grande»). `guardarMovimiento` escribe esos centavos con todos sus dígitos en el cuerpo (`pedir` acepta un cuerpo ya escrito como texto).
- **Hermes.** El código nuevo no usa ninguna API de `Intl` (ni `PluralRules` ni `DateTimeFormat`): las fechas usan `fechas.ts` (meses propios, «hoy» restando cinco horas a mano, como PN-71) y el monto, `BigInt` y expresiones regulares. No hay nada que comprobar contra `doc/IntlAPIs.md` de Hermes.
- **Atrás de Android.** Desde Registrar vuelve a PN-01 **sin guardar**; desde PN-03 vuelve a Registrar **sin cambiar nada** (solo «Listo» guarda la elección); con la hoja de categorías abierta cierra la hoja (`onRequestClose`). Después de guardar, Registrar sale de la pila (`popTo` a PN-01 con el aviso): el Atrás no vuelve al formulario. Lo comprueban `tests/navegacion/flujoDeRegistro.test.tsx` y `tests/componentes/HojaInferior.test.tsx`.
- **Textos.** Los de Registrar y PN-03 pasaron de `solo_web` a `comun` (los usan las dos apps y la prueba de claves lo exige); `periodicidad.errores.sinFecha` se queda en `solo_web` porque en Android la fecha siempre existe (viene del selector). No hay textos nuevos solo de Android.
- **Foco al primer error.** El foco va al Monto si es el primero con error (como en las demás pantallas de formulario); el error de los chips y de la fecha se anuncia con su región viva, sin mover el foco (React Native no tiene un `focus()` para un grupo de chips).

Sin dependencias nuevas.

## Movimientos: lista, detalle, corregir y borrar (US-52, D-164, D-168, D-169)

Dos ramas de Android de la US-52: `feat/us-52-movil-lista` (PN-01, sobre la web, #59) y `feat/us-52-movil` (PN-02, «Corregir» y borrar, sobre la anterior). Mismo flujo, mismos textos y mismo mapeo de errores del API que la web (`web/src/pantallas/Movimientos.tsx`).

- **PN-01 (`src/pantallas/Movimientos.tsx`, E14-PRR 4.1).** Una columna: el filtro de periodo («Noviembre», «Octubre» y «Otro mes», que abre una hoja con los meses que tienen movimientos), el filtro de categoría («Todas», las tres con más movimientos y «Ver todas», que abre una hoja con la lista completa, ocultas incluidas), el resumen del filtro («4 movimientos», «Alimentación: 2 movimientos, $120.000»), la lista agrupada por día («Hoy, 2 de noviembre de 2026», «Ayer, …» o la fecha en palabras) y «Registrar» fijo abajo, como único botón primario. Los estados: «No hay movimientos con este filtro.» con «Quitar los filtros», «Todavía no hay movimientos» y «No pudimos cargar tus movimientos.» con «Intentar de nuevo». No construye «Por confirmar» (US-60, D-168), las «Horas de vida» (RF-054), el contexto «Nuestro hogar» ni la navegación inferior (llega con el Inicio).
- **Nada de reglas en la app (E17-ECO 4.7).** El orden, los meses, las categorías del periodo, la suma y `compartido` los manda el API. Los `*_centavos` se leen como texto (`src/api/cliente.ts`) y se pasan a `BigInt`: la suma de un resumen puede pasar de 2^53 (D-082). Montos y números en Figtree (`cifras`, D-123).
- **SEG-002 (NC-E16-40, NM-05).** La fila «Arriendo de enero» ($100.000) muestra «Compartido con el hogar» con la Marca de propiedad (ícono y texto, `MarcaDePropiedad`); un aporte lleva su meta en lugar de la categoría («Aporte a una meta · Transferencia»). Lo cubre la prueba `SEG-002` de `tests/pantallas/Movimientos.test.tsx`.
- **Entrada y vuelta (D-164).** PN-71 lleva el botón «Movimientos» donde estaba «Registrar un movimiento» (se quita cuando exista la navegación inferior). PN-01 se apila sobre PN-71 (su Atrás vuelve a PN-71) y «Registrar» sobre PN-01. Los filtros viven en los parámetros de la ruta (`periodo`, `categoria`): sobreviven a abrir el formulario y volver. PN-01 pide la lista otra vez cada vez que recupera el foco (`useFocusEffect`), y solo pinta la última respuesta.
- **Sin conexión.** E14 dice «Sin conexión. Mostramos lo último que cargó.»: la app no guarda lo último que cargó, así que sale el aviso de siempre («Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.»).
- **PN-02 (`src/pantallas/DetalleDeMovimiento.tsx`, E14-PRR 4.2).** Tocar una fila de PN-01 abre el detalle con el movimiento que ya trae la lista (no hay un segundo pedido; viaja como parámetro de la ruta, solo en memoria): el monto en grande, «Gasto en Alimentación», Fecha, Medio de pago, De quién es (Marca de propiedad), Descripción y, si es una fecha de un recurrente, «Se repite» «Cada quincena». «Corregir» y «Borrar este movimiento» (**D-170:** no en un aporte ni en un retiro: se listan y se ven aquí, «Aporte a «{meta}»» o «Retiro de «{meta}»», hasta la historia de metas).
- **Corregir (`FormularioDeMovimiento` en `src/pantallas/Registrar.tsx`).** Reutiliza el formulario del registro en su propia pantalla («Corregir movimiento»), con campos llenos, «Guardar los cambios» y «Ahora no», y su propio estado (no toca el borrador del registro). Manda el `PUT` con todos los campos. **D-168:** en una fecha de un recurrente no hay Fecha ni Tipo (el API los rechaza con `fecha_no_editable` y `tipo_no_editable`) y la frase «Este cambio es solo para esta fecha. Las demás siguen igual.» va una vez, en todo el formulario; **D-170:** si el movimiento tiene una categoría que la persona ocultó después (el catálogo ya no la trae), el formulario la incluye ya elegida, en el chip y en «Ver todas», con el ícono de ojo tachado (`IconoOcultar`) y la palabra «Oculta» (`MarcaDeOculta`); las demás ocultas no aparecen, y deja de ofrecerse si se cambia el Tipo. Vuelve a PN-01 con «Listo, guardamos los cambios.».
- **Borrar.** La hoja inferior de confirmación (botón destructivo): «Gasto de $45.000 en Alimentación, Ayer.» (o «Ingreso de $1.500.000 por Salario, Ayer.») y «Se quita de tu lista y calculamos el mes de nuevo.»; un aporte o un retiro no se borra (D-170), así que no hay hoja ni aviso para ellos. **D-169:** «Esta fecha volverá a quedar por confirmar.» solo si `recurrente.vuelve_a_pendiente` es verdadero (lo decide el API: el arriendo del 15 de agosto creado el 26 de octubre no la lleva). Vuelve a PN-01 con «Listo, borramos el gasto de $45.000.». Un doble toque no manda dos borrados.
- **Errores (E14-PRR 4.2).** «Ese movimiento ya no está.» con «Ir a Movimientos» (el API contestó `404`; PN-02 lo muestra en lugar del detalle), «No pudimos guardar los cambios.», «No pudimos borrar el movimiento.», sin conexión y los errores de campo de E14-PPN 3.1. El `401` lleva a PN-60.
- **Atrás de Android.** PN-02 vuelve a PN-01 y PN-01, a PN-71; «Corregir» vuelve a PN-02 sin guardar; la hoja de borrar la cierra el Atrás. Después de guardar o borrar se vuelve con `popTo('ListaDeMovimientos')`: PN-02 y el formulario salen de la pila y el Atrás nunca vuelve al movimiento corregido o borrado (`tests/navegacion/flujoDeMovimientos.test.tsx`).
- **No se construyó:** «Cambiar cómo se repite» (abre PN-03 para una repetición que ya existe y el API de la US-52 no trae cómo cambiarla), «El saldo de la deuda sube {monto}.» (RN-012: llega con las deudas), las «Horas de vida», «Registrado por» y las reglas de «Nuestro hogar», el ícono Cerrar de la hoja de borrar (se cierra con «Ahora no», el Atrás o tocando fuera).
- **Hermes.** Sin API de `Intl` ni `URLSearchParams.set` (React Native no lo implementa): la dirección de la lista se arma a mano con `encodeURIComponent`.
- **Textos.** Los de PN-01 y PN-02 pasaron de `solo_web` a `comun` (los usan las dos apps y la prueba de claves lo exige); «Elige un movimiento para verlo.» se queda en `solo_web` (es de las dos columnas de la web). Los textos de D-170 están aprobados en E14-PRR 1.9 («1 movimiento», «Retiro de una meta», «Ingreso por {categoría}», «Aporte a «{meta}»», «Retiro de «{meta}»», la hoja y el aviso de borrar un ingreso) y «Oculta» está en `comun`. `registro.abrir` («Registrar un movimiento») se borró con el botón.
- **Prueba de integración.** `npm run integracion:api` suma la lista con filtros, corregir un monto, el `422` de D-168, borrar y `vuelve_a_pendiente` (D-169) contra el API de verdad.

Sin dependencias nuevas.

## Prueba de integración contra el API (US-49, A5; US-50, US-51, US-52)

`npm run integracion:api` (`scripts/integracion-api.mjs`) corre, con Node y fuera de Jest, el **mismo código** de `src/api/` contra un API de verdad: crear la cuenta en modo Android (el token llega en el cuerpo y queda en el almacén seguro), estado, verificar el correo con el enlace de Mailpit (como lo hace el navegador), iniciar sesión (token nuevo), `seguridad` con `403`, pedir el catálogo y autorizar por el API (`GET` y `POST /api/v1/autorizaciones`, con los errores `409 version_desactualizada` y `422 faltan_necesarias`) y comprobar que `seguridad` da `ingreso_anterior: null` **en la misma sesión** (S2 contra el API de verdad), cambiar la contraseña, cerrar sesión (`204`) y `401 sin_sesion` con el token cerrado; además la recuperación, el rechazo del modo Android con `Sec-Fetch-Site`, «No autorizo» (una cuenta nueva verificada y sin autorizar: `204`, el token se borra del almacén, sus sesiones dejan de servir y entrar da `401`; con una cuenta ya autorizada da `403 ya_autorizada`) y el estado sin conexión. Desde la US-51 también el registro con la sesión ya autorizada: las categorías (`GET /api/v1/categorias`), un gasto en efectivo, el arriendo del 15 de agosto con repetición mensual (con el «hoy» real del servidor: sin pendientes y con las próximas fechas que son los siguientes días 15), `GET /api/v1/repeticiones/proximas`, un regalo de diciembre sin repetición guardado con su fecha futura y las categorías que el API no acepta (de otro tipo o inexistente) con `422 categoria_invalida`. Una categoría **oculta** no se puede ocultar por el API (PN-05 no existe todavía): solo se prueba si se define `CONTENEDOR_POSTGRES` (el contenedor de PostgreSQL local; `POSTGRES_USER` y `POSTGRES_DB` valen `alcanzamos` por omisión), con lo que el script la oculta por SQL, comprueba que deja de salir en las categorías y que guardar en ella da `422`; sin esa variable lo dice con «OMITE» y sigue. Fuera de eso no siembra nada por SQL. En lugar de `expo-secure-store` usa un almacén en memoria (Node no tiene Keystore). Variables: `EXPO_PUBLIC_URL_API` y `URL_MAILPIT`. Los datos son sintéticos y cada corrida crea una cuenta nueva.

## Probar la cuenta y el acceso en el celular (US-49)

Con el API, PostgreSQL y Mailpit en el portátil y la app en Expo Go **58.0.5** de la Play Store (solo abre proyectos del SDK 58), por la red local (sin túnel). El celular y el portátil van en el mismo Wi-Fi. Todo desde la raíz del repositorio, salvo el paso 7. Datos sintéticos.

1. **Dirección del portátil** en la red local (se usa en los pasos 3 y 6):

   ```
   IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}'); echo $IP
   ```

2. **PostgreSQL y Mailpit** (`infra/local`, puertos solo en `127.0.0.1`):

   ```
   export POSTGRES_DB=alcanzamos POSTGRES_USER=alcanzamos POSTGRES_PASSWORD=solo-local POSTGRES_PORT=55432 MAILPIT_SMTP_PORT=51025 MAILPIT_WEB_PORT=58025
   docker compose -f infra/local/compose.yaml up -d --wait
   ```

   Un segundo Mailpit, con su pantalla abierta a la red local, para leer los correos **desde el celular** (el del compose solo escucha en el portátil):

   ```
   docker run -d --name alcanzamos-mailpit-lan --network alcanzamos-local_default -p $IP:58026:8025 axllent/mailpit:v1.31.6
   ```

3. **API** (imagen con la web embebida; tarda unos minutos la primera vez). La dirección pública es la del portátil: así el enlace del correo abre la web en el celular (D-155).

   ```
   docker build -f api/Dockerfile -t alcanzamos-api:dev .
   ENTORNO="-e BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@postgres:5432/alcanzamos?sslmode=disable -e CORREO_SMTP=alcanzamos-mailpit-lan:1025 -e CORREO_REMITENTE=no-responder@avisos.ejemplo.test -e CORREO_PRIVACIDAD=privacidad@ejemplo.test -e URL_PUBLICA=http://$IP:18090 -e SESION_SENUELO_CLAVE=Zm9vLWJhci1iYXotcXV4LXF1dXgtY29ycmUtbG9jYWw="
   docker run --rm --network alcanzamos-local_default $ENTORNO alcanzamos-api:dev migrar
   docker run -d --name alcanzamos-api --network alcanzamos-local_default -p 0.0.0.0:18090:8080 $ENTORNO alcanzamos-api:dev
   ```

4. **Revisa que el celular llega:** si el portátil tiene cortafuegos, abre el puerto `18090/tcp` (API) y `58026/tcp` (correos) y `8081/tcp` (Expo). Desde el navegador del celular, `http://IP:18090/salud` debe responder `{"estado":"ok"}` y `http://IP:58026` debe abrir Mailpit.
5. **Opcional, la prueba automática contra este API** (la de arriba):

   ```
   cd movil
   EXPO_PUBLIC_URL_API=http://$IP:18090 URL_MAILPIT=http://$IP:58026 npm run integracion:api
   ```

6. **La app** (en `movil/`; `npm start` es `expo start --lan`). La dirección del API se define al arrancar, con la IP del paso 1:

   ```
   cd movil
   npm ci
   EXPO_PUBLIC_URL_API=http://$IP:18090 npx expo start --lan
   ```

   Se abre Expo Go 58 y se escanea el QR. Si cambias la dirección, reinicia con `--clear` (`npx expo start --lan --clear`): Expo copia la variable al paquete.

7. **Recorrido en el celular:**
   1. «Crear una cuenta» → PN-65: elige una fecha de nacimiento. Con una fecha de menos de 18 años sale el aviso «Esta cuenta la crea una persona adulta.» (y lo recuerda 24 horas); con una de 18 años cumplidos, sigue PN-58.
   2. PN-58: correo (por ejemplo `laura@ejemplo.com`), contraseña de 15 caracteres o más (por ejemplo `lluvia café tren azul`) y nombre → PN-59.
   3. En el navegador del celular, `http://IP:58026`: abre el correo «Confirma tu correo en Alcanzamos» y toca el enlace (abre la web: «Listo, confirmamos tu correo.»). Vuelve a la app y toca **«Ya lo confirmé»**: llega a PN-63 («Cómo cuidamos tus datos»), con «Listo, confirmamos tu correo.» arriba.
   4. «Continuar» → PN-64 («Tu autorización»): ninguna casilla viene marcada. Toca «Autorizar y continuar» sin marcar: «Falta tu autorización para lo necesario.». Marca lo necesario (y, si quieres, los avisos) y toca «Autorizar y continuar»: llega a PN-71 con «Este es tu primer ingreso.», sin volver a entrar y sin sembrar nada. Cierra sesión, entra otra vez: ahora muestra «Tu ingreso anterior fue el … a las … p. m.» (hora de Colombia). Para ver «No autorizo», crea otra cuenta, llega a PN-64 y toca «No autorizo»: vuelve a PN-60 con «Borramos el correo que nos diste.» y esa cuenta ya no entra.
   5. PN-71 → «Cambiar mi contraseña» (PN-73) → guarda otra frase de 15 caracteres o más → vuelve a PN-71 con «Listo, cambiamos tu contraseña.».
   6. «Cerrar sesión» → PN-60 → «¿Olvidaste tu contraseña?» (PN-61) → escribe el correo → «Enviar el enlace». En `http://IP:58026` abre «Recupera el acceso a tu cuenta de Alcanzamos» y toca el enlace: la web (PN-62) te deja elegir la contraseña nueva. Vuelve a la app y entra con ella.
   7. Atrás de Android: desde PN-65 vuelve a PN-60; desde PN-59, PN-63 y PN-71 sale de la app (no vuelve al formulario ni a la sesión cerrada); desde PN-64 vuelve a PN-63; después de autorizar no vuelve a PN-64, y después de «No autorizo» no vuelve a la cuenta.
   8. Sin conexión: apaga el Wi-Fi del celular y toca «Iniciar sesión»: «Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.».
   9. TalkBack (Ajustes → Accesibilidad → TalkBack → activar). Con TalkBack, un toque selecciona un elemento y lo lee; dos toques seguidos lo activan. En PN-64 activa «Autorizar y continuar» sin marcar lo necesario: TalkBack debe anunciar «Falta tu autorización para lo necesario.». Al seleccionar la casilla de lo necesario debe leer su texto, su estado (marcada o sin marcar) y el error; cada casilla de lo opcional se lee con su texto y su estado. Es lo esperado: el error se anuncia con una región viva y el foco no salta solo a la casilla. Para apagarlo al terminar: Ajustes → Accesibilidad → TalkBack → desactivar (selecciona el interruptor con un toque y actívalo con dos), o mantén presionadas las dos teclas de volumen unos segundos si el atajo de TalkBack está activado.
   10. Registrar un gasto en efectivo (US-51, USA-004). En PN-71 toca «Movimientos» y, en PN-01, «Registrar». **Cronometra a mano desde ese toque hasta ver el aviso:** escribe el monto (`45.000`), toca una categoría de la fila (por ejemplo «Alimentación»), toca «Efectivo» y toca «Guardar». Son cinco interacciones (la fecha ya dice «Hoy» y «Gasto» ya está elegido). Vuelve a PN-01 con «Listo, registramos tu gasto de $45.000.», y TalkBack lo anuncia sin mover el foco. Prueba también «Guardar» con el formulario vacío: salen a la vez «Falta el monto.», «Falta elegir la categoría.» y «Falta elegir el medio de pago.». Atrás en Registrar vuelve a PN-01 sin guardar; después de guardar, Atrás no vuelve al formulario: va a PN-01 y de ahí a PN-71.
   11. El arriendo (S4, D-164). En Registrar toca la fecha y elige el 15 de agosto de 2026 en el selector; monto `1.200.000`, «Arriendo o cuota de vivienda» (o la que tenga «Ver todas»), «Transferencia». Toca «Cambiar» en «Se repite», elige «Cada mes»: «Próximas fechas» muestra las que calcula el API (el 15 de noviembre, el 15 de diciembre y el 15 de enero si hoy es el 26 de octubre de 2026; si es otro día, los siguientes 15 después de hoy). Atrás vuelve al formulario sin elegir nada; «Listo» deja «Se repite: Cada mes». «Guardar» registra el 15 de agosto y no deja pendientes las fechas de septiembre ni de octubre (E15 5.2). Con el Wi-Fi apagado, PN-03 avisa con «Intentar de nuevo» y «Listo» sigue sirviendo.
   12. Movimientos (US-52). En PN-71 toca «Movimientos»: PN-01 muestra «Todavía no hay movimientos» o la lista del mes agrupada por día, con «Registrar» siempre abajo. Registra dos o tres gastos de categorías distintas (paso 10) y vuelve: cada vuelta trae «Listo, registramos tu gasto de …». Toca «Octubre» y «Otro mes» (la hoja lista solo los meses con movimientos), elige una categoría de la fila y otra con «Ver todas»: el resumen dice «Alimentación: 2 movimientos, $120.000» y «Quitar los filtros» aparece si no hay resultados. Con un filtro puesto, toca «Registrar» y Atrás: PN-01 conserva el filtro. Atrás en PN-01 vuelve a PN-71. Con TalkBack, el aviso de después de guardar se anuncia solo y cada fila se lee como un solo elemento.
   13. Corregir y borrar (US-52). Toca una fila de PN-01: PN-02 muestra el monto, «Gasto en Alimentación», la fecha en palabras, el medio y la descripción. **Corregir:** los campos vienen llenos; cambia el monto a `40.000` y toca «Guardar los cambios»: vuelve a PN-01 con «Listo, guardamos los cambios.» y la fila dice $40.000; Atrás no vuelve al movimiento (va a PN-71). «Ahora no» y el Atrás de «Corregir» vuelven a PN-02 sin guardar. **Borrar:** «Borrar este movimiento» abre la hoja con «Gasto de $45.000 en Alimentación, Ayer.»; «Borrar el movimiento» vuelve a PN-01 con «Listo, borramos el gasto de $45.000.» y la fila ya no está; «Ahora no» y el Atrás cierran la hoja. Con el arriendo del 15 de agosto (paso 11, repetición mensual) abre la fila de agosto: trae «Se repite» «Cada mes», «Corregir» no muestra Fecha ni Tipo y lleva «Este cambio es solo para esta fecha. Las demás siguen igual.»; su hoja de borrar **no** dice «Esta fecha volverá a quedar por confirmar.» (es historia). Registra un gasto con repetición mensual y la fecha de hoy: su hoja de borrar **sí** la dice. Con el Wi-Fi apagado, «Guardar los cambios» y «Borrar el movimiento» avisan «Sin conexión…» y lo escrito se conserva.

8. **Para terminar** (borra también los datos):

   ```
   docker rm -f alcanzamos-api alcanzamos-mailpit-lan
   docker compose -f infra/local/compose.yaml down -v
   ```

El tráfico va en HTTP por la red local: Expo Go lo permite en desarrollo; una compilación de producción exige HTTPS (RNF-013, ADR-006).

## Pruebas (US-58, D-145)

Jest con el preset `jest-expo`, siguiendo la guía de Expo (<https://docs.expo.dev/develop/unit-testing/>). Las pruebas van en `tests/`, en espejo de `src/` (E17-ECO 4.1 bis): `src/fuentes.ts` se prueba en `tests/fuentes.test.ts`. Jest solo busca ahí (`roots` y `testMatch` apuntan a `tests/`) y mide `src/` (sin `src/tokens/`, que se genera) con un umbral de **50 % de líneas** (E17-ECO 5.5; hoy 100 %).

```
npm ci
npm test                # jest
npm run test:coverage   # con el umbral de 50 % de líneas
npm run typecheck       # incluye las pruebas
```

Las pruebas de la lógica de `scripts/` (`auditoria-logica.mjs`, `licencias-logica.mjs` y `bundle-logica.mjs`) también van en `tests/` y cuentan en Jest y en la cobertura. Los `.mjs` pasan por `babel-jest` (clave `transform` de la configuración de Jest) porque el preset de Expo solo transforma `.js`, `.ts` y `.tsx`.

**Pruebas de los textos (US-59, D-160, regla 4.13 de E17-ECO, paso 51).** `tests/textos/` reemplaza a la antigua comparación con `diseno/textos/es.json`, que ya no hace falta porque hay un solo archivo:

- `claves.test.ts`: toda clave que el código de `src/` usa existe en `comun` o `solo_android`, y toda clave de ambas la usa alguien (lee `src/` con el compilador de TypeScript con el análisis compartido de `diseno/textos/usos.mjs`). **Regla:** una clave de `comun` la usan las dos apps (la web lo comprueba en `web/tests/textos/claves.test.ts`) y una de `solo_android`, esta. Además falla si un texto de `es.json` aparece copiado en `src/` fuera del módulo generado.
- `es.generated.test.ts`: `es.generated.ts` es lo que genera el generador; los marcadores `{nombre}` se pasan exactos (error de tipo, comprobado por `npm run typecheck`, y de ejecución); y los plurales `one`/`other` con la regla manual del español.
- `tests/eslint/texto-suelto.test.ts`: la regla de textos sueltos en JSX (ver «Pipeline»).

**Hermes y `Intl.PluralRules`.** Hermes no implementa `Intl.PluralRules` (su documentación `doc/IntlAPIs.md` no la lista y la incidencia facebook/hermes#1462 sigue abierta; consultado el 2026-10-24). Por eso `plural` no la usa (D-163): aplica la regla manual del español, `one` solo para 1 y `other` para lo demás (0, 2 y los millones), igual que la web, y las pruebas de Jest corren el mismo código que corre en el teléfono.

**Resumen de las pruebas que fallan (US-59, S6).** `jest.reporters` es `[["default", { "summaryThreshold": 0 }]]`: al final de la corrida Jest vuelve a imprimir «Summary of all failing tests» con el nombre completo de cada prueba que falla (`archivo › describe › prueba`) y su error, también con `--silent` y con `--coverage`. Sin la opción Jest solo lo imprime con más de 20 suites, y una corrida parcial (`npx jest tests/x`) no lo mostraría. `modulePaths` apunta a `node_modules/` para que las pruebas que leen `diseno/` (`.mjs` fuera de `movil/`) encuentren los ayudantes de Babel.

Versiones fijadas sin `~` ni `^`, verificadas en el registro de npm el 2026-10-23: `jest-expo` 57.0.6 (hasta el SDK 57; en el SDK 58 es la 58.0.12, ver «Versión de Expo»; etiqueta `sdk-57`, publicada el 2026-10-12; `expo/bundledNativeModules.json` pide `~57.0.6`), `@react-native/jest-preset` 0.86.3 (peer de `jest-expo`, misma versión que `react-native`), `jest` 30.5.2 (2026-09-18, última), `@types/jest` 30.0.0 (última), `@testing-library/react-native` 14.1.0 (2026-10-08, última) y `test-renderer` 1.3.1 (2026-10-12; peer de la anterior).

## Versión de Expo

**Expo SDK 58** (`expo` 58.0.19, React Native 0.88.0, React 19.3.0), subido desde el SDK 57 con `npx expo install expo@58.0.19` y `npx expo install --fix`; `npx expo-doctor` no reporta avisos (20 de 20 comprobaciones). Las versiones están fijadas sin `~` ni `^` (Expo las pide con `~`, pero el proyecto las fija exactas); la tabla de abajo es la de `expo/bundledNativeModules.json` del SDK 58.

Por qué el SDK 58: el Expo Go de Google Play ya es la **58.0.5** y solo abre proyectos del SDK 58 (el dueño no instala una versión anterior). Referencias: <https://expo.dev/changelog/sdk-58> (15 de octubre de 2026) y `https://api.expo.dev/v2/versions/latest`, que el 2026-10-24 todavía informaba `expoGoSdkVersion: 57.0.0` (la tienda va antes que ese dato).

Versiones del SDK 58, verificadas en el registro de npm el 2026-10-24 (fecha de publicación entre paréntesis):

| Paquete | SDK 57 | SDK 58 |
|---|---|---|
| `expo` | 57.0.31 | 58.0.19 (2026-10-23) |
| `react-native` | 0.86.3 | 0.88.0 (2026-10-15) |
| `react` | 19.2.3 | 19.3.0 (2026-09-09; existe la 19.3.1, pero Expo pide la 19.3.0) |
| `@types/react` | 19.2.4 | 19.3.0 (la única 19.3) |
| `@react-native-community/datetimepicker` | 9.1.0 | 9.2.1 (2026-09-07) |
| `expo-secure-store` | 57.0.4 | 58.0.2 (2026-10-01) |
| `expo-font` | 57.0.4 | 58.0.10 (2026-10-23) |
| `expo-status-bar` | 57.0.1 | 58.0.4 (2026-10-21) |
| `react-native-screens` | 4.26.2 | 4.30.0 (2026-10-13) |
| `react-native-safe-area-context` | 5.7.0 | 5.10.1 (2026-09-29) |
| `react-native-svg` | 15.15.4 | 15.16.0 (2026-10-15) |
| `@react-native-async-storage/async-storage` | 2.2.0 | 2.2.0 (sin cambio) |
| `jest-expo` | 57.0.6 | 58.0.12 (2026-10-21) |
| `@react-native/jest-preset` | 0.86.3 | 0.88.0 (2026-10-15; peer de `jest-expo`) |

Sin cambio: `@react-navigation/native` 7.5.1 y `native-stack` 7.21.0 (Expo no los fija), `typescript` 6.0.3 (Expo no lo fija), `@testing-library/react-native` 14.1.0 y `test-renderer` 1.3.1 (aceptan React `>=19` y React Native `>=0.78`), `jest` 30.5.2 (el peer de `jest-expo` admite 29 y 30).

Cambios que pidió el SDK 58:

- `npx expo install --fix` sumó `"expo-status-bar"` a `plugins` de `app.json`.
- React Native 0.88 cambió el tipo del campo de texto: `TextInput` pasó a ser el componente, y la instancia (`focus()`) es `TextInputInstance`. Los `ref` de `src/` y de `tests/` usan ese tipo.
- Metro 0.88 resuelve `react-native/asset-registry` desde la carpeta de cada recurso, y las fuentes están en `../diseno/`, donde no hay `node_modules`: `metro.config.js` suma `movil/node_modules` a `resolver.nodeModulesPaths`. Sin eso, `expo export` falla.

Riesgo: cuando haya un SDK 59 y el Expo Go de la tienda lo exija, hay que repetir esta subida (`npx expo install expo@<59> --fix`) y revisar las excepciones de auditoría y de licencias.

## Probar en el celular (modo LAN)

Mismo Wi-Fi para el computador y el celular. Sin modo túnel.

```
npm ci
npm start        # equivale a expo start --lan
```

Se abre Expo Go 58 y se escanea el QR. Con USB: `npm run android` (solo requiere `platform-tools`, D-122).

Verificación sin dispositivo: `npm run typecheck`, `npx expo-doctor` y `npm run export:android`.

## Hallazgos de fuentes (verificados con fontTools sobre los TTF, 2026-10-22)

- **Figtree 2.001** (GSUB): `tnum`, `pnum`, `ss01`, `ss02`, `case`, `frac`, `numr`, `dnom`, `sups`, `subs`, `sinf`, `ordn`, `locl`, `ccmp`, `aalt`. Las cifras tabulares existen: `tnum` cambia `zero`→`zero.tf` (y las demás cifras a ancho común). `ss02` da otro cero (`zero.ss02`).
- **Atkinson Hyperlegible Next 2.001** (GSUB): `tnum`, `pnum`, `case`, `frac`, `sups`, `ordn`, `locl`, `ccmp`, `aalt`. **No tiene** `zero`, ningún `ss01`–`ss20` ni `cv01`–`cv99`. Su cero está siempre **barrado** (el glifo `zero` tiene 3 contornos; la letra O, 2) y no hay variante sin barra.
- React Native 0.86 en Android traduce `fontVariant` a `fontFeatureSettings` (`ReactTypefaceUtils.kt`): `tabular-nums`→`tnum`, `proportional-nums`→`pnum`, `stylistic-one`…`stylistic-twenty`→`ss01`…`ss20`. **No existe un valor para `zero`/`slashed-zero`**, así que ese rasgo no se puede pedir con `fontVariant` aunque la fuente lo tuviera.

Conclusión: con `fontVariant` el cero de Atkinson no se puede cambiar (ni quitar la barra ni ponerla), porque la fuente no trae variante. Según D-122 no se fuerza una solución.

**Este caso ya lo decide D-085:** «si no la tiene, la regla de Figtree se extiende a todo número». Todo número va en Figtree, también dentro de una frase. Los tokens `cifra` y `cifra-grande` ya lo prevén. El cero de Figtree por defecto es liso.

**Sin `ss02` (D-123).** El cero de Figtree por defecto no lleva barra, y eso es lo que busca D-085. `ss02` le pone barra, así que no se usa en la app. La pantalla de prueba lo muestra solo como control de que `fontVariant` funciona.

**Verificado en el celular del dueño** con Expo Go, en modo LAN, el 2026-10-22: las fuentes cargan, las cifras tabulares se alinean y el cero de Atkinson siempre lleva barra.

Otras salidas, descartadas por D-085 (cambiarlas pide una decisión nueva):

- Aceptar el cero barrado de Atkinson en los números del texto.
- Una derivada de Atkinson con otro cero: la OFL lo permite, pero exige renombrarla y mantenerla.

## Pantalla de prueba: qué mirar

1. Columnas de montos: con `tabular-nums` las cifras de cada columna deben ocupar el mismo ancho; sin esa opción, no. Se nota con los 1 y 7 de «$ 111.111» y «$ 7.080».
2. Cargó la fuente: aparece primero «Cargando…» y luego la pantalla con las cuatro filas de ceros en Atkinson y el renglón de Figtree. Si el texto se ve en Roboto, la fuente no cargó.
3. Ceros de Atkinson: las cuatro filas (sin variante, `tabular-nums`, `stylistic-one`, `stylistic-two`) deben verse con el mismo cero barrado. En el control de Figtree, `stylistic-two` sí cambia el cero (prueba de que `fontVariant` funciona en ese equipo).

## Instalación de dependencias (npm 12.2.1)

Requiere **npm 12.2.1 exacto** (`engines` de `package.json`; `engine-strict=true` hace fallar la instalación con otra versión). Para instalarlo en un equipo con npm 11, fuera de `web/` y `movil/` (su `.npmrc` exige npm 12), con la misma verificación que los pipelines:

```
cd "$(mktemp -d)"
curl -fsSLO https://registry.npmjs.org/npm/-/npm-12.2.1.tgz
echo "6ca0a6151553fc107e60f1186d9c10d57508dcde6de31292a54d4cc4e8e8ef3de25b3281274657442d7115d10df930bb3794ddcb0681cdfd9d317189abf7b63d  npm-12.2.1.tgz" | sha512sum --check --strict -
npm install --global ./npm-12.2.1.tgz
hash -r
npm --version   # 12.2.1
```

npm 12.2.1 pide Node `^22.22.2 || ^24.15.0 || >=26`. Con un gestor de versiones de Node (mise, nvm), npm se instala dentro de esa versión de Node: al cambiar o reinstalar Node hay que repetir los pasos. Los pipelines y la imagen de Docker descargan el tarball del registro y verifican su SHA-512 antes de instalarlo.

`movil/.npmrc` fija las reglas y se aplica igual en local, en `.azure-pipelines/movil.yml` y en `api/Dockerfile` (que lo copia antes de `npm ci`); no se repiten en la línea de comandos:

| Opción | Efecto |
| ------ | ------ |
| `strict-allow-scripts=true` | Una dependencia con scripts de instalación que no esté en `allowScripts` hace fallar `npm ci` e `npm install` (`ESTRICTALLOWSCRIPTS`) |
| `min-release-age=7` | La resolución no elige versiones publicadas hace menos de 7 días |
| `allow-git=none`, `allow-remote=none` | Sin dependencias desde git ni desde URL |
| `engine-strict=true` | Node y npm de `engines` son obligatorios |

`min-release-age-exclude[]` queda vacío. Solo se agregaría un paquete para una corrección de seguridad urgente, con su motivo y su fecha en esta sección.

### `min-release-age` frente al lockfile (medido con npm 12.2.1, 2026-10-24)

- **`npm ci` respeta el lockfile y no aplica la edad:** instala versiones fijadas con menos de 7 días (aquí, p. ej. `expo` 58.0.19, publicado el 2026-10-23), también con la caché vacía. No falla ni avisa.
- **`npm install` sin cambios en `package.json`:** igual, deja el lockfile como está.
- **Cualquier resolución nueva sí la aplica:** `npm install paquete` elige la última versión con 7 días o más; `npm install paquete@x.y.z` con una versión más joven falla con `ETARGET` («No matching version found … with a date before …»); si `package.json` pide una versión joven que el lockfile no tiene, `npm install` falla igual; `npm update` **baja** una versión joven del lockfile a una anterior que cumpla el rango.
- **Consecuencia:** subir una dependencia exacta publicada hace menos de 7 días no se puede instalar hasta que cumpla la edad, o hasta agregarla a `min-release-age-exclude[]` con motivo y fecha. Un lockfile que ya la trae sigue instalándose. Este proyecto fija versiones exactas; una subida de SDK con paquetes de menos de una semana espera 7 días o se excluye paquete por paquete.
- Con un paquete joven explícito en un árbol con dependencias de pares (`npm install vite@8.3.5 --save-exact` en `web/`) npm no terminó en 300 s (repite avisos `ERESOLVE overriding peer dependency`); con `timeout` se corta sin cambios.

### Revisión de antigüedad del lockfile (D-158)

`npm run antiguedad` (`scripts/antiguedad.mjs`, lógica en `scripts/antiguedad-logica.mjs`, pruebas en `tests/antiguedad.test.ts`) tapa el hueco de `npm ci`. Corre en el pipeline **antes** de `npm ci` y no usa dependencias, así que funciona sin `node_modules`. Compara cada versión de `package-lock.json` con su fecha de publicación en el registro (el campo `time` del documento del paquete) y falla:

- con una versión publicada hace menos de `min-release-age` días (se lee de `.npmrc`) que no tenga una excepción vigente;
- si no puede obtener la fecha de un paquete o el registro no la tiene para esa versión (tres intentos por paquete; no la da por buena);
- con una excepción vencida (`revisar_antes_de` anterior a hoy, en UTC) o que no corresponde a ninguna versión del lockfile;
- con una entrada del lockfile que no viene del registro.

Las excepciones van en `antiguedad-excepciones.json`, una por versión, con `paquete`, `version`, `motivo` y `revisar_antes_de` (la fecha de vencimiento), como las de auditoría. Una excepción de una versión que ya cumple la edad se informa como sobrante, pero no falla hasta vencer. Para instalar una versión joven por una corrección de seguridad urgente hacen falta dos cosas: `min-release-age-exclude[]` en `.npmrc` (para que npm la resuelva) y su excepción aquí (para que pase esta revisión).

**Transición (D-158):** el archivo arranca con 63 excepciones, las versiones que ya estaban en el lockfile de `main` el 2026-10-24 con menos de 7 días (la mayoría entró con el SDK 58). Todas vencen el 2026-11-01 (D-159): el motivo de cada una dice el día en que esa versión cumple 7 días (entre el 2026-10-25 y el 2026-10-30), y el PR del 2026-11-01 vacía el archivo. Si no se vacía, el pipeline falla desde el 2026-11-02.

**node-forge 1.4.2 (D-166):** el 2026-10-27 se subió `node-forge` a 1.4.2 (corrección de GHSA-86w9-cpqp-85rv, publicada ese día) con `--min-release-age-exclude=node-forge` en la línea de comandos de esa única instalación, sin tocar `.npmrc`, y con una excepción de antigüedad que vence el **2026-11-03**, cuando cumple 7 días. Pasada esa fecha se quita la excepción.

**Riesgo aceptado (D-158):** npm no detecta que un paquete perdió nivel de confianza (por ejemplo, que pasó de publicarse desde un pipeline con procedencia a publicarse sin ella). Se mitiga con la revisión de los cambios del lockfile en cada PR y con `npm audit signatures`.

### Scripts de instalación (`allowScripts`)

Inventario con `npm install-scripts ls` y `hasInstallScript` del lockfile. **Ninguna dependencia necesita ejecutar scripts**: se verificó instalando con todas denegadas y corriendo todas las comprobaciones.

| Paquete | Script | Decisión | Por qué / qué falla si se deniega |
| ------- | ------ | -------- | --------------------------------- |
| `@parcel/watcher` 2.6.0 | `install` (`node scripts/build-from-source.js`) | Denegado | Lo trae `jest-haste-map` para el modo `--watch`. El binario viene precompilado en el paquete opcional de cada plataforma (`@parcel/watcher-linux-x64-glibc`); el script solo compila desde fuente si no hay uno. Denegado: `require('@parcel/watcher')` carga y las 400 pruebas pasan |
| `unrs-resolver` 1.12.2 | `postinstall` (`node postinstall.js`) | Denegado | Lo trae `jest-resolve`. El script (`napi-postinstall`) solo descarga el binario nativo si falta; el binario viene en el paquete opcional (`@unrs/resolver-binding-linux-x64-gnu`). Denegado: `require('unrs-resolver')` carga y Jest resuelve módulos sin problema |
| `fsevents` 2.3.3 | `install` (`node-gyp rebuild`) | Denegado | Opcional de macOS (vigilancia de archivos). No se instala en Linux; sin ella se usa `fs.watch`. **No se pudo probar en macOS** |

Las denegaciones van por nombre (sin versión): valen para cualquier versión y sobreviven a `npm install-scripts approve --all`. Si algún día hace falta aprobar un paquete, se aprueba **fijado** (`paquete@x.y.z`, el valor por defecto de `npm install-scripts approve`) para que una versión nueva con otro script vuelva a pedir revisión; como las dependencias de este proyecto ya están fijadas, subir la versión ya exige tocar `package.json` y de paso revisar la aprobación. Una dependencia nueva con scripts hace fallar la instalación hasta decidir con `npm install-scripts approve|deny <paquete>`.

## Pipeline (US-58, D-149)

`.azure-pipelines/movil.yml` corre con cambios en `movil/`, `diseno/` o su YAML. Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado, como `web.yml`, y npm 12.2.1 desde el tarball del registro con SHA-512 verificado, y corre desde `movil/`, en este orden: `npm run antiguedad` (D-158, antes de instalar); `npm ci` (con `movil/.npmrc`); `npm audit signatures`; `npm run lint`; `npm run typecheck`; `npm run tokens` seguido de `git diff --exit-code -- ../diseno ../web ../movil` (los tokens regenerados no cambian nada); `npm run test:coverage` (mínimo 50 % de líneas); `npm run auditoria`; `npm run licencias`; `npm run comprobar-bundle`. No compila el paquete de Android.

**ESLint** (`eslint.config.mjs`, configuración plana con `defineConfig` de `eslint/config`, E17-ECO Q-2): `@eslint/js` y `typescript-eslint` recomendados, `eslint-plugin-react-hooks`, todas las reglas de `eslint-plugin-react-native-a11y` (E17-ECO 4.10, ADR-003 §3), sin `any` explícito y `@ts-ignore` solo con descripción. Más la regla de solo tokens de la web (E17-ECO 4.5), adaptada a React Native:

- Vale igual que en la web: los literales de texto con colores sueltos (`#…`, `rgb(`, `hsl(`), medidas con unidad, la paleta primitiva (`paleta`) y los dominios fijos (`alcanzamos.co`, `localhost`, `http(s)://`, D-129).
- Distinto: en React Native los estilos son objetos, sin unidades. La regla marca además un número distinto de cero en las propiedades de medida de un objeto de estilo (`padding*`, `margin*`, `gap`, `top`…, `width`, `height`, `fontSize`, `lineHeight`, `letterSpacing`, `borderRadius`, `border*Width`, `min*`/`max*`). `flex`, `opacity` y `zIndex` no son medidas y no se revisan.
- Límite: solo ve literales. Un valor que sale de una función o de una variable no se puede revisar con una regla de sintaxis: lo revisa el dueño con la lista de E17-ECO 6. `tests/`, `scripts/` y los `*.config.*` quedan fuera de la regla, y `src/tokens/tokens.generated.ts` (generado) no se revisa.
- `eslint-plugin-react-native-a11y` 3.5.1 declara compatibilidad solo hasta ESLint 8 (`peerDependencies`), pero sus reglas corren en ESLint 9. Para no usar `--legacy-peer-deps` en todo el proyecto, `package.json` tiene `overrides` solo para ese plugin (`"eslint": "$eslint"`). Se revisa cuando el plugin publique una versión nueva.
- `src/fuentes.ts` queda fuera de `no-require-imports`: Metro solo empaqueta las fuentes con `require()` estático.
- **Sin textos sueltos en JSX (D-162, US-59).** La misma regla `no-restricted-syntax` de `web/eslint.config.js`, equivalente a `react/jsx-no-literals` con `noStrings: true` (`eslint-plugin-react` no se instala): reporta texto como hijo (`<Text>Hola</Text>`), cadenas y plantillas entre llaves (también en un ternario o un `&&` directo) y cadenas en las propiedades de texto: las de React Native (`accessibilityLabel`, `accessibilityHint`, `aria-label`, `placeholder`, `title`) y las de los componentes de la app (`titulo`, `etiqueta`, `ayuda`, `pista`, `texto`, `error`, `mensaje`). Se permiten el espacio en blanco, las cadenas vacías, los números y las propiedades que no son texto (`accessibilityRole`, `autocompletar`, `teclado`, `variante`…). `tests/eslint/texto-suelto.test.ts` corre ESLint con la API de Node (en un proceso aparte, `tests/ayudas/eslint-nodo.mjs`: Jest no deja que ESLint cargue `eslint.config.mjs`) con fixtures que deben y que no deben reportar, y comprueba que `src/` y `App.tsx` pasan. Límite: no sigue cadenas que entran por una variable o por un argumento (`conBarra("…")`); de las copias de un texto de `es.json` se encarga `tests/textos/claves.test.ts`. **Excepción:** solo `src/PantallaCifras.tsx` (pantalla de prueba de tipografía, ya sin montar) queda fuera de esta regla. `App.tsx` la cumple desde D-163: «Cargando…» y «No pudimos abrir la app. Ciérrala y vuelve a abrirla.» salen de `es.json` (E14-PCP 1.19) y el detalle del error de las fuentes va solo al registro (`console.error`), nunca a la pantalla (`tests/App.test.tsx`).

Versiones fijadas sin `~` ni `^`, verificadas en el registro de npm el 2026-10-23: `eslint` y `@eslint/js` 9.39.5 (las mismas de `web/`; la última de `eslint` es la 10.13.0, pero `web/` y este proyecto se mantienen juntos en la 9), `typescript-eslint` 8.72.0, `eslint-plugin-react-hooks` 7.1.1, `eslint-plugin-react-native-a11y` 3.5.1 (2026-07-20, última) y `globals` 17.13.0.

### Vulnerabilidades (`npm run auditoria`)

`npm audit --omit=dev --audit-level=high` falla con el aviso de `zod` (abajo). En vez de silenciarlo para todo el proyecto, `scripts/auditoria.mjs` corre `npm audit --omit=dev --json` y falla con:

- todo aviso alto o crítico que no esté en `auditoria-excepciones.json`;
- toda excepción que ya no se reporta (quedó obsoleta: se quita);
- toda excepción cuyo camino de dependencias cambió, por ejemplo si el paquete pasa a ser una dependencia directa de la app;
- toda excepción cuya fecha `revisar_antes_de` pasó (hoy en UTC, después de esa fecha). El dueño la renueva en el cierre de cada iteración (D-150), y también se revisa al subir de versión de Expo. La fecha actual es **2026-11-05**, el fin de la iteración I05.

Cada excepción trae el GHSA, el paquete, las rutas de dependencias (que muestran que el paquete llega solo por las herramientas de construcción), el motivo, la fecha de revisión y `revisar_antes_de`.

### `node-forge` y `zod` no entran en la app (`npm run comprobar-bundle`)

La excepción de `zod` (y, antes de D-166, la de `node-forge`) se apoya en que ningún archivo de la app los importa; el script sigue comprobando los dos. `scripts/comprobar-bundle.mjs` lo comprueba: corre `npx expo export --platform android` en una carpeta temporal fuera del repositorio y busca en el paquete de JavaScript el nombre y cadenas propias de cada paquete, porque Metro no deja las rutas de los módulos (`MARCAS_POR_PAQUETE` en `scripts/bundle-logica.mjs`):

- `node-forge`: `RSASSA-PKCS1-V1_5` y el prefijo de OID `1.2.840.113549`.
- `zod`: `ZodError`, `invalid_type`, `too_small` e `invalid_enum_value` (valores de datos, que sobreviven a la minificación y aparecen en el bytecode de Hermes).

Falla, nombrando el paquete, si aparecen en algún archivo o si no se generó ningún paquete. Probado con un `import` temporal de cada paquete: falla; sin él, pasa (D-150, D-154).

Tarda de 3 a 6 segundos (medido el 2026-10-24, Expo 58.0.19, Node 24.22.1 en el pipeline y 26.12.0 en el portátil, caché caliente), así que es un paso del pipeline.

### Licencias (`npm run licencias`)

`scripts/licencias.mjs` es la copia de la revisión de `web/` (`web/scripts/licencias.mjs`), sin importar nada de otra carpeta: solo dependencias de producción, contra la misma lista de licencias compatibles con AGPLv3 (condición 4 de ADR-003). **La lista general no cambia.** Las excepciones (D-150) son por paquete, en `licencias-excepciones.json`, cada una con la licencia, el camino de dependencias, la razón y `revisar_antes_de` (**2026-11-05**):

| Paquete | Licencia | Camino |
|---|---|---|
| `argparse` 2.0.1 | Python-2.0 | `expo > @expo/cli > @expo/xcpretty > js-yaml > argparse` |
| `caniuse-lite` 1.0.30001819 | CC-BY-4.0 | `expo > @expo/metro-config > browserslist > caniuse-lite` |

Razón: son herramientas de compilación que no van en la app, y la FSF considera las dos licencias compatibles con la GPLv3. El camino de cada paquete es el más corto desde las dependencias directas, uno por cada paquete que depende de él.

Falla si: otro paquete tiene una licencia no permitida; cambia la licencia de uno con excepción; cambia su camino; la excepción quedó obsoleta (el paquete ya no está o su licencia ahora es permitida); o pasó la fecha `revisar_antes_de`. En este último caso se revisa en el cierre de la iteración y se renueva la fecha, o se quita la excepción.

## Alertas de `npm audit` (2026-10-23, actualizado el 2026-10-27)

El 2026-10-27 `node-forge` pasó a 1.4.2, que corrige GHSA-86w9-cpqp-85rv: ese aviso ya no sale y se quitó su excepción (D-166). Lo que sigue es lo documentado el 2026-10-23 para `zod`; la fila de `node-forge` queda como historia.

Con `--omit=dev`, `npm audit` marcaba 5 alertas altas, por dos avisos:

| Paquete | Aviso | Quién lo trae |
|---|---|---|
| `node-forge` 1.4.0 (corregido en 1.4.2, D-166) | GHSA-86w9-cpqp-85rv: la verificación de firmas RSA PKCS#1 v1.5 acepta elementos de más | `expo` → `@expo/cli` (y `@expo/code-signing-certificates`) |
| `zod` 3.25.76 | GHSA-mrhx-c7xc-m3w5: puede agotar la memoria al validar colecciones enormes con restricciones (afecta a `zod` anterior a 4.6.6) | `expo` → `@expo/cli` (como dependencia de desarrollo también por `eslint-plugin-react-hooks`, que la auditoría de producción omite) |

Las otras tres alertas son los paquetes que dependen de `node-forge` o `zod` (`@expo/code-signing-certificates`, `@expo/cli` y `expo`). El aviso de `braces` (GHSA-vfj7-8cjw-p6xm, `micromatch` de las herramientas de Jest y Metro) que se documentó el 2026-10-22 ya no sale: GitHub retiró ese aviso (*withdrawn*), aunque la versión instalada sigue siendo la 3.0.3 (`npm ls braces`). `@expo/cli` es la herramienta de línea de comandos de Expo, no la app que se instala en el celular: ninguno de los archivos de `src/` lo importa.

`zod` no tiene corrección compatible: la solución es `zod` 4 (4.6.6 o posterior), un salto mayor que Expo 58 no usa (`@expo/cli` 58.1.15 sigue trayendo la 3.25.76), y la «corrección» de npm es bajar a expo 44 (consultado el 2026-10-23). `@expo/cli` lo usa para validar la configuración y las opciones de la CLI, en la máquina de desarrollo y en el pipeline, y ningún archivo de `src/` lo importa. Es la única excepción de `auditoria-excepciones.json` (aprobada en D-154, con revisión antes del 2026-11-05). No se fuerza `zod` 4 con `overrides`: puede romper `expo start` y `expo export`.

- **No se usa `npm audit fix --force`:** bajaría Expo al SDK 44.
- **Se revisan cada vez que se sube de versión de Expo.**
