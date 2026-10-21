# Registros de decisión arquitectónica (ADR) de Alcanzamos

> **Copia pública del ADR; el original vive en el repositorio privado del proyecto.** Los identificadores `D-nnn` (decisiones), `E11-xxx`, `E14-xxx`, `ERS`, `RF/RNF/RN/RE/RT-nnn`, `O-n`, `P-nn`, `NM-nn` y `US-nn` remiten al registro de decisiones y a documentos de ese repositorio; se conservan como trazabilidad y no tienen enlace.

| Campo | Valor |
|---|---|
| Documento | Índice y método de los ADR · Código: E11-ADR |
| Proyecto | Alcanzamos |
| Estado | **Cerrado (D-083).** Los seis ADR están decididos por el dueño (D-076, D-078 a D-083) |
| Versión | 0.3 |
| Autor | Andrés Jiménez |
| Uso de IA | El asistente redactó las propuestas, aplicó los criterios aprobados y consultó las fuentes; el dueño revisa, decide y aprueba (D-051). |

## Control de versiones

| Versión | Fecha | Descripción del cambio | Autor |
|---|---|---|---|
| 0.1 | 2026-10-19 | Borrador: método común, índice y seis ADR en el orden de S3 | Andrés Jiménez |
| 0.2 | 2026-10-19 | D-076: API en Go, web en React, motor de reglas en el API en Go, monolito modular (modifica D-026), imágenes en GitHub. Índice con estados. AC-1 se vuelve a leer con el costo nuevo (USD 70,6 en el escenario base): los ADR 001, 002, 004 y 005 pasan de 3 a 4 en AC-1 | Andrés Jiménez |
| 0.3 | 2026-10-21 | D-105: nota con fecha en la sección 2; la lectura de la escala de AC-1 se declaró después de decidir los ADR | Andrés Jiménez |

## 1. Qué hay aquí

Un archivo por decisión, en el orden que pidió el dueño (S3). Cada uno trae contexto, alternativas, criterios aplicados con su evidencia, decisión, consecuencias y sensibilidad.

**Ninguna decisión es del asistente.** Un ADR pasa de «Propuesto» a «Aceptado» solo cuando el dueño lo decide y lo registra en el registro de decisiones. **D-076** (2026-10-19) registra lo que el dueño decidió sobre ADR-002, ADR-004, ADR-005 y el estilo; en esos ADR, lo que sigue propuesto (librerías, herramientas) se dice en cada uno.

| ADR | Estado | Decisión | Puntaje | Segundo | Lo decide la regla |
|---|---|---|---|---|---|
| [001](ADR-001-estructura-de-repositorios.md) | **Aprobado por el dueño (D-079)** | Monorepo del código | 3,80 | 3,25 | Sí (diferencia de 0,55) |
| [002](ADR-002-lenguaje-y-framework-del-api.md) | **Decidido por el dueño (D-076, D-081)**: Go con biblioteca estándar, Argon2id y sesiones opacas propias | Go con `net/http`, frente a chi | 3,85 | 3,70 (chi) | **No**: diferencia de 0,15 y AC-1 empata. Reversible |
| [003](ADR-003-marco-movil.md) | **Decidido por el dueño (D-078): React Native con Expo** | React Native con Expo | 3,55 | 3,45 (Flutter) | No (diferencia de 0,10; no es robusto) |
| [004](ADR-004-frontend-web.md) | **Decidido por el dueño (D-076, D-083)** | Vite + React + TypeScript, servido desde el API | 3,35 | 3,25 (Vite + React + JavaScript) | **No** entre T1 y T3 (0,10 y AC-1 empata); T2 queda atrás por regla |
| [005](ADR-005-donde-viven-las-reglas.md) | **Decidido por el dueño (D-076): B** | Un solo motor de reglas, en el API (Go) | 4,25 | 3,90 (en los clientes) | Sí (diferencia de 0,35), pero no es robusta |
| [006](ADR-006-region-y-costo.md) | **Aprobado por el dueño (D-080)** | México Central (`mexicocentral`); costo base USD 70,6 en 3 meses | 100 | 87,3 (Francia Central) | Sí (regla de D-071) |

**Dependencias entre ADR.** ADR-005 condiciona a ADR-002, ADR-003 y ADR-004: con las reglas en el API, la app y la web no llevan motor. ADR-002 y ADR-004 dependen de ADR-006 por el costo, y ADR-004 comparte con ADR-003 (decidido, D-078: React Native con Expo) las herramientas de tokens y el lenguaje. ADR-001 recoge los cambios de D-076 (carpetas `api/` en Go y `web/` en React). El costo que usan todos los ADR sale de ADR-006.

## 2. Método común

Se aplican los criterios aprobados de E11-CYR v1.1, sin cambiarlos.

**Filtros.** AF-1 a AF-5 (E11-CYR 2.1). Una alternativa que no cumpla un filtro no se puntúa. En cada ADR se dice qué filtros pueden descartar algo y cuáles no discriminan.

**Pesos.** AC-1 costo 20 %, AC-2 privacidad 20 %, AC-3 seguridad 15 %, AC-4 portabilidad 15 %, AC-5 capacidad de una persona 15 %, AC-6 exactitud 5 %, AC-7 capacidad de prueba 5 %, AC-8 uso en el celular 5 % (E11-CYR 2.2).

**Anclas.** 1: no cumple o deja un riesgo alto sin medida. 3: cumple con una medida declarada. 5: cumple por diseño y se puede comprobar. Los puntajes 2 y 4 quedan entre dos anclas.

**AC-1, cómo se leyó el ancla.** E11-CYR dice «5 si deja margen amplio, 1 si supera el crédito». Para que dos ADR no puntúen distinto el mismo costo, se fijó esta lectura antes de puntuar. Se mide el gasto de 3 meses en Azure (el horizonte de E02) contra los USD 100 del crédito:

| Puntaje | Gasto de 3 meses |
|---|---|
| 5 | hasta 60 % del crédito (USD 60) |
| 4 | hasta 75 % (USD 75) |
| 3 | hasta 90 % (USD 90) |
| 2 | hasta 100 % (USD 100) |
| 1 | más de USD 100 |

> **Nota del 2026-10-21 (D-105).** El dueño confirmó esta lectura después de decidir los ADR y la registró como **precisión declarada después de decidir los ADR**: antes solo existían las anclas 1, 3 y 5 de E11-CYR. Sube a todas las alternativas por igual y no cambia ningún orden. La frase «se fijó esta lectura antes de puntuar» se lee con esta nota.

Es una lectura de la escala, no un peso ni un criterio nuevo. Aun así queda a la vista del dueño (E11-CYR 2.3 pide una decisión antes de cambiar criterios). Los tres escenarios de costo están en ADR-006 (versión 0.2, con D-076): bajo USD 61,1, **base USD 70,6** y alto USD 99,7. El escenario base da **4** a toda alternativa que no cambie el costo (en la versión 0.1 daba 3, con USD 82,8). El cambio es parejo y no altera ningún orden.

**Desempate.** Si dos alternativas quedan a menos de 0,25 puntos, gana la de mayor puntaje en AC-1 (E11-CYR 2.3). Cuando AC-1 también empata, la regla no decide y el ADR lo dice. No se inventó un segundo desempate.

**Sensibilidad (E11-CYR 2.3).** Los dos criterios de mayor peso son AC-1 y AC-2. Cada ADR reporta qué pasa si el puntaje **del ganador** baja un punto en AC-1, en AC-2 y en ambos, sin tocar a los demás. «Robusto» quiere decir que el orden no cambia en ningún caso.

**Marcas de evidencia.** En cada puntaje se indica de dónde sale el dato:

| Marca | Significa |
|---|---|
| [P] | Documento del proyecto (ERS, decisiones, estudios) |
| [F] | Fuente externa consultada el 2026-10-19 (se cita la dirección) |
| [M] | Medición o consulta de solo lectura hecha ese día |
| [S] | **Supuesto sin medir.** Se declara para poder revisarlo |

**AC-5 y el dueño.** El dueño respondió el 2026-10-19 (S2, L2 y L4): backend **Java**; móvil **ninguno todavía** (React Native y Flutter son nuevos para él); web «soy más backend, no domino un framework frontend», con HTML, CSS y JS sin framework. Después decidió Go y React (D-076) y dijo que los dos son **nuevos para él** (L4). Con eso, el API en Go y la web en React puntúan AC-5 como lenguajes nuevos. No se supuso nada más. Cuando un ADR necesita saber si el dueño conoce algo que no dijo, lo pregunta.

## 3. Lo que no es un ADR de esta carpeta

Quedan fuera, por decisión de alcance de US-26, y aparecen como pendientes en E11-DAR sección 10: la herramienta de infraestructura como código (D-026), el proveedor de correo, el monitoreo, la versión mínima de Android (RE-006). El estilo de despliegue frente a D-026 ya lo decidió el dueño: monolito modular (D-076).

## 4. Copia pública

D-036 pide que las decisiones que un colaborador necesita conocer se publiquen como ADR en el repositorio público. Los originales viven en un repositorio privado del proyecto; esta carpeta es la copia pública (ADR-001, sección 5).
