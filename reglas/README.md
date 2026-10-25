# reglas/

Reglas de interpretación (`reglas.json`) y pruebas de consistencia entre motores (ADR-005). El motor vivirá en `api/`.

- `conjuntos/`: conjuntos de prueba congelados, sin modificar, con `SHA256SUMS`. El pipeline verifica el SHA-256 antes de medir (ADR-001).
- Regla: un conjunto congelado no se edita; un cambio crea una versión nueva con su propio hash.

Por ahora esta carpeta solo tiene los dos conjuntos congelados (`conjunto-de-prueba.jsonl` y `conjunto-de-confirmacion.jsonl`). Todavía no existen `reglas.json` ni el motor de reglas: `api/src/` no tiene ningún paquete para ellos.
