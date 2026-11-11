# .azure-pipelines/

Definiciones de pipelines de Azure Pipelines, uno por carpeta del monorepo, con filtros de ruta (`api/**`, `web/**`, `movil/**`, `reglas/**`, `infra/**`) según ADR-001.

- Cada pipeline compila y prueba su carpeta; el de `reglas/` verifica además el SHA-256 de los conjuntos congelados.
- Reglas: estándar de codificación (E17-ECO), `commitlint` valida el título del PR (Conventional Commits) y `main` exige PR y verificaciones.
- Una prueba comprueba que cada carpeta dispara solo su pipeline.
- **Control único (D-177, D-178 (4)):** `control.yml` corre en todo PR, sin filtros de ruta, ejecuta los trabajos de las carpetas que cambiaron y falla si alguno falla. Cuando el dueño lo haga obligatorio, reemplaza a los seis pipelines por carpeta (ver «Control único» abajo).
- Los pasos de cada pipeline viven una sola vez, en `plantillas/<carpeta>.yml`: los usan el pipeline por carpeta y la etapa de `control.yml`.

## Pipelines

| Archivo | Corre con | Qué hace |
|---|---|---|
| `control.yml` | Todo PR hacia `main` que no sea borrador (sin filtros de ruta) | Etapa `cambios` (lista los archivos del PR con `pruebas/cambios.py`), etapa `comun` siempre, una etapa por carpeta (`reglas`, `api`, `web`, `movil`, `infra`) solo si cambió su carpeta, y etapa final `control` que falla si alguna falló o se canceló. Cada etapa usa la misma plantilla que su pipeline por carpeta |
| `comun.yml` | Todo PR hacia `main` que no sea borrador | `gitleaks` (imagen fijada por digest) sobre el historial; `commitlint` (instalado con `commitlint/package.json`, su lockfile y su `.npmrc`) sobre el título del PR; prueba de los filtros por carpeta y del control único (`pruebas/filtros.py`) |
| `reglas.yml` | Cambios en `reglas/` o en su YAML, en un PR hacia `main` que no sea borrador | Verifica los conjuntos congelados, `reglas.json` y la salida congelada del prototipo contra `SHA256SUMS` y contra los SHA-256 fijados en el pipeline, y que la copia de `reglas.json` embebida en el API sea idéntica (`cmp`) |
| `api.yml` | Cambios en `api/`, `web/`, `diseno/` o su YAML, en un PR hacia `main` que no sea borrador | Instala Go 1.27.3 desde el tarball oficial con SHA-256 verificado; `gofmt`, `go vet`, `golangci-lint` (`go tool golangci-lint run`, ver abajo), `govulncheck` (`go tool govulncheck ./...`, ver abajo), `go test -race`, **barrera de cobertura** (levanta `postgres:18.6-alpine` fijado por digest en Docker, aplica `migrar`, corre las pruebas de integración con `-coverpkg=./src/...` y `pruebas/cobertura.py` falla si «núcleo y seguridad» queda bajo 90 %, «resto del API» bajo 75 %, cualquiera bajo `api/test/cobertura-base.json` o si un paquete de `api/src/` no está en las dos listas explícitas de E17-ECO 5.5), `go build` y `docker build` de la imagen, con la raíz del monorepo como contexto (`docker build -f api/Dockerfile .`): una etapa de Node compila `web/` y la de Go la embebe |
| `web.yml` | Cambios en `web/`, `diseno/` (tokens, textos y fuentes) o su YAML, en un PR hacia `main` que no sea borrador | Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado y npm 12.2.1 desde el tarball del registro con SHA-512 verificado; `npm run antiguedad` (antigüedad mínima de las versiones del lockfile, antes de instalar, D-158), `npm ci` (con `web/.npmrc`), `npm audit signatures`, tipos, ESLint (con la regla de textos sueltos en JSX, D-162), Prettier, tokens y textos regenerados sin diff (`git diff --exit-code diseno/ web/ movil/`; los textos salen de `diseno/textos/es.json`, D-160), pruebas con cobertura (mínimo 60 % de líneas), `vite build` y Playwright con axe-core |
| `movil.yml` | Cambios en `movil/`, `diseno/` o su YAML, en un PR hacia `main` que no sea borrador | Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado y npm 12.2.1 desde el tarball del registro con SHA-512 verificado; `npm run antiguedad` (antigüedad mínima de las versiones del lockfile, antes de instalar, D-158), `npm ci` (con `movil/.npmrc`), `npm audit signatures`, ESLint (`typescript-eslint`, `react-hooks`, `react-native-a11y`, la regla de solo tokens y la de textos sueltos en JSX, D-162), tipos, tokens y textos regenerados sin diff (`git diff --exit-code -- ../diseno ../web ../movil`; los textos salen de `diseno/textos/es.json`, D-160), pruebas con cobertura (mínimo 50 % de líneas; el resumen final lista el nombre de cada prueba que falla, también con `--silent`, US-59 S6), vulnerabilidades altas o críticas de producción (`npm audit` con las excepciones de `movil/auditoria-excepciones.json`), licencias de producción contra la lista AGPLv3 (excepciones por paquete en `movil/licencias-excepciones.json`) y `npx expo export` para comprobar que `node-forge` no entra en la app. Las excepciones llevan una fecha de revisión (D-150) y el pipeline falla si pasó. No compila el paquete de Android |
| `infra.yml` | Cambios en `infra/` o en su YAML, en un PR hacia `main` que no sea borrador | Verifica el SHA-256 de OpenTofu, `tofu fmt -check`, `tofu init -backend=false` y `tofu validate` de `bootstrap/` y `produccion/`, y `docker compose config` del compose local. Nunca hace plan ni apply |

**commitlint (D-158).** Vive en `.azure-pipelines/commitlint/`: `package.json` (privado, versiones exactas de `@commitlint/cli` y `@commitlint/config-conventional`, `engines` de Node y npm, `allowScripts` vacío porque ninguna dependencia tiene scripts de instalación), `package-lock.json`, `.npmrc` (las mismas reglas que `web/.npmrc`), `antiguedad-excepciones.json` (`[]`, sin excepciones) y `commitlint.config.mjs` (las reglas de siempre: tipos en inglés, ámbito = carpeta, encabezado de hasta 150 caracteres). En un PR, `comun.yml` hace en orden: instala Node 24.22.1 desde el tarball con SHA-256 (`NODE_SHA256`) y npm 12.2.1 con SHA-512 (igual que `web.yml`); `node web/scripts/antiguedad.mjs .azure-pipelines/commitlint` (el script de `web/` con la carpeta como argumento: sin argumento revisa `web/`; es un paso hacia la unificación pendiente, D-160); `npm ci`; `npm audit signatures`; y `node_modules/.bin/commitlint` sobre el título del PR. Antes corría con `npx --yes` y `UseNode@1`, fuera de cualquier `.npmrc` y sin lockfile.

`comun` no filtra por ruta (corre con cualquier cambio), así que un cambio en `web/scripts/antiguedad.mjs` o `antiguedad-logica.mjs` (que `comun` usa para commitlint, S11 de D-161) desde un PR de web también lo corre. Esos casos están en `pruebas/filtros.py` y protegen S11: si alguien le agrega `paths` a `comun` sin esas rutas, fallan.

Para subir commitlint: en esa carpeta, `npm install --save-exact @commitlint/cli @commitlint/config-conventional` con npm 12.2.1 (el `.npmrc` hace que npm elija solo versiones de 7 días o más), y revisar el diff del lockfile. Sin `min-release-age-exclude` ni excepciones de antigüedad.

`gitleaks` corre con la imagen `GITLEAKS_IMAGEN` (`ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0…`, digest del índice multiarquitectura resuelto el 2026-10-24): cambiar la etiqueta obliga a cambiar el digest. Lee `.gitleaks.toml` (raíz): mantiene todas las reglas por defecto y solo exceptúa la dirección del API falso de las pruebas de `movil/` (`api.prueba:18090/api/v1/…`), que confundía con una clave. `comun` revisa todo el historial que trae (`fetchDepth: 0`), también el de otras ramas subidas.

`govulncheck` (v1.9.0, 2026-10-11) está fijado como `tool` en `api/go.mod`, con las sumas de sus módulos en `api/go.sum`: no se instala nada aparte, no entra en el binario del API y no está en `api/src/`. Con la salida por defecto el paso falla (código 3) solo si el código llama a un símbolo vulnerable; una vulnerabilidad solo de módulo se informa y no falla. Hoy hay una: `GO-2026-5932` (`golang.org/x/crypto/openpgp`, sin corrección); el API solo importa `x/crypto/argon2` y no usa `openpgp`, así que no lo afecta. Se revisa cuando salga una corrección. Subir `govulncheck` es `go get -tool golang.org/x/vuln/cmd/govulncheck@<versión>` en `api/`, con los 7 días de antigüedad (D-158) también para los módulos que arrastra.

El pipeline de `diseno/` se agrega cuando haga falta, con sus filtros y sus casos en `pruebas/filtros.py`. Un cambio en `diseno/` (también en `diseno/textos/`, la fuente única de los textos, D-160) dispara el de `web/` y el de `movil/`, que construyen con sus tokens, textos y fuentes, y el de `api/`, porque la imagen del API embebe la web. Un cambio en `web/` dispara también el de `api/`.

**Cupo:** el plan gratuito de Microsoft-hosted da 1 trabajo a la vez y 1.800 minutos al mes. Los filtros (y en `control.yml`, las condiciones de cada etapa) evitan compilar lo que no cambió.

## Control único (D-177)

`control.yml` es el pipeline que el dueño deja como **único check obligatorio** de `main`. No tiene `paths`: corre en todo PR que no sea borrador, así ningún PR queda esperando un pipeline que no se disparó y ninguno entra sin las verificaciones de lo que cambia.

| Etapa | Corre | Qué hace |
|---|---|---|
| `cambios` | Siempre | Sobre el commit de fusión del PR (`refs/pull/<n>/merge`, `fetchDepth: 2`) corre `git diff --name-only --no-renames -z HEAD^1 HEAD`: el primer padre es la punta de `main`, así que la diferencia es lo que el PR cambia. `pruebas/cambios.py detectar` fija una variable de salida `true` o `false` por carpeta. Sin commit de fusión (una corrida manual) corren todas las etapas |
| `comun` | Siempre (`dependsOn: []`) | `plantillas/comun.yml` |
| `reglas`, `api`, `web`, `movil`, `infra` | Solo si cambió su carpeta: `and(succeeded(), eq(dependencies.cambios.outputs['cambios.detectar.<carpeta>'], 'true'))` | `plantillas/<carpeta>.yml`, los mismos pasos que su pipeline por carpeta |
| `control` | Solo si todas las etapas quedaron bien: `cambios` y `comun` en `Succeeded` o `SucceededWithIssues`, y las de carpeta en esos dos o en `Skipped` (`in(dependencies.<etapa>.result, …)` en la condición de la etapa) | Un trabajo que solo confirma. Una etapa que se saltó porque su carpeta no cambió cuenta como correcta |

**Por qué así (corridas 671 del #104 y 680 del #100).** Una variable de etapa con `$[ dependencies.<etapa>.result ]` quedó vacía en Azure y la etapa final falló con «sin resultado» aunque todas las etapas estaban en verde. La forma que documenta Microsoft es leer el resultado en la **condición** de la etapa: «Stage B runs if the result of Stage A is `Succeeded`, `SucceededWithIssues`, or `Skipped`» ([Expressions, Dependencies](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#dependencies)). Por eso la etapa final lee los resultados en su condición, en lugar de un script que lea variables. Hubo además una etapa `control_rechazo`, con la condición contraria, que fallaba si algo salía mal. Se quitó porque, cuando se saltaba, Azure Pipelines dejaba su check en GitHub «in progress» para siempre (#100, corrida 680), y porque no hacía falta: el check obligatorio `control` es el de la corrida entera, y una etapa que falla o se cancela ya lo deja en rojo. Prueba en una corrida real ([corrida 681](https://dev.azure.com/alcanzamos/alcanzamos/_build/results?buildId=681), #111): con la etapa `comun` fallando a propósito, la corrida terminó en Failed, `control` se saltó, el check obligatorio `control` quedó en rojo y GitHub bloqueó la fusión (`BLOCKED`).

**Mapa de carpetas.** `pruebas/cambios.py` (`CARPETAS`) tiene, para cada etapa, las mismas rutas que los `paths.include` de su pipeline por carpeta, con las mismas reglas (`carpeta/*` cubre todo lo de debajo; una ruta sin comodín, ese archivo). Cambiar `control.yml`, `pruebas/cambios.py` o `pruebas/filtros.py` solo corre `comun`, que corre la prueba.

**Qué comprueba `pruebas/filtros.py` del control único:** que `control.yml` tenga `trigger: none`, `pr.drafts: false`, `main` en `pr.branches` y **ningún** `paths`; que tenga exactamente las etapas `cambios`, `comun`, las de `CARPETAS`, `control` y `control_rechazo`; que cada etapa por carpeta tenga su condición de cambio, `dependsOn: cambios` y su plantilla; que `comun` corra siempre con su plantilla; que `control` dependa de todas y corra solo si todas quedaron bien, que no haya otra etapa final (como `control_rechazo`), y que `control` no use variables de etapa con `dependencies.<etapa>.result`; que el mapa sea igual a los filtros de cada pipeline por carpeta (ninguna carpeta queda sin etapa) y que cada pipeline por carpeta use su plantilla; que cada caso de `ESPERADO` dé las mismas etapas que los pipelines por carpeta; que `cambios.py` lea nombres con «ñ», con salto de línea o con un comando `##vso` sin que un nombre de archivo apague una etapa; y que la revisión rechace catorce cambios rotos de `control.yml` (`MUTACIONES`).

**Minutos.** `control.yml` corre los mismos trabajos que los pipelines por carpeta que hoy se disparan, más dos trabajos chicos: `cambios` (checkout de 2 commits y un script) y `control` (sin checkout). Con 1 trabajo a la vez las etapas corren una tras otra, igual que hoy los pipelines. Estimación antes de medir: unos 20 a 35 s más por PR (un PR solo de documentos: `comun`, unos 35 s, pasa a 1 min aprox.; uno de `api` y `web`, unos 18 min, casi no cambia). **Método (D-178 (4)):** el PR que agrega `control.yml` cambia los seis YAML y sus plantillas, así que en su única corrida se disparan los seis pipelines por carpeta y todas las etapas de `control`: se suma la duración de los trabajos de la corrida de `control` (Azure DevOps → la corrida → cada trabajo) y se compara con la suma de las seis corridas viejas del mismo commit. La diferencia es el costo del control único por PR.

**Cambio de la protección (lo hace el dueño, en este orden):**

1. Registrar el pipeline en Azure DevOps: Pipelines → New pipeline → GitHub → `alcanzamos/alcanzamos` → «Existing Azure Pipelines YAML file» → rama `ci/control-unico`, ruta `/.azure-pipelines/control.yml` → Save (sin correr). Renombrarlo a `control` (el nombre del check en GitHub). Agregarle la variable secreta `GITHUB_TOKEN_PR` (el mismo token de `comun`, D-167), o `comun` pedirá el título sin token.
2. Marcar listo el PR de este cambio: corre una vez y es el PR de prueba del consumo de minutos (método de arriba). Debe pasar `control` con todas sus etapas.
3. Si pasa y el consumo es el esperado: en GitHub, Settings → Branches → `main`, cambiar la verificación obligatoria de `comun` a `control` (sigue `strict`). Desde ahí un PR sin `control.yml` (que no se puso al día con `main`) no puede fusionarse: se pone al día con `pasar-pr.sh`, como siempre.
4. Fusionar el PR. En el pipeline `control` (Edit → Triggers → YAML → Get sources), la rama por defecto debe quedar `main`, no `ci/control-unico`.
5. Para que cada PR corra una sola vez (D-183), desactivar en Azure DevOps los seis pipelines por carpeta (`comun`, `reglas`, `api`, `web`, `movil`, `infra`: Settings → «Disabled»). Desde ahí solo corre `control`.
6. En un PR siguiente: borrar los seis YAML por carpeta, dejar el mapa solo en `pruebas/cambios.py` (con sus casos en `pruebas/filtros.py`) y eliminar las definiciones desactivadas en Azure DevOps.

Mientras el dueño no haga los pasos 3 y 5 rige D-118: el check obligatorio es `comun` y los demás se miran antes de fusionar.

Versiones fijadas (verificadas en sus fuentes oficiales el 2026-10-21): gitleaks v8.30.1 (imagen del 2026-03-21; digest del índice multiarquitectura `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`, resuelto en ghcr.io el 2026-10-24), `@commitlint/cli` y `@commitlint/config-conventional` 21.2.3 (la versión más nueva con 7 días o más que resolvió npm el 2026-10-24; la 21.2.4 es del 2026-10-18), Node 24.22.1 LTS (nodejs.org), npm 12.2.1 (registro de npm, 2026-10-24; SHA-512 del tarball fijado en `web.yml`, `movil.yml`, `comun.yml` y `api/Dockerfile`; reglas de instalación en `web/.npmrc`, `movil/.npmrc` y `commitlint/.npmrc`), OpenTofu 1.13.2 (GitHub releases, 2026-10-22; SHA-256 del zip fijado en el pipeline, tomado de `tofu_1.13.2_SHA256SUMS`), Go 1.27.3 (go.dev/dl, 2026-10-22; SHA-256 del tarball fijado en el pipeline), Node 24.22.1 para `web.yml` y `comun.yml` (nodejs.org, `SHASUMS256.txt`, 2026-10-22; SHA-256 del tarball fijado en el pipeline; las dependencias de `web/` están en su README), imagen `ubuntu-24.04`.

## Cuándo corren: una sola vez por PR (D-183)

Cada corrida gasta minutos del cupo gratuito (1.800 por mes, D-116). Para que cada PR corra **una sola vez**:

- **Ningún pipeline corre al fusionar en `main`** (`trigger: none`). `main` exige la rama al día (`strict`) y se fusiona con squash: el contenido de `main` queda igual a lo que ya se probó en el PR. Cuando haya despliegue (I08 o I09), el disparador vuelve solo para lo que despliega.
- **Un PR borrador no corre** (`pr.drafts: false`). Los PR se abren como borrador y se revisan igual.
- **Orden de trabajo:**
  1. Se fusiona un PR.
  2. El siguiente se pone al día con `main` mientras sigue siendo borrador, con `~/.cache/alc/pasar-pr.sh`, así que no corre.
  3. Se marca «listo para revisar» y corre una vez.
  4. Se fusiona.
- **Los PR encadenados** (con base en otra rama) no corren hasta que su base es `main`.
- **Cambios chicos del mismo componente** van juntos en un PR, bajo el tope de unas 600 líneas.

`pruebas/filtros.py` comprueba que cada pipeline tenga `trigger: none` y `pr.drafts: false`, también `control.yml`.

Ojo: hasta que el dueño cambie la protección (sección «Control único»), el único check obligatorio para fusionar es `comun`. Los de `api`, `web`, `movil`, `infra` y `reglas` hay que mirarlos antes de fusionar. Después, el único check obligatorio es `control`, que ya incluye los de las carpetas que cambiaron.

## Token de GitHub de `comun` (D-167)

El paso de commitlint pide el título del PR a la API de GitHub. Sin token, GitHub permite 60 pedidos por hora por IP, y los agentes de Azure comparten IP: a veces responde 403 y `comun` falla sin que el PR tenga la culpa. Por eso el pipeline `comun` (y `control`, que corre la misma plantilla) tiene una **variable secreta `GITHUB_TOKEN_PR`** (Azure DevOps → Pipelines → `comun` → Edit → Variables, «Keep this value secret»).

- **Token:** fine-grained, solo para `alcanzamos/alcanzamos`, permiso «Pull requests: Read-only», vence a los 90 días. Lo crea y lo renueva el dueño. **Creado el 2026-10-27; vence el 2027-01-25: renovarlo antes** (D-167).
- **Cómo se usa:** entra al paso como variable de entorno y va a `curl` por su entrada estándar, nunca en la línea de comandos. Azure lo oculta en los registros.
- **Sin la variable:** el paso pide el título sin token, como antes.
- **Con el token vencido o revocado:** GitHub responde 401 y `comun` falla. Es a propósito: avisa que hay que renovarlo.
