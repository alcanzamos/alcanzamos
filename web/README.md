# web/

App web en Vite + React + TypeScript (ADR-004). Se compila a `web/dist` y se sirve desde el API, en un solo dominio y sin CORS.

- Archivo de construcción: `package.json` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), ESLint con `typescript-eslint` y complementos de accesibilidad, Prettier por defecto.
- Los tokens de diseño vienen de [`diseno/`](../diseno/); las fuentes (Figtree y Atkinson Hyperlegible Next, OFL) también, y las sirve la propia app: no hay pedidos a terceros.

## Qué hay

Base de la US-57 (Vite, React, TypeScript, tokens, fuentes propias, CSP) y, desde la US-49, las pantallas de cuenta y acceso (D-152, cinco PR): crear la cuenta, verificar el correo, iniciar sesión, recuperar el acceso, la seguridad de la cuenta y el cambio de contraseña. La US-50 suma la información de privacidad y la autorización de datos (PN-63 y PN-64). Todo texto que ve la persona sale palabra por palabra de E14-PCP; los textos salen de [`diseno/textos/es.json`](../diseno/textos/es.json) (fuente única de web y Android, D-160), cada uno con su referencia de E14, y llegan por el módulo generado `src/textos/es.generated.ts`; `src/textos.ts` solo guarda el tipo de cada aviso y la tabla de códigos del API a texto. El cliente no tiene reglas de negocio (E17-ECO 4.7): el API valida y la web solo muestra el código de error de cada campo.

| Ruta                     | Pantalla                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/crear-cuenta`          | PN-58 · Crear la cuenta (con la casilla «Soy mayor de edad» de la web: no se pide ni se guarda ninguna fecha)                                                                                                                                                                                                                                     |
| `/revisa-tu-correo`      | PN-59 · Verificar el correo: «Ya lo confirmé», «Reenviar el correo» (espera de 30 s) y «Cambiar el correo», que abre el campo en la misma pantalla (E14-PCP 4.16 T3)                                                                                                                                                                              |
| `/verificar?t=`          | Enlace del correo: confirmado, va enseguida a PN-63 (con sesión) o a `/entrar` (sin ella), con «Listo, confirmamos tu correo.» arriba como `role="status"` (T11)                                                                                                                                                                                  |
| `/privacidad`            | PN-63 · Cómo cuidamos tus datos, solo en el primer uso: la frase de entrada, las ocho tarjetas de E14-PCP 4.6 y «Continuar» a PN-64. Sin Atrás. Es el destino de quien tiene la cuenta verificada y no ha autorizado                                                                                                                              |
| `/autorizacion`          | PN-64 · Tu autorización: pide el catálogo a `GET /api/v1/autorizaciones` y lo muestra en dos tarjetas (lo necesario, con una casilla; lo que se puede elegir, con una casilla por finalidad). Ninguna casilla viene marcada; «Autorizar y continuar» sin lo necesario muestra el error y no pide nada; «No autorizo» borra la cuenta y va a PN-60 |
| `/entrar`                | PN-60 · Iniciar sesión, solo con correo (D-137), con el logo; errores de campo, 429 (T1), sin conexión (T10) y 5xx (T7: «No pudimos iniciar tu sesión.», nunca «No pudimos entrar con esos datos.»)                                                                                                                                               |
| `/cuenta/seguridad`      | PN-71 · Seguridad de la cuenta: el ingreso anterior en palabras y «Cerrar sesión» (T2). Es el destino provisional de quien entra con autorización, hasta que haya un Inicio                                                                                                                                                                       |
| `/registrar`             | PN-01 · Formulario de registro (US-51, D-164): Tipo, Monto, Fecha, Categoría, Medio de pago, De quién es, Descripción, «Se repite» y «Guardar». Se llega por el botón provisional «Registrar un movimiento» de PN-71 y se vuelve a PN-71 con el aviso                                                                                             |
| `/registrar/se-repite`   | PN-03 · Se repite (US-51): las seis opciones, la explicación de cada una, «Empieza el», «Próximas fechas» (hasta tres, en palabras) y «Listo», que vuelve al formulario con «Se repite: Cada mes»; las fechas las manda el API (ver abajo)                                                                                                        |
| `/cuenta/contrasena`     | PN-73 · Cambiar la contraseña con la sesión iniciada; cierra las otras sesiones y vuelve a PN-71 con el logro                                                                                                                                                                                                                                     |
| `/recuperar-acceso`      | PN-61 · Recuperar el acceso: pedir el enlace. Responde igual con o sin cuenta; 429 dice T1                                                                                                                                                                                                                                                        |
| `/recuperar?t=`          | PN-62 · Elegir la contraseña nueva (con repetición); enlace vencido: «Ese enlace ya no sirve.» y «Pedir otro enlace». Guardada: va a PN-60 con «Listo, cambiaste tu contraseña.»                                                                                                                                                                  |
| `/` y rutas desconocidas | Llevan a `/entrar` (E14 no tiene pantalla de «no encontrada»)                                                                                                                                                                                                                                                                                     |

- **Sin temporizadores para avanzar** (D-153, WCAG 2.2.1): `/verificar` no espera nada. El aviso de llegada viaja en el estado del historial (`src/llegada.ts`) y la pantalla de destino lo muestra arriba en un `MensajeDeEstado`, que el lector de pantalla anuncia solo.
- **Acceso negado** (`src/accesoNegado.ts`): una pantalla de dentro que recibe `401` va a `/entrar` con «Tu sesión se cerró. Entra de nuevo.»; `403 verificacion_pendiente`, a PN-59; `403 autorizacion_pendiente`, a PN-63 (`/privacidad`).
- **Autorización (US-50):** PN-64 manda las dos necesarias más las accesorias marcadas y la `version.numero` del catálogo; con `409 version_desactualizada` muestra el error de envío de E14 y vuelve a pedir el catálogo (E14 no tiene texto propio). Un código de finalidad que E14 no tiene, un tipo desconocido o una fecha que no se puede escribir es un error de carga, nunca una omisión en silencio. La fecha de la versión va en palabras con `diaEnPalabras` (`src/fechas.ts`, la fecha sin hora). Autorizar no vuelve a iniciar sesión: la misma sesión sube de nivel y PN-71 sigue diciendo «Este es tu primer ingreso.» (S2; lo prueba `e2e/autorizacion.spec.ts` con el API simulado y el API tiene su prueba de integración). «No autorizo» llama a `POST /api/v1/autorizaciones/rechazo` y va a PN-60 con «Borramos el correo que nos diste.»; sin conexión o con un error del servidor se queda con «Todavía no pudimos borrar tu correo. Intenta de nuevo.».
- **Entrar a PN-71 sin pedir dos veces:** tras iniciar sesión con una cuenta activa, PN-60 va directo a `/cuenta/seguridad`, que pide el ingreso anterior y, si recibe `403 autorizacion_pendiente`, sigue a PN-63.
- **Fechas** (`src/fechas.ts`): `Intl` solo pasa el instante a `America/Bogota`; los meses y «a. m.»/«p. m.» son propios. A las 1:xx se dice «a la 1:xx».
- **Correo de PN-59:** el que la persona escribió se guarda en `sessionStorage` de la pestaña, solo para mostrarlo; no se manda a ningún lado.
- **Enrutador propio** (`src/enrutador.ts`, History API): son pocas rutas planas servidas por el API en el mismo origen (cuyo `index.html` de respaldo atiende cualquier ruta). No suma ninguna dependencia, así que no hay versión que fijar ni licencia o auditoría nuevas. Si llegan rutas anidadas o cargas por ruta, se evalúa una biblioteca entonces.
- **Cliente del API** (`src/api/cliente.ts`): rutas relativas `/api/v1/...` y `credentials: 'same-origin'` (D-129). La sesión viaja solo en la cookie `HttpOnly`: la web no guarda ningún token ni manda `X-Alcanzamos-Cliente`. Un pedido que no llega se devuelve como `sin_conexion`, no como excepción.
- **Componentes** (`src/componentes/`, E14-SDD): campo de texto, campo de contraseña (Ver/Ocultar, permite pegar), casilla (nunca marcada de inicio), botón y botón de texto de 48 px, aviso (información, atención, logro), mensaje de estado (`role="status"`), íconos. Solo tokens (`--color-*`, `--espacio-*`...). Etiquetas visibles, `aria-describedby` para ayuda y error, `aria-invalid`. «Deshabilitado» usa `aria-disabled` para no perder el foco.
- **Columna de antes de entrar** (`Pagina`): 560 px por el token `--tamano-columna-contenido` (`dimension.tamano.columna-contenido`, D-152), el título como `h1` y, en PN-58 y PN-60, el Logo horizontal en color de 40 px con el texto alternativo «Alcanzamos».
- **Logo** (D-152): se importa de `marca/logo-horizontal-color.svg` (`../marca/...`). En la imagen del API entra solo ese archivo, no la carpeta `marca/`. Sigue bajo la política de marca (`TRADEMARK.md`), no bajo la AGPLv3, también dentro de la web.
- **Números en Figtree** (D-123, `src/componentes/Cifras.tsx`): cada número de un texto va en un `span.cifra` (Figtree, `tabular-nums`, sin `ss02`).
- **Pantalla de prueba de la US-57 (`PantallaPrueba`):** se quitó. Servía para comprobar tipografía, tokens y foco, y esas comprobaciones ahora las hacen las pantallas reales (axe, foco visible, CSP). `src/dinero.ts` se queda: la usarán las pantallas con montos.
- `tests/`: las pruebas de Vitest, en espejo de `src/` (D-145, E17-ECO 4.1 bis); `tests/preparar.ts` es su preparación. Las pruebas de Playwright siguen en `e2e/`.
- `src/estilos/tokens.css`: variables CSS **generadas** desde `diseno/tokens/alcanzamos.tokens.json` (no se edita a mano). No incluye la paleta primitiva: las hojas solo pueden usar tokens semánticos (`--color-*`).
- La sirve el API: `web/dist` se embebe en la imagen (`embed` y `http.FileServerFS`), la web en `/` y el API en `/api/`. Ver [`api/README.md`](../api/README.md).

### Registro de movimientos (US-51, D-164)

Formulario de E14-PPN 3.1 y PN-03 de E14-PRR 4.3, contra `GET /api/v1/categorias` y `POST /api/v1/movimientos` ([`api/README.md`](../api/README.md), «Registro de movimientos»).

- **Filas omitidas (D-164):** no se dibujan y cada una llega con su historia. El cuadro de lenguaje natural con «Llenar el formulario», su advertencia y el paso «Revisa y confirma» (motor de reglas, ADR-005); el aviso de faltante (simulación); el enlace «Prima, cesantías o intereses» (PN-04); «Elegir cuáles ver» de la hoja de categorías (PN-05); «Compartido con el hogar» (hogares). **Por pedido del dueño (S2), tampoco el chip «Tarjeta» ni la fila «Cuotas»:** el medio de pago es solo «Efectivo» y «Transferencia», también para gastos, hasta que lleguen las tarjetas (I07). Sin el cuadro, el botón dice «Guardar». «Dejar de repetir» de PN-03 solo aplica a un movimiento que ya se repite (US-52) y tampoco se dibuja.
- **Distribución:** una columna de 560 px (`Pagina`). La columna izquierda de E14 (5/12) solo traía lo omitido, así que no queda nada que repartir en dos; la barra lateral llega con el Inicio.
- **Entrada y salida provisionales (S3):** el botón «Registrar un movimiento» (texto de E14-PRR, PN-72) está en PN-71 y se quita cuando exista PN-01; la entrada al formulario y la vuelta pasan entonces allí (criterio de la US-52). Al guardar se vuelve a PN-71 con «Listo, registramos tu gasto de $45.000.» (o «…tu ingreso…»; con una repetición de fecha futura, «Listo. Tu gasto de $45.000 queda por confirmar el 20 de diciembre de 2026.») como mensaje de estado (`role="status"`, `irConMensaje` de `src/llegada.ts`): el lector de pantalla lo anuncia. Con centavos: «$123.456,78» (E14-SDD 5.5).
- **Monto en centavos, sin decimales binarios (D-082, EXA-001):** `leerMonto` (`src/dinero.ts`) pasa el texto («45.000», «$123.456,78») a centavos con `BigInt`, sin `Number` ni `parseFloat`; el monto llega hasta 2^63 − 1 centavos y el cuerpo del POST escribe esos dígitos tal cual (`src/api/registro.ts`). El punto es de miles y la coma es decimal; un punto que no agrupa de a tres («12.5») es ambiguo y se rechaza sin adivinar: «¿Quisiste decir $12.500 o $12,50?».
- **Fecha:** el campo es el de fecha del navegador (accesible y con selector propio) y debajo va la fecha en palabras (D-090), o «Hoy». La fecha futura sin repetición se acepta y se guarda con su fecha (RF-057, D-091 es solo de los recurrentes). Con repetición, el API guarda el movimiento si la fecha es de hoy o pasada, y solo la repetición si es futura; las fechas entre la escrita y hoy son historia (E15 5.2): el arriendo del 15 de agosto, mensual, escrito el 26 de octubre, registra el 15 de agosto y la próxima es el 15 de noviembre.
- **Las fechas vienen del API (D-165, E17-ECO 4.7):** el cliente no lleva reglas de negocio. PN-03 llama a `GET /api/v1/repeticiones/proximas?periodicidad=&inicio=` con la periodicidad elegida y «Empieza el» (la fecha del formulario) y muestra lo que recibe, en palabras (`obtenerProximas` en `src/api/registro.ts`); no hay una copia en TypeScript de E15 5.2. Mientras llegan, la tarjeta queda ocupada; si fallan, sale el aviso de siempre con «Intentar de nuevo» y «Listo» sigue sirviendo. «Hoy» como valor inicial de «Fecha» y la lectura del monto con `bigint` sí se quedan en el cliente.
- **Categorías:** el API manda `id` y `nombre`; el texto sale de `diseno/textos/es.json` por `id` (`registro.categorias.c{id}`, catálogo de E09), nunca de `nombre`. Una categoría sin texto no se muestra. **La categoría es obligatoria (D-165)** hasta que exista el motor de reglas que la sugiere: no llega ninguna elegida y, sin una, el campo dice «Falta elegir la categoría.» y no se manda nada.
- **Lo escrito mientras se elige «Se repite»** vive en memoria (`src/borradorDeRegistro.ts`), no en el navegador: son datos financieros y se pierde al recargar. Se conserva solo en el viaje del formulario a PN-03 y de vuelta; en cualquier otra pantalla se vacía (`App`), así que abrir el formulario desde PN-71 empieza vacío y cerrar la sesión (PN-71 o un `401`) no deja nada escrito para la siguiente persona; al guardar también se vacía (L10).
- **Errores:** los de campo de E14 antes de enviar, todos a la vez y con el foco en el primero; los códigos `422` del API van al mismo texto (`textosDeErrorDeRegistro`). Un código sin texto de E14 (`categoria_invalida`, `descripcion_larga`…) da el aviso de error al guardar. 401, 403, 429, 5xx y sin conexión usan los avisos de siempre.
- **Textos del registro:** todos son de E14 (E14-PPN 3.1 y 1.11, D-165), ya aprobados; no queda ninguno «propuesto».
- **USA-004** (un gasto en efectivo en menos de 20 s) no se cronometra en las pruebas: `e2e/registro.spec.ts` fija que cuesta cinco interacciones desde PN-71 (abrir, escribir el monto, elegir la categoría, elegir «Efectivo», «Guardar»; la categoría cuenta mientras no exista el motor de reglas, D-165) y la medición con una persona queda para la prueba con usuarios.

### Pendientes de E14

- **«Política de tratamiento…»** (PN-58 y PN-60, fila 9): abre PN-68, que no está construida; todavía no hay enlace.
- **Navegación lateral web** de PN-71 y PN-73 (E14-PCP 1): no hay otras pantallas de dentro a las que llevar; PN-71 solo lleva «Registrar un movimiento» (provisional) y «Cerrar sesión», y PN-73 su Atrás. La barra llega con el Inicio.
- **Estados de PN-60 de otras historias** («Cuenta borrada»): no se construye aquí.
- **Título de la pestaña** («{titulo} · Alcanzamos», `pagina.titulo_del_documento`): ya existía en `Pagina.tsx` y no está en E14-PCP; se movió a `es.json` sin cambiarlo y su referencia lo dice. Falta llevarlo a E14.
- **Plurales de PN-72** (`porConfirmar` en `es.json`, aprobados en D-163, E14-PRR 1.6): con los dos tipos, «13 por confirmar: 2 ingresos y 11 gastos»; con un solo tipo, sin el cero: «13 gastos por confirmar», «1 ingreso por confirmar». `resumenPorConfirmar(ingresos, gastos)` (`src/textos.ts`) elige la forma y lanza un error si los dos son 0, porque E14 no tiene texto para eso (PN-72 solo muestra el resumen con fechas por confirmar). `plural` usa solo la regla manual del español (1 → `one`, lo demás → `other`), sin `Intl.PluralRules`.
- **«Leer la política completa»** (PN-63 fila 10 y PN-64 fila 10): abre PN-68, que no está construida; no se muestra, como el enlace de PN-58 y PN-60.
- **PN-63 «desde el menú»** (con Atrás y sin «Continuar»): necesita PN-66, que no existe. Solo está el modo primer uso.
- **Inicio:** «Autorizar y continuar» lleva a Inicio según E14; mientras no exista, va a PN-71, como al entrar.

## Cómo se usa

Requiere Node 24.22.1 o superior y npm 12.2.1 (ver [Instalación de dependencias](#instalación-de-dependencias-npm-1221)). Desde `web/`:

```
npm ci                # instala las versiones fijadas
npm run dev           # servidor de desarrollo
npm run build         # tsc --noEmit + vite build, deja web/dist
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run format:check  # Prettier (npm run format para aplicarlo)
npm run tokens        # regenera src/estilos/tokens.css
npm run textos        # regenera src/textos/es.generated.ts desde diseno/textos/es.json
npm test              # Vitest + Testing Library (las pruebas están en tests/, en espejo de src/)
npm run test:coverage # con umbral de 60 % de líneas
npm run auditoria     # npm audit de producción; falla con altas o críticas
npm run licencias     # licencias de producción contra la lista compatible con AGPLv3
npm run e2e           # Playwright + axe-core sobre la app compilada
```

Tokens y textos regenerables sin diferencias: tras `npm run tokens` y tras `npm run textos`, `git diff --exit-code diseno/ web/ movil/` no debe mostrar nada. `src/textos/es.generated.ts` no se edita a mano y Prettier lo ignora; el pipeline lo regenera.

### Playwright

Los navegadores no vienen con `npm ci`. Una sola vez por máquina:

```
npx playwright install chromium            # en Linux, si faltan librerías: npx playwright install --with-deps chromium
```

`npm run e2e` compila la app y levanta `vite preview` en `127.0.0.1:4173` (si ya hay uno, lo reutiliza). Con el API simulado en `page.route` (`e2e/ayudas.ts`: un pedido sin manejador hace fallar la prueba), comprueba cero violaciones de axe-core, la CSP exacta, el logo propio, la columna de 560 px y que no haya pedidos a otros orígenes.

## Reglas que se hacen cumplir

- `strict` en TypeScript; ESLint prohíbe `any` explícito y `@ts-ignore` sin descripción.
- ESLint con las configuraciones recomendadas de `typescript-eslint`, `eslint-plugin-react-hooks` y `eslint-plugin-jsx-a11y`, más una regla que prohíbe en TypeScript colores sueltos (`#hex`, `rgb(`), medidas en `px`/`rem`, la paleta primitiva y dominios fijos. Las hojas CSS las revisa `tests/estilos/estilos.test.ts`, que además verifica que no haya `ss02` ni `font-feature-settings`.
- **Sin textos sueltos en JSX (D-162, US-59).** Una regla `no-restricted-syntax` en `eslint.config.js`, equivalente a `react/jsx-no-literals` con `noStrings: true` (eslint-plugin-react no se instala), reporta texto como hijo (`<p>Hola</p>`), cadenas y plantillas entre llaves (también en un ternario o un `&&` directo) y cadenas en las propiedades de texto (`aria-label`, `title`, `alt`, `placeholder` y las de los componentes: `titulo`, `etiqueta`, `ayuda`, `texto`, `error`, `mensaje`). Se permiten el espacio en blanco, los números, `alt=""` y las propiedades que no son texto (`className`, `type`, `id`, `href`…). `tests/eslint/texto-suelto.test.ts` corre ESLint con fixtures que deben y que no deben reportar, y comprueba que `src/` pasa. Límite: no sigue cadenas que entran por una variable o una función; para eso está la prueba de claves.
- **Claves de textos (S2).** `tests/textos/claves.test.ts` falla si el código usa una clave que no existe y si una clave de `comun` o `solo_web` no la usa nadie (lee `src/` con el compilador de TypeScript y sigue los accesos `textos.a.b.c`, los grupos y los alias; no admite `textos[x]` ni desestructurar; el análisis es `diseno/textos/usos.mjs`, compartido con móvil). Como las hojas de la web son `comun` + `solo_web`, una clave de `comun` que la web no usa falla aquí y una que móvil no usa falla en `movil/tests/textos/claves.test.ts`: `comun` exige uso en las dos apps; `solo_web`, en la web. Desde la US-59 (PR B) la web comparte con móvil los textos idénticos: pasaron de `solo_web` a `comun` (`textosDeRepeticion`, de PN-62, que móvil no construye, pasó a `solo_web`). Los textos de PN-72 (`porConfirmar`) los usa `resumenPorConfirmar` de `src/textos.ts`, que PN-72 llamará.
- **Dominio fijo (D-129).** Ningún literal de `src/` lleva `alcanzamos.co`, `localhost`, `127.0.0.1` ni una URL absoluta. Única excepción: el buzón `privacidad@alcanzamos.co`, un texto legal fijo y aprobado de E14-PCP 4.6 y 5 (D-120), que sale palabra por palabra en `src/textos/es.generated.ts`. `eslint.config.js` lo admite solo en ese módulo y solo esa dirección; cualquier otro dominio ahí (`https://app.alcanzamos.co`) o el buzón en otro archivo de `src/` sigue fallando. Lo prueba `tests/eslint/dominio-fijo.test.ts`.
- Prettier con la configuración por defecto (`.prettierrc.json` vacío).

## Alertas de `npm audit` (2026-10-22)

`npm audit` completo (con las herramientas de desarrollo) y `npm audit --omit=dev --audit-level=high` (lo que corre el pipeline) dan **0 vulnerabilidades**. No hay alertas que documentar.

- **No se usa `npm audit fix --force`:** cambiaría versiones fijadas a mano fuera de lo verificado.
- **Se revisan cada vez que se sube de versión** una dependencia.
- Si una alerta alta o crítica viniera solo de herramientas de desarrollo, se documenta aquí como en [`movil/README.md`](../movil/README.md) (tabla de paquete, aviso y quién lo trae); el pipeline solo revisa producción.

## Licencias

El proyecto es `AGPL-3.0-only`. `npm run licencias` (`scripts/licencias.mjs`, sin dependencias) lee `package-lock.json`, toma todos los paquetes que no están marcados `"dev": true` (producción, incluidos los transitivos) y falla, listando los infractores, si alguna licencia no está en esta lista. Si el lockfile no trae el campo `license`, lo lee de `node_modules/<paquete>/package.json`; sin licencia o con una desconocida, falla. Al final imprime cuántos paquetes hay por licencia.

Una expresión SPDX con `OR` pasa si alguna opción está permitida; con `AND`, solo si todas lo están (`AND` pesa más que `OR`; `WITH` no se acepta). La lógica tiene pruebas en `tests/licencias.test.ts`.

| Licencia        | Por qué es compatible con AGPLv3                                                    |
| --------------- | ----------------------------------------------------------------------------------- |
| `MIT`           | Permisiva, solo pide conservar el aviso                                             |
| `ISC`           | Equivalente funcional de MIT                                                        |
| `BSD-2-Clause`  | Permisiva, sin condiciones adicionales a la AGPL                                    |
| `BSD-3-Clause`  | Igual que la anterior más la cláusula de no usar el nombre para promocionar         |
| `Apache-2.0`    | Compatible con GPLv3 y, por tanto, con AGPLv3 (la FSF la declara compatible con v3) |
| `0BSD`          | Sin condiciones                                                                     |
| `CC0-1.0`       | Dedicación al dominio público                                                       |
| `Unlicense`     | Dominio público                                                                     |
| `Zlib`          | Permisiva, sin condiciones incompatibles                                            |
| `BlueOak-1.0.0` | Permisiva, aceptada por la FSF como compatible con GPL                              |
| `MPL-2.0`       | Su cláusula de compatibilidad secundaria permite combinarla con (A)GPL              |

Las fuentes (Figtree y Atkinson Hyperlegible Next) son `OFL-1.1` y no son paquetes de npm: vienen de `diseno/fuentes/` y su licencia viaja en `dist/fuentes/`. Por eso esta revisión no las cubre.

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

`web/.npmrc` fija las reglas y se aplica igual en local, en `.azure-pipelines/web.yml` y en `api/Dockerfile` (que lo copia antes de `npm ci`); no se repiten en la línea de comandos:

| Opción                                | Efecto                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `strict-allow-scripts=true`           | Una dependencia con scripts de instalación que no esté en `allowScripts` hace fallar `npm ci` e `npm install` (`ESTRICTALLOWSCRIPTS`) |
| `min-release-age=7`                   | La resolución no elige versiones publicadas hace menos de 7 días                                                                      |
| `allow-git=none`, `allow-remote=none` | Sin dependencias desde git ni desde URL                                                                                               |
| `engine-strict=true`                  | Node y npm de `engines` son obligatorios                                                                                              |

`min-release-age-exclude[]` queda vacío. Solo se agregaría un paquete para una corrección de seguridad urgente, con su motivo y su fecha en esta sección.

### `min-release-age` frente al lockfile (medido con npm 12.2.1, 2026-10-24)

- **`npm ci` respeta el lockfile y no aplica la edad:** instala versiones fijadas con menos de 7 días (aquí, p. ej. `vite` 8.3.5, publicado el 2026-10-21), también con la caché vacía. No falla ni avisa.
- **`npm install` sin cambios en `package.json`:** igual, deja el lockfile como está.
- **Cualquier resolución nueva sí la aplica:** `npm install paquete` elige la última versión con 7 días o más; `npm install paquete@x.y.z` con una versión más joven falla con `ETARGET` («No matching version found … with a date before …»); si `package.json` pide una versión joven que el lockfile no tiene, `npm install` falla igual; `npm update` **baja** una versión joven del lockfile a una anterior que cumpla el rango.
- **Consecuencia:** subir una dependencia exacta publicada hace menos de 7 días no se puede instalar hasta que cumpla la edad, o hasta agregarla a `min-release-age-exclude[]` con motivo y fecha. Un lockfile que ya la trae sigue instalándose. Este proyecto fija versiones exactas; una subida de SDK con paquetes de menos de una semana espera 7 días o se excluye paquete por paquete.
- Con un paquete joven explícito en un árbol con dependencias de pares (`npm install vite@8.3.5 --save-exact` en `web/`) npm no terminó en 300 s (repite avisos `ERESOLVE overriding peer dependency`); con `timeout` se corta sin cambios.

### Revisión de antigüedad del lockfile (D-158)

`npm run antiguedad` (`scripts/antiguedad.mjs`, lógica en `scripts/antiguedad-logica.mjs`, pruebas en `tests/antiguedad.test.ts`) tapa el hueco de `npm ci`. Corre en el pipeline **antes** de `npm ci` y no usa dependencias, así que funciona sin `node_modules`. Sin argumentos revisa `web/`; con una carpeta (`node web/scripts/antiguedad.mjs <carpeta>`) revisa el `.npmrc`, el lockfile y las excepciones de esa carpeta: así lo usa `comun.yml` para `.azure-pipelines/commitlint/` hasta la unificación pendiente (D-160). Como `comun` usa el script, un cambio en `scripts/antiguedad.mjs` o `antiguedad-logica.mjs` también corre `comun` (no filtra por ruta; casos en `.azure-pipelines/pruebas/filtros.py`). Compara cada versión de `package-lock.json` con su fecha de publicación en el registro (el campo `time` del documento del paquete) y falla:

- con una versión publicada hace menos de `min-release-age` días (se lee de `.npmrc`) que no tenga una excepción vigente;
- si no puede obtener la fecha de un paquete o el registro no la tiene para esa versión (tres intentos por paquete; no la da por buena);
- con una excepción vencida (`revisar_antes_de` anterior a hoy, en UTC) o que no corresponde a ninguna versión del lockfile;
- con una entrada del lockfile que no viene del registro.

Las excepciones van en `antiguedad-excepciones.json`, una por versión, con `paquete`, `version`, `motivo` y `revisar_antes_de` (la fecha de vencimiento), como las de auditoría. Una excepción de una versión que ya cumple la edad se informa como sobrante, pero no falla hasta vencer. Para instalar una versión joven por una corrección de seguridad urgente hacen falta dos cosas: `min-release-age-exclude[]` en `.npmrc` (para que npm la resuelva) y su excepción aquí (para que pase esta revisión).

**Transición (D-158):** el archivo arranca con 39 excepciones, las versiones que ya estaban en el lockfile de `main` el 2026-10-24 con menos de 7 días (la mayoría entró con el SDK 58). Todas vencen el 2026-11-01 (D-159): el motivo de cada una dice el día en que esa versión cumple 7 días (entre el 2026-10-25 y el 2026-10-30), y el PR del 2026-11-01 vacía el archivo. Si no se vacía, el pipeline falla desde el 2026-11-02.

**Riesgo aceptado (D-158):** npm no detecta que un paquete perdió nivel de confianza (por ejemplo, que pasó de publicarse desde un pipeline con procedencia a publicarse sin ella). Se mitiga con la revisión de los cambios del lockfile en cada PR y con `npm audit signatures`.

### Scripts de instalación (`allowScripts`)

Inventario con `npm install-scripts ls` y `hasInstallScript` del lockfile. **Ninguna dependencia necesita ejecutar scripts**: se verificó instalando con todas denegadas y corriendo todas las comprobaciones.

| Paquete          | Script                         | Decisión | Por qué / qué falla si se deniega                                                                                                                                                                                                            |
| ---------------- | ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fsevents` 2.3.3 | `install` (`node-gyp rebuild`) | Denegado | Dependencia opcional solo de macOS para vigilar archivos (Vite la usa si está). No se instala en Linux. Sin ella, Vite vigila con `fs.watch`. **No se pudo probar en macOS**; se deja denegada para que `strict-allow-scripts` no falle allí |

Las denegaciones van por nombre (sin versión): valen para cualquier versión y sobreviven a `npm install-scripts approve --all`. Si algún día hace falta aprobar un paquete, se aprueba **fijado** (`paquete@x.y.z`, el valor por defecto de `npm install-scripts approve`) para que una versión nueva con otro script vuelva a pedir revisión; como las dependencias de este proyecto ya están fijadas, subir la versión ya exige tocar `package.json` y de paso revisar la aprobación. Una dependencia nueva con scripts hace fallar la instalación hasta decidir con `npm install-scripts approve|deny <paquete>`.

## Versiones

Todas fijadas exactamente (sin `^` ni `~`) y verificadas en el registro de npm (`https://registry.npmjs.org/<paquete>`) y en nodejs.org el **2026-10-22**.

| Paquete                           | Versión     | Nota                                                                                                                                                                               |
| --------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`, `react-dom`              | 19.3.1      | Última (2026-10-14). `movil/` usa 19.3.0, la que fija Expo SDK 58                                                                                                                  |
| `typescript`                      | 6.0.3       | Igual que `movil/`; `typescript-eslint` 8.72.0 acepta `>=4.8.4 <6.1.0`. La última en npm es 7.0.2, fuera de ese rango                                                              |
| `vite`                            | 8.3.5       | Última                                                                                                                                                                             |
| `@vitejs/plugin-react`            | 6.1.2       | Última; pide `vite ^8`                                                                                                                                                             |
| `vitest`, `@vitest/coverage-v8`   | 5.0.5       | Última                                                                                                                                                                             |
| `jsdom`                           | 30.1.3      | Última                                                                                                                                                                             |
| `@testing-library/react`          | 16.3.3      | Última                                                                                                                                                                             |
| `@testing-library/dom`            | 10.4.2      | Última; la pide `@testing-library/react`                                                                                                                                           |
| `@testing-library/jest-dom`       | 7.0.1       | Última                                                                                                                                                                             |
| `@playwright/test`                | 1.64.1      | Última                                                                                                                                                                             |
| `@axe-core/playwright`            | 4.14.0      | Última                                                                                                                                                                             |
| `eslint`, `@eslint/js`            | 9.39.5      | **No es la última** (10.13.0): `eslint-plugin-jsx-a11y` 6.10.2, la última, solo acepta ESLint hasta 9. ESLint 9 figura como sin soporte; se revisa cuando el complemento admita 10 |
| `typescript-eslint`               | 8.72.0      | Última                                                                                                                                                                             |
| `eslint-plugin-react-hooks`       | 7.1.1       | Última                                                                                                                                                                             |
| `eslint-plugin-jsx-a11y`          | 6.10.2      | Última                                                                                                                                                                             |
| `globals`                         | 17.13.0     | Última                                                                                                                                                                             |
| `prettier`                        | 3.9.10      | Última                                                                                                                                                                             |
| `style-dictionary`                | 5.7.0       | Igual que `movil/`                                                                                                                                                                 |
| `@types/react`                    | 19.3.0      | Última; igual que `movil/`                                                                                                                                                         |
| `@types/react-dom`                | 19.3.0      | Última; de la misma serie que `react-dom`                                                                                                                                          |
| `@types/node`                     | 24.19.2     | Última de la serie 24, la del Node del pipeline                                                                                                                                    |
| npm (pipeline, Docker, `engines`) | 12.2.1      | registro de npm, 2026-10-24; requiere Node `^22.22.2 \|\| ^24.15.0 \|\| >=26`; SHA-512 del tarball fijado en `.azure-pipelines/web.yml` y `api/Dockerfile`                         |
| Node (pipeline)                   | 24.22.1 LTS | nodejs.org; SHA-256 del tarball fijado en `.azure-pipelines/web.yml`                                                                                                               |
