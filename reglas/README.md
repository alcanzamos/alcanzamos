# reglas/

Reglas de interpretación (`reglas.json`) y pruebas de consistencia entre motores (ADR-005). El motor vive en `api/src/interpretacion` (US-62, D-076): un solo motor, en Go.

| Archivo | Qué es |
|---|---|
| `reglas.json` | Las reglas `D-1.0` de la opción D (D-075), copiadas **sin cambios** del prototipo. `SHA256SUMS` y el pipeline fijan su SHA-256. **No se editan**: una versión nueva (`D-1.1`) es otro archivo con su propio hash y se mide con un conjunto nuevo, nunca visto (D-075 (4)) |
| `conjuntos/` | Los dos conjuntos de prueba congelados, sin modificar, con su propio `SHA256SUMS`. El pipeline y las pruebas verifican el SHA-256 antes de medir (ADR-001) |
| `referencia/` | La salida del prototipo de Python (`motor.py`) para cada mensaje de los dos conjuntos: la referencia congelada de IAR-004 |
| `SHA256SUMS` | SHA-256 de `reglas.json` y de la referencia. El pipeline (`.azure-pipelines/reglas.yml`) los comprueba con `sha256sum --check --strict` y contra los valores fijados en el YAML |

Regla: un archivo congelado no se edita; un cambio crea una versión nueva con su propio hash.

## De dónde sale `reglas.json`

Es `docs/adso/proyecto/03-diseno/E11-arquitectura/prueba-de-concepto/opcion-d/reglas.json` del repositorio de documentos (adso). Lo hizo el commit `d073baf` (2026-10-19, la medición única de D-075) y sigue idéntico en `origin/main` de adso (`2c18264`, 2026-11-06). SHA-256: `5d130dbc945679c3f8ad52f17c8cdabda89fb64f074fb6abde637d0ec5f3153c`.

**Hay una segunda copia, idéntica byte a byte, en `api/src/interpretacion/reglas.json`.** Go no puede embeber (`go:embed`) archivos de fuera de su módulo (`api/`) y la imagen del API solo copia `api/`, así que el motor lleva su copia. Que sean idénticas lo comprueban `TestLasReglasSonLasDeD10YLaCopiaEmbebidaEsIdentica` (API) y el paso `cmp` de `reglas.yml`. Para cambiar de versión de reglas hay que cambiar las dos y el hash.

## La referencia de IAR-004

`referencia/referencia-prueba.jsonl` (245 mensajes) y `referencia/referencia-confirmacion.jsonl` (100) tienen una línea por mensaje, en el mismo orden que su conjunto: `id`, `fecha_referencia`, `version_reglas`, `monto` (en **pesos**, como el prototipo; el motor en Go da centavos), `tipo`, `fecha`, `categoria` e `intencion`. No llevan el texto de los mensajes, solo el `id`. La fecha de referencia es la de `medir.py` para todos: **2026-11-02**.

| Archivo | SHA-256 |
|---|---|
| `referencia/referencia-prueba.jsonl` | `f54b9b3c6f409212ba909f0ee3f5579de9f5ea69638197d64ae34cf76e7c1574` |
| `referencia/referencia-confirmacion.jsonl` | `d58f1b0a3456f1c7243a24f1d879320e25f997bd3091edc90712835ef0631368` |

Se generaron con `motor.py` y `reglas.json` de adso en `origin/main` (`2c18264`; `motor.py` y `reglas.json` son los de `d073baf`), sin el prototipo en el pipeline. Para regenerarlos, con `ADSO` apuntando a un árbol de adso en esa revisión (por ejemplo `git -C <adso> archive origin/main docs/adso/proyecto/03-diseno/E11-arquitectura/prueba-de-concepto | tar -x -C <carpeta vacía>`), desde la raíz del monorepo:

```sh
python3 -I -B reglas/referencia/generar.py "$ADSO/docs/adso/proyecto/03-diseno/E11-arquitectura/prueba-de-concepto/opcion-d" reglas/conjuntos reglas/referencia
(cd reglas && sha256sum reglas.json referencia/*.jsonl > SHA256SUMS)   # el resultado no debe cambiar
```

`generar.py` verifica el SHA-256 de cada conjunto antes de leer un mensaje (sale con código 2 si difiere). El resultado es determinista: regenerar da los mismos bytes.

## Cómo se usa

- **IAR-004** (`api/test/interpretacion`, `TestIAR004…`): el motor en Go da la misma salida que la referencia, mensaje por mensaje y campo por campo (monto, tipo, fecha, categoría e intención), en los 345 mensajes. La prueba verifica antes el SHA-256 de cada conjunto y falla si difiere.
- **IAR-001** (`TestIAR001…`): la exactitud sobre el código real, calculada como `medir.py`, contra RNF-006 (≥ 90 % en monto, tipo y fecha; ≥ 80 % en categoría). Imprime los porcentajes (`go test -v`).
- Ninguno de los dos conjuntos sirve para medir una versión nueva de las reglas: ya se vieron sus fallos (D-075 (4)).
