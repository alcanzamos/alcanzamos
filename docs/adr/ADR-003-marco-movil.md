# ADR-003 · Marco móvil: React Native con Expo o Flutter

> **Copia pública del ADR; el original vive en el repositorio privado del proyecto.** Los identificadores `D-nnn` (decisiones), `E11-xxx`, `E14-xxx`, `ERS`, `RF/RNF/RN/RE/RT-nnn`, `O-n`, `P-nn`, `NM-nn` y `US-nn` remiten al registro de decisiones y a documentos de ese repositorio; se conservan como trazabilidad y no tienen enlace.

| Campo | Valor |
|---|---|
| Documento | Registro de decisión arquitectónica 003 · Código: E11-ADR-003 |
| Proyecto | Alcanzamos |
| Estado | **Decidido por el dueño (D-078): React Native con Expo** |
| Versión | 1.0 |
| Autor | Andrés Jiménez |
| Responsable de decidir | Dueño del proyecto |
| Uso de IA | El asistente redactó la propuesta, puntuó con los criterios de E11-CYR y consultó las fuentes; el dueño revisa y decide (D-051). |

## Control de versiones

| Versión | Fecha | Descripción del cambio | Autor |
|---|---|---|---|
| 0.1 | 2026-10-19 | Borrador: React Native frente a Flutter, Kotlin nativo como alternativa descartada, pendiente 5 de E14-SDD | Andrés Jiménez |
| 0.2 | 2026-10-19 | Reescrito por el cambio de decisiones del dueño (L3, D-076: web en React, API en Go). AC-1 sube a 4 en las dos alternativas con el costo de ADR-006 v0.2. Compara los dos marcos en 11 factores con fuente y fecha. Corrige la cuota de Android 11 o más (94,33 % a 96,34 %) y la nota de AC-8 de la versión 0.1. El ganador cambia de Flutter (3,30 contra 3,25) a React Native con Expo (3,35 contra 3,25) | Andrés Jiménez |
| 1.0 | 2026-10-19 | Decidido por el dueño (D-078): React Native con Expo, porque usa los componentes reales de cada sistema y así la app se siente hecha para Android en Android y para iOS en iOS. Aprender Dart no era un limitante para el dueño | Andrés Jiménez |

## Decisión del dueño (D-078, 2026-10-19)

**React Native con Expo.**

**Razón del dueño.** Le importa que la app se sienta hecha para cada plataforma: para Android en Android y para iOS en iOS. Aprender un lenguaje más (Dart) no era un limitante, así que la ventaja de AC-5 no decide. Tampoco quería un marco que pierda terreno.

**Evidencia que sostiene la razón** (consultada el 2026-10-19):

- React Native dibuja con los componentes reales del sistema: un `View` es un `UIView` en iOS y un `android.view` en Android (<https://reactnative.dev/docs/view>). Los componentes del sistema adoptan solos los cambios de diseño del sistema, como Liquid Glass en iOS 26 (<https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass>).
- Flutter dibuja sus propios widgets (<https://flutter.dev/blog/why-flutter-doesnt-use-oem-widgets>) e imita cada plataforma con Material y Cupertino. Hoy no implementa Liquid Glass (<https://github.com/flutter/flutter/issues/170310>, abierto) ni Material 3 Expressive (<https://m3.material.io/develop/flutter>).
- Continuidad: React y React Native pasaron a la React Foundation, en la Linux Foundation, el 2026-02-24 (<https://react.dev/blog/2026/02/24/the-react-foundation>). Flutter sigue activo en Google. Ninguno muestra señales de discontinuación.

**Condiciones que acompañan la decisión:**

1. **Componentes nativos de verdad** para navegación, pestañas, selectores de fecha, hojas y diálogos. Se evitan las bibliotecas que dibujan todo en JavaScript. La marca de E14 se aplica encima de los componentes nativos, sin reemplazarlos.
2. **Notificaciones con FCM** mediante `@react-native-firebase/messaging` (o el token del dispositivo de Expo), **no** con el servicio de notificaciones de Expo, que pasa los avisos por sus servidores (D-029; E11-EIP, decisión 2).
3. **Rendimiento en gama baja:** se mide en E17 con un celular real (no se encontró evidencia comparativa confiable).
4. **Pendiente 5 de E14-SDD:** la app usa TypeScript; los tokens se generan desde el mismo JSON que la web, con Style Dictionary.
5. La tabla de puntajes de arriba queda como registro del análisis previo. No se agregó un criterio nuevo: el dueño decidió directamente (E11-CYR 2.3 no se aplica a una decisión directa del dueño).

## 1. Contexto

D-028 (aceptada): el producto se publica en web y Android; iOS queda para después. La app móvil es **multiplataforma**, no nativa. Entre React Native y Flutter se elige en E11. La autenticación y las notificaciones se eligen de modo que funcionen también en iOS (RNF-020) [P].

**Decisiones del dueño que cambian la comparación (L3, L5).** El API va en **Go** (ADR-002). La web va en **React** (D-076; ADR-004). El dueño pidió comparar de nuevo los dos marcos **en todos los factores, con evidencia, y no solo por compartir React con la web**.

**AC-5 depende del dueño y no se supuso (S2, L2, L4).** Java en el backend; HTML, CSS y JS sin framework en la web. **Go, React y el desarrollo móvil son nuevos para él.** Ningún marco móvil le es conocido.

Lo que el marco móvil toca:

- Una app Android publicada en Google Play (RT-006), con las políticas para familias (RE-002) [P].
- Notificaciones con la app cerrada por Firebase Cloud Messaging (D-029, RF-017). Decisión 2 del estudio de privacidad: la notificación lleva un **texto fijo y el identificador del aviso**; la app consulta el contenido al abrirse [P, E14-PPN §8].
- Tokens de diseño de E14-SDD: 105 tokens con una regla fija de nombres [P].
- Accesibilidad con TalkBack: WCAG 2.1 AA en las pantallas principales (RNF-019) [P].
- Versión mínima de Android (RE-006): «se fija en E11 según la cuota de versiones en Colombia» [P, ERS v1.9 §3.4.2].
- El motor de reglas, **solo si** ADR-005 lo pone en la app. La propuesta de ADR-005 es que no [P].

**Etiquetas de evidencia.** [P] documento del proyecto. [F] fuente externa con dirección y fecha de consulta (todas el 2026-10-19). [M] medido por el asistente ese día, con el comando descrito. [S] supuesto sin verificar. «No verificado» significa que no se encontró fuente.

## 2. Alternativas

| # | Alternativa | Aspecto positivo | Razón de descarte o de elección |
|---|---|---|---|
| A | **React Native con Expo** (TypeScript) | Mismo lenguaje (TypeScript) y mismo modelo de componentes (React) que la web de D-076; pruebas con Jest y Maestro; instalación de Expo con plantillas | Más paquetes de terceros que revisar (factor 11). Las pantallas nativas no se comparten con la web |
| B | **Flutter** (Dart) | Dart es de tipos estáticos, cercano a Java; pruebas y verificaciones de accesibilidad dentro del SDK; menos paquetes transitivos | Agrega un tercer lenguaje (Go, TypeScript, Dart) y un segundo marco de interfaz que aprender. Nada se comparte con la web en React |
| C | **Kotlin nativo** (Jetpack Compose) | Mejor integración con Android; Kotlin es cercano a Java | **Descartada por D-028**, que restringe a un marco multiplataforma. Cambiarla exige una entrada en el registro de decisiones. iOS tendría que rehacerse, contra RNF-020 |

### 2.1 Versiones evaluadas

| Marco | Versión estable actual | Fuente |
|---|---|---|
| Expo SDK | **58** (`expo` 58.0.16, `expo-notifications` 58.1.5) | [F, `registry.npmjs.org/expo/latest` y `/expo-notifications/latest`, 2026-10-19] |
| React Native | **0.88.0** (2026-10-15), que usa el SDK 58 con React 19.3.0 | [F, `docs.expo.dev/versions/latest/` tabla «Each Expo SDK version depends on a React Native version»; `api.github.com/repos/facebook/react-native/releases`, 2026-10-19] |
| Flutter | **3.47.7** (2026-10-08) | [F, `storage.googleapis.com/flutter_infra_release/releases/releases_linux.json`, 2026-10-19] |
| Plugins de FCM | `@react-native-firebase/messaging` 26.4.0; `firebase_messaging` 17.0.0 (2026-10-15) | [F, `registry.npmjs.org/@react-native-firebase/messaging` y `pub.dev/api/packages/firebase_messaging`, 2026-10-19] |

### 2.2 Filtros

| Filtro | A React Native con Expo | B Flutter | C Kotlin nativo |
|---|---|---|---|
| AF-1 Licencia | Sí: React Native y Expo, MIT | Sí: Flutter y Dart, BSD de 3 cláusulas | Sí (no consultada) |
| AF-2 Cabe en el crédito | Sí: la app no consume Azure | Sí | Sí |
| AF-3 Mismo API | Sí | Sí | Sí |
| AF-4 Una persona lo opera | Sí | Sí | Sí |
| Restricción de D-028 (multiplataforma) | Cumple | Cumple | **No cumple** |

Fuentes de AF-1: `api.github.com/repos/{facebook/react-native, expo/expo, flutter/flutter, dart-lang/sdk}` campo `license` (MIT, MIT, BSD-3-Clause, BSD-3-Clause) [F, 2026-10-19]. El detalle de dependencias y de AGPLv3 está en el factor 11.

## 3. Comparación por factor

Para cada factor: qué se encontró, con qué fuente y qué tan fuerte es. La puntuación con los criterios de E11-CYR va en la sección 4.

### 3.1 Rendimiento en Android de gama baja

**Evidencia fuerte (documentación oficial):**

| Hecho | Marco | Fuente |
|---|---|---|
| Hermes es el motor de JavaScript por defecto. La documentación dice que «para muchas apps» mejora el arranque, baja la memoria y reduce el tamaño frente a JavaScriptCore. Compila a *bytecode* en la compilación de lanzamiento. No da cifras | React Native | [F, `reactnative.dev/docs/hermes`, 2026-10-19] |
| Desde la 0.82 solo existe la Nueva Arquitectura (no se puede desactivar). Hermes V1 es el motor por defecto desde la 0.84 | React Native | [F, `reactnative.dev/blog/2025/10/08/react-native-0.82`; título de la versión 0.84 en `reactnative.dev/blog`, 2026-10-19] |
| Impeller es el motor de dibujo por defecto en Android **API 29 o más**. En versiones menores o sin Vulkan, **cae al renderizador OpenGL anterior** | Flutter | [F, `docs.flutter.dev/perf/impeller`, 2026-10-19] |

**Qué significa para Colombia.** Android 9 o menos es ≈ 2,1 % de los dispositivos (sección 3.3) [M, cálculo con StatCounter]. El paso de Impeller a OpenGL afecta a pocos equipos. Un celular de gama baja con Android 11 o más sí usa Impeller; cómo se comporta ahí no se encontró en una fuente fuerte.

**Evidencia débil.** Busqué comparaciones publicadas. Las que aparecen (`asoasis.tech`, `sharpskill.dev`, 2026) son artículos de blogs comerciales. No traen datos crudos, dispositivos, versiones ni método reproducible, y varias cifras no coinciden entre ellas [F, leídos el 2026-10-19; **no se usan como base de puntaje**]. Lo único que dicen de forma consistente es que la brecha de arranque y memoria se redujo con la Nueva Arquitectura y Hermes V1, y que Flutter es más estable en cuadros por segundo con animaciones pesadas. Esto es un indicio, no una prueba.

**Conclusión del factor.** No hay medición fuerte y comparable en gama baja. **No discrimina con evidencia.** La app de Alcanzamos son formularios, listas y gráficos simples, sin animación pesada [P, ADR-004 §1 para la web; E14-PPN para la app]. Queda una medición en un celular de gama baja real en E17 (arranque en frío, cuadros perdidos y memoria), con un APK mínimo de cada marco si la decisión sigue abierta [S].

### 3.2 Accesibilidad con TalkBack (RNF-019, WCAG 2.1 AA)

| Aspecto | React Native con Expo | Flutter |
|---|---|---|
| Cómo se expone la semántica | Los componentes se traducen a vistas nativas de Android. Propiedades: `accessible` (en Android pasa a `focusable`), `accessibilityLabel`, `accessibilityHint`, `accessibilityRole`/`role`, `accessibilityState`, `accessibilityLabelledBy` (Android), `importantForAccessibility` (Android) [F, `reactnative.dev/docs/accessibility`] | Los *widgets* estándar exponen semántica y el *widget* `Semantics` la ajusta [S]. Flutter dibuja sus propios elementos y construye un árbol de semántica que pasa a TalkBack [F, `docs.flutter.dev/ui/accessibility`, `.../assistive-technologies`] |
| Guía oficial | La página de accesibilidad cubre los dos lectores de pantalla y avisa que Android y iOS difieren. TalkBack puede enfocar un padre en vez del hijo [F, `reactnative.dev/docs/accessibility`] | Pide probar con TalkBack y VoiceOver, contraste mínimo de 4,5:1 y objetivos táctiles de 48 por 48 px en Android; recomienda el Accessibility Scanner de Android [F, `docs.flutter.dev/ui/accessibility`, `.../accessibility-testing`] |
| Verificación automática | `eslint-plugin-react-native-a11y` 3.5.1 (MIT) [F, npm]; el Accessibility Scanner de Android sirve para cualquier app [F, misma página de Flutter] | **Dentro del SDK**: `meetsGuideline` con `androidTapTargetGuideline` (48 px), `labeledTapTargetGuideline` y `textContrastGuideline` [F, `docs.flutter.dev/ui/accessibility/accessibility-testing`] |
| Brechas conocidas | `accessible` no garantiza que TalkBack enfoque el elemento; hay diferencias entre plataformas (la propia documentación lo dice) | La semántica es un árbol aparte del que dibuja el motor; no se encontró una lista oficial de brechas en TalkBack **[no verificado]** |
| Indicio de incidencias abiertas (débil) | 20 incidencias abiertas que mencionan «TalkBack» en `react/react-native` | 97 abiertas con la etiqueta `a: accessibility` que mencionan «TalkBack» en `flutter/flutter` |

El indicio de incidencias **no es comparable**: las etiquetas, el tamaño de la comunidad y la forma de buscar son distintos [M, API de búsqueda de GitHub, 2026-10-19]. No se usa para puntuar.

**Conclusión del factor.** Los dos tienen APIs de etiqueta y rol y guía oficial. Flutter trae pruebas automáticas de accesibilidad en el SDK; React Native depende de un complemento de lint y del Accessibility Scanner. **Los dos pueden llegar a WCAG 2.1 AA; ninguno lo da hecho.** RNF-019 se verifica con herramienta automática y lista de chequeo (ERS) con TalkBack real en E18 [P]. Esto se refleja en AC-7 (ventaja de Flutter) y no mueve AC-8.

### 3.3 Versión mínima de Android y cuota en Colombia (RE-006)

| Marco | Mínimo que soporta | Fuente |
|---|---|---|
| React Native 0.88 (y Expo SDK 58) | **Android 7 (API 24)** | [F, `minSdk = "24"` en `gradle/libs.versions.toml` del paquete `react-native@0.88.0`; `expo-modules-core@58.0.23` usa 24 por defecto en `ExpoModulesCorePlugin.gradle`, 2026-10-19] |
| Flutter 3.47.7 | **Android 7 (API 24)**: «Supported 24 to 37», «Unsupported 23 and earlier» | [F, `docs.flutter.dev/reference/supported-platforms`, 2026-10-19] |

**Los dos marcos fijan el mismo mínimo.** El marco no limita RE-006. La versión mínima de la app es una decisión sobre la cuota de dispositivos.

**Cuota en Colombia, septiembre de 2026** [F, StatCounter, «Mobile & Tablet Android Version Market Share in Colombia», `gs.statcounter.com/android-version-market-share/mobile-tablet/colombia` y su archivo CSV, 2026-10-19]. La tabla suma todas las filas del CSV (20 filas; «Other» 0,01 %):

| Mínimo posible | Cuota que queda cubierta |
|---|---|
| Android 7 (API 24, mínimo de los dos marcos) | **99,73 %** |
| Android 8 (API 26) | ≈ 99,59 % |
| Android 9 (API 28) | 99,02 % |
| Android 10 (API 29, desde donde Impeller es el motor por defecto) | 97,91 % |
| Android 11 (API 30) | 96,34 % |

Notas:

- **Corrección de la versión 0.1.** Decía «Android 11 o superior es el 94,33 %» porque solo leí las seis versiones de la página. El CSV completo suma además Android 12L (12.1 y 12.2: 1,59 %) y Android 17 (0,31 %), así que el valor correcto es 96,34 % [M].
- La página HTML y el CSV difieren en décimas (Android 16: 36,51 % y 36,73 %). Se usó el CSV porque lista todas las versiones. StatCounter mide navegación web, no instalaciones; es un sustituto de la cuota de dispositivos [S].
- La tabla es de mobile y tablet juntos. Una fuente solo de móvil **no se encontró** (no verificado).

**Propuesta para RE-006 (decide el dueño, pregunta 3):** **Android 7 (API 24)**, el mínimo común de los dos marcos, que cubre 99,73 %. Subir el mínimo no reduce trabajo medible: no hay evidencia de que un mínimo mayor ahorre horas de desarrollo [S]. La versión mínima de la política de Google Play (nivel objetivo de API) es otro requisito y se revisa en E17 [S].

### 3.4 Firebase Cloud Messaging (D-029)

| Aspecto | React Native con Expo | Flutter |
|---|---|---|
| Paquete | `@react-native-firebase/messaging` 26.4.0 (Apache 2.0), Android e iOS; **exige la Nueva Arquitectura desde la v26** (ya es la única de RN 0.82 o más) [F, `rnfirebase.io/messaging/usage`, npm]. También `expo-notifications` 58.1.5 (MIT) | `firebase_messaging` 17.0.0, publicado por `firebase.google.com`, Flutter Favorite, 160 de 160 puntos en pub.dev, Android e iOS [F, `pub.dev/api/packages/firebase_messaging` y `/score`] |
| Pasa por un intermediario | `expo-notifications` ofrece el servicio de Expo (`getExpoPushTokenAsync`), que **enruta por servidores de Expo** hacia FCM y APNs. También `getDevicePushTokenAsync` devuelve el token nativo de FCM «para usar con otro servicio» [F, `docs.expo.dev/push-notifications/overview/`, `.../sdk/notifications/`]. Con `@react-native-firebase/messaging` no hay intermediario | Directo a FCM; no existe un intermediario equivalente |
| Mensajes solo de datos con la app cerrada | Android: `setBackgroundMessageHandler`. La documentación avisa que un mensaje solo de datos en segundo plano o cerrado es de **baja prioridad y se ignora**, salvo que se envíe con `priority: high` (Android) y `content-available` (iOS) [F, `rnfirebase.io/messaging/usage`]. Con `expo-notifications`, se usa una tarea de segundo plano (`expo-task-manager`) y el sistema puede no entregarla en modo Doze [F, `docs.expo.dev/versions/latest/sdk/notifications/`] | `FirebaseMessaging.onBackgroundMessage` con una función de nivel superior; en Android corre en un aislado aparte, sin interfaz [F, `firebase.google.com/docs/cloud-messaging/flutter/receive-messages`] |
| Notificación vista por el sistema | Con un mensaje de **notificación** (título y cuerpo fijos) más un campo `data` con el identificador, el sistema la muestra sin código de la app cuando la app está en segundo plano, en los dos marcos [F, `firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type`] | Igual |
| Requiere desarrollo nativo | Sí: `@react-native-firebase` necesita código nativo y **no funciona con Expo Go**; se usa `expo-dev-client` y *config plugins* [F, `docs.expo.dev/guides/using-firebase/`] | Configuración de Firebase en el proyecto de Android; el detalle no se verificó [S] |

**Cómo cumple la decisión 2 de privacidad (texto fijo e identificador).** Por el mecanismo de FCM que no depende del marco: el servidor envía un mensaje de **notificación con texto fijo** y `data: {id}` y la app consulta el contenido al abrirse. Eso evita depender de mensajes solo de datos con la app cerrada, que son poco fiables (fila 3, los dos marcos). Si el diseño exigiera mensajes **solo de datos**, hay que enviarlos con prioridad alta y mostrar una notificación local con una biblioteca (`expo-notifications` o `flutter_local_notifications` 22.3.2) [F, npm y pub.dev].

**Condición de privacidad para React Native (AC-2).** La app debe usar `@react-native-firebase/messaging` o `getDevicePushTokenAsync`, **no** el servicio de Expo, para que el texto y el identificador no pasen por un tercero distinto de Google. Es una medida de configuración, no una limitación [F, páginas de arriba].

**Conclusión del factor.** Los dos soportan FCM en Android e iOS con la decisión 2. Flutter lo hace directo por diseño; React Native exige elegir el paquete correcto. **No discrimina en capacidad; sí exige una medida en React Native.**

### 3.5 Tamaño de la app

- **Flutter.** La documentación oficial solo trae una cifra vieja y de iOS (la aplicación de demostración de Flutter 1.17: 5,4 MB comprimida, 13,7 MB descomprimida) [F, `docs.flutter.dev/perf/app-size`, 2026-10-19]. No encontré una cifra oficial vigente para un APK o AAB de Android.
- **React Native con Expo.** La documentación de Expo y la de React Native no dan una cifra de APK mínimo vigente (no verificado). El motor Hermes y las bibliotecas nativas suman al tamaño [S].
- **Medición propia.** No se midió: no hay SDK de Android ni de Flutter instalado en esta máquina [M, `which flutter` sin resultado].

**Conclusión del factor.** **No verificado.** No hay base para puntuar una diferencia. Se mide en E17 con el AAB de cada marco. Con el AAB de Google Play el tamaño que descarga la persona queda dividido por arquitectura y densidad (comportamiento del formato AAB) [S]. Para AC-8, la descarga pesa menos que la latencia y el cuadro por segundo (RNF-001) [P].

### 3.6 Madurez y mantenimiento

| Dato | React Native con Expo | Flutter | Fuente |
|---|---|---|---|
| Repositorio, estrellas | `react/react-native` (antes `facebook/react-native`), 126.722; `expo/expo`, 52.866 | `flutter/flutter`, 180.296; `dart-lang/sdk`, 11.312 | [F, API de GitHub, 2026-10-19] |
| Último cambio en el código | 2026-10-19 (los cuatro repositorios consultados) | 2026-10-19 | [F, campo `pushed_at`] |
| Cadencia de versiones | Seis versiones por año: 0.84 (2026-02-11), 0.85 (2026-04-08), 0.86 (2026-06-11), 0.87 (2026-08-11), 0.88 (2026-10-15). Expo SDK, tres por año | Versión estable trimestral: 3.41 (2026-02-11), 3.44 (2026-05-18), 3.47 (2026-08-12), con parches casi semanales (3.47.7 el 2026-10-08) | [F, `docs.expo.dev/versions/latest/`; GitHub releases; `releases_linux.json`] |
| Descargas semanales | `react-native` 9,04 millones; `expo` 7,09 millones (npm, 2026-10-12 al 18) | `firebase_messaging` 3,99 millones en 30 días (pub.dev) | [F, `api.npmjs.org/downloads`, `pub.dev/api/packages/firebase_messaging/score`] |
| Respaldo y gobierno | Meta y Expo: un ingeniero de Expo integra el equipo de versiones de React Native [F, `docs.expo.dev/versions/latest/`]. El código vive hoy en la organización `react` de GitHub, lo que **sugiere** una fundación (no se confirmó la fundación en una fuente de gobierno) **[no verificado]** | Google | [F, `api.github.com/repos/react/react-native`, 2026-10-19] |
| Rupturas | Nueva Arquitectura: por defecto desde la 0.76, **única desde la 0.82** [F, `reactnative.dev/blog`, `.../react-native-0.82`]. Complementos como `@react-native-firebase` 26 la exigen. Cada subida de Expo SDK sube RN | Cambios de motor de dibujo (Impeller por defecto en 3.27); guía pública de «Breaking changes» | [F, `reactnative.dev/blog`; menú de `docs.flutter.dev` («Breaking changes»)] |

El mantenimiento es una carga real para una persona (AF-4): React Native y Expo suben seis y tres veces al año; Flutter sube cuatro veces al año, con parches frecuentes. **Los dos están vivos y respaldados**; no hay indicios de abandono. No discrimina con evidencia.

### 3.7 Camino a iOS (D-028)

| Aspecto | React Native con Expo | Flutter |
|---|---|---|
| iOS soportado | iOS 15.1 o más (código de React Native 0.88) [F, `min_ios_version_supported` en `scripts/cocoapods/helpers.rb` del paquete `react-native@0.88.0`] | iOS 15 a 27; probado en CI en 18 y 26 [F, `docs.flutter.dev/reference/supported-platforms`] |
| Autenticación y notificaciones | `@react-native-firebase/messaging` y `expo-notifications` soportan APNs y FCM | `firebase_messaging` soporta APNs y FCM |
| Compilar iOS sin Mac | EAS Build de Expo compila Android e iOS en la nube [F, `docs.expo.dev/build/introduction/`]; su costo y límites **no se verificaron** | Requiere un Mac con Xcode [S] |

Los dos cumplen RNF-020 en capacidad. Apple cuesta USD 99 al año, igual en ambos (G-25) [P]. **No discrimina.**

### 3.8 Pruebas

| Nivel | React Native con Expo | Flutter |
|---|---|---|
| Unidad | Jest; Expo ofrece `jest-expo` [F, `docs.expo.dev/develop/unit-testing/`] | `flutter_test`, dentro del SDK [F, `docs.flutter.dev/testing/overview`] |
| Componente / *widget* | React Native Testing Library 14.1.0 (MIT), recomendada por la documentación de RN. El renderizador de pruebas de React figura como obsoleto [F, `reactnative.dev/docs/testing-overview`; npm] | `flutter_test`, *widget testing*, dentro del SDK [F, `docs.flutter.dev/testing/overview`] |
| Extremo a extremo en Android | **Maestro** (Apache 2.0, 16.127 estrellas): soporta React Native; Expo lo documenta en EAS Workflows. Detox (MIT) es otra opción [F, `docs.maestro.dev/platform-support/react-native`, `docs.expo.dev/eas/workflows/examples/e2e-tests/`, API de GitHub] | `integration_test` dentro del SDK. **Maestro también soporta Flutter** y prueba por el árbol de semántica [F, `docs.maestro.dev/platform-support/flutter`] |
| Accesibilidad automática | Lint y Accessibility Scanner | `meetsGuideline` dentro del SDK (3.2) |

Las dos pilas cubren unidad, componente y extremo a extremo en Android, y **Maestro sirve para las dos**. La diferencia: en Flutter casi todo viene en el SDK; en React Native se ensamblan tres herramientas. Una ventaja de React Native: Jest es el mismo ejecutor que puede usar la web en React [S].

### 3.9 Qué se comparte con la web en React (D-076)

| Elemento | React Native con Expo | Flutter |
|---|---|---|
| Lenguaje | **TypeScript** igual que la web | Dart; la web usa TypeScript. **No se comparte** |
| Conocimiento de React (componentes, estado, *hooks*, JSX) | **Se comparte**: lo que el dueño aprende para la web sirve en la app. Expo SDK 58 usa React 19.3.0 [F, `docs.expo.dev/versions/latest/`] | No se comparte; es un modelo de *widgets* distinto |
| Bibliotecas | Cualquier biblioteca de TypeScript sin dependencia del navegador (validación, fechas, formato de pesos) corre en la web y en la app [S]. La compatibilidad con Hermes de cada una se verifica [S] | Solo bibliotecas de Dart; **ninguna** de las de la web |
| Cliente del API | Un cliente en TypeScript, generado o escrito, sirve a los dos [S]. Con un contrato de OpenAPI del API en Go, también se puede generar uno en Dart [S] | El cliente se genera o se escribe aparte en Dart |
| Tokens de diseño (E14-SDD, pendiente 5) | Style Dictionary 5.7.0 (Apache 2.0) genera variables CSS **y** constantes de TypeScript desde el mismo JSON de tokens [F, `registry.npmjs.org/style-dictionary/latest`; `styledictionary.com/reference/hooks/formats/predefined/`] | Style Dictionary también trae un formato de Dart (`flutter/class.dart`) [F, misma página] |
| Reglas de validación (`reglas.json`, ADR-005) | Un solo código de TypeScript en web y app, **si** las reglas viven en el cliente (la propuesta de ADR-005 es que no) [S] | Dart: habría que sumarlo a la prueba de portabilidad [P, E11-PDC-D] |
| Componentes de interfaz | **No se comparten**: la web usa elementos HTML y la app usa componentes nativos (`View`, `Text`). Expo permite *react-native-web*, pero el diseño de E14 distingue las dos interfaces [S] | **No se comparten** |
| Repositorio | Con el monorepo de ADR-001 A, `web/`, `movil/` y `diseno/` pueden compartir paquetes de TypeScript [S] | `movil/` queda aparte, con su propia cadena |

**Qué se comparte de verdad.** Lenguaje, conocimiento de React, bibliotecas de TypeScript, cliente del API y tokens. **Qué no.** Los componentes de interfaz. Eso es menos de lo que sugiere «misma tecnología»: el ahorro principal es de **aprendizaje** y de un solo lenguaje de interfaz, no de código de pantallas.

### 3.10 Curva de aprendizaje para el dueño (AC-5)

Punto de partida: sabe Java y JS básico; **React, Go, Dart y el desarrollo móvil son nuevos** (L2, L4) [P].

| Qué debe aprender para la web y la app | React Native con Expo | Flutter |
|---|---|---|
| Lenguajes nuevos (con Go del API) | Go y TypeScript: **dos** | Go, TypeScript y Dart: **tres** |
| Marcos de interfaz nuevos | React (la web ya lo obliga) y la capa de React Native/Expo sobre ese modelo | React (para la web) **y** Flutter |
| Cadena de herramientas | Node y npm (la web de React ya los obliga), más Gradle y el SDK de Android | SDK de Flutter, más Android SDK; Node para la web |
| Apoyo oficial | Tutorial de Expo; `react.dev/learn` [F, 2026-10-19] | «Dart para quienes vienen de Java» (`dart.dev/resources/coming-from/java-to-dart`); «Flutter para desarrolladores de React Native» [F, 2026-10-19] |
| Punto a favor | Aprender React **una vez** sirve a web y móvil | Dart se parece a Java (tipos estáticos, clases) |

La comparación es **contable, no de familiaridad**: con la web decidida en React (D-076), el dueño debe aprender React de todos modos; Flutter suma un segundo marco de interfaz y un tercer lenguaje encima. El punto a favor de Flutter (Dart cercano a Java) reduce el costo del lenguaje, no el del marco. **No hay horas medidas por marco**: E02 asignó 80 h de producción a Android multiplataforma sin separarlas por marco [P, E02-EDC §2]. El factor k se mide al empezar la construcción.

### 3.11 Licencia (AGPLv3, D-021, RE-007) y costo

| Componente | Licencia | Fuente |
|---|---|---|
| React Native, Expo, `expo-notifications`, React Native Testing Library | MIT | [F, GitHub y npm, 2026-10-19] |
| `@react-native-firebase/*`, Style Dictionary | Apache 2.0 | [F, npm] |
| Flutter, Dart, `firebase_messaging` | BSD de 3 cláusulas | [F, GitHub y `pub.dev/packages/firebase_messaging/license`] |
| Maestro | Apache 2.0 | [F, API de GitHub] |

La FSF dice que Expat (MIT), BSD modificada y Apache 2.0 son compatibles con la GPL v3, y que MPL 2.0 es compatible con la AGPL v3 por su sección 3.3 [F, `gnu.org/licenses/license-list.html`, 2026-10-19]. **Costo:** los dos son gratis. Google Play cuesta USD 25 una vez y Apple USD 99 al año (G-25), iguales [P, E02-EDC §3]. Expo cobra planes de EAS (compilación y actualizaciones en la nube); **no se usan** en este diseño: las compilaciones corren en Azure Pipelines [P, documento interno de configuración de Azure].

**Superficie de dependencias (medida, no equivalente).** Con la plantilla oficial de Expo 58 (`expo-template-default` 58.0.25), `npm install --package-lock-only` da **572 paquetes** en el árbol; sus licencias son 495 MIT, 33 ISC, 12 MPL-2.0, 7 BSD-3, 6 Apache-2.0 y otras sueltas (incluida `Python-2.0` y datos con `CC-BY-4.0` de herramientas de desarrollo). El cierre de dependencias de `pub.dev` de `firebase_messaging`, `flutter_local_notifications`, `http`, `flutter_secure_storage` y `go_router` da **65 paquetes** [M, `registry.npmjs.org` y `pub.dev/api/packages`, 2026-10-19]. **No son comparables uno a uno**: el árbol de npm incluye herramientas de desarrollo (Metro, Babel) y la plantilla trae enrutador y animaciones; el de Dart no cuenta el SDK de Flutter. Es un indicio de que hay **más paquetes que revisar** con React Native (RNF-005, RE-007), no una cifra de riesgo. Ninguna licencia de código de ejecución incompatible con AGPLv3 apareció en la plantilla; se revisan todas en E17 [S].

## 4. Criterios aplicados

Se puntúan A y B con la escala y las anclas de E11-CYR 2.2 (1 = no cumple o riesgo alto sin medida; 3 = cumple con una medida declarada; 5 = cumple por diseño y se puede comprobar). Los pesos no cambian (E11-CYR 2.3). C queda descartada por D-028.

**E11-CYR no tiene un criterio de accesibilidad.** La evidencia de TalkBack (3.2) se asienta en AC-7 (capacidad de probar RNF-019) y en AC-8. No se cambió ningún peso.

| Criterio | Peso | A React Native con Expo | B Flutter |
|---|---|---|---|
| AC-1 Costo | 20 % | 4 | 4 |
| AC-2 Privacidad | 20 % | 3 | 3 |
| AC-3 Seguridad | 15 % | 3 | 3 |
| AC-4 Portabilidad | 15 % | 4 | 4 |
| AC-5 Capacidad de una persona | 15 % | 4 | 3 |
| AC-6 Exactitud | 5 % | 4 | 4 |
| AC-7 Capacidad de prueba | 5 % | 3 | 4 |
| AC-8 Uso en el celular | 5 % | 3 | 3 |
| **Total ponderado** | 100 % | **3,55** | **3,45** |

Cálculo: A = 0,80 + 0,60 + 0,45 + 0,60 + 0,60 + 0,20 + 0,15 + 0,15 = 3,55. B = 0,80 + 0,60 + 0,45 + 0,60 + 0,45 + 0,20 + 0,20 + 0,15 = 3,45.

**Evidencia por criterio.**

- **AC-1 (4, 4).** Ninguno consume Azure. Las compilaciones corren en Azure Pipelines dentro de los 1.800 minutos gratuitos [P, documento interno de configuración de Azure]. Con el costo recalculado en ADR-006 v0.2 (Go, monolito modular e imágenes en GitHub: USD 70,6 en tres meses, escenario base), AC-1 pasa de 3 a 4, igual en las dos alternativas; no cambia el orden.
- **AC-2 (3, 3).** Los dos mandan a FCM solo texto fijo e identificador (decisión 2) [P]. **React Native necesita una medida** para no pasar por el servicio de Expo: usar `@react-native-firebase/messaging` o `getDevicePushTokenAsync` (3.4). Flutter va directo a FCM. Esa diferencia es de configuración y está controlada, así que ambos quedan en 3 (ancla: cumple con una medida declarada). Hay más paquetes de terceros que revisar con React Native (572 contra 65, no comparable, 3.11); se declara en AC-3 como riesgo, no aquí.
- **AC-3 (3, 3).** Keystore de Android: en ambos pasa por un complemento (`expo-secure-store` o `flutter_secure_storage`) [S]. RNF-013 se sostiene igual: solo HTTPS (ADR-006) [P]. La cadena de suministro es el único contraste: más paquetes en npm (3.11). Como no es medición comparable, no se resta un punto; es la **primera cosa que se revisaría** si se cambiara una puntuación (sección 7).
- **AC-4 (4, 4).** Los dos compilan para iOS con el mismo código, con autenticación y FCM que funcionan en APNs (3.7); el API no depende de la plataforma (ADR-005). Costo de Apple igual [P]. No discrimina.
- **AC-5 (4, 3).** Es el criterio que decide (3.10). Con la web en React (D-076, decisión del dueño), el dueño aprende React de todos modos. React Native lo reutiliza: **dos** lenguajes nuevos (Go y TypeScript) y un marco de interfaz. Flutter agrega Dart y un segundo marco de interfaz: **tres** lenguajes. Dart cercano a Java reduce el costo del lenguaje pero no el del marco. No hay horas medidas por marco; E02 dio 80 h para Android (E02-EDC §2) [P]. Puntaje de React Native 4 (ancla 3, subido uno porque la curva se reparte con una pieza obligatoria ya decidida) y de Flutter 3. La diferencia depende de que D-076 se mantenga; no depende de la «familiaridad» del dueño, que es nula en ambos.
- **AC-6 (4, 4).** La app no calcula resultados: los cálculos viven en el API en Go (RN-005, RNF-002) [P]. No discrimina.
- **AC-7 (3, 4).** Flutter trae pruebas de unidad, de *widgets*, de integración y verificaciones de accesibilidad (`meetsGuideline`) dentro del SDK (3.2, 3.8). React Native cubre los mismos niveles con herramientas documentadas (Jest, React Native Testing Library, Maestro) pero hay que ensamblarlas, y las comprobaciones de accesibilidad son lint y revisión manual. Maestro sirve para los dos [F]. RNF-001 se mide con personas (E18).
- **AC-8 (3, 3).** RNF-001 depende sobre todo del diseño (E11-CYR AC-8). **No hay medición de rendimiento en gama baja** (3.1) ni cifra de tamaño (3.5). La versión 0.1 dio 4 a los dos sin medición; **se baja a 3** (ancla: «cumple con una medida declarada»; la medida es medir en E17). No discrimina.

## 5. Decisión propuesta

**React Native con Expo, por 0,10 puntos (3,55 contra 3,45). La decide el dueño.**

**Por qué, en palabras simples.** Los dos marcos sirven: ambos soportan Android 7, FCM con texto fijo e identificador, TalkBack y pruebas en Android, y los dos tienen respaldo y versiones frecuentes. La diferencia real es **cuánto debe aprender una sola persona**. La web va en React (D-076), así que el dueño debe aprender React de todos modos. Con React Native, esa misma base sirve en la app, y los lenguajes nuevos son dos (Go y TypeScript). Con Flutter se agrega Dart y un segundo marco de interfaz: tres lenguajes y dos marcos de interfaz.

**Los tres factores que deciden:**

1. **Curva de aprendizaje (AC-5):** React Native reutiliza React de la web; Flutter suma Dart y Flutter (3.10).
2. **Lo compartido con la web (3.9):** lenguaje, conocimiento de React, bibliotecas, cliente del API y tokens (Style Dictionary). Los componentes de interfaz no se comparten.
3. **Pruebas (AC-7), a favor de Flutter, y no alcanza:** el SDK de Flutter trae pruebas de accesibilidad dentro; React Native necesita ensamblar herramientas. Compensa 0,05 de los 0,15 que gana React Native en AC-5.

**Lo que no decide:** versión mínima de Android (la misma, API 24), FCM (los dos lo soportan), rendimiento en gama baja y tamaño (sin evidencia fuerte), iOS, licencia.

**Condiciones de la propuesta.**

1. FCM con `@react-native-firebase/messaging` o `getDevicePushTokenAsync`, **no** el servicio de Expo (3.4, AC-2).
2. Medir en E17 en un celular de gama baja real: arranque en frío, cuadros perdidos, memoria y tamaño del AAB. Si el resultado fuera malo, la propuesta se revisa (el cambio de marco cuesta rehacer `movil/`).
3. Verificar con TalkBack real en E18 (RNF-019); ningún marco lo da hecho.
4. Revisar las licencias de todas las dependencias de la app contra AGPLv3 en E17 (factor 11).

## 6. Consecuencias

**Lo que se gana**

- Un solo código para Android, con camino a iOS (D-028).
- Un lenguaje de interfaz (TypeScript y React) para web y app: menos que aprender y bibliotecas compartidas.
- Los tokens de E14 se generan con el mismo JSON para CSS y para TypeScript.

**Lo que se pierde o queda condicionado**

- **Más paquetes de terceros** que revisar contra AGPLv3 y contra RNF-005 (sin publicidad ni perfilamiento para menores).
- **Cambios frecuentes:** React Native sube seis veces al año y Expo tres; cada subida de Expo SDK trae una versión nueva de React Native. Se actualiza con calma, una vez por trimestre, no con cada versión [S].
- **Menos pruebas incluidas** que en Flutter; se ensamblan Jest, React Native Testing Library y Maestro (3.8).
- **FCM exige configuración** para no pasar por Expo y necesita código nativo (no Expo Go) (3.4).
- **El motor de reglas no corre en la app** si se aprueba ADR-005 B. Si el dueño elige reglas en la app, Hermes ejecuta JavaScript y la prueba de portabilidad cubría Python, Node y Java [P, E11-PDC-D §3] y suma Go (L3); habría que verificar Hermes. Flutter correría Dart, tampoco en la prueba: ninguno queda exento.
- **Flutter para web sigue descartado** (ADR-004): dibuja en un lienzo y su accesibilidad es opcional. La web va en React (D-076).
- **Versión mínima de Android (RE-006).** Propuesta: **Android 7 (API 24)**, 99,73 % en Colombia (3.3). Decide el dueño.

### 6.1 Pendiente 5 de E14-SDD: lenguaje de Android y herramienta de tokens

**Lenguaje de Android.** **TypeScript** con React Native y Expo (Dart si el dueño elige Flutter). No hay Kotlin ni Java en la app.

**Nombres.** La regla de E14-SDD §3.2 no cambia: `color.accion.primaria.fondo` en Penpot, `--color-accion-primaria-fondo` en la web y `colorAccionPrimariaFondo` en el código de la app. Ese identificador es válido tal cual en TypeScript y en Dart.

**Herramienta de conversión.** Un JSON de tokens (formato W3C que ya produce el generador de tokens del proyecto) se convierte en **variables CSS para la web y en constantes de TypeScript para la app**. Dos opciones:

| Opción | A favor | En contra |
|---|---|---|
| **Style Dictionary** 5.7.0 (Apache 2.0) | Lee el formato W3C; resuelve las referencias `{token}`; trae formatos para variables CSS, JavaScript y TypeScript, y Dart (`flutter/class.dart`) [F, `registry.npmjs.org/style-dictionary/latest`, `styledictionary.com/reference/hooks/formats/predefined/` y `.../info/dtcg/`, 2026-10-19] | Agrega Node al pipeline (la web de React ya lo necesita, ADR-004). Los tipos compuestos de tipografía necesitan un formato propio [S] |
| **Script propio** sobre `alcanzamos.tokens.json` | Sin herramienta nueva | Hay que escribir y probar un resolvedor de referencias entre los 105 tokens |

**Propuesta: Style Dictionary**, porque resolver las referencias es lo difícil y ya está hecho, y con la web en React el costo de Node ya está pagado. Es una decisión menor derivada de este ADR; no se puntuó con pesos. La conversión corre en el pipeline y sus salidas no se escriben a mano (E14-SDD §8.3).

## 7. Sensibilidad (E11-CYR 2.3)

Se cambian en un punto los dos criterios de mayor peso (AC-1 y AC-2, 20 % cada uno) para el ganador, como pide la regla, y después los puntos que de verdad separan a los dos.

| Caso | React Native con Expo | Flutter | ¿Cambia el orden? |
|---|---|---|---|
| Base | 3,55 | 3,45 | — |
| AC-1 del ganador baja un punto | 3,35 | 3,45 | **Sí** |
| AC-2 del ganador baja un punto | 3,35 | 3,45 | **Sí** |
| Ambos bajan un punto | 3,15 | 3,45 | **Sí** |
| AC-5 de React Native baja a 3 (el dueño decide que la curva es igual) | 3,40 | 3,45 | **Sí** |
| AC-3 de Flutter sube a 4 (se pondera la superficie de dependencias, 3.11) | 3,55 | 3,60 | **Sí** |
| AC-7 de React Native sube a 4 (Maestro y Jest compartidos con la web) | 3,60 | 3,45 | No |

**Regla de desempate.** La diferencia (0,10) es menor que 0,25, y AC-1 empata, así que **la regla no decide**. Gana React Native solo por el puntaje total.

**No es robusto.** Un punto menos en AC-1, AC-2 o AC-5 invierte el orden, y un punto más en AC-3 de Flutter también. La ventaja de React Native depende de un solo hecho: **que el dueño deba aprender React para la web (D-076)**. Si la web dejara de ser React (ADR-004), React Native pierde esa ventaja y la propuesta pasa a Flutter (ADR-003 v0.1: 3,30 contra 3,25). La propuesta tampoco resiste una prueba de rendimiento en gama baja que salga mal. Por eso el ADR queda **Propuesto** y las condiciones de la sección 5 son parte de la propuesta.

## 8. Requisitos que sostiene

RE-005, RE-002, RT-006 (app Android publicada); RE-006 (mínimo común Android 7, 3.3); RNF-020 (iOS después); RNF-022 y RNF-023 (tokens compartidos con la web); RNF-001 (registro rápido); RNF-005 (revisar dependencias); RNF-019 en la app (APIs de etiqueta y rol en los dos marcos; se verifica con TalkBack real y lista de chequeo, E18); RF-017 y D-029 (FCM con texto fijo e identificador).

## 9. Preguntas para el dueño

1. ¿React Native con Expo o Flutter? Gana React Native por 0,10, con la condición de que la web siga en React.
2. ¿Style Dictionary o script propio para los tokens?
3. ¿Android 7 (API 24, 99,73 %) como versión mínima (RE-006), o se decide en E17 con la tabla completa de versiones?
4. ¿Aceptas medir rendimiento, tamaño y TalkBack en un celular de gama baja en E17 (condiciones 2 y 3 de la sección 5) antes de cerrar la decisión?

## Fuentes

Todas consultadas el **2026-10-19**.

**Proyecto:** D-019, D-021, D-026, D-028, D-029, D-076; E11-CYR v1.1 §2; E14-SDD §3 y §9; E14-PPN §8 (decisión 2); E02-EDC §2 y §3; E11-PDC-D §3; ERS v1.9 (RE-006, RNF-019); ADR-001, ADR-004, ADR-005, ADR-006; respuestas del dueño (S2, L2, L3, L4).

**Externas:**

- Flutter: `docs.flutter.dev/reference/supported-platforms`, `/perf/impeller`, `/perf/app-size`, `/ui/accessibility`, `/ui/accessibility/assistive-technologies`, `/ui/accessibility/accessibility-testing`, `/testing/overview`, `/get-started/flutter-for/react-native-devs`; `storage.googleapis.com/flutter_infra_release/releases/releases_linux.json`; `dart.dev/resources/coming-from/java-to-dart`.
- React Native y Expo: `reactnative.dev/docs/accessibility`, `/docs/hermes`, `/docs/testing-overview`, `/blog`, `/blog/2025/10/08/react-native-0.82`; `docs.expo.dev/versions/latest/`, `/versions/latest/sdk/notifications/`, `/push-notifications/overview/`, `/guides/using-firebase/`, `/develop/unit-testing/`, `/eas/workflows/examples/e2e-tests/`, `/build/introduction/`; paquetes `react-native@0.88.0` y `expo-modules-core@58.0.23` de npm (archivos `gradle/libs.versions.toml`, `ExpoModulesCorePlugin.gradle`, `scripts/cocoapods/helpers.rb`).
- FCM: `rnfirebase.io/messaging/usage`; `firebase.google.com/docs/cloud-messaging/flutter/receive-messages`, `/customize-messages/set-message-type`; `pub.dev/api/packages/firebase_messaging` y `/score`.
- Cuota: `gs.statcounter.com/android-version-market-share/mobile-tablet/colombia` (página y CSV de septiembre de 2026).
- Repositorios, licencias y descargas: `api.github.com/repos/{react/react-native, expo/expo, flutter/flutter, dart-lang/sdk, mobile-dev-inc/maestro, wix/Detox, firebase/flutterfire}`; `registry.npmjs.org` y `api.npmjs.org/downloads`; `pub.dev/api/packages`; `docs.maestro.dev/platform-support/react-native` y `/flutter`; `styledictionary.com`; `gnu.org/licenses/license-list.html`.
- Blogs comerciales de comparación de rendimiento (`asoasis.tech`, `sharpskill.dev`): leídos, **sin valor probatorio**, no se usan para puntuar.

**Medido por el asistente (2026-10-19):** cierre de dependencias de `expo-template-default` 58.0.25 con `npm install --package-lock-only --ignore-scripts` (572 paquetes) y de los paquetes de Dart con la API de `pub.dev` (65 paquetes); suma de la cuota de Android con el CSV de StatCounter.

**No verificado:** rendimiento comparado en gama baja (arranque, cuadros, memoria); tamaño de APK o AAB vigente de cada marco; brechas conocidas de TalkBack en Flutter; fundación o gobierno de React Native tras el traslado a la organización `react`; costo y límites de EAS Build para iOS; cuota de Android solo de móviles; mínimo de iOS de Expo SDK 58 (se usó el de React Native 0.88); si Hermes ejecuta cada biblioteca de TypeScript compartida.
