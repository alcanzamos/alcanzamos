# .azure-pipelines/

Definiciones de pipelines de Azure Pipelines, uno por carpeta del monorepo, con filtros de ruta (`api/**`, `web/**`, `movil/**`, `reglas/**`, `infra/**`) según ADR-001.

- Cada pipeline compila y prueba su carpeta; el de `reglas/` verifica además el SHA-256 de los conjuntos congelados.
- Reglas: estándar de codificación (E17-ECO), `commitlint` valida el título del PR (Conventional Commits) y `main` exige PR y verificaciones.
- Una prueba comprueba que cada carpeta dispara solo su pipeline.

## Pipelines

| Archivo | Corre con | Qué hace |
|---|---|---|
| `comun.yml` | Todo PR hacia `main` y cada push a `main` | `gitleaks` sobre el historial; `commitlint` sobre el título del PR; prueba de los filtros por carpeta (`pruebas/filtros.py`) |
| `reglas.yml` | Cambios en `reglas/` o en su YAML | Verifica los conjuntos congelados contra `SHA256SUMS` y contra los SHA-256 fijados en el pipeline |
| `api.yml` | Cambios en `api/` o en su YAML | Instala Go 1.27.3 desde el tarball oficial con SHA-256 verificado; `gofmt`, `go vet`, `go test -race`, `go build` y `docker build` de la imagen. No corre las pruebas de integración |
| `infra.yml` | Cambios en `infra/` o en su YAML | Verifica el SHA-256 de OpenTofu, `tofu fmt -check`, `tofu init -backend=false` y `tofu validate` de `bootstrap/` y `produccion/`, y `docker compose config` del compose local. Nunca hace plan ni apply |

Los pipelines de `web/`, `movil/` y `diseno/` se agregan cuando esas carpetas tengan código, cada uno con sus filtros y sus casos en `pruebas/filtros.py`.

**Cupo:** el plan gratuito de Microsoft-hosted da 1 trabajo a la vez y 1.800 minutos al mes. Los filtros evitan compilar lo que no cambió.

Versiones fijadas (verificadas en sus fuentes oficiales el 2026-10-21): gitleaks v8.30.1 (GitHub releases), `@commitlint/cli` y `@commitlint/config-conventional` 21.2.4 (registro de npm), Node 24.22.1 LTS (nodejs.org), OpenTofu 1.13.2 (GitHub releases, 2026-10-22; SHA-256 del zip fijado en el pipeline, tomado de `tofu_1.13.2_SHA256SUMS`), Go 1.27.3 (go.dev/dl, 2026-10-22; SHA-256 del tarball fijado en el pipeline), imagen `ubuntu-24.04`.
