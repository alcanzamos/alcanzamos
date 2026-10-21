# ADR-001 · Estructura de repositorios

> **Copia pública del ADR; el original vive en el repositorio privado del proyecto.** Los identificadores `D-nnn` (decisiones), `E11-xxx`, `E14-xxx`, `ERS`, `RF/RNF/RN/RE/RT-nnn`, `O-n`, `P-nn`, `NM-nn` y `US-nn` remiten al registro de decisiones y a documentos de ese repositorio; se conservan como trazabilidad y no tienen enlace.

| Campo | Valor |
|---|---|
| Documento | Registro de decisión arquitectónica 001 · Código: E11-ADR-001 |
| Proyecto | Alcanzamos |
| Estado | **Aprobado por el dueño (D-079): monorepo** |
| Versión | 1.1 |
| Autor | Andrés Jiménez |
| Responsable de decidir | Dueño del proyecto |
| Uso de IA | El asistente redactó la propuesta, puntuó con los criterios de E11-CYR y consultó las fuentes; el dueño revisa y decide (D-051). |

## Control de versiones

| Versión | Fecha | Descripción del cambio | Autor |
|---|---|---|---|
| 0.1 | 2026-10-19 | Borrador: contexto, tres alternativas, puntajes con evidencia, propuesta y sensibilidad | Andrés Jiménez |
| 0.2 | 2026-10-19 | Sin decisión nueva del dueño para este ADR: sigue «Propuesto». Se actualizan las referencias a las decisiones de D-076: API en Go, web en React, monolito modular (sin trabajadores aparte), imágenes en GitHub. Puntajes sin cambio | Andrés Jiménez |
| 1.0 | 2026-10-19 | Aprobado por el dueño (D-079): monorepo público `alcanzamos/alcanzamos`. Se actualizan las referencias a ADR-003 (React Native con Expo, D-078). Quedan abiertas las preguntas 1 y 2 de la sección 7 | Andrés Jiménez |
| 1.1 | 2026-10-19 | D-083: los conjuntos congelados se publican en el monorepo sin modificar, con el SHA-256 verificado en el pipeline de E18 | Andrés Jiménez |

## 1. Contexto

D-036 (aceptada) ya fijó **qué se publica**: el código del producto es público en la organización `alcanzamos` (API, web, Android, trabajadores, esquema y migraciones, infraestructura como código sin secretos y documentación del producto). Los artefactos del Método ADSO, el registro de decisiones y las evidencias van en un repositorio privado del proyecto.

**Cambios de D-076 que tocan este ADR** (2026-10-19): el API es un monolito modular en Go (ADR-002), sin trabajadores aparte (la palabra «trabajadores» de D-036 queda sin objeto, salvo el trabajo programado de las tareas, que es el mismo código); la web es React (ADR-004); y las imágenes de contenedor van en GitHub Container Registry. El marco móvil es React Native con Expo (ADR-003, D-078).

D-036 dejó abierta **cómo se organiza el código**: un monorepo con un pipeline por aplicación filtrado por ruta, un repositorio por aplicación o un punto medio. D-008 había supuesto un monorepo sin compararlo.

Restricciones que pesan:

- Licencia AGPLv3 y dependencias compatibles (D-021, RE-007) [P].
- Código en GitHub público; Boards y Pipelines en Azure DevOps privado, conectados con la GitHub App limitada a los repositorios del proyecto (D-021) [P].
- Una sola persona opera el sistema (AF-4, D-003) [P].
- Piezas que dos o más aplicaciones comparten: el archivo de reglas (ADR-005), los tokens de diseño (E14-SDD, 105 tokens en un JSON) y los textos de la interfaz (RNF-015, RNF-022) [P].
- Secretos, estado de Terraform, volcados de base y datos reales **nunca van en git** (D-036) [P].

**Lo que este ADR no decide:** la separación entre código público y documentación académica privada. Esa ya es D-036 y no se reabre.

## 2. Alternativas

| # | Alternativa | Aspecto positivo | Razón de descarte o de elección |
|---|---|---|---|
| A | **Monorepo** `alcanzamos/alcanzamos` con `api/`, `web/`, `movil/`, `reglas/`, `diseno/`, `infra/` y `docs/adr/`, con un pipeline por carpeta filtrado por ruta | Una sola copia de lo compartido; un cambio de reglas o de tokens viaja con el código que lo usa; una configuración de seguridad | **Propuesta.** Ver sección 4 |
| B | **Un repositorio por pieza**: `-api`, `-web`, `-movil`, `-infra`, `-reglas`, `-diseno` | Historiales y permisos independientes; cada pipeline es simple | Lo compartido exige publicar y versionar paquetes o usar submódulos. Seis repositorios que configurar y vigilar para una sola persona |
| C | **Punto medio**: `alcanzamos` (API, web, reglas, infraestructura) y `alcanzamos-movil` | El proyecto Android, con otra cadena de herramientas, queda aparte | Las reglas y los tokens siguen cruzando repositorios. Dos pipelines y dos configuraciones de seguridad sin una ganancia clara |

**Filtros.** AF-1 (licencia), AF-3 (mismo API), AF-4 (una persona) y AF-5 (región) no cambian entre las tres: todas publican con AGPLv3 en GitHub y usan el mismo API. AF-2: ninguna agrega costo en Azure. Las tres pasan. Lo que cambia es el esfuerzo de mantenerlas, y eso lo mide AC-5.

## 3. Criterios aplicados

| Criterio | Peso | A Monorepo | B Un repo por pieza | C Punto medio |
|---|---|---|---|---|
| AC-1 Costo | 20 % | 4 | 4 | 4 |
| AC-2 Privacidad | 20 % | 3 | 3 | 3 |
| AC-3 Seguridad | 15 % | 4 | 3 | 3 |
| AC-4 Portabilidad | 15 % | 4 | 3 | 3 |
| AC-5 Capacidad de una persona | 15 % | 4 | 2 | 3 |
| AC-6 Exactitud | 5 % | 3 | 3 | 3 |
| AC-7 Capacidad de prueba | 5 % | 5 | 3 | 4 |
| AC-8 Uso en el celular | 5 % | 4 | 3 | 3 |
| **Total ponderado** | 100 % | **3,80** | **3,05** | **3,25** |

**Evidencia por criterio.**

- **AC-1 (4, 4, 4).** Ninguna alternativa cambia el gasto en Azure; el escenario base es USD 70,6 en 3 meses, que da 4 con la lectura de AC-1 del README [M, ADR-006 §5; en la versión 0.1 era USD 82,8 y 3]. GitHub gratis y 1.800 minutos al mes de Azure Pipelines en el nivel gratuito [P, documento interno de configuración de Azure]. Los filtros por ruta de Azure Pipelines (`trigger` con `paths`) evitan compilar lo que no cambió [F, `learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/trigger`]. No discrimina.
- **AC-2 (3, 3, 3).** La medida es la misma en las tres: *secret scanning*, *push protection* y exclusión de datos reales (D-036) [P]. No discrimina.
- **AC-3 (4, 3, 3).** *Secret scanning* y *push protection* se activan **en cada repositorio público** (D-036) [P]. Con A hay una configuración que revisar; con B, seis; con C, dos. Las tres cumplen con una medida declarada; A reduce los lugares donde olvidarla.
- **AC-4 (4, 3, 3).** Quien bifurque el proyecto con A se lleva todo lo que necesita para ejecutarlo, que es lo que pide la AGPLv3 (D-021) [P]. Con B o C debe reunir varios repositorios y sus versiones.
- **AC-5 (4, 2, 3).** Un clon, un pipeline con filtros por ruta, un lugar donde enlazar tareas. Con B hay seis repositorios con sus pipelines y sus protecciones de rama. Si E11 usa GitHub Actions, la credencial federada de Azure se amarra a un sujeto que nombra el repositorio; con B serían varias credenciales (no verificado en la documentación de Microsoft en esta tarea) [S]. D-049 solo prevé «otra credencial» para GitHub [P, documento interno de configuración de Azure].
- **AC-6 (3, 3, 3).** La exactitud de los cálculos no depende de cómo se organicen los archivos. No discrimina.
- **AC-7 (5, 3, 4).** La prueba de consistencia entre motores de reglas (ADR-005, E18) y la prueba de portabilidad de expresiones regulares necesitan `reglas.json`, los motores y los conjuntos congelados en el mismo árbol: con A corren en un solo pipeline, con una sola versión de cada pieza. Con B hay que descargar otros repositorios en el pipeline y fijar sus versiones. Con C, solo el motor de la app queda fuera [P, E11-PDC-D §3: la prueba de portabilidad ejecuta Python, Node y Java, y con D-076 también Go (RE2), sobre el mismo `reglas.json`].
- **AC-8 (4, 3, 3).** RNF-022 exige los mismos nombres de concepto en web y Android. Un solo archivo de tokens (E14-SDD §3.1) y un solo archivo de textos, versionados juntos, lo sostienen mejor que copias en repositorios distintos [P].

## 4. Decisión propuesta

**Un monorepo público `alcanzamos/alcanzamos` para todo el código del producto.** El repositorio privado del proyecto sigue aparte (D-036).

1. **Gana por 0,55 puntos.** La diferencia supera los 0,25 de la regla de desempate; no hace falta AC-1.
2. **Lo compartido va en una carpeta.** `reglas/` y `diseno/` (tokens y textos) viven junto al código que los consume. Es la forma más simple de cumplir la condición del dueño para ADR-005: el archivo de reglas como único punto común.
3. **Un pipeline por carpeta**, con filtros por ruta (`api/**`, `web/**`, `movil/**`, `reglas/**`, `infra/**`). Un cambio en `reglas/` o `diseno/` dispara los pipelines que lo usan.

Estructura propuesta (los nombres se confirman en E17):

```
alcanzamos/
├── api/        API en Go, `go.mod` (ADR-002)
├── web/        app web en React con Vite, `package.json` (ADR-004)
├── movil/      app en React Native con Expo, para Android y después iOS (ADR-003, D-078)
├── reglas/     reglas.json y la prueba de consistencia (ADR-005; el motor en Go vive en `api/`)
├── diseno/     tokens (JSON W3C) y textos de la interfaz (E14-SDD)
├── infra/      infraestructura como código, sin secretos
├── docs/adr/   copia pública de los ADR (D-036)
└── .azure-pipelines/
```

## 5. Consecuencias

**Lo que se gana**

- Una sola configuración de seguridad y una sola clonación.
- Reglas, tokens y textos cambian con el código que los usa.
- La prueba de consistencia de ADR-005 corre en un solo pipeline.

**Lo que se pierde o queda condicionado**

- **Pipelines más delicados.** Los filtros por ruta se pueden equivocar y compilar de más o de menos. Se mitiga con una prueba de que cada carpeta dispara solo su pipeline (E17).
- **Historial único.** Una persona que contribuya solo a la app móvil clona también el API. El tamaño del repositorio no preocupa a esta escala, pero se anota.
- **Las herramientas de Go y de Node (web y React Native) conviven en un árbol.** Cada carpeta lleva su propio archivo de construcción (`go.mod` en `api/`, `package.json` en `web/` y en `movil/`).
- **La imagen del API lleva la web.** Si ADR-004 se acepta como está propuesto, la imagen embebe `web/dist`: un cambio en `web/**` también dispara la construcción de la imagen del API (filtro por ruta). Se verifica en E17.
- **Imágenes en GitHub (D-076).** Publicar la imagen en GitHub Container Registry desde Azure Pipelines necesita una credencial de GitHub con permiso de escritura de paquetes. Si se hace desde GitHub Actions, la credencial federada de Azure también se amarra al repositorio (ver AC-5). E17 decide cuál [S].
- **Los conjuntos congelados de la prueba (E11-PDC-CP) vivían en el repositorio privado.** La regresión de E18 (ADR-005) corre en un pipeline que clona el repositorio público. **Decidido (D-083):** se publican en el monorepo sin modificar, con su SHA-256 verificado en el pipeline.
- **Los originales de los ADR viven en el repositorio privado.** La copia pública está en `docs/adr/` (D-036). Hay que revisar el historial antes de publicar.
- **Terraform u OpenTofu** (pendiente de D-026) sigue abierto. AF-1 ya orienta: Terraform pasó a la licencia BUSL (no libre) y OpenTofu usa MPL 2.0 [F, `github.com/hashicorp/terraform` y `github.com/opentofu/opentofu`, archivo `LICENSE`, 2026-10-19]. No se decide aquí.

## 6. Sensibilidad (E11-CYR 2.3)

| Caso | Puntaje de A | Segundo (C) | ¿Cambia el orden? |
|---|---|---|---|
| Base | 3,80 | 3,25 | — |
| AC-1 del ganador baja un punto | 3,60 | 3,25 | No |
| AC-2 del ganador baja un punto | 3,60 | 3,25 | No |
| Ambos bajan un punto | 3,40 | 3,25 | No |

**Robusto.** El ganador mantiene la ventaja aun con los dos criterios de mayor peso en contra. AC-1 y AC-2 puntúan igual en las tres alternativas, así que la decisión la mueven AC-3, AC-4, AC-5 y AC-7.

## 7. Requisitos que sostiene y preguntas para el dueño

- **Sostiene:** RE-007 (licencia), RNF-022 (coherencia entre web y Android), RNF-006 (la regresión corre junto al código), RNF-021 (sin costo extra).
- **Pregunta 1. Decidido (D-083):** los conjuntos congelados (prueba y confirmación) se publican en el monorepo **sin modificar**, y el pipeline de la regresión de E18 verifica su SHA-256 antes de medir (D-075).
- **Pregunta 2.** ¿Se confirma la estructura de carpetas o prefiere otros nombres?

## Fuentes

D-008, D-014, D-021, D-036, D-049; E11-CYR v1.1 §2; E11-PDC-D §3; E14-SDD §3.1; documento interno de configuración de Azure (§1, §4 y §5); documentación de Azure Pipelines (`trigger`, `paths`), consultada el 2026-10-19.
