# movil/

App móvil en React Native con Expo, primero Android y después iOS (ADR-003). Las notificaciones usan FCM sin pasar por el servicio de notificaciones de Expo.

- Archivo de construcción: `package.json` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), misma configuración de TypeScript, ESLint y Prettier que `web/`. Código en `src/` y pruebas en `tests/`.
- Los tokens de diseño vienen de [`diseno/`](../diseno/) y se convierten con `npm run tokens`.

## Estado (US-45, T3)

Solo hay una pantalla de prueba con cifras inventadas (`src/PantallaCifras.tsx`): cifras tabulares de Figtree, cero de Atkinson Hyperlegible Next y qué fuente cargó. No hay lógica de negocio. ESLint ya está configurado (ver «Pipeline»); Prettier todavía no (pendiente con `web/`).

## Base de la cuenta y el acceso (US-49, A1)

Rama `feat/us-49-movil-base` (D-155). Es la base de las pantallas de cuenta y acceso: navegación, cliente del API, token en el Keystore, textos y logo. La pantalla de prueba de cifras sigue en `src/PantallaCifras.tsx` y `src/fuentes.ts`, pero la app abre ya en `PN-60`.

- **Navegación nativa** (`src/navegacion/`): `@react-navigation/native` y `@react-navigation/native-stack`, que usan las pantallas del sistema (ADR-003 condición 1, D-078). El Atrás de Android vuelve a la pantalla anterior y, en la primera, sale de la app. `reemplazarPila` (`llegada.ts`) deja una pantalla como la única de la pila, para las que no deben poder volverse con Atrás (después de entrar, de cerrar sesión o de crear la cuenta). La marca va encima: fondo de página y sin barra salvo en las pantallas que la piden. Se llega a PN-60 al abrir la app: la edad nunca se pregunta antes de iniciar sesión (E14-PCP 3).
- **Cliente del API** (`src/api/cliente.ts`): único lugar con `fetch`. Manda siempre `X-Alcanzamos-Cliente: android` y, si hay sesión, `Authorization: Bearer <token>`. **Nunca** manda `Origin` ni `Sec-Fetch-Site`: React Native no las agrega y el API rechaza el modo Android si llegan (D-143 (3)); una prueba lo comprueba.
- **Dirección del API** (`src/config.ts`): sale de `EXPO_PUBLIC_URL_API`, sin dominio fijo en el código (D-129; ESLint lo prohíbe). Expo la copia al paquete al arrancar, así que se define al correr `expo start`, no en un archivo del repositorio. Ejemplo solo para probar en la red local (no es una dirección del producto): `EXPO_PUBLIC_URL_API=http://192.168.1.20:18090 npx expo start --lan`. Sin ella, la app no hace ningún pedido y muestra «Sin conexión…».
- **Token de la sesión** (`src/sesion/token.ts`): solo en `expo-secure-store`, que en Android lo cifra con el Keystore (ADR-003, AC-3). No se usa `AsyncStorage` ni archivos para el token, y las pantallas nunca lo ven: el cliente lo guarda al recibirlo y lo borra con un `401 sin_sesion`. `tests/sesion/almacenamiento.test.ts` revisa el código.
- **Textos** (`src/textos.ts`): copia de `web/src/textos.ts` sin la casilla de la web, con los mismos textos y códigos de E14-PCP (4.16, aprobados en D-153). `movil/` no importa nada de otra carpeta.
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

- **Selector de fecha:** `@react-native-community/datetimepicker` 9.1.0 (MIT, 2026-03-17, la que `expo/bundledNativeModules.json` pide para el SDK 57 y la que documenta Expo: <https://docs.expo.dev/versions/v57.0.0/sdk/date-time-picker/>, que lista Expo Go). `DateTimePickerAndroid.open` abre el diálogo del sistema. El diálogo siempre se abre en una fecha (hoy o la última elegida): no se puede abrir «sin elegir nada» como pide E14-PCP 4.8. El campo sí queda vacío hasta que la persona confirma, y no se fija fecha máxima ni mínima.
- **`accessibilityRole="alert"`:** React Native no tiene un rol de estado (`role="status"` no llega a Android), así que el aviso usa `alert` con la región viva cortés. La región cortés evita que interrumpa lo que TalkBack está diciendo.
- **`accessibilityHint`:** E14 no define pistas; se usa el texto de ayuda del campo donde existe. El plugin de ESLint (`has-accessibility-hint`) exige la pista junto a todo `accessibilityLabel`; dos casos la omiten con la razón escrita (el logo y el botón Ver y Ocultar, de los que E14 fija solo el nombre).
- **Pruebas:** `tests/ayudas/preparar.ts` mockea los márgenes del sistema (`react-native-safe-area-context`) para todas las pruebas.

### Aviso de la auditoría al sumar el selector de fecha

`npm run auditoria` **falla desde esta rama**, sin ningún aviso nuevo: `@react-native-community/datetimepicker` declara `expo` como dependencia par opcional y `npm audit` lista ahora al selector como «vulnerable» por esa vía. Los dos avisos con excepción (`node-forge` y `zod`) ganan un camino más, `@react-native-community/datetimepicker > expo > @expo/cli > …`, y el script exige que el dueño revise las `rutas` de `auditoria-excepciones.json`. No se agregó ni se cambió ninguna excepción (D-155): queda para decisión del dueño.

## Crear la cuenta, verificar el correo y la pantalla provisional (US-49, A3)

Rama `feat/us-49-movil-cuenta` (D-155). Flujo: PN-60 → «Crear una cuenta» → **PN-65** → **PN-58** → **PN-59** → pantalla provisional.

- **PN-65 · Edad** (`src/pantallas/Edad.tsx`, `src/edad/`): solo se abre desde «Crear una cuenta» de PN-60. La edad se calcula en el teléfono (`calculo.ts`, corte en 18 años, por día del calendario local: quien cumple 18 hoy es mayor; quien los cumple mañana, no). **La fecha no se envía ni se guarda** (D-089; el dueño citó D-134): vive solo en el estado de la pantalla. El teléfono recuerda únicamente `{"resultado":"menor","hasta":<hora>}` durante 24 horas, en AsyncStorage (no es un secreto; `recuerdo.ts`). Un resultado de persona adulta no se recuerda: E14-PCP 4.8 solo define el estado «Resultado recordado» para menores. Con menos de 18 años muestra el aviso de E14 **sin** el botón «Ya tengo un usuario: iniciar sesión» (D-137); el Atrás del sistema vuelve a PN-60. Es la única regla de negocio del cliente (excepción a ADR-005 escrita en E14).
- **PN-58 · Crear la cuenta** (`CrearCuenta.tsx`): los tres datos, sin casilla de edad. Manda `mayor_de_edad: true` solo si viene de PN-65 (el tipo de la ruta solo admite `mayorDeEdad: true`; sin eso la pantalla vuelve a PN-60 y no hace ningún pedido). Los errores `422` salen de `textos.ts`; un código sin texto muestra el aviso general y no se inventa uno. La fila «Política de tratamiento de datos» (PN-68) no está: esa pantalla no existe todavía.
- **PN-59 · Verificar el correo** (`RevisaTuCorreo.tsx`): T3 (cambiar el correo en la misma pantalla), T4, T8, espera de 30 s entre reenvíos y la línea de los 7 días. Los enlaces del correo abren la web en el navegador del teléfono (D-155): la pantalla no dice nada nuevo y la persona vuelve y toca «Ya lo confirmé». Los App Links llegan con I08.
- **Pantalla provisional** (`SinAutorizacion.tsx`): el texto de E14-PCP 4.7 y solo «Cerrar sesión» (T2): cierra la sesión en el API y borra el token del Keystore; solo la falta de conexión la deja abierta.
- **Atrás de Android:** PN-65 se apila sobre PN-60; PN-58 reemplaza a PN-65; de PN-58 a PN-59 y a la provisional se usa `reemplazarPila`, así que desde ahí el Atrás sale de la app y no vuelve al formulario ni a una pantalla sin sesión (`tests/navegacion/flujoDeCuenta.test.tsx` toca el Atrás de verdad).
- **Lo que no se guarda:** `tests/sesion/almacenamiento.test.ts` comprueba que `AsyncStorage` solo aparece en `src/edad/` y que `expo-secure-store` solo aparece en `src/sesion/token.ts`.

Dependencia nueva: `@react-native-async-storage/async-storage` 2.2.0 (MIT, 2025-06-05), la versión de `expo/bundledNativeModules.json` para el SDK 57; no suma ningún aviso a la auditoría.

## Iniciar sesión, seguridad de la cuenta y cambiar la contraseña (US-49, A4)

Rama `feat/us-49-movil-sesion` (D-155).

- **PN-60 · Iniciar sesión** (`Entrar.tsx`): solo con correo; **no** hay «Entro con mi nombre de usuario» (D-137, queda para I11 junto con el botón de PN-65). El API recibe un `identificador` genérico. Con la cuenta activa va a PN-71; con la cuenta sin verificar (sesión limitada, D-138), a PN-59 con el correo escrito. Los errores: `422` por campo, `401` «No pudimos entrar con esos datos.» (sin decir cuál falló), `429` «Hiciste muchos intentos…», `5xx` T7 («No pudimos iniciar tu sesión.», que nunca dice que los datos están mal), sin conexión. Muestra arriba, como mensaje de estado, la llegada («Tu sesión se cerró…», «Listo, confirmamos tu correo.», «Listo, cambiaste tu contraseña.»). Faltan dos filas de E14 cuyas pantallas no existen todavía: «¿Olvidaste tu contraseña?» (PN-61, llega con A5) y «Política de tratamiento y consultas» (PN-68).
- **Arranque** (`Navegacion.tsx`): con un token en el Keystore la primera pantalla es PN-71, que le pregunta al API si la sesión sigue valiendo; sin token, PN-60. Lo que decide es el API: `401` → PN-60 con «Tu sesión se cerró», `403 verificacion_pendiente` → PN-59, `403 autorizacion_pendiente` → pantalla provisional (`accesoNegado.ts`, que ya usaba PN-59 en A3).
- **PN-71 · Seguridad de la cuenta** (`SeguridadDeLaCuenta.tsx`): la fecha del ingreso **anterior** en palabras y en la hora de Colombia, con los números en Figtree con cifras tabulares y sin `ss02` (D-123, D-085). `fechaEnPalabras` (`fechas.ts`) resta cinco horas a mano y lee los campos en UTC: Colombia no tiene horario de verano, y así no depende de `Intl.DateTimeFormat` con zona en Hermes ni de la zona del teléfono. Con «Cerrar sesión» (T2): `DELETE /api/v1/sesiones/actual` y borra el token del Keystore.
- **PN-73 · Cambiar la contraseña** (`CambiarContrasena.tsx`): dos campos, sin la nota del menor (llega con I11). Al guardar vuelve a PN-71 con «Listo, cambiamos tu contraseña.»; el token no cambia (la sesión de ahora sigue abierta y las demás las cierra el API).
- **Barra superior** (`barra.ts`): PN-71 y PN-73 usan la barra nativa de la pila con el título en `tipografia.titulo-2` (E14-SDD 5.10). El Atrás es el del sistema.

## Recuperar el acceso (US-49, A5)

Rama `feat/us-49-movil-recuperacion` (D-155).

- **PN-61 · Recuperar el acceso: pedir el enlace** (`RecuperarAcceso.tsx`): se abre desde «¿Olvidaste tu contraseña?» de PN-60 (Atrás vuelve a PN-60). La respuesta es la misma con o sin cuenta («Si ese correo tiene una cuenta, te enviamos un enlace.»); errores de campo, `429`, `5xx` y sin conexión con los textos de E14-PCP 4.4. Incluye la «Nota del menor» de la fila 5 («¿Entras con nombre de usuario? Pide a tu tutor que restablezca tu acceso.»), que E14 marca como solo Android y que ninguna decisión quita; apunta a un ingreso con nombre de usuario que llega con I11 (D-137). Está lista para quitarse si el dueño prefiere esperar a I11.
- **PN-62 · Elegir la contraseña nueva: no se construye en la app.** E14-PCP 4.5 sí tiene su tabla de Android, pero no se puede llegar a ella: el enlace del correo es `URL_PUBLICA/recuperar?t=<token>` y abre la web en el navegador del teléfono (D-155). Un esquema propio (`alcanzamos://`) se descartó (otra app puede registrarlo y recibir el token) y los App Links dependen de la huella del certificado de firma de la app publicada, que llega en I08. Hasta entonces PN-62 vive en la web; la persona vuelve a la app y entra con la contraseña nueva. Con App Links (I08) se suma PN-62 en la app, con los textos de E14-PCP 4.5 que ya están en `textos.ts` (`textosDeRepeticion`, `avisos.enlaceVencido`, `avisos.errorAlGuardarContrasena` y `avisos.contrasenaRecuperada`).

## Prueba de integración contra el API (US-49, A5)

`npm run integracion:api` (`scripts/integracion-api.mjs`) corre, con Node y fuera de Jest, el **mismo código** de `src/api/` contra un API de verdad: crear la cuenta en modo Android (el token llega en el cuerpo y queda en el almacén seguro), estado, verificar el correo con el enlace de Mailpit (como lo hace el navegador), iniciar sesión (token nuevo), `seguridad` con `403`, sembrar las autorizaciones por SQL (hasta que la US-50 construya PN-64), `seguridad` con `200`, cambiar la contraseña, cerrar sesión (`204`) y `401 sin_sesion` con el token cerrado; además la recuperación, el rechazo del modo Android con `Sec-Fetch-Site` y el estado sin conexión. En lugar de `expo-secure-store` usa un almacén en memoria (Node no tiene Keystore). Variables: `EXPO_PUBLIC_URL_API`, `URL_MAILPIT` y `CONTENEDOR_POSTGRES` (el contenedor de PostgreSQL de `infra/local`). Los datos son sintéticos y cada corrida crea una cuenta nueva.

## Probar la cuenta y el acceso en el celular (US-49)

Con el API, PostgreSQL y Mailpit en el portátil y la app en Expo Go (SDK 57), por la red local (sin túnel). El celular y el portátil van en el mismo Wi-Fi. Todo desde la raíz del repositorio, salvo el paso 7. Datos sintéticos.

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
   EXPO_PUBLIC_URL_API=http://$IP:18090 URL_MAILPIT=http://$IP:58026 CONTENEDOR_POSTGRES=alcanzamos-local-postgres-1 npm run integracion:api
   ```

6. **La app** (en `movil/`; `npm start` es `expo start --lan`). La dirección del API se define al arrancar, con la IP del paso 1:

   ```
   cd movil
   npm ci
   EXPO_PUBLIC_URL_API=http://$IP:18090 npx expo start --lan
   ```

   Se abre Expo Go y se escanea el QR. Si cambias la dirección, reinicia con `--clear` (`npx expo start --lan --clear`): Expo copia la variable al paquete.

7. **Recorrido en el celular:**
   1. «Crear una cuenta» → PN-65: elige una fecha de nacimiento. Con una fecha de menos de 18 años sale el aviso «Esta cuenta la crea una persona adulta.» (y lo recuerda 24 horas); con una de 18 años cumplidos, sigue PN-58.
   2. PN-58: correo (por ejemplo `laura@ejemplo.com`), contraseña de 15 caracteres o más (por ejemplo `lluvia café tren azul`) y nombre → PN-59.
   3. En el navegador del celular, `http://IP:58026`: abre el correo «Confirma tu correo en Alcanzamos» y toca el enlace (abre la web: «Listo, confirmamos tu correo.»). Vuelve a la app y toca **«Ya lo confirmé»**: llega a la pantalla provisional («Sin esta autorización no podemos darte la cuenta.»), con «Cerrar sesión».
   4. Para ver PN-71 y PN-73 hay que sembrar la autorización (PN-64 llega con la US-50). En el portátil:

      ```
      docker exec -i alcanzamos-local-postgres-1 psql -U alcanzamos -d alcanzamos -c "INSERT INTO autorizacion (titular_id, otorgante_id, finalidad, version_del_texto, otorgada_en) SELECT persona_id, persona_id, f, '1.0 del 2026-10-30', now() - interval '1 hour' FROM perfil_adulto, unnest(ARRAY['cuenta_y_acceso','funciones_financieras']) AS f WHERE correo = 'laura@ejemplo.com'"
      ```

      En la app: «Cerrar sesión» → PN-60 → entra con el correo y la contraseña → PN-71 («Este es tu primer ingreso.»). Cierra sesión, entra otra vez: ahora muestra «Tu ingreso anterior fue el … a las … p. m.» (hora de Colombia).
   5. PN-71 → «Cambiar mi contraseña» (PN-73) → guarda otra frase de 15 caracteres o más → vuelve a PN-71 con «Listo, cambiamos tu contraseña.».
   6. «Cerrar sesión» → PN-60 → «¿Olvidaste tu contraseña?» (PN-61) → escribe el correo → «Enviar el enlace». En `http://IP:58026` abre «Recupera el acceso a tu cuenta de Alcanzamos» y toca el enlace: la web (PN-62) te deja elegir la contraseña nueva. Vuelve a la app y entra con ella.
   7. Atrás de Android: desde PN-65 vuelve a PN-60; desde PN-59, PN-71 y la pantalla provisional sale de la app (no vuelve al formulario ni a la sesión cerrada).
   8. Sin conexión: apaga el Wi-Fi del celular y toca «Iniciar sesión»: «Sin conexión. Intenta de nuevo cuando vuelvas a tener internet.».

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

Versiones fijadas sin `~` ni `^`, verificadas en el registro de npm el 2026-10-23: `jest-expo` 57.0.6 (etiqueta `sdk-57`, publicada el 2026-10-12; `expo/bundledNativeModules.json` pide `~57.0.6`), `@react-native/jest-preset` 0.86.3 (peer de `jest-expo`, misma versión que `react-native`), `jest` 30.5.2 (2026-09-18, última), `@types/jest` 30.0.0 (última), `@testing-library/react-native` 14.1.0 (2026-10-08, última) y `test-renderer` 1.3.1 (2026-10-12; peer de la anterior).

## Versión de Expo

**Expo SDK 57** (`expo` 57.0.31, React Native 0.86.3, React 19.2.3), plantilla `blank-typescript@sdk-57` con `create-expo-app` 5.0.0. Las versiones están fijadas sin `~` ni `^`.

Por qué el SDK 57 y no el 58 (el más reciente en npm, 58.0.17), consultado el 2026-10-22:

- El listado de Expo Go en Google Play (`host.exp.exponent`) muestra la versión **57.0.9**, actualizada el 17 de agosto de 2026 según la ficha.
- `https://api.expo.dev/v2/versions/latest` informa `expoGoSdkVersion: 57.0.0`.
- El anuncio del SDK 58 (<https://expo.dev/changelog/sdk-58>, 15 de octubre de 2026) dice: «Expo Go for SDK 58 on the Apple App Store and Google Play Store will be released within a few weeks» y que ese Expo Go **solo** soportará el SDK 58. Aún no estaba publicado en la tienda al consultar.
- Contexto: <https://expo.dev/changelog/expo-go-and-app-store-may-2026> (4 de mayo de 2026) y <https://expo.dev/changelog/sdk-57> (30 de junio de 2026).

Riesgo: cuando la tienda publique el Expo Go del SDK 58, el celular lo actualizará y dejará de abrir esta app. Entonces hay que subir a SDK 58 (`npx expo install expo@^58.0.0 --fix`) o instalar el APK 57.0.9 de <https://github.com/expo/expo-go-releases>.

## Probar en el celular (modo LAN)

Mismo Wi-Fi para el computador y el celular. Sin modo túnel.

```
npm ci
npm start        # equivale a expo start --lan
```

Se abre Expo Go y se escanea el QR. Con USB: `npm run android` (solo requiere `platform-tools`, D-122).

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
2. Cargó la fuente: aparece primero «Cargando fuentes…» y luego la pantalla con las cuatro filas de ceros en Atkinson y el renglón de Figtree. Si el texto se ve en Roboto, la fuente no cargó.
3. Ceros de Atkinson: las cuatro filas (sin variante, `tabular-nums`, `stylistic-one`, `stylistic-two`) deben verse con el mismo cero barrado. En el control de Figtree, `stylistic-two` sí cambia el cero (prueba de que `fontVariant` funciona en ese equipo).

## Pipeline (US-58, D-149)

`.azure-pipelines/movil.yml` corre con cambios en `movil/`, `diseno/` o su YAML. Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado, como `web.yml`, y corre desde `movil/`, en este orden: `npm ci`; `npm run lint`; `npm run typecheck`; `npm run tokens` seguido de `git diff --exit-code -- ../diseno ../web ../movil` (los tokens regenerados no cambian nada); `npm run test:coverage` (mínimo 50 % de líneas); `npm run auditoria`; `npm run licencias`; `npm run comprobar-bundle`. No compila el paquete de Android.

**ESLint** (`eslint.config.mjs`, configuración plana, E17-ECO Q-2): `@eslint/js` y `typescript-eslint` recomendados, `eslint-plugin-react-hooks`, todas las reglas de `eslint-plugin-react-native-a11y` (E17-ECO 4.10, ADR-003 §3), sin `any` explícito y `@ts-ignore` solo con descripción. Más la regla de solo tokens de la web (E17-ECO 4.5), adaptada a React Native:

- Vale igual que en la web: los literales de texto con colores sueltos (`#…`, `rgb(`, `hsl(`), medidas con unidad, la paleta primitiva (`paleta`) y los dominios fijos (`alcanzamos.co`, `localhost`, `http(s)://`, D-129).
- Distinto: en React Native los estilos son objetos, sin unidades. La regla marca además un número distinto de cero en las propiedades de medida de un objeto de estilo (`padding*`, `margin*`, `gap`, `top`…, `width`, `height`, `fontSize`, `lineHeight`, `letterSpacing`, `borderRadius`, `border*Width`, `min*`/`max*`). `flex`, `opacity` y `zIndex` no son medidas y no se revisan.
- Límite: solo ve literales. Un valor que sale de una función o de una variable no se puede revisar con una regla de sintaxis: lo revisa el dueño con la lista de E17-ECO 6. `tests/`, `scripts/` y los `*.config.*` quedan fuera de la regla, y `src/tokens/tokens.generated.ts` (generado) no se revisa.
- `eslint-plugin-react-native-a11y` 3.5.1 declara compatibilidad solo hasta ESLint 8 (`peerDependencies`), pero sus reglas corren en ESLint 9. Para no usar `--legacy-peer-deps` en todo el proyecto, `package.json` tiene `overrides` solo para ese plugin (`"eslint": "$eslint"`). Se revisa cuando el plugin publique una versión nueva.
- `src/fuentes.ts` queda fuera de `no-require-imports`: Metro solo empaqueta las fuentes con `require()` estático.

Versiones fijadas sin `~` ni `^`, verificadas en el registro de npm el 2026-10-23: `eslint` y `@eslint/js` 9.39.5 (las mismas de `web/`; la última de `eslint` es la 10.13.0, pero `web/` y este proyecto se mantienen juntos en la 9), `typescript-eslint` 8.72.0, `eslint-plugin-react-hooks` 7.1.1, `eslint-plugin-react-native-a11y` 3.5.1 (2026-07-20, última) y `globals` 17.13.0.

### Vulnerabilidades (`npm run auditoria`)

`npm audit --omit=dev --audit-level=high` falla con los avisos de `node-forge` y `zod` (abajo). En vez de silenciarlo para todo el proyecto, `scripts/auditoria.mjs` corre `npm audit --omit=dev --json` y falla con:

- todo aviso alto o crítico que no esté en `auditoria-excepciones.json`;
- toda excepción que ya no se reporta (quedó obsoleta: se quita);
- toda excepción cuyo camino de dependencias cambió, por ejemplo si el paquete pasa a ser una dependencia directa de la app;
- toda excepción cuya fecha `revisar_antes_de` pasó (hoy en UTC, después de esa fecha). El dueño la renueva en el cierre de cada iteración (D-150), y también se revisa al subir de versión de Expo. La fecha actual es **2026-11-05**, el fin de la iteración I05.

Cada excepción trae el GHSA, el paquete, las rutas de dependencias (que muestran que el paquete llega solo por las herramientas de construcción), el motivo, la fecha de revisión y `revisar_antes_de`.

### `node-forge` y `zod` no entran en la app (`npm run comprobar-bundle`)

Las excepciones de `node-forge` y `zod` se apoyan en que ningún archivo de la app los importa. `scripts/comprobar-bundle.mjs` lo comprueba: corre `npx expo export --platform android` en una carpeta temporal fuera del repositorio y busca en el paquete de JavaScript el nombre y cadenas propias de cada paquete, porque Metro no deja las rutas de los módulos (`MARCAS_POR_PAQUETE` en `scripts/bundle-logica.mjs`):

- `node-forge`: `RSASSA-PKCS1-V1_5` y el prefijo de OID `1.2.840.113549`.
- `zod`: `ZodError`, `invalid_type`, `too_small` e `invalid_enum_value` (valores de datos, que sobreviven a la minificación y aparecen en el bytecode de Hermes).

Falla, nombrando el paquete, si aparecen en algún archivo o si no se generó ningún paquete. Probado con un `import` temporal de cada paquete: falla; sin él, pasa (D-150, D-154).

Tarda de 3 a 6 segundos (medido el 2026-10-23, Expo 57.0.31, Node 24.22.1, caché caliente), así que es un paso del pipeline.

### Licencias (`npm run licencias`)

`scripts/licencias.mjs` es la copia de la revisión de `web/` (`web/scripts/licencias.mjs`), sin importar nada de otra carpeta: solo dependencias de producción, contra la misma lista de licencias compatibles con AGPLv3 (condición 4 de ADR-003). **La lista general no cambia.** Las excepciones (D-150) son por paquete, en `licencias-excepciones.json`, cada una con la licencia, el camino de dependencias, la razón y `revisar_antes_de` (**2026-11-05**):

| Paquete | Licencia | Camino |
|---|---|---|
| `argparse` 2.0.1 | Python-2.0 | `expo > @expo/cli > @expo/xcpretty > js-yaml > argparse` |
| `caniuse-lite` 1.0.30001819 | CC-BY-4.0 | `expo > @expo/metro-config > browserslist > caniuse-lite` |

Razón: son herramientas de compilación que no van en la app, y la FSF considera las dos licencias compatibles con la GPLv3. El camino de cada paquete es el más corto desde las dependencias directas, uno por cada paquete que depende de él.

Falla si: otro paquete tiene una licencia no permitida; cambia la licencia de uno con excepción; cambia su camino; la excepción quedó obsoleta (el paquete ya no está o su licencia ahora es permitida); o pasó la fecha `revisar_antes_de`. En este último caso se revisa en el cierre de la iteración y se renueva la fecha, o se quita la excepción.

## Alertas de `npm audit` (2026-10-23)

Con `--omit=dev`, `npm audit` marca 5 alertas altas, por dos avisos:

| Paquete | Aviso | Quién lo trae |
|---|---|---|
| `node-forge` 1.4.0 | GHSA-86w9-cpqp-85rv: la verificación de firmas RSA PKCS#1 v1.5 acepta elementos de más | `expo` → `@expo/cli` (y `@expo/code-signing-certificates`) |
| `zod` 3.25.76 | GHSA-mrhx-c7xc-m3w5: puede agotar la memoria al validar colecciones enormes con restricciones (afecta a `zod` anterior a 4.6.6) | `expo` → `@expo/cli` (como dependencia de desarrollo también por `eslint-plugin-react-hooks`, que la auditoría de producción omite) |

Las otras tres alertas son los paquetes que dependen de `node-forge` o `zod` (`@expo/code-signing-certificates`, `@expo/cli` y `expo`). El aviso de `braces` (GHSA-vfj7-8cjw-p6xm, `micromatch` de las herramientas de Jest y Metro) que se documentó el 2026-10-22 ya no sale: GitHub retiró ese aviso (*withdrawn*), aunque la versión instalada sigue siendo la 3.0.3 (`npm ls braces`). `node-forge` no tiene versión corregida (la última publicada es la 1.4.0, la afectada) y `@expo/cli` es la herramienta de línea de comandos de Expo, no la app que se instala en el celular: ninguno de los archivos de `src/` lo importa. Por eso es una de las dos excepciones de `auditoria-excepciones.json` (aprobada en D-150, con revisión antes del 2026-11-05).

`zod` tampoco tiene corrección compatible: la solución es `zod` 4 (4.6.6 o posterior), un salto mayor que Expo 57 no usa, y la «corrección» de npm es bajar a expo 44 (consultado el 2026-10-23). `@expo/cli` lo usa para validar la configuración y las opciones de la CLI, en la máquina de desarrollo y en el pipeline, y ningún archivo de `src/` lo importa. Es la segunda excepción de `auditoria-excepciones.json` (aprobada en D-154, con revisión antes del 2026-11-05). No se fuerza `zod` 4 con `overrides`: puede romper `expo start` y `expo export`.

- **No se usa `npm audit fix --force`:** bajaría Expo al SDK 44.
- **Se revisan cada vez que se sube de versión de Expo.**
