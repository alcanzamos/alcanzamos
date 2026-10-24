# .azure-pipelines/

Definiciones de pipelines de Azure Pipelines, uno por carpeta del monorepo, con filtros de ruta (`api/**`, `web/**`, `movil/**`, `reglas/**`, `infra/**`) según ADR-001.

- Cada pipeline compila y prueba su carpeta; el de `reglas/` verifica además el SHA-256 de los conjuntos congelados.
- Reglas: estándar de codificación (E17-ECO), `commitlint` valida el título del PR (Conventional Commits) y `main` exige PR y verificaciones.
- Una prueba comprueba que cada carpeta dispara solo su pipeline.

## Pipelines

| Archivo | Corre con | Qué hace |
|---|---|---|
| `comun.yml` | Todo PR hacia `main` y cada push a `main` | `gitleaks` sobre el historial; `commitlint` sobre el título del PR; prueba de los filtros por carpeta (`pruebas/filtros.py`) |

`gitleaks` lee `.gitleaks.toml` (raíz): mantiene todas las reglas por defecto y solo exceptúa la dirección del API falso de las pruebas de `movil/` (`api.prueba:18090/api/v1/…`), que confundía con una clave. `comun` revisa todo el historial que trae (`fetchDepth: 0`), también el de otras ramas subidas.
| `reglas.yml` | Cambios en `reglas/` o en su YAML | Verifica los conjuntos congelados contra `SHA256SUMS` y contra los SHA-256 fijados en el pipeline |
| `api.yml` | Cambios en `api/`, `web/`, `diseno/` o su YAML | Instala Go 1.27.3 desde el tarball oficial con SHA-256 verificado; `gofmt`, `go vet`, `go test -race`, **barrera de cobertura** (levanta `postgres:18.6-alpine` fijado por digest en Docker, aplica `migrar`, corre las pruebas de integración con `-coverpkg=./src/...` y `pruebas/cobertura.py` falla si «núcleo y seguridad» queda bajo 90 %, «resto del API» bajo 75 %, cualquiera bajo `api/test/cobertura-base.json` o si un paquete de `api/src/` no está en las dos listas explícitas de E17-ECO 5.5), `go build` y `docker build` de la imagen, con la raíz del monorepo como contexto (`docker build -f api/Dockerfile .`): una etapa de Node compila `web/` y la de Go la embebe |
| `web.yml` | Cambios en `web/`, `diseno/` o su YAML | Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado y npm 12.2.1 desde el tarball del registro con SHA-512 verificado; `npm run antiguedad` (antigüedad mínima de las versiones del lockfile, antes de instalar, D-158), `npm ci` (con `web/.npmrc`), `npm audit signatures`, tipos, ESLint, Prettier, tokens regenerados sin diff (`git diff --exit-code diseno/ web/ movil/`), pruebas con cobertura (mínimo 60 % de líneas), `vite build` y Playwright con axe-core |
| `movil.yml` | Cambios en `movil/`, `diseno/` o su YAML | Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado y npm 12.2.1 desde el tarball del registro con SHA-512 verificado; `npm run antiguedad` (antigüedad mínima de las versiones del lockfile, antes de instalar, D-158), `npm ci` (con `movil/.npmrc`), `npm audit signatures`, ESLint (`typescript-eslint`, `react-hooks`, `react-native-a11y` y la regla de solo tokens), tipos, tokens regenerados sin diff (`git diff --exit-code -- ../diseno ../web ../movil`), pruebas con cobertura (mínimo 50 % de líneas), vulnerabilidades altas o críticas de producción (`npm audit` con las excepciones de `movil/auditoria-excepciones.json`), licencias de producción contra la lista AGPLv3 (excepciones por paquete en `movil/licencias-excepciones.json`) y `npx expo export` para comprobar que `node-forge` no entra en la app. Las excepciones llevan una fecha de revisión (D-150) y el pipeline falla si pasó. No compila el paquete de Android |
| `infra.yml` | Cambios en `infra/` o en su YAML | Verifica el SHA-256 de OpenTofu, `tofu fmt -check`, `tofu init -backend=false` y `tofu validate` de `bootstrap/` y `produccion/`, y `docker compose config` del compose local. Nunca hace plan ni apply |

El pipeline de `diseno/` se agrega cuando haga falta, con sus filtros y sus casos en `pruebas/filtros.py`. Un cambio en `diseno/` dispara el de `web/` y el de `movil/`, que construyen con sus tokens y fuentes, y el de `api/`, porque la imagen del API embebe la web. Un cambio en `web/` dispara también el de `api/`.

**Cupo:** el plan gratuito de Microsoft-hosted da 1 trabajo a la vez y 1.800 minutos al mes. Los filtros evitan compilar lo que no cambió.

Versiones fijadas (verificadas en sus fuentes oficiales el 2026-10-21): gitleaks v8.30.1 (GitHub releases), `@commitlint/cli` y `@commitlint/config-conventional` 21.2.4 (registro de npm), Node 24.22.1 LTS (nodejs.org), npm 12.2.1 (registro de npm, 2026-10-24; SHA-512 del tarball fijado en `web.yml`, `movil.yml` y `api/Dockerfile`; reglas de instalación en `web/.npmrc` y `movil/.npmrc`), OpenTofu 1.13.2 (GitHub releases, 2026-10-22; SHA-256 del zip fijado en el pipeline, tomado de `tofu_1.13.2_SHA256SUMS`), Go 1.27.3 (go.dev/dl, 2026-10-22; SHA-256 del tarball fijado en el pipeline), Node 24.22.1 para `web.yml` (nodejs.org, `SHASUMS256.txt`, 2026-10-22; SHA-256 del tarball fijado en el pipeline; las dependencias de `web/` están en su README), imagen `ubuntu-24.04`.
