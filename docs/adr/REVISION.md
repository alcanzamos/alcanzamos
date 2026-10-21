# Revisión de la copia pública de los ADR

Lista, por archivo, de cada cambio respecto del original. Los números de línea son los del original. No se cambiaron decisiones, alternativas, criterios ni puntajes.

**Se conservaron a propósito** (no son rutas ni datos internos): los identificadores de trazabilidad (`D-nnn`, `E11-xxx`, `RF-nnn`, etc.), explicados en la nota de cada archivo; el nombre del autor en la tabla de cada ADR; la mención de la oferta «Azure for Students» y de la región `mexicocentral`; las direcciones de fuentes externas públicas. El dueño decide si quiere quitar alguno.


## ADR-001-estructura-de-repositorios.md

| Línea | Quitado o cambiado | Reemplazo |
|---|---|---|
| 7 | Fila de la tabla de control: `\| Etapa \| E11 del Método ADSO (`ETAPA-11-arquitectura-del-software`) \|` | (eliminada) |
| 8 | Fila de la tabla de control: `\| Historia \| US-26 \|` | (eliminada) |
| 26 | `van en `alcanzamos/adso`, privado.` | van en un repositorio privado del proyecto. |
| 68 | `[P, azure-setup §1 y §5]` | [P, documento interno de configuración de Azure] |
| 72 | `[P, azure-setup §4]` | [P, documento interno de configuración de Azure] |
| 79 | ``alcanzamos/adso` sigue privado y aparte (D-036).` | El repositorio privado del proyecto sigue aparte (D-036). |
| 114 | `**Los conjuntos congelados de la prueba (E11-PDC-CP) viven hoy en `adso`, que es privado.**` | **Los conjuntos congelados de la prueba (E11-PDC-CP) vivían en el repositorio privado.** |
| 115 | `**Los ADR en esta carpeta son del repositorio privado.** La copia pública va en `docs/adr/` cuando exista el repositorio (D-036).` | **Los originales de los ADR viven en el repositorio privado.** La copia pública está en `docs/adr/` (D-036). |
| 137 | ``docs/cloud/azure-setup.md` §1, §4 y §5` | documento interno de configuración de Azure (§1, §4 y §5) |
| 1-3 | — | Se agrega debajo del título la nota «Copia pública del ADR; el original vive en el repositorio privado del proyecto» y la explicación de los identificadores |

## ADR-002-lenguaje-y-framework-del-api.md

| Línea | Quitado o cambiado | Reemplazo |
|---|---|---|
| 7 | Fila de la tabla de control: `\| Etapa \| E11 del Método ADSO (`ETAPA-11-arquitectura-del-software`) \|` | (eliminada) |
| 8 | Fila de la tabla de control: `\| Historia \| US-26 \|` | (eliminada) |
| 243 | `Hay que portar `motor.py` (274 líneas)` | Hay que portar el motor del prototipo en Python (274 líneas) |
| 1-3 | — | Se agrega debajo del título la nota «Copia pública del ADR; el original vive en el repositorio privado del proyecto» y la explicación de los identificadores |

## ADR-003-marco-movil.md

| Línea | Quitado o cambiado | Reemplazo |
|---|---|---|
| 7 | Fila de la tabla de control: `\| Etapa \| E11 del Método ADSO (`ETAPA-11-arquitectura-del-software`) \|` | (eliminada) |
| 8 | Fila de la tabla de control: `\| Historia \| US-26 \|` | (eliminada) |
| 248 | `[P, azure-setup §5]` | [P, documento interno de configuración de Azure] |
| 274 | `[P, azure-setup §5]` | [P, documento interno de configuración de Azure] |
| 328 | `(formato W3C que ya produce `e14-tokens.py`)` | (formato W3C que ya produce el generador de tokens del proyecto) |
| 1-3 | — | Se agrega debajo del título la nota «Copia pública del ADR; el original vive en el repositorio privado del proyecto» y la explicación de los identificadores |

## ADR-004-frontend-web.md

| Línea | Quitado o cambiado | Reemplazo |
|---|---|---|
| 7 | Fila de la tabla de control: `\| Etapa \| E11 del Método ADSO (`ETAPA-11-arquitectura-del-software`) \|` | (eliminada) |
| 8 | Fila de la tabla de control: `\| Historia \| US-26 \|` | (eliminada) |
| 149 | `[P, `tokens/alcanzamos.tokens.json`]` | [P, archivo de tokens de diseño del proyecto] |
| 196 | `E14-SDD §3.2, §8.3 y `tokens/alcanzamos.tokens.json`` | E14-SDD §3.2 y §8.3 y el archivo de tokens de diseño del proyecto |
| 1-3 | — | Se agrega debajo del título la nota «Copia pública del ADR; el original vive en el repositorio privado del proyecto» y la explicación de los identificadores |

## ADR-005-donde-viven-las-reglas.md

| Línea | Quitado o cambiado | Reemplazo |
|---|---|---|
| 7 | Fila de la tabla de control: `\| Etapa \| E11 del Método ADSO (`ETAPA-11-arquitectura-del-software`) \|` | (eliminada) |
| 8 | Fila de la tabla de control: `\| Historia \| US-26 \|` | (eliminada) |
| 28 | `(`motor.py`, 274 líneas, solo biblioteca estándar)` | (del prototipo en Python, 274 líneas, solo biblioteca estándar) |
| 114 | `(`test_portabilidad.py`)` | (del prototipo) |
| 126 | `prototipo de Python (`motor.py`)` | prototipo de Python |
| 143 | `**Portar `motor.py` a Go**` | **Portar el motor del prototipo a Go** |
| 145 | `[M, `motor.py`]` | [M, prototipo en Python] |
| 168 | `medición de líneas sobre `prueba-de-concepto/opcion-d/`` | medición de líneas sobre el prototipo de la opción D |
| 1-3 | — | Se agrega debajo del título la nota «Copia pública del ADR; el original vive en el repositorio privado del proyecto» y la explicación de los identificadores |

## ADR-006-region-y-costo.md

| Línea | Quitado o cambiado | Reemplazo |
|---|---|---|
| 7 | Fila de la tabla de control: `\| Etapa \| E11 del Método ADSO (`ETAPA-11-arquitectura-del-software`) \|` | (eliminada) |
| 8 | Fila de la tabla de control: `\| Historia \| US-26 \|` | (eliminada) |
| 90 | `**E11-TDE** (`03-transmision-de-datos.md`, 2026-10-19)` | **E11-TDE** (estudio de transmisión de datos, 2026-10-19) |
| 188 | ``docs/cloud/azure-setup.md` §2` | documento interno de configuración de Azure (§2) |
| 244 | `[P, azure-setup §4]` | [P, documento interno de configuración de Azure] |
| 244 | `borrar los de la prueba R-9` | borrar los de la prueba de región |
| 244 | `El grupo de la prueba (`rg-alcanzamos-prueba-r9`) ya está` | El grupo de recursos de la prueba ya está |
| 262 | ``docs/cloud/azure-setup.md` §2 a §4` | documento interno de configuración de Azure (§2 a §4) |
| 1-3 | — | Se agrega debajo del título la nota «Copia pública del ADR; el original vive en el repositorio privado del proyecto» y la explicación de los identificadores |

## README.md

| Línea | Quitado o cambiado | Reemplazo |
|---|---|---|
| 7 | Fila de la tabla de control: `\| Etapa \| E11 del Método ADSO (`ETAPA-11-arquitectura-del-software`) \|` | (eliminada) |
| 8 | Fila de la tabla de control: `\| Historia \| US-26 \|` | (eliminada) |
| 84 | `Estos archivos viven en el repositorio privado `adso`. Cuando exista el repositorio público, la copia irá en `docs/adr/` (ADR-001, sección 5).` | Los originales viven en un repositorio privado del proyecto; esta carpeta es la copia pública (ADR-001, sección 5). |
| 1-3 | — | Se agrega debajo del título la nota «Copia pública del ADR; el original vive en el repositorio privado del proyecto» y la explicación de los identificadores |

Total de cambios registrados: 47.
