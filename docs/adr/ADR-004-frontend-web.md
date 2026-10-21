# ADR-004 · Front-end de la web

> **Copia pública del ADR; el original vive en el repositorio privado del proyecto.** Los identificadores `D-nnn` (decisiones), `E11-xxx`, `E14-xxx`, `ERS`, `RF/RNF/RN/RE/RT-nnn`, `O-n`, `P-nn`, `NM-nn` y `US-nn` remiten al registro de decisiones y a documentos de ese repositorio; se conservan como trazabilidad y no tienen enlace.

| Campo | Valor |
|---|---|
| Documento | Registro de decisión arquitectónica 004 · Código: E11-ADR-004 |
| Proyecto | Alcanzamos |
| Estado | **Decidido por el dueño (D-076, D-083): Vite + React + TypeScript, embebido en la imagen del API** |
| Versión | 1.0 |
| Autor | Andrés Jiménez |
| Responsable de decidir | Dueño del proyecto |
| Uso de IA | El asistente redactó la propuesta, puntuó con los criterios de E11-CYR y consultó las fuentes; el dueño revisa y decide (D-051). |

## Control de versiones

| Versión | Fecha | Descripción del cambio | Autor |
|---|---|---|---|
| 0.1 | 2026-10-19 | Borrador: cuatro alternativas para la web, AC-5 según las respuestas del dueño, propuesta de HTML, CSS y JS sin framework | Andrés Jiménez |
| 0.2 | 2026-10-19 | El dueño decide React (D-076). Se reescribe: herramientas (Vite, TypeScript), AC-5 con React nuevo para el dueño, tokens de E14 en la web, cuadro de lenguaje natural (RF-001) llamando al API, alojamiento con el API en Go | Andrés Jiménez |
| 1.0 | 2026-10-19 | Decidido por el dueño (D-083): Vite + React + TypeScript embebido en la imagen del API con `embed` y `http.FileServerFS`; un dominio, sin CORS; cookie `SameSite=Strict` | Andrés Jiménez |

## 1. Contexto

El producto tiene una app web y una app Android que consumen el mismo API (RE-005, D-019, AF-3). La web debe cumplir:

- WCAG 2.1 nivel AA en las pantallas principales (RNF-019) [P].
- Uso sin desplazamiento horizontal de 360 a 1920 px (RNF-024) [P].
- Los mismos nombres, íconos, colores y pasos que Android (RNF-022) [P].
- **Lenguaje natural también en la web** (acta 12.8 de D-062, D-075): el cuadro de registro llena el formulario y la persona confirma antes de guardar (RF-001, RF-004, RN-001) [P].

**Decisión del dueño (D-076, 2026-10-19 15:50).** «La web va en React.» La versión 0.1 propuso HTML, CSS y JS sin framework; esa propuesta **queda reemplazada**.

**AC-5 depende del dueño y no se supuso.** Respuesta del 2026-10-19 (L4): React **«es nuevo para mí»**. Antes dijo (L2): «soy más backend, no domino un framework frontend»; sabe HTML, CSS y JS sin framework. Su lenguaje de backend era Java; el del API ahora es Go, también nuevo (ADR-002). **El dueño aprende dos tecnologías nuevas a la vez**: es el riesgo de capacidad más alto de la construcción (sección 5).

La web es una interfaz de formularios, listas y gráficos simples, sin tiempo real. No hay requisito de uso sin conexión en la web [P, ERS v1.9].

## 2. Alternativas de herramientas con React

React está decidido. Lo que se compara es **cómo se construye y se sirve**.

| # | Alternativa | Aspecto positivo | Razón de descarte o de elección |
|---|---|---|---|
| T1 | **Vite + React + TypeScript**, aplicación de una sola página (SPA) que llama al API. Archivos estáticos | Sin servidor propio de la web. Es la herramienta que la documentación de React ofrece para construir una app «desde cero» [F, `react.dev/learn/build-a-react-app-from-scratch`] | **Propuesta.** El enrutador, los formularios y el estado se eligen y se ensamblan; ver sección 4 |
| T2 | **Framework de React con servidor** (por ejemplo Next.js o React Router en modo framework) | La documentación de React **recomienda empezar con un framework** para apps nuevas [F, `react.dev/learn/creating-a-react-app`] | Suma un servidor de Node que operar y pagar, y más conceptos nuevos (render en servidor). Contra AF-4 y AC-1. El mismo texto dice que se puede construir sin framework si las restricciones lo piden [F, mismo texto] |
| T3 | **Vite + React con JavaScript**, sin TypeScript | Menos que aprender. Es el JS que el dueño ya conoce | Sin tipos: los errores de forma de datos aparecen al ejecutar, no al compilar. El API tendrá un contrato que conviene tipar |

**Variante descartada.** Plantillas del lado del servidor del propio API (HTMX o `html/template`): ya no es React; contradice la decisión del dueño.

**Filtros.**

| Filtro | T1 | T2 | T3 |
|---|---|---|---|
| AF-1 Licencia | Sí: React, Vite, `@vitejs/plugin-react`, React Router, React Hook Form y Vitest son MIT; TypeScript y Playwright, Apache 2.0 [F, registro de npm, sección 3.1]. Cada dependencia indirecta se revisa en E17 (RE-007) | Sí (Next.js: licencia no consultada [S]) | Sí |
| AF-2 Cabe en el crédito | Sí (ADR-006) | **Sí, con reserva**: un contenedor de Node siempre encendido sumaría unos USD 5,9 al mes [M, cálculo con las tarifas de ADR-006 §5, 0,25 vCPU y 0,5 GiB en reposo] | Sí |
| AF-3 Mismo API | Sí | Sí | Sí |
| AF-4 Una persona lo opera | Sí | Sí, con una pieza más | Sí |

## 3. Criterios aplicados

| Criterio | Peso | T1 Vite + React + TS | T2 Framework con servidor | T3 Vite + React + JS |
|---|---|---|---|---|
| AC-1 Costo | 20 % | 4 | 3 | 4 |
| AC-2 Privacidad | 20 % | 3 | 3 | 3 |
| AC-3 Seguridad | 15 % | 3 | 3 | 3 |
| AC-4 Portabilidad | 15 % | 4 | 3 | 4 |
| AC-5 Capacidad de una persona | 15 % | 2 | 1 | 2 |
| AC-6 Exactitud | 5 % | 4 | 4 | 3 |
| AC-7 Capacidad de prueba | 5 % | 4 | 4 | 3 |
| AC-8 Uso en el celular | 5 % | 4 | 4 | 4 |
| **Total ponderado** | 100 % | **3,35** | **2,85** | **3,25** |

**Evidencia por criterio.**

- **AC-1 (4, 3, 4).** T1 y T3 son archivos estáticos: costo ≈ 0 y el escenario base queda en USD 70,6 en 3 meses (ADR-006 §5), que da 4. T2 suma el contenedor de Node. Con réplica en cero el costo es menor, pero el arranque en frío hace lenta cada primera visita [S]. Con réplica encendida, el escenario base de 3 meses pasaría de USD 70,6 a unos USD 88 [M, ADR-006 §5 más 3 × 5,9]. Eso da 3 con la lectura de AC-1 del README de los ADR (hasta USD 90).
- **AC-2 (3, 3, 3).** React trae un árbol de paquetes de terceros en el navegador de personas y menores (RNF-005, RNF-007). La medida es la misma en las tres: lista de dependencias fija (`package-lock.json`), revisión de licencias y de vulnerabilidades en el pipeline, y una política de contenido (CSP) que prohíbe orígenes externos [S]. Sin analítica ni SDK de publicidad. No discrimina.
- **AC-3 (3, 3, 3).** JSX escapa por defecto lo que se inserta como texto; la excepción es `dangerouslySetInnerHTML`, que se prohíbe por regla de revisión [S]. El riesgo principal pasa a la cadena de suministro de npm. Se cubre con el `package-lock.json`, la revisión de vulnerabilidades y la CSP. La sesión va en una cookie `HttpOnly`, no en el almacenamiento del navegador (ADR-002 §5.2). RNF-013 con HTTPS (E11-DAR).
- **AC-4 (4, 3, 4).** T1 y T3 producen archivos estándar del navegador que cualquier servidor sirve. T2 ata la web a un servidor de Node y a un framework.
- **AC-5 (2, 1, 2).** Fuente: respuesta del dueño [P, L4].
  - T1: React, TypeScript, Vite y npm son nuevos. HTML, CSS y JS sí los conoce; por eso 2 y no 1. TypeScript le resulta cercano por venir de Java (lenguaje con tipos) [S].
  - T2: todo lo de T1 y además el render en servidor.
  - T3: se ahorra TypeScript, pero queda con React y Vite nuevos.
  - E02 asignó 70 h de producción a la web [P, E02-EDC §2]; no dice con qué tecnología. **Esas horas no están recalculadas para React nuevo.**
- **AC-6 (4, 4, 3).** La web no calcula resultados; los muestra (RN-005). TypeScript separa tipos de datos del contrato del API [S]. En JS sin tipos, un número que llega como texto se descubre al ejecutar.
- **AC-7 (4, 4, 3).** Vitest y React Testing Library para componentes, Playwright para recorridos completos y `axe-core` para accesibilidad (sección 3.1). Con TypeScript, el compilador es una prueba más.
- **AC-8 (4, 4, 4).** RNF-024 se logra con CSS adaptable y los tokens de espaciado de E14. No discrimina.

**Sensibilidad (E11-CYR 2.3).**

| Caso | T1 | T3 (segundo) | ¿Cambia el orden? |
|---|---|---|---|
| Base | 3,35 | 3,25 | — |
| AC-1 de T1 baja un punto | 3,15 | 3,25 | **Sí** |
| AC-2 de T1 baja un punto | 3,15 | 3,25 | **Sí** |
| Ambos bajan un punto | 2,95 | 3,25 | **Sí** |

**No es robusto, y la regla no decide entre T1 y T3.** La diferencia es de 0,10 y AC-1 empata. **T2 sí queda atrás por regla** (2,85: diferencia de 0,50). La elección entre T1 y T3 es de comodidad: TypeScript agrega algo que aprender pero reduce errores que el dueño, nuevo en React, tardaría en encontrar. **Es una decisión menor** y reversible: un proyecto de Vite con TypeScript puede empezar permitiendo archivos `.js` y migrar gradualmente [S, no verificado en la documentación de TypeScript].

### 3.1 Herramientas verificadas

Consultadas el **2026-10-19** en el registro de npm (`https://registry.npmjs.org/<paquete>/latest`). «Fecha» es la de publicación de esa versión según el mismo registro.

| Función | Paquete | Licencia | Versión y fecha | Nota |
|---|---|---|---|---|
| Biblioteca de interfaz | `react`, `react-dom` | MIT | 19.3.1, 2026-10-14 | La documentación de React en `react.dev` muestra la versión 19.3 |
| Compilador y servidor de desarrollo | `vite` | MIT | 8.3.4, 2026-10-08 | Exige Node `^20.19.0 \|\| >=22.12.0` [F, campo `engines`] |
| Integración de React con Vite | `@vitejs/plugin-react` | MIT | 6.1.2, 2026-10-05 | |
| Lenguaje | `typescript` | Apache 2.0 | 7.0.2, 2026-07-08 | |
| Rutas | `react-router` | MIT | 8.5.0, 2026-10-19 | La documentación de React lo lista como marco recomendado; se usaría como biblioteca de rutas. **El modo de uso sin servidor no se verificó** |
| Formularios | `react-hook-form` | MIT | 7.90.0, 2026-10-11 | Para los formularios de RF-002 y para llenarlos desde el lenguaje natural |
| Validación de formas | `zod` | MIT | 4.6.7, 2026-10-12 | Opcional: valida lo que llega del API |
| Pruebas de componentes | `vitest`, `@testing-library/react` | MIT | 5.0.5, 2026-10-15; 16.3.3, 2026-08-27 | |
| Pruebas de recorrido | `playwright` | Apache 2.0 | 1.64.1, 2026-10-14 | |
| Accesibilidad automática | `axe-core` | **MPL 2.0** | 4.14.0, 2026-10-05 | Solo para desarrollo y pruebas; no va en el paquete que se publica. Compatibilidad de MPL 2.0 con AGPLv3: **no verificada**; se revisa en E17 (RE-007) |
| Conversión de tokens | `style-dictionary` | Apache 2.0 | 5.7.0, 2026-10-16 | Sección 4.3 |
| Caché de datos del API (no se propone aún) | `@tanstack/react-query` | MIT | 5.104.5, 2026-10-19 | Se evalúa solo si el estado del servidor se complica |

**No propuesto:** internacionalización (el producto es en español), una biblioteca de componentes visuales (los componentes de E14 se construyen con los tokens) ni `eslint-plugin-jsx-a11y` (último lanzamiento 6.10.2, 2024-10-26; compatibilidad con ESLint actual no verificada).

## 4. Decisión (D-083)

**Decidido por el dueño el 2026-10-19:** Vite + React + TypeScript; los archivos estáticos van **embebidos en la imagen del API** con `embed` y se sirven con `http.FileServerFS`; **un solo dominio, sin CORS**, y la cookie de sesión con `SameSite=Strict` (D-081). Los tokens llegan como variables CSS con Style Dictionary (D-078). Lo que sigue es el análisis que sostiene la decisión.

### 4.1 Análisis previo

**Vite + React + TypeScript (T1)**, SPA con archivos estáticos que llama al API por HTTPS.

1. T1 puntúa 3,35; T3, 3,25; T2, 2,85. Se propone T1 por los tipos y porque T2 no cabe en AF-4 ni en AC-1.
2. **Enrutamiento, formularios y pruebas.** `react-router` para rutas, `react-hook-form` para formularios, Vitest con Testing Library y Playwright con `axe-core` para pruebas y accesibilidad.
3. **Alojamiento propuesto: los archivos estáticos dentro de la imagen del API en Go**, embebidos con `embed` y servidos con `http.FileServerFS` (Go 1.22) [F, `api/go1.22.txt` de `golang/go`]. Un solo contenedor, un solo dominio y sin CORS. D-026 pedía una aplicación por contenedor; **D-076 la modifica con el monolito modular**. La versión 0.1 de este ADR descartó esta forma por esa regla de D-026.
   - **Alternativa:** un contenedor de archivos estáticos aparte (Caddy o nginx) con réplica en cero. Costo extra: unos USD 1,75 al mes [M, ADR-006 §5.3, variante «web aparte»]. Exige CORS y `SameSite` más laxo si el dominio es otro.
   - **Contra de la forma propuesta:** un cambio en la web obliga a reconstruir y redesplegar el API. Se acepta: es una sola persona.
   - Otras opciones (Azure Static Web Apps, GitHub Pages) no se evaluaron: sus regiones y su efecto en la política de la suscripción no se verificaron [S].
4. **Compilación.** Un Dockerfile de varias etapas: `node` compila `web/`, `go build` embebe `web/dist` y la imagen final no lleva Node. Node entra solo en el pipeline, no en producción.

### 4.1 Cuadro de lenguaje natural (RF-001) en la web

- La web **no lleva motor**: el cuadro llama al API (ADR-005 B). El texto va por HTTPS a una operación del API (la ruta y el contrato van a E12), y el motor en Go responde con `monto`, `tipo`, `fecha`, `categoria` e `intencion`.
- El componente rellena el formulario de registro con `react-hook-form` (los campos quedan editables) y **no guarda nada hasta que la persona confirma** (RF-004, RN-001).
- **Varios movimientos.** Cuando el API indique que detectó más de uno, la web muestra el aviso de US-29: «Tomamos solo el primer movimiento. Registra los otros por separado.» (L4, decisión 5). El prototipo no informa cuántos detectó; la señal será una heurística aparte que cuenta los montos, sin tocar `reglas.json`, decidida por el dueño (D-077, (4)) y diseñada en E12.
- La web no registra el texto en consola ni en herramientas de analítica (NM-03, NM-12).

### 4.2 Accesibilidad (RNF-019) y adaptación (RNF-024)

HTML semántico en cada componente de React (`button`, `label`, `nav`), foco visible y orden de tabulación comprobado en Playwright. `axe-core` corre sobre cada pantalla en el pipeline. RNF-019 no está en ningún criterio de E11-CYR y se refleja aquí por su forma de verificación (E11-DAR, O-17). La automatización **no sustituye** la lista de chequeo manual de E18 [S].

### 4.3 Tokens de E14 en la web (pendiente 5 de E14-SDD, lado web)

- E14-SDD guarda los 105 tokens en un JSON con el formato W3C (`$value` y `$type`) [P, archivo de tokens de diseño del proyecto].
- **Propuesta: Style Dictionary** lee ese JSON, resuelve las referencias `{token}` y genera **variables CSS** con la regla de nombres fija de E14-SDD §3.2: `--color-accion-primaria-fondo` [P]. Las usa React con CSS normal o módulos de CSS. Las salidas se generan en el pipeline y no se escriben a mano (E14-SDD §8.3).
- **Node ya está** en el pipeline por Vite, así que la objeción de ADR-003 («agrega Node») no aplica a la web. Los tipos compuestos de tipografía necesitan un formato propio [S, ADR-003 §5.1].
- La herramienta para la app móvil **depende de ADR-003 (en revisión)**.

### 4.4 Qué depende de ADR-003 (en revisión)

| Tema | Si el marco móvil usa TypeScript con React | Si no usa React |
|---|---|---|
| Lenguaje y herramientas | Se pueden compartir tipos del contrato del API y esquemas `zod` | Nada se comparte salvo el contrato del API (OpenAPI o JSON) y los tokens |
| Componentes | No se comparten sin una capa adicional (la web usa elementos del navegador) [S, no verificado] | Igual |
| Tokens | Style Dictionary para web y móvil | Style Dictionary con otro formato, o script propio |
| Aprendizaje del dueño | React sirve a la web y a la app: se aprende una vez | Dos pilas nuevas más Go |

Este ADR no asume el resultado de ADR-003.

## 5. Consecuencias

**Lo que se gana**

- El ecosistema de React: componentes, pruebas y documentación abundante.
- Tipos que describen el contrato del API.
- Un solo despliegue (propuesta de alojamiento).

**Lo que se pierde o queda condicionado**

- **Tres tecnologías nuevas a la vez: React, TypeScript y Go** (ADR-002). El plan de E02 (70 h de web y 120 h de API) **no está recalculado**. El factor k se mide en las primeras semanas (E02 §5). Se anota como riesgo de capacidad: si el factor k es alto, lo que se recorta primero son las pantallas no esenciales de la web, no la seguridad (pendiente del dueño, E11-DAR, O-20).
- **Cadena de suministro de npm.** Miles de paquetes indirectos. Se mitiga con `package-lock.json`, `npm ci`, revisión de vulnerabilidades y licencias en el pipeline y política de contenido estricta [S].
- **Versiones en movimiento.** `vite` 8, `typescript` 7 y `react-router` 8 son versiones mayores recientes [M, npm, 2026-10-19]; la versión se fija al empezar E17 y se actualiza con un calendario.
- **Mínimo de Node** `^20.19.0 || >=22.12.0` solo para construir.
- **Notificaciones en la web** (RF-017, D-029): Web Push exige un *service worker*; Vite lo permite como archivo estático. **No se verificó** el soporte de Web Push en cada navegador; E17 lo prueba [S].
- **SPA y enrutamiento.** El API debe devolver `index.html` para rutas que no son del API (`/v1/*` queda reservado). Es un manejador pequeño [S].
- **Dominio.** Con el alojamiento propuesto, un solo dominio y sin CORS. Con la alternativa, CORS limitado al dominio de la web (`rs/cors`, ADR-002 §5).

## 6. Requisitos que sostiene

RE-005 (mismo API), RNF-019 (WCAG, con HTML semántico y `axe-core`), RNF-024 (adaptable), RNF-022 y RNF-023 (tokens y componentes de E14), RNF-005 (sin publicidad ni analítica), RF-001 y RF-004 en la web (el cuadro llama al API, ADR-005).

## 7. Preguntas para el dueño

1. **Decidido (D-083):** Vite + React + TypeScript.
2. **Decidido (D-083):** embebida en el API con `embed` y `http.FileServerFS`; un dominio, sin CORS, cookie `SameSite=Strict`.
3. **Decidido (D-078):** Style Dictionary.
4. Pendiente: qué dominio tendrá la web (se define en E19).

## Fuentes

D-019, D-026, D-029, D-062 (acta 12.8), D-075, D-076, D-077; E11-CYR v1.1 §2; E14-SDD §3.2 y §8.3 y el archivo de tokens de diseño del proyecto; E02-EDC §2 y §5; ERS v1.9 (RNF-019, RNF-022, RNF-024, RF-001, RF-004, RN-001); ADR-002, ADR-005 y ADR-006; respuestas del dueño del 2026-10-19 (L2, L4). Fuentes externas consultadas el 2026-10-19: `react.dev/learn/creating-a-react-app` y `.../build-a-react-app-from-scratch`; `registry.npmjs.org` (versiones, licencias, fechas y `engines`); `api/go1.22.txt` de `github.com/golang/go`.
