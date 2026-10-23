# movil/

App móvil en React Native con Expo, primero Android y después iOS (ADR-003). Las notificaciones usan FCM sin pasar por el servicio de notificaciones de Expo.

- Archivo de construcción: `package.json` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), misma configuración de TypeScript, ESLint y Prettier que `web/`. Código en `src/` y pruebas en `tests/`.
- Los tokens de diseño vienen de [`diseno/`](../diseno/) y se convierten con `npm run tokens`.

## Estado (US-45, T3)

Solo hay una pantalla de prueba con cifras inventadas (`src/PantallaCifras.tsx`): cifras tabulares de Figtree, cero de Atkinson Hyperlegible Next y qué fuente cargó. No hay lógica de negocio. ESLint ya está configurado (ver «Pipeline»); Prettier todavía no (pendiente con `web/`).

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
