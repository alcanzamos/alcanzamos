# .azure-pipelines/

Definiciones de pipelines de Azure Pipelines, uno por carpeta del monorepo, con filtros de ruta (`api/**`, `web/**`, `movil/**`, `reglas/**`, `infra/**`) según ADR-001.

- Cada pipeline compila y prueba su carpeta; el de `reglas/` verifica además el SHA-256 de los conjuntos congelados.
- Reglas: estándar de codificación (E17-ECO), `commitlint` valida el título del PR (Conventional Commits) y `main` exige PR y verificaciones.
- Una prueba comprueba que cada carpeta dispara solo su pipeline.
- **Control único (D-177, D-178 (4)):** `control.yml` corre en todo PR, sin filtros de ruta, ejecuta los trabajos de las carpetas que cambiaron y falla si alguno falla. Cuando el dueño lo haga obligatorio, reemplaza a los seis pipelines por carpeta (ver «Control único» abajo).
- Los pasos de cada pipeline viven una sola vez, en `plantillas/<carpeta>.yml`: los usan el pipeline por carpeta y la etapa de `control.yml`. Las instalaciones de Go (`plantillas/pasos/go.yml`) y de Node y npm (`plantillas/pasos/node.yml`) también viven una sola vez: las usan `api`, `web`, `movil` y la revisión diaria.
- **Revisión diaria (S3):** `revision-diaria.yml` corre cada mañana sobre `main`, fuera de los PR: `govulncheck` en `api/` y `npm audit` en `web/` y `movil/`. Si encuentra algo, la corrida queda en rojo o en «Partially succeeded» y al dueño le llega un correo (ver «Revisión diaria» abajo).

## Pipelines

| Archivo | Corre con | Qué hace |
|---|---|---|
| `control.yml` | Todo PR hacia `main` que no sea borrador (sin filtros de ruta) | Etapa `cambios` (lista los archivos del PR con `pruebas/cambios.py`), etapa `comun` siempre, una etapa por carpeta (`reglas`, `api`, `web`, `movil`, `infra`) solo si cambió su carpeta, y etapa final `control` que falla si alguna falló o se canceló. Cada etapa usa la misma plantilla que su pipeline por carpeta |
| `comun.yml` | Todo PR hacia `main` que no sea borrador | `gitleaks` (imagen fijada por digest) sobre el historial; `commitlint` (instalado con `commitlint/package.json`, su lockfile y su `.npmrc`) sobre el título del PR; prueba de los filtros por carpeta y del control único (`pruebas/filtros.py`) |
| `reglas.yml` | Cambios en `reglas/` o en su YAML, en un PR hacia `main` que no sea borrador | Verifica los conjuntos congelados, `reglas.json` y la salida congelada del prototipo contra `SHA256SUMS` y contra los SHA-256 fijados en el pipeline, y que la copia de `reglas.json` embebida en el API sea idéntica (`cmp`) |
| `api.yml` | Cambios en `api/`, `web/`, `diseno/` o su YAML, en un PR hacia `main` que no sea borrador | Instala Go 1.27.3 desde el tarball oficial con SHA-256 verificado; `gofmt`, `go vet`, `golangci-lint` (`go tool golangci-lint run`, ver abajo), `govulncheck` con la regla de los 7 días (`go tool govulncheck -format json ./...` y `pruebas/vulnerabilidades.py`, ver abajo), `go test -race`, **barrera de cobertura** (levanta `postgres:18.6-alpine` fijado por digest en Docker, aplica `migrar`, corre las pruebas de integración con `-coverpkg=./src/...` y `pruebas/cobertura.py` falla si «núcleo y seguridad» queda bajo 90 %, «resto del API» bajo 75 %, cualquiera bajo `api/test/cobertura-base.json` o si un paquete de `api/src/` no está en las dos listas explícitas de E17-ECO 5.5), `go build` y `docker build` de la imagen, con la raíz del monorepo como contexto (`docker build -f api/Dockerfile .`): una etapa de Node compila `web/` y la de Go la embebe |
| `web.yml` | Cambios en `web/`, `diseno/` (tokens, textos y fuentes) o su YAML, en un PR hacia `main` que no sea borrador | Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado y npm 12.2.1 desde el tarball del registro con SHA-512 verificado; `npm run antiguedad` (antigüedad mínima de las versiones del lockfile, antes de instalar, D-158), `npm ci` (con `web/.npmrc`), `npm audit signatures`, tipos, ESLint (con la regla de textos sueltos en JSX, D-162), Prettier, tokens y textos regenerados sin diff (`git diff --exit-code diseno/ web/ movil/`; los textos salen de `diseno/textos/es.json`, D-160), pruebas con cobertura (mínimo 60 % de líneas), `vite build` y Playwright con axe-core |
| `movil.yml` | Cambios en `movil/`, `diseno/` o su YAML, en un PR hacia `main` que no sea borrador | Instala Node 24.22.1 desde el tarball oficial con SHA-256 verificado y npm 12.2.1 desde el tarball del registro con SHA-512 verificado; `npm run antiguedad` (antigüedad mínima de las versiones del lockfile, antes de instalar, D-158), `npm ci` (con `movil/.npmrc`), `npm audit signatures`, ESLint (`typescript-eslint`, `react-hooks`, `react-native-a11y`, la regla de solo tokens y la de textos sueltos en JSX, D-162), tipos, tokens y textos regenerados sin diff (`git diff --exit-code -- ../diseno ../web ../movil`; los textos salen de `diseno/textos/es.json`, D-160), pruebas con cobertura (mínimo 50 % de líneas; el resumen final lista el nombre de cada prueba que falla, también con `--silent`, US-59 S6), vulnerabilidades altas o críticas de producción (`npm audit` con las excepciones de `movil/auditoria-excepciones.json`), licencias de producción contra la lista AGPLv3 (excepciones por paquete en `movil/licencias-excepciones.json`) y `npx expo export` para comprobar que `node-forge` no entra en la app. Las excepciones llevan una fecha de revisión (D-150) y el pipeline falla si pasó. No compila el paquete de Android |
| `infra.yml` | Cambios en `infra/` o en su YAML, en un PR hacia `main` que no sea borrador | Verifica el SHA-256 de OpenTofu, `tofu fmt -check`, `tofu init -backend=false` y `tofu validate` de `bootstrap/` y `produccion/`, y `docker compose config` del compose local. Nunca hace plan ni apply |
| `revision-diaria.yml` | Todos los días a las 10:00 UTC (5:00 a. m. en Colombia) sobre `main`, haya o no cambios (`always: true`). Nunca en un PR ni al fusionar | Tres trabajos: `govulncheck` en `api/` (el mismo Go fijado y el mismo comando que el PR) y `npm run auditoria` en `web/` y en `movil/` (el mismo Node y npm fijados y el mismo comando que el PR, sin `npm ci`: `npm audit` lee el lockfile). Falla con lo mismo que haría fallar un PR; queda en «Partially succeeded» si una revisión solo advierte. Ver «Revisión diaria» |

**commitlint (D-158).** Vive en `.azure-pipelines/commitlint/`: `package.json` (privado, versiones exactas de `@commitlint/cli` y `@commitlint/config-conventional`, `engines` de Node y npm, `allowScripts` vacío porque ninguna dependencia tiene scripts de instalación), `package-lock.json`, `.npmrc` (las mismas reglas que `web/.npmrc`), `antiguedad-excepciones.json` (`[]`, sin excepciones) y `commitlint.config.mjs` (las reglas de siempre: tipos en inglés, ámbito = carpeta, encabezado de hasta 150 caracteres). En un PR, `comun.yml` hace en orden: instala Node 24.22.1 desde el tarball con SHA-256 (`NODE_SHA256`) y npm 12.2.1 con SHA-512 (igual que `web.yml`); `node web/scripts/antiguedad.mjs .azure-pipelines/commitlint` (el script de `web/` con la carpeta como argumento: sin argumento revisa `web/`; es un paso hacia la unificación pendiente, D-160); `npm ci`; `npm audit signatures`; y `node_modules/.bin/commitlint` sobre el título del PR. Antes corría con `npx --yes` y `UseNode@1`, fuera de cualquier `.npmrc` y sin lockfile.

`comun` no filtra por ruta (corre con cualquier cambio), así que un cambio en `web/scripts/antiguedad.mjs` o `antiguedad-logica.mjs` (que `comun` usa para commitlint, S11 de D-161) desde un PR de web también lo corre. Esos casos están en `pruebas/filtros.py` y protegen S11: si alguien le agrega `paths` a `comun` sin esas rutas, fallan.

Para subir commitlint: en esa carpeta, `npm install --save-exact @commitlint/cli @commitlint/config-conventional` con npm 12.2.1 (el `.npmrc` hace que npm elija solo versiones de 7 días o más), y revisar el diff del lockfile. Sin `min-release-age-exclude` ni excepciones de antigüedad.

`gitleaks` corre con la imagen `GITLEAKS_IMAGEN` (`ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0…`, digest del índice multiarquitectura resuelto el 2026-10-24): cambiar la etiqueta obliga a cambiar el digest. Lee `.gitleaks.toml` (raíz): mantiene todas las reglas por defecto y solo exceptúa la dirección del API falso de las pruebas de `movil/` (`api.prueba:18090/api/v1/…`), que confundía con una clave. `comun` revisa todo el historial que trae (`fetchDepth: 0`), también el de otras ramas subidas.

`govulncheck` (v1.9.0, 2026-10-11) está fijado como `tool` en `api/go.mod`, con las sumas de sus módulos en `api/go.sum`: no se instala nada aparte, no entra en el binario del API y no está en `api/src/`. Subir `govulncheck` es `go get -tool golang.org/x/vuln/cmd/govulncheck@<versión>` en `api/`, con los 7 días de antigüedad (D-158) también para los módulos que arrastra; si cambia el protocolo de su JSON (hoy `v1.0.0`), la barrera falla hasta revisarla.

**Vulnerabilidades con la regla de los 7 días (D-201).** Cuatro pasos en `plantillas/api.yml`:

1. `pruebas/vulnerabilidades.py probar`: la barrera se prueba a sí misma, sin red, con salidas de govulncheck de ejemplo, consultas simuladas y «ahora» fijo (2026-11-11 15:00 UTC). Hay casos que deben fallar (arreglo de 7 días o más, sin arreglo, pseudo-versión, fecha que no se obtiene, salida vacía o rota, análisis incompleto), casos que deben avisar y pasar (arreglo de menos de 7 días, también el mismo día de la publicación de Go y un microsegundo antes de cumplirlos: go1.27.4 avisa el 2026-11-17 a las 23:59:59.999999 UTC y falla el 2026-11-18 a las 00:00 UTC) y casos que deben pasar (nada alcanzado; hallazgos solo de módulo o de paquete, que no cuentan). También rechaza el JSON que Python acepta y Go no (`NaN`, `Infinity`, `-Infinity` y claves repetidas en cualquier nivel, que borrarían un hallazgo alcanzado) y comprueba que ningún texto de afuera deje un `##` en lo impreso (el agente busca `##vso[` en cualquier parte de la línea, con cualquier número de `#` delante) y que el momento en que cumple 7 días sea exacto (con microsegundos si los tiene).
2. `pruebas/vulnerabilidades_regresion.py` (`unittest`, sin red): las pruebas de regresión de un verificador independiente, aparte de la autoprueba.
3. `go tool govulncheck -format json ./... > $(Agent.TempDirectory)/govulncheck.json`. Con `-format json` govulncheck sale con 0 aunque encuentre vulnerabilidades, así que el script es la única barrera. Si govulncheck no termina (sin red, un paquete que no compila) sale con otro código y el paso falla.
4. `pruebas/vulnerabilidades.py revisar` sobre ese archivo. Cuenta solo las vulnerabilidades que el código alcanza: los hallazgos cuyo primer marco tiene `function`, en un análisis de nivel `symbol`, las mismas que hacen salir a govulncheck con código 3 con la salida de texto (comprobado con `govulncheck -mode convert` sobre la salida real del 2026-11-11). Por cada una, según la versión que la corrige: **avisa y no falla** si se publicó hace menos de 7 días (`##vso[task.logissue type=warning]` con la vulnerabilidad, la versión y el momento UTC en que cumple 7 días); **falla** si tiene 7 días o más, si no hay arreglo, si el arreglo es solo una pseudo-versión o si no puede obtener la fecha (no la da por buena, como `antiguedad`, D-158). También falla si la salida está vacía o rota, si no empieza con `config`, si no es de nivel `symbol` y modo `source`, si falta el `SBOM` o el progreso «Checking the code against the vulnerabilities...», o si el JSON no es estricto. Sin CVSS, EPSS ni KEV: lo urgente lo decide el dueño ante cada aviso.

**Fuentes de la fecha de publicación** (nunca la del commit). Cada consulta: tres intentos, 60 s por lectura; un 404 o 410 no se reintenta.

- **Go** (`stdlib` y `toolchain`; `v1.27.4` es `go1.27.4`): el día de «go1.27.4 (released 2026-11-10)» en [go.dev/doc/devel/release](https://go.dev/doc/devel/release), que debe aparecer una sola vez (dos entradas, aun con la misma fecha, fallan). La página da solo el día, y los 7 días se cuentan desde su final, las 00:00 UTC del día siguiente (D-201): GO-2026-6859 (arreglada en go1.27.4, publicado el 2026-11-10) avisa hasta el 2026-11-18 a las 00:00 UTC y falla desde entonces. El principio: **la regla que obliga a adoptar una versión nunca se adelanta a la que permite adoptarla**. Las dos revisiones no tienen que dar la misma fecha: la de antigüedad (la que permite adoptar Go; todavía por construir) usa el `Last-Modified` del tarball y de la imagen, y esta, el final del día. Si una imagen sale al día siguiente y esta barrera empieza a fallar antes de que se pueda adoptar, los PR de `api/` esperan; no se abre una excepción por eso. Una fecha de la página posterior a ahora se rechaza desde el comienzo del día, así que el mismo día de la publicación avisa. No sirven `go.dev/dl/?mode=json` (no trae fechas) ni `proxy.golang.org` (da la del commit: 2026-11-02 para go1.27.4).
- **Los demás módulos**: el `Timestamp` de [index.golang.org](https://index.golang.org/), la primera vez que `proxy.golang.org` guardó esa versión. Para no recorrer el índice entero, primero se mira una página desde poco antes del `Last-Modified` del `.mod` en el proxy (coincide con esa primera vez; es solo una pista); si ahí no está, se recorre desde la hora del commit (`.info`) menos una hora, hasta 30 páginas de 2000 entradas, y si no aparece, falla. No sirve deps.dev: su `publishedAt` es la hora del commit (`golang.org/x/crypto` v0.58.0: 16:24:17 UTC del 2026-10-09 en deps.dev; 16:42:23 UTC en el índice).

Consulta en vivo de la fecha que usaría la barrera: `python3 -I -B .azure-pipelines/pruebas/vulnerabilidades.py fecha stdlib v1.27.4` (o `fecha <módulo> <versión>`).

**El aviso solo vale para fusionar, no para desplegar.** El pipeline de despliegue de la US-79 falla con cualquier vulnerabilidad que el código alcance y que tenga arreglo, aunque tenga menos de 7 días, salvo que el dueño registre una excepción. Así la espera nunca deja una vulnerabilidad conocida en UAT ni en producción sin una decisión del dueño.

Hoy (2026-11-11) hay una vulnerabilidad solo de módulo que no cuenta: `GO-2026-5932` (`golang.org/x/crypto/openpgp`; su único arreglo es la pseudo-versión `v0.58.1-0.20261009181718-2f1f834330b2`); el API solo importa `x/crypto/argon2` y no usa `openpgp`. Si algún día el código la alcanza, falla por la pseudo-versión.

El pipeline de `diseno/` se agrega cuando haga falta, con sus filtros y sus casos en `pruebas/filtros.py`. Un cambio en `diseno/` (también en `diseno/textos/`, la fuente única de los textos, D-160) dispara el de `web/` y el de `movil/`, que construyen con sus tokens, textos y fuentes, y el de `api/`, porque la imagen del API embebe la web. Un cambio en `web/` dispara también el de `api/`.

**Cupo:** el plan gratuito de Microsoft-hosted da 1 trabajo a la vez y 1.800 minutos al mes. Los filtros (y en `control.yml`, las condiciones de cada etapa) evitan compilar lo que no cambió. La revisión diaria gasta unos 30 a 50 minutos al mes (ver «Revisión diaria»).

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

Versiones fijadas (verificadas en sus fuentes oficiales el 2026-10-21): gitleaks v8.30.1 (imagen del 2026-03-21; digest del índice multiarquitectura `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`, resuelto en ghcr.io el 2026-10-24), `@commitlint/cli` y `@commitlint/config-conventional` 21.2.3 (la versión más nueva con 7 días o más que resolvió npm el 2026-10-24; la 21.2.4 es del 2026-10-18), Node 24.22.1 LTS (nodejs.org), npm 12.2.1 (registro de npm, 2026-10-24; SHA-512 del tarball fijado en `plantillas/pasos/node.yml` (web, movil y la revisión diaria), `plantillas/comun.yml` y `api/Dockerfile`; reglas de instalación en `web/.npmrc`, `movil/.npmrc` y `commitlint/.npmrc`), OpenTofu 1.13.2 (GitHub releases, 2026-10-22; SHA-256 del zip fijado en el pipeline, tomado de `tofu_1.13.2_SHA256SUMS`), Go 1.27.3 (go.dev/dl, 2026-10-22; SHA-256 del tarball fijado en `plantillas/pasos/go.yml`, que usan `api` y la revisión diaria), Node 24.22.1 (nodejs.org, `SHASUMS256.txt`, 2026-10-22; SHA-256 del tarball fijado en `plantillas/pasos/node.yml` y en `plantillas/comun.yml`; las dependencias de `web/` están en su README), imagen `ubuntu-24.04`.

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

`pruebas/filtros.py` comprueba que cada pipeline tenga `trigger: none` y `pr.drafts: false`, también `control.yml`. La única excepción es la revisión diaria (`revision-diaria.yml`), que no corre en ningún PR: tiene `pr: none` y su propia comprobación (sección «Revisión diaria»).

Ojo: hasta que el dueño cambie la protección (sección «Control único»), el único check obligatorio para fusionar es `comun`. Los de `api`, `web`, `movil`, `infra` y `reglas` hay que mirarlos antes de fusionar. Después, el único check obligatorio es `control`, que ya incluye los de las carpetas que cambiaron.

## Revisión diaria (S3, regla de los 7 días)

Decidido por el dueño el 2026-11-11: «una corrida diaria programada sobre main con govulncheck y las auditorías de npm de web y movil. En Azure el cron necesita always: true, porque sin eso no corre si no hubo commits. Si aparece un aviso nuevo, me llega un correo. Dime cuántos minutos gasta al mes. Cuando haya producción (US-79), revisa además la etiqueta desplegada.»

**Por qué.** Un PR solo ve una vulnerabilidad si alguien abre uno; los avisos se publican aunque el código no cambie. La corrida 687 (#103) encontró `GO-2026-6859` en la biblioteca estándar de Go 1.27.3, que `main` también llama: sin un PR de `api/`, nadie se habría enterado.

**Cuándo corre.** `schedules` con un solo cron, `0 10 * * *`: Azure lee el cron en UTC, así que corre a las 5:00 a. m. en Colombia (UTC-5, sin horario de verano). Solo sobre `main`, con `always: true`. Sin él, Azure corre la programación solo «if there have been source code or pipeline settings changes since the last successful scheduled run» ([Configure schedules for pipelines](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/scheduled-triggers)): un día sin commits en `main` no habría revisión. Tiene `trigger: none` (no corre al fusionar) y `pr: none` (sin `pr`, Azure corre un pipeline de GitHub en todo PR). Cada trabajo tiene un tope de 10 minutos.

**Qué corre.** Los mismos comandos y las mismas versiones fijadas que un PR, para que la revisión diaria y el PR digan lo mismo:

| Trabajo | Instala | Revisa |
|---|---|---|
| `api` | Go desde `plantillas/pasos/go.yml` (`govulncheck` revisa la biblioteca estándar de la versión de Go con la que corre) | `go tool govulncheck ./...`: falla (código 3) si el código llama a un símbolo vulnerable |
| `web` | Node y npm desde `plantillas/pasos/node.yml` | `npm run auditoria` (`npm audit --omit=dev --audit-level=high`) |
| `movil` | Node y npm desde `plantillas/pasos/node.yml` | `npm run auditoria` (altas o críticas de producción, con las excepciones de `movil/auditoria-excepciones.json`; una excepción vencida falla) |

Sin `npm ci`: `npm audit` lee el lockfile, así que no se instala ningún paquete ni corre ningún script de instalación (comprobado en local el 2026-11-11: `web/` y `movil/` sin `node_modules` dan el mismo resultado).

**Resultado de la corrida.**

- **Failed**: una revisión falla (lo mismo que haría fallar un PR) o falla una instalación.
- **Partially succeeded**: una revisión solo advierte. El paso guarda su salida; si sale con 0 y alguna línea empieza con `##vso[task.logissue type=warning]`, termina con `##vso[task.complete result=SucceededWithIssues;]` ([logging commands](https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/logging-commands): «The build will be completed as partially succeeded at best»). Hoy ninguna revisión advierte: lo hará la de Go con la regla de los 7 días (S2) y, después, la de npm (S5).
- **Succeeded**: sin hallazgos. No llega correo.

Lo que ya está aceptado no avisa: una vulnerabilidad de un módulo que el código no llama (`GO-2026-5932`, `govulncheck` la informa y sale con 0) y una excepción vigente de `movil/auditoria-excepciones.json`.

**Ojo, hasta que entre el #112 (Go 1.27.4).** Con Go 1.27.3, `main` llama a `GO-2026-6859` (corrida 687), así que cada revisión diaria va a terminar en Failed, con un correo por día. Cuando entre el PR de S2 pasará a Partially succeeded (el arreglo, Go 1.27.4, es del 2026-11-10 y no cumple 7 días hasta el 2026-11-17), y desaparecerá cuando entre el #112.

**«Aviso nuevo»: correo cada día mientras haya un hallazgo, sin estado.** La corrida no recuerda la anterior: si un hallazgo sigue ahí, vuelve a mandar correo al día siguiente. La alternativa, avisar solo lo que no estaba ayer, necesita guardar el resultado de cada corrida (un artefacto de la anterior, descargado con la API de Azure DevOps), compararlo y decidir qué pasa si se borró o venció. No es trivial y agrega un modo de fallar en silencio: si la comparación se equivoca, un aviso nunca llega. Se elige el correo diario porque:

- lo que el dueño ya decidió no manda correo: está en el repositorio, como una excepción con su fecha de revisión (`movil/auditoria-excepciones.json`, D-150) o como un aviso que solo es de módulo. «Nuevo» es todo lo que no tiene esa decisión;
- un aviso de menos de 7 días (S2) dura como mucho 7 días como advertencia; después falla, hasta que entra el arreglo;
- un correo por día es el recordatorio de algo que sigue abierto.

Si el correo diario resulta ruidoso, el paso siguiente es la comparación con la corrida anterior.

**Correo (lo hace el dueño, una vez).** La suscripción por defecto «Build completes» avisa solo de «a build you queued or that was queued for you» ([notificaciones por defecto](https://learn.microsoft.com/en-us/azure/devops/organizations/notifications/oob-built-in-notifications)). Una corrida programada no la pide ninguna persona (en esta organización las de PR figuran a nombre de «GitHub»), así que sin una suscripción propia no llega nada. No hace falta ningún secreto en el repositorio:

1. Registrar el pipeline (después de fusionar este cambio): Azure DevOps → proyecto `alcanzamos` → Pipelines → New pipeline → GitHub → `alcanzamos/alcanzamos` → «Existing Azure Pipelines YAML file» → rama `main`, ruta `/.azure-pipelines/revision-diaria.yml` → Continue → en el menú junto a Run, **Save** (sin correr). Renombrarlo a `revision-diaria` (⋮ → Rename/move). No necesita variables ni la variable `GITHUB_TOKEN_PR`.
2. Comprobar la programación: en el pipeline, ⋮ → **Scheduled runs**: la próxima corrida a las 5:00 a. m. (la página la muestra en la hora del navegador). No agregar programaciones en Edit → ⋮ → Triggers: las de la interfaz reemplazan a las del YAML.
3. Crear la suscripción personal: arriba a la derecha, **User settings** (el ícono junto al avatar) → **Notifications** → **New subscription** → Category **Build**, Template **A build completes** → Next.
4. En el formulario:
   - Description: `revision-diaria: falla o aviso`.
   - Deliver to: el correo preferido (u otra dirección).
   - Filter: **A specific team project** → `alcanzamos`.
   - Filter criteria: `Definition name` `=` `revision-diaria`; Add new clause → `And` `Status` `<>` `Succeeded`. Así llega con Failed, Partially succeeded y una corrida detenida o cancelada (por ejemplo, por el tope de 10 minutos). Si `Status` no ofrece `<>`, dos cláusulas agrupadas: `Status` `=` `Failed` Or `Status` `=` `Partially Succeeded`.
   - Finish.
5. Probarla: Run pipeline sobre `main`. Mientras `main` tenga `GO-2026-6859` (hasta el #112), la corrida termina en Failed y el correo debe llegar en unos minutos. Esa corrida mide también los minutos reales (abajo).

**Minutos.** Estimación con las duraciones reales de los pasos en las corridas 683, 684 y 687 de `control` (API de timeline), por trabajo (inicio, checkout, instalación, revisión y cierre):

| Trabajo | Duración por corrida | De dónde sale |
|---|---|---|
| `api` | 36 a 67 s | Inicio 0,6 a 0,9 s, checkout 1,8 a 2 s, Go 3,2 a 3,6 s, versión 0,2 s. `govulncheck` en las corridas tardó 7,5 a 10,5 s, pero con los módulos ya bajados por `go vet` (48 a 51 s). Aquí corre en frío: se toma entre 30 s (en local, 16 s de `go mod download` y 10 s de `govulncheck`) y 61 s (`go vet` más `govulncheck`) |
| `web` | 12 a 13 s | Inicio 0,6 s, checkout 2 a 2,2 s, Node 3,3 a 3,8 s, npm 4,9 s, `npm audit` 0,9 a 1 s |
| `movil` | 15 s | Inicio 0,8 s, checkout 2,5 s, Node 4 s, npm 5,1 s, `npm audit` 2,2 s |

Total: 63 a 95 s por día, **unos 32 a 48 minutos al mes** (× 30). Si Azure redondeara cada trabajo al minuto entero, serían 3 minutos por día, 90 al mes, el peor caso. Contra el cupo: el proyecto `alcanzamos` es **privado**, así que aplica el plan gratuito de Microsoft-hosted para proyectos privados (D-116): 1 trabajo a la vez y **1.800 minutos al mes**, sin compras (`az devops invoke … resourceusage` del 2026-11-11: `FreeCount` 1, `PurchasedCount` 0, `totalMinutes` 1.800, `usedMinutes` 1.101). La revisión diaria es del 2 al 3 % del cupo (5 % en el peor caso), lo mismo que unas dos corridas de un PR de `api` y `web` al mes (corrida 683: 19,5 minutos). La primera corrida manual (paso 5) da el número real: Azure DevOps → la corrida → la duración de cada trabajo.

**Cuando entre el PR de S2 (`pruebas/vulnerabilidades.py`).** En `revision-diaria.yml` hay una nota «CAMBIA CUANDO ENTRE EL PR DE S2» en el paso de Go: el paso pasa a ser el mismo de `plantillas/api.yml`, primero `vulnerabilidades.py probar` (el script se prueba a sí mismo) y después `go tool govulncheck -format json ./... | python3 -I -B ../.azure-pipelines/pruebas/vulnerabilidades.py revisar -`. Con `-format json`, `govulncheck` sale siempre con 0: el script es la única barrera. Para que la corrida quede en Partially succeeded con un arreglo de menos de 7 días, el script debe imprimir ese aviso como `##vso[task.logissue type=warning]…` y salir con 0; todo lo demás sale con otro código y la deja en Failed.

**TODO (US-79): la etiqueta desplegada.** Cuando haya producción, la revisión diaria revisa también la etiqueta `v*` desplegada, porque lo que corre en producción puede no ser `main`. Plan, sin implementar (la nota «TODO(US-79)» está en el YAML):

- La etiqueta desplegada es la de la última corrida exitosa del pipeline de despliegue hacia producción (`Build.SourceBranch` = `refs/tags/v…`); se lee con la API de Azure DevOps y `$(System.AccessToken)`, sin secretos en el repositorio.
- Cada trabajo pasa a una plantilla con un parámetro `ref` y corre dos veces, con `main` y con la etiqueta (`git fetch --depth 1 origin tag <etiqueta>` y `git worktree add` en `$(Agent.TempDirectory)`, o un recurso de repositorio con `ref: refs/tags/<etiqueta>`).
- Sobre la etiqueta rige la regla del despliegue (S2): falla con cualquier vulnerabilidad que el código alcance y que tenga arreglo, aunque tenga menos de 7 días, salvo una excepción que registre el dueño.
- Gasta lo mismo otra vez: unos 1 a 1,6 minutos más por día.

**Qué comprueba `pruebas/filtros.py`.** Un pipeline con `schedules` se acepta solo si está en `PROGRAMADOS` (hoy, solo `revision-diaria`). Debe tener `trigger: none`, `pr: none` y una sola programación, diaria (minuto y hora fijos, `* * *`), con `branches.include` igual a `main` y sin `exclude`, y `always: true`. La prueba también comprueba que su revisión rechace once cambios rotos (`MUTACIONES_PROGRAMADO`: `always` en `false` o ausente, otra rama, `'*'`, un `exclude`, un `pr` o un `trigger` con ramas, sin `pr`, un cron cada hora o semanal y una segunda programación). No entra en la simulación de los filtros, porque no corre en ningún PR. Además, los pasos compartidos que usa cada plantilla (`plantillas/pasos/*.yml`) deben disparar su etapa y su pipeline por carpeta: un cambio en `plantillas/pasos/go.yml` corre `api`, y uno en `plantillas/pasos/node.yml` corre `web` y `movil`.

## Token de GitHub de `comun` (D-167)

El paso de commitlint pide el título del PR a la API de GitHub. Sin token, GitHub permite 60 pedidos por hora por IP, y los agentes de Azure comparten IP: a veces responde 403 y `comun` falla sin que el PR tenga la culpa. Por eso el pipeline `comun` (y `control`, que corre la misma plantilla) tiene una **variable secreta `GITHUB_TOKEN_PR`** (Azure DevOps → Pipelines → `comun` → Edit → Variables, «Keep this value secret»).

- **Token:** fine-grained, solo para `alcanzamos/alcanzamos`, permiso «Pull requests: Read-only», vence a los 90 días. Lo crea y lo renueva el dueño. **Creado el 2026-10-27; vence el 2027-01-25: renovarlo antes** (D-167).
- **Cómo se usa:** entra al paso como variable de entorno y va a `curl` por su entrada estándar, nunca en la línea de comandos. Azure lo oculta en los registros.
- **Sin la variable:** el paso pide el título sin token, como antes.
- **Con el token vencido o revocado:** GitHub responde 401 y `comun` falla. Es a propósito: avisa que hay que renovarlo.
