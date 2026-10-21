# reglas/

Archivo de reglas de interpretación (`reglas.json`) y pruebas de consistencia entre motores (ADR-005). El motor vive en `api/`.

- `conjuntos/`: conjuntos de prueba congelados, sin modificar, con `SHA256SUMS`. El pipeline verifica el SHA-256 antes de medir (ADR-001).
- Regla: un conjunto congelado no se edita; un cambio crea una versión nueva con su propio hash.

Aún no hay reglas.
