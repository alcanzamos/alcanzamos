# web/

App web en Vite + React + TypeScript (ADR-004). Se compila a `web/dist` y se sirve desde el API, en un solo dominio y sin CORS.

- Archivo de construcción: `package.json` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), ESLint con `typescript-eslint` y complementos de accesibilidad, Prettier por defecto.
- Los tokens de diseño vienen de [`diseno/`](../diseno/); las fuentes (Figtree y Atkinson Hyperlegible Next, OFL) también, y las sirve la propia app: no hay pedidos a terceros.

## Qué hay

Base de la US-57 (Vite, React, TypeScript, tokens, fuentes propias, CSP) y, desde la US-49, las pantallas de cuenta y acceso (D-152, cinco PR): crear la cuenta, verificar el correo, iniciar sesión, recuperar el acceso, la seguridad de la cuenta y el cambio de contraseña. Todo texto que ve la persona sale palabra por palabra de E14-PCP; los textos y la tabla de códigos del API a texto están en un solo módulo, `src/textos.ts`, cada uno con su referencia en E14-PCP. El cliente no tiene reglas de negocio (E17-ECO 4.7): el API valida y la web solo muestra el código de error de cada campo.

| Ruta                     | Pantalla                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/crear-cuenta`          | PN-58 · Crear la cuenta (con la casilla «Soy mayor de edad» de la web: no se pide ni se guarda ninguna fecha)                                                                                       |
| `/revisa-tu-correo`      | PN-59 · Verificar el correo: «Ya lo confirmé», «Reenviar el correo» (espera de 30 s) y «Cambiar el correo», que abre el campo en la misma pantalla (E14-PCP 4.16 T3)                                |
| `/verificar?t=`          | Enlace del correo: confirmado, va enseguida a la pantalla provisional (con sesión) o a `/entrar` (sin ella), con «Listo, confirmamos tu correo.» arriba como `role="status"` (T11)                  |
| `/sin-autorizacion`      | **Provisional** (US-49, P1): el texto de E14-PCP 4.7 y solo «Cerrar sesión». **La US-50 la reemplaza por PN-63 y PN-64.**                                                                           |
| `/entrar`                | PN-60 · Iniciar sesión, solo con correo (D-137), con el logo; errores de campo, 429 (T1), sin conexión (T10) y 5xx (T7: «No pudimos iniciar tu sesión.», nunca «No pudimos entrar con esos datos.») |
| `/cuenta/seguridad`      | PN-71 · Seguridad de la cuenta: el ingreso anterior en palabras y «Cerrar sesión» (T2). Es el destino provisional de quien entra con autorización, hasta que haya un Inicio                         |
| `/cuenta/contrasena`     | PN-73 · Cambiar la contraseña con la sesión iniciada; cierra las otras sesiones y vuelve a PN-71 con el logro                                                                                       |
| `/recuperar-acceso`      | PN-61 · Recuperar el acceso: pedir el enlace. Responde igual con o sin cuenta; 429 dice T1                                                                                                          |
| `/recuperar?t=`          | PN-62 · Elegir la contraseña nueva (con repetición); enlace vencido: «Ese enlace ya no sirve.» y «Pedir otro enlace». Guardada: va a PN-60 con «Listo, cambiaste tu contraseña.»                    |
| `/` y rutas desconocidas | Llevan a `/entrar` (E14 no tiene pantalla de «no encontrada»)                                                                                                                                       |

- **Sin temporizadores para avanzar** (D-153, WCAG 2.2.1): `/verificar` no espera nada. El aviso de llegada viaja en el estado del historial (`src/llegada.ts`) y la pantalla de destino lo muestra arriba en un `MensajeDeEstado`, que el lector de pantalla anuncia solo.
- **Acceso negado** (`src/accesoNegado.ts`): una pantalla de dentro que recibe `401` va a `/entrar` con «Tu sesión se cerró. Entra de nuevo.»; `403 verificacion_pendiente`, a PN-59; `403 autorizacion_pendiente`, a la pantalla provisional.
- **Entrar a PN-71 sin pedir dos veces:** tras iniciar sesión con una cuenta activa, PN-60 va directo a `/cuenta/seguridad`, que pide el ingreso anterior y, si recibe `403 autorizacion_pendiente`, sigue a la provisional.
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

### Pendientes de E14

- **«Política de tratamiento…»** (PN-58 y PN-60, fila 9): abre PN-68, que no está construida; todavía no hay enlace.
- **Navegación lateral web** de PN-71 y PN-73 (E14-PCP 1): no hay otras pantallas de dentro a las que llevar; PN-71 solo lleva «Cerrar sesión» y PN-73 su Atrás. La barra llega con el Inicio.
- **Estados de PN-60 de otras historias** («Cuenta borrada», «Sin autorización» de PN-64): no se construyen aquí.
- **PN-63 y PN-64** (US-50): hasta entonces, la pantalla provisional `/sin-autorizacion`.

## Cómo se usa

Requiere Node 24.22.1 o superior. Desde `web/`:

```
npm ci                # instala las versiones fijadas
npm run dev           # servidor de desarrollo
npm run build         # tsc --noEmit + vite build, deja web/dist
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run format:check  # Prettier (npm run format para aplicarlo)
npm run tokens        # regenera src/estilos/tokens.css
npm test              # Vitest + Testing Library (las pruebas están en tests/, en espejo de src/)
npm run test:coverage # con umbral de 60 % de líneas
npm run auditoria     # npm audit de producción; falla con altas o críticas
npm run licencias     # licencias de producción contra la lista compatible con AGPLv3
npm run e2e           # Playwright + axe-core sobre la app compilada
```

Tokens regenerables sin diferencias: tras `npm run tokens`, `git diff --exit-code diseno/ web/ movil/` no debe mostrar nada.

### Playwright

Los navegadores no vienen con `npm ci`. Una sola vez por máquina:

```
npx playwright install chromium            # en Linux, si faltan librerías: npx playwright install --with-deps chromium
```

`npm run e2e` compila la app y levanta `vite preview` en `127.0.0.1:4173` (si ya hay uno, lo reutiliza). Con el API simulado en `page.route` (`e2e/ayudas.ts`: un pedido sin manejador hace fallar la prueba), comprueba cero violaciones de axe-core, la CSP exacta, el logo propio, la columna de 560 px y que no haya pedidos a otros orígenes.

## Reglas que se hacen cumplir

- `strict` en TypeScript; ESLint prohíbe `any` explícito y `@ts-ignore` sin descripción.
- ESLint con las configuraciones recomendadas de `typescript-eslint`, `eslint-plugin-react-hooks` y `eslint-plugin-jsx-a11y`, más una regla que prohíbe en TypeScript colores sueltos (`#hex`, `rgb(`), medidas en `px`/`rem`, la paleta primitiva y dominios fijos. Las hojas CSS las revisa `tests/estilos/estilos.test.ts`, que además verifica que no haya `ss02` ni `font-feature-settings`.
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

## Versiones

Todas fijadas exactamente (sin `^` ni `~`) y verificadas en el registro de npm (`https://registry.npmjs.org/<paquete>`) y en nodejs.org el **2026-10-22**.

| Paquete                         | Versión     | Nota                                                                                                                                                                               |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`, `react-dom`            | 19.2.3      | Igual que `movil/`. La última en npm es 19.3.1; no se adopta para no separarse de `movil/`                                                                                         |
| `typescript`                    | 6.0.3       | Igual que `movil/`; `typescript-eslint` 8.72.0 acepta `>=4.8.4 <6.1.0`. La última en npm es 7.0.2, fuera de ese rango                                                              |
| `vite`                          | 8.3.5       | Última                                                                                                                                                                             |
| `@vitejs/plugin-react`          | 6.1.2       | Última; pide `vite ^8`                                                                                                                                                             |
| `vitest`, `@vitest/coverage-v8` | 5.0.5       | Última                                                                                                                                                                             |
| `jsdom`                         | 30.1.3      | Última                                                                                                                                                                             |
| `@testing-library/react`        | 16.3.3      | Última                                                                                                                                                                             |
| `@testing-library/dom`          | 10.4.2      | Última; la pide `@testing-library/react`                                                                                                                                           |
| `@testing-library/jest-dom`     | 7.0.1       | Última                                                                                                                                                                             |
| `@playwright/test`              | 1.64.1      | Última                                                                                                                                                                             |
| `@axe-core/playwright`          | 4.14.0      | Última                                                                                                                                                                             |
| `eslint`, `@eslint/js`          | 9.39.5      | **No es la última** (10.13.0): `eslint-plugin-jsx-a11y` 6.10.2, la última, solo acepta ESLint hasta 9. ESLint 9 figura como sin soporte; se revisa cuando el complemento admita 10 |
| `typescript-eslint`             | 8.72.0      | Última                                                                                                                                                                             |
| `eslint-plugin-react-hooks`     | 7.1.1       | Última                                                                                                                                                                             |
| `eslint-plugin-jsx-a11y`        | 6.10.2      | Última                                                                                                                                                                             |
| `globals`                       | 17.13.0     | Última                                                                                                                                                                             |
| `prettier`                      | 3.9.10      | Última                                                                                                                                                                             |
| `style-dictionary`              | 5.7.0       | Igual que `movil/`                                                                                                                                                                 |
| `@types/react`                  | 19.2.4      | Igual que `movil/`                                                                                                                                                                 |
| `@types/react-dom`              | 19.2.3      | Coincide con `react-dom`                                                                                                                                                           |
| `@types/node`                   | 24.19.2     | Última de la serie 24, la del Node del pipeline                                                                                                                                    |
| Node (pipeline)                 | 24.22.1 LTS | nodejs.org; SHA-256 del tarball fijado en `.azure-pipelines/web.yml`                                                                                                               |
