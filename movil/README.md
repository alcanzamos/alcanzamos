# movil/

App móvil en React Native con Expo, primero Android y después iOS (ADR-003). Las notificaciones usan FCM sin pasar por el servicio de notificaciones de Expo.

- Archivo de construcción: `package.json` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), misma configuración de TypeScript, ESLint y Prettier que `web/`.
- Los tokens de diseño vienen de [`diseno/`](../diseno/) y se convierten con `npm run tokens`.

## Estado (US-45, T3)

Solo hay una pantalla de prueba con cifras inventadas (`src/PantallaCifras.tsx`): cifras tabulares de Figtree, cero de Atkinson Hyperlegible Next y qué fuente cargó. No hay lógica de negocio. ESLint y Prettier todavía no están configurados aquí (pendiente con `web/`).

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

## Alertas de `npm audit` (2026-10-22)

`npm audit` marca 15 alertas altas. Todas salen de dos paquetes que usan las herramientas de desarrollo de Expo y Metro, no la app que se instala en el celular:

| Paquete | Aviso | Quién lo trae |
|---|---|---|
| `braces` 3.0.3 | GHSA-vfj7-8cjw-p6xm: denegación de servicio con patrones muy anidados | `@expo/metro` → `metro-file-map` → `micromatch` |
| `node-forge` 1.4.0 | GHSA-86w9-cpqp-85rv: la verificación de firmas RSA PKCS#1 v1.5 acepta elementos de más | `@expo/cli` y `@expo/code-signing-certificates` |

Las otras 13 alertas son los paquetes que dependen de estos dos (`expo`, `react-native` y sus herramientas).

- **No se usa `npm audit fix --force`:** bajaría o cambiaría versiones de Expo y React Native fuera del SDK 57.
- **Se revisan cada vez que se sube de versión de Expo.**
