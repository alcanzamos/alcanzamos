# .azure-pipelines/

Definiciones de pipelines de Azure Pipelines, uno por carpeta del monorepo, con filtros de ruta (`api/**`, `web/**`, `movil/**`, `reglas/**`, `infra/**`) según ADR-001.

- Cada pipeline compila y prueba su carpeta; el de `reglas/` verifica además el SHA-256 de los conjuntos congelados.
- Reglas: estándar de codificación (E17-ECO), `commitlint` valida el título del PR (Conventional Commits) y `main` exige PR y verificaciones.
- Una prueba comprueba que cada carpeta dispara solo su pipeline.

Aún no hay pipelines.
