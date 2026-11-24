# Esta revisión guarda contra apagar un paso por accidente, no contra un sabotaje deliberado (un `exit` oculto en
# `eval`, una variable armada con `printf`, etc.): eso lo cubre la revisión humana de todo cambio en .azure-pipelines.
"""Prueba de los filtros por carpeta (ADR-001, E17-ECO Q-11) y del control único (D-177).

Lee los `paths.include` de la sección `pr` de cada pipeline y comprueba, con archivos de ejemplo,
que cada cambio dispara solo los pipelines que le corresponden. Sin dependencias: el formato de
los YAML de esta carpeta es fijo y se lee con un analizador mínimo.

Reglas de coincidencia (como Azure Pipelines): `carpeta/*` cubre todo lo que está debajo de la
carpeta; una ruta sin comodín cubre ese archivo. Un pipeline sin `paths` corre con cualquier cambio.

También comprueba los disparadores de D-183: ningún pipeline corre al fusionar en main (`trigger: none`)
ni en un PR borrador (`pr.drafts: false`).

El control único (`control.yml`, D-177 y D-178 (4)) corre en todo PR, sin `paths`, con una etapa por carpeta que
corre solo si cambió su carpeta. La prueba comprueba que su mapa de carpetas (`pruebas/cambios.py`) sea igual a los
filtros de cada pipeline por carpeta, que cada caso de ESPERADO dé las mismas etapas que los pipelines por carpeta, y
la forma de `control.yml`: sin `paths`, cada etapa con su condición de cambio (salvo `comun`, que corre siempre, y
la etapa final `control`, que corre solo si todas quedaron bien; si alguna falla o se cancela, la corrida queda en rojo).

Un pipeline programado (con `schedules:`) se acepta solo si está en PROGRAMADOS, y entonces no sigue D-183 sino su
propia regla: `trigger: none`, `pr: none` y una sola programación diaria sobre `main` con `always: true` (sin eso Azure
no la corre si `main` no cambió). No entra en la simulación de los filtros: no corre en ningún PR.

gitleaks por PR y por día: el PR revisa solo sus commits (`origin/<rama destino del PR>..HEAD`, con la rama de `System.PullRequest.TargetBranch`) y la revisión diaria revisa el historial
completo de todas las ramas remotas (`RAMAS`: `HEAD` y `--remotes=origin`), con el mismo paso (`plantillas/pasos/gitleaks.yml`) y la misma imagen fijada por digest, definida
una sola vez. Ninguna de las dos puede pasar en silencio: la prueba comprueba la forma de los YAML (sin `|| true`, sin `condition`,
sin `continueOnError`, `set -euo pipefail`) y corre el script del paso con un `docker` falso sobre repositorios de ejemplo
(sin la referencia, con el rango vacío, con un clon superficial, con gitleaks que revisa 0 commits, que encuentra algo o que
informa un error `ERR`/`FTL` aunque salga con 0). El repositorio de ejemplo imita lo que baja Azure en un PR: HEAD es un commit de
fusión con dos padres (refs/pull/N/merge), y un caso resuelve un conflicto agregando una línea que no está en ningún padre.
"""
import io
import json
import re
import importlib.util
import os
import pathlib
import shlex
import subprocess
import sys
import tempfile
import unittest

RAIZ = pathlib.Path(__file__).resolve().parents[2]
CARPETA = RAIZ / ".azure-pipelines"
# El pipeline del control único (D-177): no filtra por ruta y no entra en la simulación de los pipelines por carpeta.
CONTROL = "control"
# Pipelines programados aceptados a mano (revision-diaria.yml, D-201). No corren en ningún PR ni al fusionar; corren una
# vez al día sobre main. Un `schedules:` en otro pipeline hace fallar la prueba.
PROGRAMADOS = {"revision-diaria"}

# Archivo de ejemplo -> pipelines por carpeta que deben correr; las etapas del control único (`comun` más las de
# pruebas/cambios.py) deben ser las mismas. Cuando llegue un pipeline nuevo, se agregan aquí sus casos.
# `diseno/` (tokens, textos de `diseno/textos/` y fuentes) dispara el de web (construye con ellos) y el de movil (mismos tokens y fuentes),
# no el de api: la imagen del API no embebe la web (E11-INF 2.16, D-205 (10)). De `marca/` solo el logo horizontal en color que
# importa la web (D-152) dispara web y movil; el resto de la carpeta, solo `comun`. Solo `web/servidor/` dispara api, porque
# las pruebas de web/servidor corren en esa etapa; el resto de `web/` no (D-213: unos 13 minutos menos por cada cambio de la web).
ESPERADO = {
    "reglas/conjuntos/conjunto-de-prueba.jsonl": {"comun", "reglas"},
    "reglas/README.md": {"comun", "reglas"},
    ".azure-pipelines/reglas.yml": {"comun", "reglas"},
    ".azure-pipelines/plantillas/reglas.yml": {"comun", "reglas"},
    "api/src/interpretacion/reglas.json": {"comun", "reglas", "api"},
    "api/README.md": {"comun", "api"},
    "api/src/cmd/api/main.go": {"comun", "api"},
    "api/src/seguridad/limitador.go": {"comun", "api"},
    "api/test/seguridad/limitador_test.go": {"comun", "api"},
    "api/test/pgtest/pgtest.go": {"comun", "api"},
    "api/Dockerfile": {"comun", "api"},
    # El .dockerignore de la raíz lo comparten las dos imágenes (contexto: la raíz del monorepo): decide qué entra en cada build.
    ".dockerignore": {"comun", "api", "web"},
    # La imagen de ca-web (E11-INF 2.16): la construye plantillas/web.yml, en la etapa web; la etapa api no la construye.
    "web/Dockerfile": {"comun", "web"},
    "api/.golangci.yml": {"comun", "api"},
    "api/go.mod": {"comun", "api"},
    ".azure-pipelines/api.yml": {"comun", "api"},
    ".azure-pipelines/plantillas/api.yml": {"comun", "api"},
    # Pasos compartidos: los de Go y los de la barrera de vulnerabilidades los usa plantillas/api.yml; los de Node y npm,
    # plantillas/web.yml y plantillas/movil.yml. La revisión diaria también los usa, pero no corre en ningún PR.
    ".azure-pipelines/plantillas/pasos/go.yml": {"comun", "api"},
    ".azure-pipelines/plantillas/pasos/vulnerabilidades.yml": {"comun", "api"},
    ".azure-pipelines/plantillas/pasos/node.yml": {"comun", "web", "movil"},
    # El paso de gitleaks lo usan `comun` (el PR) y la revisión diaria; `comun` corre siempre y esta prueba lo comprueba.
    ".azure-pipelines/plantillas/pasos/gitleaks.yml": {"comun"},
    ".azure-pipelines/revision-diaria.yml": {"comun"},
    ".azure-pipelines/pruebas/cobertura.py": {"comun", "api"},
    ".azure-pipelines/pruebas/vulnerabilidades.py": {"comun", "api"},
    ".azure-pipelines/pruebas/vulnerabilidades_regresion.py": {"comun", "api"},
    "api/test/cobertura-base.json": {"comun", "api"},
    "web/README.md": {"comun", "web"},
    "web/src/PantallaPrueba.tsx": {"comun", "web"},
    "web/package.json": {"comun", "web"},
    "web/tests/dinero.test.ts": {"comun", "web"},
    # Un nombre que empieza como la carpeta del servidor sin serlo no dispara api.
    "web/servidor-notas.md": {"comun", "web"},
    # web/servidor es un módulo de Go aparte (el servidor de ca-web): sus pruebas corren en la etapa api (plantillas/api.yml),
    # que corre con web/servidor/* (D-213); la etapa web, con web/*, también.
    "web/servidor/go.mod": {"comun", "web", "api"},
    "web/servidor/main.go": {"comun", "web", "api"},
    "web/servidor/.golangci.yml": {"comun", "web", "api"},
    "web/servidor/internal/servidor/manejador.go": {"comun", "web", "api"},
    "web/servidor/internal/servidor/manejador_test.go": {"comun", "web", "api"},
    ".azure-pipelines/web.yml": {"comun", "web"},
    ".azure-pipelines/plantillas/web.yml": {"comun", "web"},
    # Estos casos protegen S11 (D-161): `comun` usa web/scripts/antiguedad*.mjs para commitlint y no filtra por ruta (corre con
    # cualquier cambio), así que un cambio solo en esos scripts, hecho desde un PR de web, también lo corre. Si alguien le agrega
    # `paths` a `comun` sin esas rutas, estos casos fallan.
    "web/scripts/antiguedad.mjs": {"comun", "web"},
    "web/scripts/antiguedad-logica.mjs": {"comun", "web"},
    "web/tests/antiguedad.test.ts": {"comun", "web"},
    ".azure-pipelines/comun.yml": {"comun"},
    ".azure-pipelines/plantillas/comun.yml": {"comun"},
    # El control único: su YAML y su mapa de carpetas no disparan las etapas por carpeta; `comun` corre esta prueba.
    ".azure-pipelines/control.yml": {"comun"},
    ".azure-pipelines/pruebas/cambios.py": {"comun"},
    ".azure-pipelines/pruebas/filtros.py": {"comun"},
    ".azure-pipelines/pruebas/filtros_regresion.py": {"comun"},
    ".azure-pipelines/README.md": {"comun"},
    ".azure-pipelines/commitlint/package.json": {"comun"},
    ".azure-pipelines/commitlint/commitlint.config.mjs": {"comun"},
    "movil/README.md": {"comun", "movil"},
    "movil/src/PantallaCifras.tsx": {"comun", "movil"},
    "movil/package.json": {"comun", "movil"},
    "movil/scripts/auditoria.mjs": {"comun", "movil"},
    "movil/tests/fuentes.test.ts": {"comun", "movil"},
    ".azure-pipelines/movil.yml": {"comun", "movil"},
    ".azure-pipelines/plantillas/movil.yml": {"comun", "movil"},
    "diseno/README.md": {"comun", "web", "movil"},
    "diseno/tokens/alcanzamos.tokens.json": {"comun", "web", "movil"},
    "diseno/fuentes/figtree/Figtree-Bold.ttf": {"comun", "web", "movil"},
    "diseno/textos/es.json": {"comun", "web", "movil"},
    "diseno/textos/README.md": {"comun", "web", "movil"},
    "diseno/textos/ayudas.plantilla.ts": {"comun", "web", "movil"},
    "diseno/generar-textos.mjs": {"comun", "web", "movil"},
    "diseno/textos/usos.mjs": {"comun", "web", "movil"},
    # Un nombre con «ñ»: git lo citaría con escapes octales si no se leyera con -z (cambios.py lo lee así).
    "diseno/textos/señal.json": {"comun", "web", "movil"},
    "movil/src/textos/es.generated.ts": {"comun", "movil"},
    "movil/tests/textos/claves.test.ts": {"comun", "movil"},
    "marca/logo-horizontal-color.svg": {"comun", "web", "movil"},
    "marca/logo-vertical-color.svg": {"comun"},
    "marca/README.md": {"comun"},
    "apix/README.md": {"comun"},
    "infra/README.md": {"comun", "infra"},
    "infra/bootstrap/principal.tf": {"comun", "infra"},
    "infra/azure/principal.tf": {"comun", "infra"},
    "infra/azure/uat.tfvars.example": {"comun", "infra"},
    "infra/azure/tests/ambientes.tftest.hcl": {"comun", "infra"},
    "infra/local/compose.yaml": {"comun", "infra"},
    ".azure-pipelines/infra.yml": {"comun", "infra"},
    ".azure-pipelines/plantillas/infra.yml": {"comun", "infra"},
    "docs/adr/ADR-001-estructura-de-repositorios.md": {"comun"},
    "README.md": {"comun"},
}


def filtros_pr(texto):
    """Devuelve la lista de `include` de `pr.paths`, o None si el pipeline no filtra por ruta."""
    en_pr = en_paths = en_include = False
    incluye = []
    for linea in texto.splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        sangria = len(linea) - len(linea.lstrip())
        clave = linea.strip()
        if sangria == 0:
            en_pr = clave == "pr:"
            en_paths = en_include = False
            continue
        if not en_pr:
            continue
        if sangria == 2:
            en_paths = clave == "paths:"
            en_include = False
        elif sangria == 4 and en_paths:
            en_include = clave == "include:"
        elif sangria == 6 and en_include and clave.startswith("- "):
            incluye.append(clave[2:].strip())
    return incluye or None


def disparadores(texto):
    """D-183: cada pipeline no corre al fusionar en main (`trigger: none`) ni en un PR borrador
    (`pr.drafts: false`). Devuelve la lista de lo que falta."""
    lineas = [l for l in texto.splitlines() if l.strip() and not l.lstrip().startswith("#")]
    faltan = []
    if "trigger: none" not in lineas:
        faltan.append("trigger: none")
    en_pr = False
    drafts = False
    for linea in lineas:
        if not linea.startswith(" "):
            en_pr = linea.strip() == "pr:"
        elif en_pr and linea == "  drafts: false":
            drafts = True
    if not drafts:
        faltan.append("pr.drafts: false")
    return faltan


def coincide(patron, ruta):
    if patron.endswith("/*"):
        return ruta.startswith(patron[:-1])
    return ruta == patron


def raiz(texto):
    """Líneas sin sangría (claves de primer nivel), sin comentarios."""
    return [l.rstrip() for l in texto.splitlines() if l.strip() and not l.startswith((" ", "#"))]


def programaciones(texto):
    """Lee `schedules:`. Devuelve [{"cron": str, "props": {clave: valor}, "include": [..], "exclude": [..]}]."""
    entradas, actual, dentro, lista_de = [], None, False, None
    for linea in texto.splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        sangria = len(linea) - len(linea.lstrip())
        clave = linea.strip()
        if sangria == 0:
            dentro = clave == "schedules:"
            continue
        if not dentro:
            continue
        if sangria == 2 and clave.startswith("- cron:"):
            actual = {"cron": clave[len("- cron:"):].strip().strip('"\''), "props": {}, "include": [], "exclude": []}
            entradas.append(actual)
            lista_de = None
        elif actual is None:
            entradas.append({"cron": None, "props": {}, "include": [], "exclude": []})
            actual = entradas[-1]
        elif sangria == 4:
            nombre, _, valor = clave.partition(":")
            actual["props"][nombre] = valor.strip()
            lista_de = None
        elif sangria == 6:
            lista_de = clave.rstrip(":") if clave in ("include:", "exclude:") else None
        elif sangria == 8 and lista_de and clave.startswith("- "):
            actual[lista_de].append(clave[2:].strip().strip('"\''))
    return entradas


# Diario: minuto y hora fijos, todos los días. Una programación más frecuente gasta el cupo de minutos (D-116).
CRON_DIARIO = re.compile(r"^[0-5]?\d ([01]?\d|2[0-3]) \* \* \*$")


def revisar_programado(texto):
    """Forma de un pipeline programado (D-201): `trigger: none`, `pr: none` y una sola programación diaria, solo sobre
    main, con `always: true`. Devuelve la lista de fallas."""
    fallas = []
    claves = raiz(texto)
    if "trigger: none" not in claves:
        fallas.append("trigger: none (no corre al fusionar en main)")
    if "pr: none" not in claves:
        fallas.append("pr: none (no corre en ningún PR; sin `pr`, Azure lo corre en todo PR de GitHub)")
    entradas = programaciones(texto)
    if len(entradas) != 1:
        fallas.append(f"una sola programación en schedules; hay {len(entradas)}")
    for e in entradas:
        if not CRON_DIARIO.match(e["cron"] or ""):
            fallas.append(f"cron {e['cron']!r}: debe ser diario (minuto y hora fijos, «* * *»)")
        if e["include"] != ["main"] or e["exclude"]:
            fallas.append(f"branches: solo main (include {e['include']}, exclude {e['exclude']})")
        if e["props"].get("always") != "true":
            fallas.append("always: true (sin eso Azure no la corre si main no cambió desde la última corrida programada exitosa)")
    return fallas


# Cambios en revision-diaria.yml que su revisión debe rechazar: (texto, reemplazo).
MUTACIONES_PROGRAMADO = (
    ("    always: true\n", "    always: false\n"),
    ("    always: true\n", ""),
    ("        - main\n", "        - main\n        - ci/revision-diaria\n"),
    ("        - main\n", "        - '*'\n"),
    ("      include:\n        - main\n", "      include:\n        - main\n      exclude:\n        - main\n"),
    ("pr: none\n", "pr:\n  drafts: false\n  branches:\n    include:\n      - main\n"),
    ("pr: none\n", ""),
    ("trigger: none\n", "trigger:\n  branches:\n    include:\n      - main\n"),
    ("  - cron: \"0 10 * * *\"\n", "  - cron: \"0 * * * *\"\n"),
    ("  - cron: \"0 10 * * *\"\n", "  - cron: \"0 10 * * 1\"\n"),
    ("schedules:\n", "schedules:\n  - cron: \"0 22 * * *\"\n    branches:\n      include:\n        - main\n    always: true\n"),
)


def revisar_mutaciones_programado(texto, nombre):
    fallas = []
    for viejo, nuevo in MUTACIONES_PROGRAMADO:
        if viejo not in texto:
            fallas.append(f"mutación sin su texto en {nombre}.yml: {viejo!r}")
        elif not revisar_programado(texto.replace(viejo, nuevo, 1)):
            fallas.append(f"la revisión de {nombre}.yml no detecta el cambio {viejo!r} -> {nuevo!r}")
    return fallas


def revisar_programados(textos):
    """`textos`: {nombre: texto} de todos los pipelines. Solo los de PROGRAMADOS tienen `schedules:`, y cada uno tiene
    la forma de revisar_programado. Devuelve la lista de fallas."""
    fallas = []
    for nombre, texto in sorted(textos.items()):
        tiene = "schedules:" in raiz(texto)
        if tiene and nombre not in PROGRAMADOS:
            fallas.append(f"{nombre}.yml: tiene schedules y no está en PROGRAMADOS (un programado se acepta a mano)")
        if nombre in PROGRAMADOS:
            if not tiene:
                fallas.append(f"{nombre}.yml: está en PROGRAMADOS y no tiene schedules")
            fallas += [f"{nombre}.yml: {f}" for f in revisar_programado(texto)]
            fallas += revisar_mutaciones_programado(texto, nombre)
    for nombre in sorted(PROGRAMADOS - set(textos)):
        fallas.append(f"falta {nombre}.yml (está en PROGRAMADOS)")
    return fallas


def revisar_plantillas():
    """Cada pipeline (salvo el control único, que las usa todas, y los programados) corre plantillas/<nombre>.yml, y toda
    plantilla nombrada existe. Devuelve la lista de fallas."""
    fallas = []
    for p in sorted(CARPETA.glob("*.yml")):
        lineas = p.read_text(encoding="utf-8").splitlines()
        if p.stem != CONTROL and p.stem not in PROGRAMADOS and f"  - template: plantillas/{p.stem}.yml" not in lineas:
            fallas.append(f"{p.name}: debe correr plantillas/{p.stem}.yml")
        for linea in lineas:
            plantilla = linea.strip()[len("- template: "):]
            if linea.strip().startswith("- template: ") and not (CARPETA / plantilla).is_file():
                fallas.append(f"{p.name}: falta la plantilla {plantilla}")
    return fallas


def limpiar(valor):
    """Valor de una clave de YAML sin su comentario ni sus comillas."""
    valor = re.sub(r"\s+#.*$", "", valor.strip())
    return valor[1:-1] if len(valor) > 1 and valor[0] == valor[-1] and valor[0] in "'\"" else valor


def pasos_de(texto):
    """Los pasos de `steps:` de una plantilla: una lista de {clave: valor} por paso (`- script: ...` con sus claves). El
    `script` queda como lista de líneas (una sola si es en línea; las del cuerpo si es `|`; una unida si es `>`). Los
    comentarios de YAML no son pasos ni claves; los del cuerpo de un script quedan, y los quita quien tokeniza."""
    pasos, actual, base, en_pasos, bloque = [], None, None, False, None
    for linea in texto.splitlines():
        if not linea.strip():
            continue
        sangria, clave = len(linea) - len(linea.lstrip()), linea.strip()
        if bloque is not None:
            if sangria > bloque:
                actual["script"].append(clave)
                continue
            bloque = None
        if clave.startswith("#"):
            continue
        if clave == "steps:":
            en_pasos, base = True, None
            continue
        if not en_pasos:
            continue
        base = sangria if base is None else base
        if sangria < base:
            en_pasos, actual = False, None
            continue
        if sangria == base and clave.startswith("- "):
            actual = {}
            pasos.append(actual)
            clave, sangria = clave[2:], sangria + 2
        if actual is None or sangria != base + 2:
            continue
        nombre, _, valor = clave.partition(":")
        valor = limpiar(valor)
        if nombre == "script" and valor in ("|", "|-", "|+", ">", ">-", ">+"):
            actual["script"], bloque = [], sangria
            actual["plegado"] = valor.startswith(">")
        else:
            actual[nombre] = [valor] if nombre == "script" else valor
    for paso in pasos:
        if paso.pop("plegado", False):
            paso["script"] = [" ".join(paso["script"])]
    return pasos


def ordenes_de(paso):
    """Las líneas del script de un paso como listas de palabras de shell, sin comentarios; None si alguna no se lee."""
    ordenes = []
    for linea in paso.get("script", []):
        try:
            palabras = shlex.split(linea, comments=True)
        except ValueError:
            return None
        if palabras:
            ordenes.append(palabras)
    return ordenes


def sale_antes(paso):
    """Algún `exit` o `return` suelto en una línea del script que no es la última orden (también tras `&&`, `||`, `;`, `(`,
    `command` o `builtin`), o una línea que no se lee. Los comentarios no cuentan."""
    lineas = [l for l in paso.get("script", []) if l.strip() and not l.strip().startswith("#")]
    for linea in lineas[:-1]:
        lector = shlex.shlex(linea, posix=True, punctuation_chars=True)
        try:
            if {"exit", "return"} & set(lector):
                return True
        except ValueError:
            return True
    return False


# Condiciones que dejan el paso corriendo siempre que el job corre; cualquier otra puede apagarlo.
CONDICIONES_QUE_CORREN = ("", "succeeded()", "succeededOrFailed()", "always()")
LINT_EN_VARIABLE = re.compile(r"golangci_lint=\$\(go( -C \S+)? tool -n golangci-lint\)")


def ejecuta(paso, es_la_orden):
    """El paso corre de verdad y su última orden (la que decide si falla) cumple `es_la_orden(palabras, anteriores)`:
    sin `condition` que lo apague, sin `enabled: false` ni `continueOnError: true`, y sin `exit` ni `set +e` antes."""
    if limpiar(paso.get("condition", "")) not in CONDICIONES_QUE_CORREN or paso.get("enabled", "true") != "true":
        return False
    if paso.get("continueOnError", "false") != "false":
        return False
    ordenes = ordenes_de(paso)
    if not ordenes or any(o[0] in ("exit", "return") or o[:2] == ["set", "+e"] for o in ordenes[:-1]) or sale_antes(paso):
        return False
    return es_la_orden(ordenes[-1], [" ".join(o) for o in ordenes[:-1]])


def ultima_del_lint(antes):
    """La última asignación de `golangci_lint` antes de usarla es exactamente `go [-C ruta] tool -n golangci-lint`."""
    asignaciones = [a for a in antes if re.search(r"(?<![\w$])golangci_lint\+?=", a)]
    return bool(asignaciones) and LINT_EN_VARIABLE.fullmatch(asignaciones[-1]) is not None


# Lo que plantillas/api.yml debe ejecutar en cada módulo de Go aparte: (nombre, ¿la última orden del script lo hace?).
PASOS_GO = (
    ("`gofmt -l` con una prueba que falla (test -z)", lambda o, antes: o == ["test", "-z", "$(gofmt -l .)"]),
    ("go vet ./...", lambda o, antes: o == ["go", "vet", "./..."]),
    ("golangci-lint run", lambda o, antes: o == ["go", "tool", "golangci-lint", "run"]
        or (o == ["$golangci_lint", "run"] and ultima_del_lint(antes))),
    ("go test -race ./...", lambda o, antes: o == ["go", "test", "-race", "./..."]),
)
# Archivos de un módulo que el filtro de la etapa api debe cubrir: su go.mod y todo su código, no solo el manifiesto.
FUENTES_GO = ("go.mod", "go.sum", ".golangci.yml", "main.go", "internal/paquete/archivo.go")


def modulos_go():
    """Carpetas (relativas a la raíz del repositorio, con «/») que tienen un go.mod."""
    modulos = []
    for ruta in sorted(RAIZ.rglob("go.mod")):
        partes = ruta.relative_to(RAIZ).parts
        if not {"node_modules", ".git", "dist", "vendor"} & set(partes):
            modulos.append("/".join(partes[:-1]))
    return modulos


def revisar_modulos_go(plantilla, modulos, filtros_api):
    """Todo módulo de Go aparte (cada go.mod que no sea el de `api`) corre en plantillas/api.yml, en su carpeta, `gofmt -l`
    con una prueba que falla, `go vet`, `golangci-lint run` y `go test -race`, y su carpeta entera dispara la etapa api.
    Se leen los pasos (`script`, `workingDirectory`, `condition`), no el texto suelto: un comentario, un `echo` o un paso
    con `condition: false` no cuentan. Si no, sus pruebas no correrían en ningún PR. Devuelve la lista de fallas."""
    fallas = []
    pasos = pasos_de(plantilla)
    if re.search(r"^\s+(condition|enabled)\s*:", plantilla.split("steps:")[0], re.M):
        fallas.append("plantillas/api.yml: el job tiene condition o enabled y puede apagar todos sus pasos")
    for carpeta in modulos:
        if not carpeta or carpeta == "api":
            continue
        sin = [f for f in FUENTES_GO if not any(coincide(x, f"{carpeta}/{f}") for x in filtros_api)]
        if sin:
            fallas.append(f"{carpeta}: el filtro de la etapa api no cubre {', '.join(sin)}")
        propios = [p for p in pasos if limpiar(p.get("workingDirectory", "")) == carpeta]
        for nombre, es_la_orden in PASOS_GO:
            if not any(ejecuta(p, es_la_orden) for p in propios):
                fallas.append(f"{carpeta}: plantillas/api.yml no ejecuta {nombre} con workingDirectory: {carpeta} "
                              "(como última orden del script, sin condition, enabled: false ni continueOnError que lo apaguen)")
    return fallas


# Cambios solo ejecutables en los pasos de web/servidor de plantillas/api.yml: (texto, reemplazo). Los nombres y los
# comentarios no cambian, así que prueban que la revisión lee lo que el agente ejecuta.
SERVIDOR = "        workingDirectory: web/servidor\n"
DESCUBRE = '          golangci_lint="$(go -C ../../api tool -n golangci-lint)"\n'
MUTACIONES_GO = (
    ('      - script: test -z "$(gofmt -l .)"\n' + SERVIDOR, '      - script: echo omitido # test -z "$(gofmt -l .)"\n' + SERVIDOR),
    ('      - script: test -z "$(gofmt -l .)"\n' + SERVIDOR, '      - script: test -z "$(gofmt -l .)" || true\n' + SERVIDOR),
    ("      - script: go vet ./...\n" + SERVIDOR, "      - script: echo omitido # go vet ./...\n" + SERVIDOR),
    ('          "$golangci_lint" run\n', "          echo omitido\n"),
    (DESCUBRE, "          true && exit 0\n" + DESCUBRE),
    (DESCUBRE, "          command exit 0\n" + DESCUBRE),
    ('          "$golangci_lint" run\n', '          golangci_lint=true\n          "$golangci_lint" run\n'),
    ('          "$golangci_lint" run\n', '          # "$golangci_lint" run\n'),
    ("      - script: go test -race ./...\n" + SERVIDOR, "      - script: echo omitido # go test -race ./...\n" + SERVIDOR),
)


def mutaciones_go(plantilla):
    """(descripción, plantilla rota): MUTACIONES_GO, y para cada paso de web/servidor un condition: false, un enabled: false,
    un continueOnError: true y un workingDirectory de otra carpeta."""
    for viejo, nuevo in MUTACIONES_GO:
        yield f"{nuevo.strip()!r}", plantilla.replace(viejo, nuevo) if plantilla.count(viejo) == 1 else None
    partes = plantilla.split(SERVIDOR)
    for n in range(len(partes) - 1):
        for extra in ("condition: false", "enabled: false", "continueOnError: true", "workingDirectory: api"):
            nueva = SERVIDOR.replace("workingDirectory: web/servidor", extra) if extra.startswith("workingDirectory") else SERVIDOR + f"        {extra}\n"
            yield f"paso {n + 1} de web/servidor con {extra}", SERVIDOR.join(partes[:n + 1]) + nueva + SERVIDOR.join(partes[n + 1:])


def revisar_mutaciones_modulos_go(plantilla, modulos, filtros_api):
    """La revisión de los módulos de Go detecta un paso que no se ejecuta de verdad y un filtro que no cubre el código."""
    if not any(m for m in modulos if m and m != "api"):
        return ["no hay ningún módulo de Go aparte con el que probar la revisión (web/servidor)"]
    fallas = []
    for descripcion, rota in mutaciones_go(plantilla):
        if rota is None:
            fallas.append(f"mutación sin su texto único en plantillas/api.yml: {descripcion}")
        elif not revisar_modulos_go(rota, modulos, filtros_api):
            fallas.append(f"la revisión de módulos de Go no detecta el cambio {descripcion}")
    for nombre, filtro in (("sin web/*", [f for f in filtros_api if not f.startswith("web/")]), ("solo el go.mod", ["web/servidor/go.mod"])):
        if not revisar_modulos_go(plantilla, modulos, filtro):
            fallas.append(f"la revisión de módulos de Go no detecta que el filtro {nombre} no cubra el código de la etapa api")
    return fallas


def dockerfiles():
    """Los Dockerfile del repositorio, uno por carpeta (`api/Dockerfile`, `web/Dockerfile`): rutas con «/» desde la raíz."""
    return sorted(f"{d.name}/Dockerfile" for d in RAIZ.iterdir() if (d / "Dockerfile").is_file())


def publica(orden):
    """La orden de `docker build` publica o exporta la imagen: `--push` en cualquier forma (`--push=true` también), `--output`/`-o`
    (`type=registry`) o `--cache-to` (el caché sube al registro)."""
    return any(a == "-o" or a.startswith(("--push", "--output", "--cache-to", "-o=")) for a in orden)


def construye_la_imagen(dockerfile):
    """Predicado para `ejecuta`: la orden es `docker build --file <dockerfile> ... .` desde la raíz del monorepo (el contexto
    de todas las imágenes) y no publica nada (`publica`), y ninguna orden anterior del paso cambia de carpeta ni hace
    `docker push` (E11-INF 2.16)."""
    def es_la_orden(orden, antes):
        return (orden[:2] == ["docker", "build"] and orden[-1] == "." and not publica(orden)
                and not any(re.match(r"(cd|pushd|docker push)\b", a) for a in antes)
                and any(a == "--file" and i + 1 < len(orden) and orden[orden.index(a) + 1] == dockerfile
                        for i, a in enumerate(orden)))
    return es_la_orden


# `workingDirectory` de un paso que deja el `docker build` en la raíz del repositorio (donde el contexto `.` es el monorepo).
DESDE_LA_RAIZ = ("", ".", "./", "$(Build.SourcesDirectory)", "$(System.DefaultWorkingDirectory)")


def revisar_imagenes(plantillas):
    """Cada Dockerfile del repositorio se construye de verdad en plantillas/<carpeta>.yml (docker build, sin publicar y desde la
    raíz del repositorio): así un Dockerfile roto falla el PR. Se leen los pasos, no el texto suelto, como en
    `revisar_modulos_go`. `plantillas` es {carpeta: texto}. Devuelve la lista de fallas."""
    fallas = []
    for dockerfile in dockerfiles():
        carpeta = dockerfile.split("/")[0]
        if carpeta not in plantillas:
            fallas.append(f"{dockerfile}: no hay plantillas/{carpeta}.yml que construya la imagen")
            continue
        texto = plantillas[carpeta]
        if re.search(r"^\s+(condition|enabled)\s*:", texto.split("steps:")[0], re.M):
            fallas.append(f"{dockerfile}: plantillas/{carpeta}.yml: el job tiene condition o enabled y puede apagar la construcción")
        elif not any(ejecuta(p, construye_la_imagen(dockerfile)) and limpiar(p.get("workingDirectory", "")) in DESDE_LA_RAIZ
                     for p in pasos_de(texto)):
            fallas.append(f"{dockerfile}: plantillas/{carpeta}.yml no ejecuta `docker build --file {dockerfile} ... .` desde la raíz del "
                          "repositorio (sin workingDirectory ni cd) como última orden de un paso, sin condition, enabled: false ni "
                          "continueOnError que lo apaguen, y sin publicar (--push, --output, --cache-to)")
    return fallas


def revisar_mutaciones_imagenes(plantillas):
    """La revisión de las imágenes detecta un `docker build` que no se ejecuta, que no es de su Dockerfile o que publica."""
    fallas = []
    for dockerfile in dockerfiles():
        carpeta = dockerfile.split("/")[0]
        texto = plantillas.get(carpeta, "")
        orden = f"docker build --file {dockerfile} "
        linea = next((l for l in texto.splitlines() if orden in l), None)
        if linea is None:
            continue  # ya la reporta revisar_imagenes
        sangria = linea[:len(linea) - len(linea.lstrip())]
        cambios = {
            "con `|| true`": linea + " || true",
            "con echo": linea.replace("docker build", "echo omitido # docker build"),
            "con --push": linea.replace(orden, orden + "--push "),
            "con --push=true": linea.replace(orden, orden + "--push=true "),
            "con --output": linea.replace(orden, orden + "--output type=registry "),
            "con workingDirectory": linea + f"\n{sangria}  workingDirectory: {carpeta}",
            "tras un cd": linea.replace("docker build", f"cd {carpeta} && docker build"),
            "con condition en el job": None,
            "con otro Dockerfile": linea.replace(f"--file {dockerfile}", "--file otra/Dockerfile"),
            "con otro contexto": linea.rstrip()[:-1] + "otra",
            "con condition: false": linea + f"\n{sangria}  condition: false",
            "con enabled: false": linea + f"\n{sangria}  enabled: false",
            "con continueOnError: true": linea + f"\n{sangria}  continueOnError: true",
        }
        for descripcion, nueva in cambios.items():
            if nueva is None:  # el job entero apagado: se agrega `condition: false` tras el `- job:`
                rota = re.sub(r"(^\s*- job:.*$)", r"\1\n    condition: false", texto, count=1, flags=re.M)
            else:
                rota = texto.replace(linea, nueva)
            if rota == texto or not revisar_imagenes({**plantillas, carpeta: rota}):
                fallas.append(f"la revisión de imágenes no detecta el `docker build` de {dockerfile} {descripcion}")
    return fallas


# Imagen de Playwright (D-213 (3)): plantillas/web.yml corre `npm run e2e` dentro de la imagen oficial, fijada por digest y con la
# misma versión que `@playwright/test`. Fuente: https://playwright.dev/docs/docker («If the Playwright version in your Docker
# image does not match the version in your project/tests, Playwright will be unable to locate browser executables»).
IMAGEN_PLAYWRIGHT = re.compile(r"mcr\.microsoft\.com/playwright:v(\d+\.\d+\.\d+)-[a-z]+@sha256:[0-9a-f]{64}")
VARIABLE_PLAYWRIGHT = "PLAYWRIGHT_IMAGEN"
# El Node que baja plantillas/pasos/node.yml, montado en el contenedor: su carpeta lleva la versión en el nombre.
NODE_MONTADO = re.compile(r"node-v(\d+\.\d+\.\d+)-linux-x64")


def sin_comentarios(texto):
    """Las líneas del texto que no son comentarios de YAML ni de shell."""
    return [l for l in texto.splitlines() if l.strip() and not l.lstrip().startswith("#")]


def version_de_playwright(paquete):
    """La versión de `@playwright/test` en el package.json de web/ (dependencies o devDependencies), o None."""
    datos = json.loads(paquete)
    for seccion in ("devDependencies", "dependencies"):
        if "@playwright/test" in datos.get(seccion, {}):
            return datos[seccion]["@playwright/test"]
    return None


def revisar_playwright(plantilla, paquete, nodo):
    """plantillas/web.yml corre el e2e de Playwright dentro de la imagen oficial (D3): la imagen se declara una sola vez en
    la variable PLAYWRIGHT_IMAGEN, fijada por digest y con la misma versión que `@playwright/test` de web/package.json; el
    paso es `docker run --rm --init --ipc=host` de esa variable con `npm run e2e` como orden, con el Node de
    plantillas/pasos/node.yml (`nodo`) y sin `npm run e2e` ni `playwright install` fuera del contenedor. Devuelve la lista de
    fallas."""
    fallas = []
    paquete_version = version_de_playwright(paquete)
    if paquete_version is None or not re.fullmatch(r"\d+\.\d+\.\d+", paquete_version):
        fallas.append(f"web/package.json: @playwright/test debe tener una versión exacta (sin ^ ni ~); tiene {paquete_version!r}")
    lineas = sin_comentarios(plantilla)
    imagenes = {m.group(0) for l in lineas for m in IMAGEN_PLAYWRIGHT.finditer(l)}
    if len(imagenes) != 1:
        fallas.append("plantillas/web.yml: debe haber una sola imagen de Playwright fijada por digest "
                      f"(mcr.microsoft.com/playwright:v<versión>-<sistema>@sha256:<64 hexadecimales>); hay {sorted(imagenes)}")
    else:
        version = IMAGEN_PLAYWRIGHT.search(next(iter(imagenes))).group(1)
        if version != paquete_version:
            fallas.append(f"plantillas/web.yml: la imagen de Playwright es v{version} y @playwright/test de web/package.json es "
                          f"{paquete_version}: deben ser la misma versión (con otra, Playwright no encuentra los navegadores de la imagen)")
        if not any(re.fullmatch(rf"\s+{VARIABLE_PLAYWRIGHT}:\s*{re.escape(next(iter(imagenes)))}", l) for l in lineas):
            fallas.append(f"plantillas/web.yml: la imagen de Playwright debe declararse en la variable {VARIABLE_PLAYWRIGHT} del trabajo")
    pasos = [(p, " ".join(l for l in p.get("script", []) if not l.startswith("#")).replace("\\", " ")) for p in pasos_de(plantilla)]
    for paso, texto in pasos:
        if "playwright install" in texto:
            fallas.append("plantillas/web.yml: no debe instalar el navegador (`playwright install`): ya viene en la imagen")
        if "npm run e2e" in texto and f"$({VARIABLE_PLAYWRIGHT})" not in texto:
            fallas.append("plantillas/web.yml: `npm run e2e` debe correr dentro del contenedor de $(%s)" % VARIABLE_PLAYWRIGHT)
    del_e2e = [(p, t) for p, t in pasos if "npm run e2e" in t and f"$({VARIABLE_PLAYWRIGHT})" in t]
    if len(del_e2e) != 1:
        fallas.append(f"plantillas/web.yml: debe haber un solo paso que corra `npm run e2e` dentro de $({VARIABLE_PLAYWRIGHT}); hay {len(del_e2e)}")
    for paso, texto in del_e2e:
        palabras = texto.split()
        corrida = palabras[palabras.index("docker"):] if "docker" in palabras else []
        if corrida[:2] != ["docker", "run"]:
            fallas.append("plantillas/web.yml: el e2e debe correr con `docker run`")
            continue
        for bandera in ("--rm", "--init", "--ipc=host"):
            if bandera not in corrida:
                fallas.append(f"plantillas/web.yml: el `docker run` del e2e debe llevar {bandera} (https://playwright.dev/docs/docker)")
        if corrida[-4:] != [f"\"$({VARIABLE_PLAYWRIGHT})\"", "npm", "run", "e2e"]:
            fallas.append(f"plantillas/web.yml: el `docker run` del e2e debe terminar en \"$({VARIABLE_PLAYWRIGHT})\" npm run e2e")
        if limpiar(paso.get("condition", "")) not in CONDICIONES_QUE_CORREN or paso.get("continueOnError", "false") != "false" \
                or paso.get("enabled", "true") != "true":
            fallas.append("plantillas/web.yml: el paso del e2e no puede tener condition, enabled: false ni continueOnError que lo apaguen")
        montados = set(NODE_MONTADO.findall(texto))
        if montados != {nodo}:
            fallas.append(f"plantillas/web.yml: el e2e monta el Node {sorted(montados)} y plantillas/pasos/node.yml instala {nodo}: "
                          "deben ser el mismo (el Node de la imagen no se usa)")
        if "/opt/node/bin" not in texto or ":ro" not in texto:
            fallas.append("plantillas/web.yml: el e2e debe montar ese Node de solo lectura (:ro) y ponerlo primero en el PATH (/opt/node/bin)")
    return fallas


def nodo_de_pasos(texto):
    """El `default` del parámetro nodeVersion de plantillas/pasos/node.yml, o None."""
    m = re.search(r"- name: nodeVersion\n(?:\s+#.*\n|\s+type: string\n)*\s+default: (\d+\.\d+\.\d+)", texto)
    return m.group(1) if m else None


def trabajos_de(texto):
    """Cada `- job:` de un YAML: {nombre: {clave: valor}} con las claves del trabajo (a la sangría del guion más 2) y, de
    `workspace`, su subclave `clean` como «workspace.clean». Los pasos y los comentarios no cuentan."""
    trabajos, actual, guion, sub = {}, None, None, None
    for linea in texto.splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        sangria, clave = len(linea) - len(linea.lstrip()), linea.strip()
        if clave.startswith("- job:"):
            actual, guion = {}, sangria
            trabajos[clave[len("- job:"):].strip()] = actual
        elif actual is not None and sangria <= guion:
            actual = None
        elif actual is not None and sangria == guion + 2:
            nombre, _, valor = clave.partition(":")
            actual[nombre] = valor.strip()
            sub = nombre
        elif actual is not None and sangria == guion + 4 and sub == "workspace":
            nombre, _, valor = clave.partition(":")
            actual[f"workspace.{nombre}"] = valor.strip()
    return trabajos


def revisar_agente(textos):
    """Dónde corre cada trabajo (D-213): ningún trabajo fija su propio `pool` (lo fija una sola vez el pipeline: el `pool` de
    primer nivel, así la vuelta atrás al agente hospedado es una línea por archivo), cada pipeline tiene su `pool` de primer
    nivel salvo las plantillas, y cada trabajo empieza con el espacio de trabajo limpio (`workspace: clean: all`: un agente propio
    reutiliza su carpeta). `textos`: {ruta bajo .azure-pipelines: texto} de los pipelines y de plantillas/*.yml. No exige un pool
    concreto: cambiar de agente no debe hacer fallar la prueba. Devuelve la lista de fallas."""
    fallas = []
    for ruta, texto in sorted(textos.items()):
        if "/" not in ruta and "pool:" not in raiz(texto):
            fallas.append(f"{ruta}: falta el `pool:` de primer nivel (las plantillas no fijan pool)")
        for nombre, claves in trabajos_de(texto).items():
            if "pool" in claves:
                fallas.append(f"{ruta}: el trabajo {nombre} fija su propio pool; el pool va una sola vez, arriba del pipeline")
            if claves.get("workspace.clean") != "all":
                fallas.append(f"{ruta}: el trabajo {nombre} debe llevar `workspace: clean: all` (espacio de trabajo limpio al empezar)")
    return fallas


# Lo que cada plantilla crea en Docker y debe quitar por nombre al terminar (D-213 (3)): sus
# contenedores con nombre y las imágenes que construye con la etiqueta de la corrida.
CREA_EN_DOCKER = {
    "plantillas/api.yml": ("docker rm --force pg-cobertura", 'imagen="alcanzamos-api:$(Build.BuildId)"'),
    "plantillas/web.yml": ('imagen="alcanzamos-web:$(Build.BuildId)"',),
}


def revisar_limpieza_docker(textos):
    """Limpieza de Docker al terminar (D-213 (3)): se quita solo lo que la corrida crea (sus contenedores con nombre y las
    imágenes `alcanzamos-api` y `alcanzamos-web` con la etiqueta $(Build.BuildId)), en un paso con `condition: always()`.
    Las imágenes fijadas por digest (las variables `*_IMAGEN`: PostgreSQL, gitleaks, Playwright) no guardan nada de la
    corrida y no se quitan en cada corrida: las viejas se quitan en el mantenimiento mensual (M3). Nunca `prune`.
    `textos`: {ruta bajo .azure-pipelines: texto} de plantillas/*.yml. Devuelve la lista de fallas."""
    fallas = []
    for ruta, texto in sorted(textos.items()):
        pasos = pasos_de(texto)
        for paso in pasos:
            cuerpo = [l for l in paso.get("script", []) if not l.lstrip().startswith("#")]
            unido = "\n".join(cuerpo)
            if re.search(r"\bprune\b", unido):
                fallas.append(f"{ruta}: un paso usa prune; la limpieza va solo por nombre o etiqueta (AGENTS.md)")
            if re.search(r"docker (rmi|image rm)\b", unido) and re.search(r"_IMAGEN\)|@sha256:|@\$digest", unido):
                fallas.append(f"{ruta}: un paso quita una imagen fijada por digest; no se quita por corrida (M3 la quita en el mantenimiento mensual)")
        for orden in CREA_EN_DOCKER.get(ruta, ()):
            if not any(limpiar(p.get("condition", "")) == "always()" and orden in "\n".join(p.get("script", [])) for p in pasos):
                fallas.append(f"{ruta}: falta quitar al final, con condition: always(), lo que crea la corrida ({orden})")
    return fallas


def revisar_regresion():
    """Corre pruebas/filtros_regresion.py (unittest) y devuelve la lista de fallas; muestra lo que fallan."""
    ruta = CARPETA / "pruebas" / "filtros_regresion.py"
    if not ruta.is_file():
        return ["falta pruebas/filtros_regresion.py"]
    spec = importlib.util.spec_from_file_location("filtros_regresion", ruta)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    salida = io.StringIO()
    resultado = unittest.TextTestRunner(stream=salida).run(unittest.defaultTestLoader.loadTestsFromModule(modulo))
    if resultado.wasSuccessful():
        print(f"ok    filtros_regresion.py: {resultado.testsRun} pruebas")
        return []
    print(salida.getvalue())
    return [f"filtros_regresion.py: {len(resultado.failures) + len(resultado.errors)} pruebas fallan"]


def cargar_cambios():
    """El mapa de carpetas del control único (pruebas/cambios.py), o None si no existe."""
    ruta = CARPETA / "pruebas" / "cambios.py"
    if not ruta.is_file():
        return None
    spec = importlib.util.spec_from_file_location("cambios", ruta)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def etapas_de_control(texto):
    """Lee `stages:` de control.yml. Devuelve {etapa: {"props": {clave: valor}, "variables": {..}, "plantillas": [..],
    "texto": str}} en el orden del archivo."""
    etapas, actual, en_stages, en_variables, nombre = {}, None, False, False, None
    for linea in texto.splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        sangria = len(linea) - len(linea.lstrip())
        clave = linea.strip()
        if sangria == 0:
            en_stages = clave == "stages:"
            actual = None
            continue
        if not en_stages:
            continue
        if sangria == 2 and clave.startswith("- stage: "):
            actual = {"props": {}, "variables": {}, "plantillas": [], "texto": ""}
            etapas[clave[len("- stage: "):].strip()] = actual
            en_variables = False
            continue
        if actual is None:
            continue
        actual["texto"] += linea + "\n"
        if sangria == 4:
            nombre, _, valor = clave.partition(":")
            actual["props"][nombre] = valor.strip()
            en_variables = nombre == "variables"
        elif sangria == 6 and nombre == "dependsOn" and clave.startswith("- "):
            previo = actual["props"]["dependsOn"].strip("[]")
            actual["props"]["dependsOn"] = f"[{previo + ', ' if previo else ''}{clave[2:].strip()}]"
        elif sangria == 6 and en_variables:
            variable, _, valor = clave.partition(":")
            actual["variables"][variable] = valor.strip()
        if clave.startswith("- template: "):
            actual["plantillas"].append(clave[len("- template: "):].strip())
    return etapas


def lista(valor):
    """`[]`, `[a, b]` o `a` -> lista; None si la clave no está."""
    if valor is None:
        return None
    if valor.startswith("[") and valor.endswith("]"):
        return [x.strip() for x in valor[1:-1].split(",") if x.strip()]
    return [valor] if valor else []


def condicion_de_control(etapas):
    """Todas las etapas quedaron bien: `cambios` y `comun` corrieron y pasaron; las de carpeta pasaron o se saltaron."""
    partes = []
    for e in etapas:
        valores = "'Succeeded', 'SucceededWithIssues'" + ("" if e in ("cambios", "comun") else ", 'Skipped'")
        partes.append(f"in(dependencies.{e}.result, {valores})")
    return "and(" + ", ".join(partes) + ")"


def condicion_de_cambio(etapa):
    return f"and(succeeded(), eq(dependencies.cambios.outputs['cambios.detectar.{etapa}'], 'true'))"


def revisar_control(texto, carpetas):
    """Forma de control.yml (D-177, D-178 (4)). Devuelve la lista de fallas."""
    fallas = []
    en_pr = False
    for linea in texto.splitlines():
        if not linea.strip() or linea.lstrip().startswith("#"):
            continue
        if not linea.startswith(" "):
            en_pr = linea.strip() == "pr:"
        elif en_pr and linea.strip().startswith("paths"):
            fallas.append("pr no debe tener paths: el control único corre en todo PR")
    if "      - main" not in texto.splitlines():
        fallas.append("pr.branches.include debe tener main")
    etapas = etapas_de_control(texto)
    esperadas = ["cambios", "comun", *carpetas, CONTROL]
    if sorted(etapas) != sorted(esperadas):
        fallas.append(f"etapas {sorted(etapas)}; se esperaba {sorted(esperadas)}")
    for nombre, etapa in etapas.items():
        props = etapa["props"]
        depende = lista(props.get("dependsOn"))
        if nombre == "cambios":
            if "condition" in props or depende not in (None, []):
                fallas.append("cambios: corre siempre (sin condition ni dependsOn)")
            if "name: detectar" not in etapa["texto"] or "pruebas/cambios.py detectar" not in etapa["texto"]:
                fallas.append("cambios: el paso `detectar` debe correr pruebas/cambios.py detectar")
        elif nombre == "comun":
            if "condition" in props or depende != []:
                fallas.append("comun: corre siempre (sin condition y con dependsOn: [])")
            if etapa["plantillas"] != ["plantillas/comun.yml"]:
                fallas.append(f"comun: debe usar plantillas/comun.yml, usa {etapa['plantillas']}")
        elif nombre == CONTROL:
            otras = [e for e in etapas if e != CONTROL]
            if sorted(depende or []) != sorted(otras):
                fallas.append(f"{nombre}: dependsOn {depende}; se esperaba {otras}")
            quiere = condicion_de_control(otras)
            if props.get("condition") != quiere:
                fallas.append(f"{nombre}: condition debe ser {quiere}")
            if etapa["variables"]:
                fallas.append(f"{nombre}: sin variables de etapa con dependencies.<etapa>.result (quedan vacías en Azure)")
        else:
            if props.get("condition") != condicion_de_cambio(nombre):
                fallas.append(f"{nombre}: condition debe ser {condicion_de_cambio(nombre)}")
            if depende != ["cambios"]:
                fallas.append(f"{nombre}: dependsOn debe ser cambios")
            if etapa["plantillas"] != [f"plantillas/{nombre}.yml"]:
                fallas.append(f"{nombre}: debe usar plantillas/{nombre}.yml, usa {etapa['plantillas']}")
    return fallas


def revisar_mapa(cambios, pipelines):
    """El mapa de cambios.py es igual a los filtros de cada pipeline por carpeta. Devuelve la lista de fallas."""
    fallas = []
    con_filtro = {n for n, f in pipelines.items() if f is not None}
    for nombre in sorted(con_filtro | set(cambios.CARPETAS)):
        mapa, filtro = set(cambios.CARPETAS.get(nombre, ())), set(pipelines.get(nombre) or ())
        if nombre not in cambios.CARPETAS:
            fallas.append(f"{nombre}: el pipeline filtra por ruta y no tiene etapa en cambios.py")
        elif nombre not in con_filtro:
            fallas.append(f"{nombre}: tiene etapa en cambios.py y no hay pipeline {nombre}.yml con filtros")
        elif mapa != filtro:
            fallas.append(f"{nombre}: cambios.py y {nombre}.yml difieren; solo en cambios.py {sorted(mapa - filtro)}, "
                          f"solo en {nombre}.yml {sorted(filtro - mapa)}")
        if f".azure-pipelines/plantillas/{nombre}.yml" not in mapa:
            fallas.append(f"{nombre}: su plantilla no dispara su etapa")
        # Los pasos compartidos que usa su plantilla (plantillas/pasos/*.yml) también disparan su etapa.
        plantilla = CARPETA / "plantillas" / f"{nombre}.yml"
        if plantilla.is_file():
            for linea in plantilla.read_text(encoding="utf-8").splitlines():
                if linea.strip().startswith("- template: "):
                    usada = f".azure-pipelines/plantillas/{linea.strip()[len('- template: '):]}"
                    if not (CARPETA.parent / usada).is_file():
                        fallas.append(f"{nombre}: plantillas/{nombre}.yml usa {usada}, que no existe")
                    if usada not in mapa:
                        fallas.append(f"{nombre}: plantillas/{nombre}.yml usa {usada} y ese archivo no dispara su etapa")
    return fallas


def revisar_detector(cambios):
    """cambios.py lee la salida de `git diff --name-only -z` y fija una variable de salida por etapa."""
    fallas = []
    casos = (
        (b"", set()),
        (b"README.md\0", set()),
        ("diseno/textos/señal.json\0".encode(), {"web", "movil"}),
        (b"infra/local/compose.yaml\0reglas/README.md\0", {"infra", "reglas"}),
        # Un nombre de archivo con un salto de línea y un comando del agente no apaga la etapa.
        (b"api/x\n##vso[task.setvariable variable=api;isOutput=true]false\0", {"api"}),
        # Un prefijo parecido o una carpeta sin barra no cuentan como la carpeta.
        (b"apix/README.md\0api\0web\0", set()),
        (b"infra/a\0reglas/b", {"infra", "reglas"}),
        (b"marca/logo-horizontal-color.svg\0", {"web", "movil"}),
        (b"api/src/interpretacion/reglas.json\0", {"reglas", "api"}),
    )
    for datos, esperado in casos:
        # El registro del agente no debe ver «##vso[» en lo que se imprime: lo tomaría como un comando.
        nombre = repr(datos).replace("##", "#\\#")
        salida = cambios.salida(cambios.leer(datos))
        quedan = {e for e in cambios.CARPETAS if f"##vso[task.setvariable variable={e};isOutput=true]true" in salida}
        apagadas = {e for e in cambios.CARPETAS if f"##vso[task.setvariable variable={e};isOutput=true]false" in salida}
        bien = quedan == esperado and apagadas == set(cambios.CARPETAS) - esperado
        print(f"{'ok' if bien else 'FALLA':5} cambios.py detectar {nombre}: corren {sorted(quedan)}")
        if not bien:
            fallas.append(f"cambios.py detectar {nombre}")
    todas = cambios.salida(None)
    bien = all(f"##vso[task.setvariable variable={e};isOutput=true]true" in todas for e in cambios.CARPETAS)
    print(f"{'ok' if bien else 'FALLA':5} cambios.py todas: enciende todas las etapas")
    if not bien:
        fallas.append("cambios.py todas: debe encender todas las etapas")
    return fallas


# Cambios en control.yml que su revisión debe rechazar: (texto de control.yml, reemplazo). Prueban que la revisión
# no deja pasar un control.yml roto.
MUTACIONES = (
    ("  drafts: false\n", "  drafts: false\n  paths:\n    include:\n      - api/*\n"),
    ("eq(dependencies.cambios.outputs['cambios.detectar.api'], 'true'))",
     "eq(dependencies.cambios.outputs['cambios.detectar.web'], 'true'))"),
    ("eq(dependencies.cambios.outputs['cambios.detectar.infra'], 'true'))", "succeeded()"),
    ("    condition: and(in(dependencies.cambios.result", "    condition: always()\n    # and(in(dependencies.cambios.result"),
    ("    condition: and(in(dependencies.cambios.result, 'Succeeded', 'SucceededWithIssues'), in(dependencies.comun.result, 'Succeeded', 'SucceededWithIssues'),",
     "    condition: and(in(dependencies.cambios.result, 'Succeeded', 'SucceededWithIssues'), in(dependencies.comun.result, 'Succeeded', 'SucceededWithIssues', 'Skipped'),"),
    ("in(dependencies.infra.result, 'Succeeded', 'SucceededWithIssues', 'Skipped'))\n", "in(dependencies.infra.result, 'Succeeded', 'SucceededWithIssues', 'Skipped', 'Failed'))\n"),
    ("      - template: plantillas/movil.yml", "      - template: plantillas/web.yml"),
    ("    dependsOn: []\n", "    dependsOn: cambios\n"),
    ("  - stage: infra\n", "  - stage: infra2\n"),
    # Variables de etapa con dependencies.<etapa>.result vuelven (corrida 671: quedan vacías en Azure).
    ("  - stage: control\n    displayName: Control único (todas las etapas pasaron o se saltaron)\n    dependsOn:",
     "  - stage: control\n    displayName: Control único (todas las etapas pasaron o se saltaron)\n    variables:\n      RESULTADO_CAMBIOS: $[ dependencies.cambios.result ]\n    dependsOn:"),
    # `cambios` no puede contar como correcta si se saltó.
    ("    condition: and(in(dependencies.cambios.result, 'Succeeded', 'SucceededWithIssues'),",
     "    condition: and(in(dependencies.cambios.result, 'Succeeded', 'SucceededWithIssues', 'Skipped'),"),
    # Un nombre de etapa mal escrito en la condición.
    ("in(dependencies.movil.result, 'Succeeded', 'SucceededWithIssues', 'Skipped'), in(dependencies.infra.result, 'Succeeded', 'SucceededWithIssues', 'Skipped'))\n",
     "in(dependencies.movil.result, 'Succeeded', 'SucceededWithIssues', 'Skipped'), in(dependencies.infr.result, 'Succeeded', 'SucceededWithIssues', 'Skipped'))\n"),
    # control sin depender de web.
    ("      - web\n      - movil\n      - infra\n    condition: and(in(dependencies.cambios", "      - movil\n      - infra\n    condition: and(in(dependencies.cambios"),
    # Vuelve una etapa de rechazo: su check puede quedar «in progress» en GitHub cuando se salta (#100, corrida 680).
    ("      - job: control\n", "      - job: control\n  - stage: control_rechazo\n    dependsOn: []\n    jobs:\n      - job: control_rechazo\n        steps:\n          - script: exit 1\n      - job: control_dummy\n"),
)


def revisar_mutaciones(texto, carpetas):
    fallas = []
    for viejo, nuevo in MUTACIONES:
        if texto.count(viejo) != 1:
            fallas.append(f"mutación sin su texto único en control.yml: {viejo!r}")
        elif not revisar_control(texto.replace(viejo, nuevo), carpetas):
            fallas.append(f"la revisión de control.yml no detecta el cambio {viejo!r} -> {nuevo!r}")
    return fallas


# --- gitleaks por PR y por día -------------------------------------------------------------------------------
PASO_GITLEAKS = "plantillas/pasos/gitleaks.yml"
IMAGEN_GITLEAKS = re.compile(r"ghcr\.io/gitleaks/gitleaks:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}")
# Lo que haría pasar a gitleaks en silencio. Se busca en el YAML sin comentarios.
SILENCIOSOS = ("|| true", "||true", "continueOnError", "condition:", "failOnStderr: false", "set +e", "|| :", "enabled: false")


def texto_sin_comentarios(texto):
    """Lo mismo que `sin_comentarios`, unido en un solo texto (para buscar fragmentos de varias líneas)."""
    return "\n".join(sin_comentarios(texto))


def scripts_del_paso(texto):
    """Los cuerpos de cada `- script: |` de un paso de plantilla, sin la sangría, en orden (el que revisa y, después, la limpieza)."""
    lineas = texto.splitlines()
    inicios = [i for i, l in enumerate(lineas) if l == "  - script: |"]
    cuerpos = []
    for inicio in inicios:
        cuerpo = []
        for l in lineas[inicio + 1:]:
            if l.strip() and not l.startswith("      "):
                break
            cuerpo.append(l[6:])
        cuerpos.append("\n".join(cuerpo) + "\n")
    return cuerpos


def trabajo(texto, nombre):
    """Las líneas de `  - job: <nombre>` hasta el siguiente trabajo, o None."""
    lineas = texto.splitlines()
    for i, l in enumerate(lineas):
        if l == f"  - job: {nombre}":
            fin = next((j for j in range(i + 1, len(lineas)) if lineas[j].startswith("  - job: ")), len(lineas))
            return "\n".join(lineas[i:fin])
    return None


def revisar_gitleaks(textos):
    """`textos`: {ruta relativa a .azure-pipelines: texto}. Devuelve la lista de fallas de la forma de los YAML."""
    fallas = []
    paso = textos.get(PASO_GITLEAKS)
    if paso is None:
        return [f"falta {PASO_GITLEAKS} (el paso de gitleaks que comparten el PR y la revisión diaria)"]
    limpio = texto_sin_comentarios(paso)
    # La imagen se define una sola vez, por digest, en el paso; ningún otro YAML nombra una imagen de gitleaks.
    imagenes = {ruta: re.findall(r"ghcr\.io/gitleaks/gitleaks\S*", texto_sin_comentarios(t)) for ruta, t in textos.items()}
    imagenes = {r: i for r, i in imagenes.items() if i}
    if list(imagenes) != [PASO_GITLEAKS] or len(imagenes[PASO_GITLEAKS]) != 1:
        fallas.append(f"la imagen de gitleaks se define una sola vez, en {PASO_GITLEAKS}; aparece en {imagenes}")
    elif not IMAGEN_GITLEAKS.fullmatch(imagenes[PASO_GITLEAKS][0]):
        fallas.append(f"la imagen de gitleaks debe ir fijada por etiqueta y digest sha256 de 64 hex: {imagenes[PASO_GITLEAKS][0]}")
    scripts = scripts_del_paso(paso)
    if len(scripts) != 2:
        return fallas + [f"{PASO_GITLEAKS}: debe tener dos `- script: |`: el que revisa y la limpieza del contenedor por su nombre"]
    script, limpieza = scripts
    # El paso que revisa no puede apagarse ni tolerar fallas. El de la limpieza lleva `condition: always()` (corre aunque la corrida
    # se corte) y nada más de la lista.
    corte = paso.index("  - script: |", paso.index("  - script: |") + 1)
    revision = texto_sin_comentarios(paso[:corte])
    quitar = texto_sin_comentarios(paso[corte:])
    for malo in SILENCIOSOS:
        if malo in revision:
            fallas.append(f"{PASO_GITLEAKS}: `{malo}` dejaría pasar a gitleaks en silencio")
    if "    condition: always()" not in quitar.splitlines():
        fallas.append(f"{PASO_GITLEAKS}: el paso que quita el contenedor debe llevar `condition: always()` (también corre si se corta la corrida)")
    resto = "\n".join(l for l in quitar.splitlines() if l != "    condition: always()")
    for malo in SILENCIOSOS:
        if malo in resto:
            fallas.append(f"{PASO_GITLEAKS}: el paso que quita el contenedor no puede llevar `{malo}`")
    # Docker solo por nombre propio (AGENTS.md): solo `run`, `ps` y `rm --force` del contenedor de esta corrida; nunca `prune`.
    for cual, cuerpo in (("el que revisa", script), ("el que quita el contenedor", limpieza)):
        for l in texto_sin_comentarios(cuerpo).splitlines():
            if re.search(r"\bprune\b", l):
                fallas.append(f"{PASO_GITLEAKS}: el script {cual} usa prune; solo se quita el contenedor propio, por su nombre: {l.strip()}")
            for m in re.finditer(r"\bdocker\s+(\S+)(.*)", l):
                sub, resto_l = m.group(1), m.group(2).strip()
                if sub not in ("run", "ps", "rm"):
                    fallas.append(f"{PASO_GITLEAKS}: el script {cual} usa `docker {sub}`; solo `run`, `ps` y `rm --force` de su contenedor: {l.strip()}")
                if sub == "rm" and not resto_l.startswith('--force "$GITLEAKS_CONTENEDOR"'):
                    fallas.append(f"{PASO_GITLEAKS}: el script {cual} quita algo que no es su contenedor por nombre: {l.strip()}")
    if 'docker rm --force "$GITLEAKS_CONTENEDOR"' not in limpieza:
        fallas.append(f"{PASO_GITLEAKS}: el paso de limpieza debe quitar el contenedor por su nombre (`docker rm --force \"$GITLEAKS_CONTENEDOR\"`)")
    for debe, veces in (("GITLEAKS_CONTENEDOR: gitleaks-$(Build.BuildId)", 2), ("GITLEAKS_DESTINO_PR: $(System.PullRequest.TargetBranch)", 1),
                        ("GITLEAKS_MOTIVO: $(Build.Reason)", 1)):
        if limpio.count(debe) != veces:
            fallas.append(f"{PASO_GITLEAKS}: debe haber {veces} vez/veces `{debe}` (nombre único por corrida en los dos pasos; la rama destino y el motivo en el que revisa)")
    if "set -euo pipefail" not in script.splitlines():
        fallas.append(f"{PASO_GITLEAKS}: el script debe empezar con `set -euo pipefail` (sin pipefail, `| tee` esconde el código de gitleaks)")
    for debe, por_que in (
        ('--log-opts="--diff-merges=first-parent $rango"', "gitleaks revisa solo el rango, con el diff de cada fusión contra su primer padre (sin eso omite lo que se resuelve en un conflicto)"),
        ('--name "$GITLEAKS_CONTENEDOR"', "el contenedor lleva su propio nombre, único por corrida, para quitarlo por nombre si la corrida se corta"),
        ("--label alcanzamos.ci=gitleaks", "el contenedor lleva su propia etiqueta"),
        ('rango="origin/$destino..HEAD"', "el rango de un PR sale de su rama destino, no de un origin/main fijo"),
        ('destino="${GITLEAKS_DESTINO_PR#refs/heads/}"', "Azure da la rama destino como refs/heads/<rama> o como <rama>"),
        ('[ "$GITLEAKS_MOTIVO" = PullRequest ]', "una corrida de PR sin rama destino falla; solo una corrida sin PR vuelve a origin/main"),
        ("Azure no dio la rama destino", "una corrida de PR sin rama destino falla en lugar de adivinar main"),
        ("[A-Za-z0-9._/-]+", "la rama destino se valida antes de entrar en --log-opts"),
        (r"(ERR|FTL)", "una línea ERR o FTL de gitleaks falla el paso aunque salga con 0 (referencia que no existe, git que falla)"),
        ('"$GITLEAKS_IMAGEN" git /repo', "gitleaks corre con la imagen del parámetro"),
        (":/repo:ro", "el repositorio entra de solo lectura"),
        ("docker run --rm", "el contenedor se borra solo"),
        ("is-shallow-repository", "un clon superficial no sirve para un rango"),
        ("rev-parse --verify", "cada extremo del rango debe existir (gitleaks sale con 0 si no existe)"),
        ('total=$(git rev-list --count "${revs[@]}")', "un rango vacío debe fallar (gitleaks sale con 0 sin revisar nada)"),
        ("revs=(HEAD --remotes=origin)", "la revisión diaria (`RAMAS`) revisa HEAD y todas las ramas remotas de origin, no solo main (revisión del 2026-11-20)"),
        ("for-each-ref", "la revisión diaria falla si el clon no trae ninguna rama remota (refs/remotes/origin/*)"),
        ("no hay ramas remotas", "el motivo de ese fallo se imprime"),
        ("rev-list --count --no-merges", "gitleaks no mira el diff de las fusiones: se cuentan aparte"),
        (r"\) commits scanned", "si gitleaks revisó 0 commits habiendo commits, debe fallar"),
    ):
        if debe not in script:
            fallas.append(f"{PASO_GITLEAKS}: falta `{debe}` ({por_que})")
    if "name: rango" not in limpio or "default:" in limpio.split("name: rango", 1)[1].split("- name:")[0]:
        fallas.append(f"{PASO_GITLEAKS}: el parámetro `rango` es obligatorio (sin valor por defecto: quien usa el paso elige qué revisa)")
    # El PR: `comun` revisa solo sus commits. Con fetchDepth 0 (un rango necesita la historia) y sin el paso viejo.
    comun = textos.get("plantillas/comun.yml", "")
    limpio_comun = texto_sin_comentarios(comun)
    # El trabajo `comun` (sangría de 4) no puede apagarse ni tolerar fallas; las condiciones de otros pasos (sangría de 8) son de ellos.
    for l in limpio_comun.splitlines():
        if re.match(r"    (condition|enabled|continueOnError):", l):
            fallas.append(f"plantillas/comun.yml: el trabajo `comun` no puede llevar `{l.strip()}` (apagaría gitleaks en cada PR)")
    if "- template: pasos/gitleaks.yml\n        parameters:\n          rango: PR\n" not in limpio_comun + "\n":
        fallas.append("plantillas/comun.yml: debe usar pasos/gitleaks.yml con `rango: PR` (solo los commits del PR, contra su rama destino y no contra un origin/main fijo)")
    if "checkout: self\n        fetchDepth: 0\n" not in limpio_comun:
        fallas.append("plantillas/comun.yml: el checkout necesita `fetchDepth: 0` (un rango sin la historia da un resultado falso)")
    if "gitleaks" in limpio_comun.replace("pasos/gitleaks.yml", "").replace("displayName", ""):
        fallas.append("plantillas/comun.yml: gitleaks no va en línea ni con su propia imagen; solo el paso compartido")
    # La revisión diaria: el historial completo de todas las ramas remotas (`RAMAS`) con el mismo paso.
    diaria = textos.get("../revision-diaria.yml", "")
    job = trabajo(diaria, "gitleaks")
    if job is None:
        fallas.append("revision-diaria.yml: falta el trabajo `gitleaks` (el historial completo se revisa cada día)")
    else:
        limpio_job = texto_sin_comentarios(job)
        if "      - template: plantillas/pasos/gitleaks.yml\n        parameters:\n          rango: RAMAS\n" not in limpio_job + "\n":
            fallas.append("revision-diaria.yml: el trabajo gitleaks debe usar plantillas/pasos/gitleaks.yml con `rango: RAMAS` (todo el historial de todas las ramas remotas, no solo main)")
        if "checkout: self\n        fetchDepth: 0\n" not in limpio_job:
            fallas.append("revision-diaria.yml: el trabajo gitleaks necesita `fetchDepth: 0` (el historial completo)")
        for malo in SILENCIOSOS:
            if malo in limpio_job:
                fallas.append(f"revision-diaria.yml: el trabajo gitleaks no puede llevar `{malo}`")
    return fallas


def textos_gitleaks():
    claves = {
        PASO_GITLEAKS: CARPETA / PASO_GITLEAKS,
        "plantillas/comun.yml": CARPETA / "plantillas" / "comun.yml",
        "../revision-diaria.yml": CARPETA / "revision-diaria.yml",
    }
    textos = {k: v.read_text(encoding="utf-8") for k, v in claves.items() if v.is_file()}
    # El resto de los YAML: ninguno puede nombrar una imagen de gitleaks.
    for ruta in sorted(CARPETA.rglob("*.yml")):
        rel = ruta.relative_to(CARPETA).as_posix()
        if rel not in textos and not any(ruta == v for v in claves.values()):
            textos[rel] = ruta.read_text(encoding="utf-8")
    return textos


# Cambios que la revisión de gitleaks debe rechazar: (archivo, texto, reemplazo).
MUTACIONES_GITLEAKS = (
    (PASO_GITLEAKS, "set -euo pipefail", "set -eu"),
    (PASO_GITLEAKS, '--log-opts="--diff-merges=first-parent $rango"', "--redact"),
    (PASO_GITLEAKS, '--log-opts="--diff-merges=first-parent $rango"', '--log-opts="$rango"'),
    (PASO_GITLEAKS, "(ERR|FTL)", "(XXX)"),
    (PASO_GITLEAKS, "    displayName:", "    enabled: false\n    displayName:"),
    (PASO_GITLEAKS, ":/repo:ro", ":/repo"),
    (PASO_GITLEAKS, "$rango\" 2>&1 | tee", "$rango\" 2>&1 || true | tee"),
    (PASO_GITLEAKS, "    displayName:", "    condition: false\n    displayName:"),
    (PASO_GITLEAKS, "    displayName:", "    continueOnError: true\n    displayName:"),
    (PASO_GITLEAKS, "is-shallow-repository", "rev-parse"),
    (PASO_GITLEAKS, 'total=$(git rev-list --count "${revs[@]}")', 'total=$(git rev-list "${revs[@]}" | wc -l)'),
    (PASO_GITLEAKS, "rev-list --count --no-merges", "rev-list --count"),
    (PASO_GITLEAKS, r"\) commits scanned", r"\) commits"),
    (PASO_GITLEAKS, "@sha256:", "@sha257:"),
    (PASO_GITLEAKS, "  - name: rango\n    type: string\n", "  - name: rango\n    type: string\n    default: HEAD\n"),
    # El PR revisa contra su rama destino: ni todo el historial (`HEAD`) ni un `origin/main` fijo.
    ("plantillas/comun.yml", "rango: PR", "rango: HEAD"),
    ("plantillas/comun.yml", "rango: PR", "rango: origin/main..HEAD"),
    (PASO_GITLEAKS, '[ "$GITLEAKS_MOTIVO" = PullRequest ]', "true"),
    (PASO_GITLEAKS, 'rango="origin/$destino..HEAD"', 'rango="origin/main..HEAD"'),
    (PASO_GITLEAKS, "GITLEAKS_DESTINO_PR: $(System.PullRequest.TargetBranch)", "GITLEAKS_DESTINO_PR: refs/heads/main"),
    (PASO_GITLEAKS, "[A-Za-z0-9._/-]+", ".*"),
    # El contenedor con nombre y etiqueta propios, y su limpieza por nombre, siempre y sin prune.
    (PASO_GITLEAKS, '--name "$GITLEAKS_CONTENEDOR" ', ""),
    (PASO_GITLEAKS, "--label alcanzamos.ci=gitleaks ", ""),
    (PASO_GITLEAKS, "GITLEAKS_CONTENEDOR: gitleaks-$(Build.BuildId)", "GITLEAKS_CONTENEDOR: gitleaks"),
    (PASO_GITLEAKS, "    condition: always()\n", "    condition: succeeded()\n"),
    (PASO_GITLEAKS, "    condition: always()\n", ""),
    (PASO_GITLEAKS, "    condition: always()\n", "    condition: always()\n    continueOnError: true\n"),
    (PASO_GITLEAKS, '        docker rm --force "$GITLEAKS_CONTENEDOR"\n      fi\n    env:', '        docker container prune --force\n      fi\n    env:'),
    (PASO_GITLEAKS, '        docker rm --force "$GITLEAKS_CONTENEDOR"\n      fi\n    env:', '        docker rm --force gitleaks\n      fi\n    env:'),
    (PASO_GITLEAKS, '        docker rm --force "$GITLEAKS_CONTENEDOR"\n      fi\n    env:', '        docker rm --force $(docker ps --all --quiet)\n      fi\n    env:'),

    ("plantillas/comun.yml", "        fetchDepth: 0\n", "        fetchDepth: 50\n"),
    ("plantillas/comun.yml", "      - template: pasos/gitleaks.yml\n", "      - script: docker run ghcr.io/gitleaks/gitleaks:latest git /repo\n      - template: pasos/gitleaks.yml\n"),
    # La revisión diaria recorre todas las ramas remotas: ni solo HEAD (main), ni un rango, ni el del PR.
    ("../revision-diaria.yml", "rango: RAMAS", "rango: HEAD"),
    ("../revision-diaria.yml", "rango: RAMAS", "rango: HEAD~1..HEAD"),
    ("../revision-diaria.yml", "rango: RAMAS", "rango: origin/main"),
    ("../revision-diaria.yml", "rango: RAMAS", "rango: PR"),
    ("../revision-diaria.yml", "        fetchDepth: 0\n", "        fetchDepth: 1\n"),
    (PASO_GITLEAKS, "revs=(HEAD --remotes=origin)", "revs=(HEAD)"),
    (PASO_GITLEAKS, "revs=(HEAD --remotes=origin)", "revs=(HEAD --branches)"),
    (PASO_GITLEAKS, "revs=(HEAD --remotes=origin)", "revs=(--remotes=origin)"),
    (PASO_GITLEAKS, 'total=$(git rev-list --count "${revs[@]}")', 'total=$(git rev-list --count "$rango")'),
    ("../revision-diaria.yml", "  - job: gitleaks\n", "  - job: gitleaks\n    condition: false\n"),
    ("../revision-diaria.yml", "  - job: gitleaks\n", "  - job: gitleaks\n    enabled: false\n"),
    ("../revision-diaria.yml", "  - job: gitleaks\n", "  - job: gitleaks2\n"),
    ("plantillas/comun.yml", "  - job: comun\n", "  - job: comun\n    condition: false\n"),
    ("plantillas/comun.yml", "  - job: comun\n", "  - job: comun\n    enabled: false\n"),
    ("plantillas/comun.yml", "  - job: comun\n", "  - job: comun\n    continueOnError: true\n"),
    ("plantillas/comun.yml", "    steps:\n", "    condition: eq(1, 2)\n    steps:\n"),
)


def revisar_mutaciones_gitleaks(textos):
    fallas = []
    for archivo, viejo, nuevo in MUTACIONES_GITLEAKS:
        texto = textos.get(archivo, "")
        if texto.count(viejo) < 1:
            fallas.append(f"mutación sin su texto en {archivo}: {viejo!r}")
            continue
        mutados = dict(textos)
        mutados[archivo] = texto.replace(viejo, nuevo, 1)
        if not revisar_gitleaks(mutados):
            fallas.append(f"la revisión de gitleaks no detecta el cambio en {archivo}: {viejo!r} -> {nuevo!r}")
    return fallas


# Un `docker` falso: anota cada llamada en $DOCKER_LLAMADAS; `run` guarda sus argumentos en $DOCKER_ARGS e imprime $FALSO_SALIDA con el
# código $FALSO_CODIGO (como gitleaks); `ps` con `--filter` lista $FALSO_EXISTE (el contenedor que ya existe, si lo hay) y sin filtro
# lista además un contenedor ajeno del dueño (que un paso nunca debe tocar); lo demás no hace nada.
DOCKER_FALSO = """#!/usr/bin/env bash
printf '%s\\n' "docker $*" >> "$DOCKER_LLAMADAS"
case "$1" in
  run)
    printf '%s\\n' "$@" > "$DOCKER_ARGS"
    printf '%s\\n' "$FALSO_SALIDA"
    exit "${FALSO_CODIGO:-0}"
    ;;
  ps)
    case "$*" in
      *--filter*) if [ -n "${FALSO_EXISTE:-}" ]; then printf '%s\\n' "$FALSO_EXISTE"; fi ;;
      *) printf '%s\\n' "$FALSO_EXISTE" "contenedor-ajeno-del-dueno" ;;
    esac
    ;;
esac
exit 0
"""


def git(cwd, *args, check=True):
    entorno = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
               "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
    return subprocess.run(["git", *args], cwd=cwd, env=entorno, check=check, capture_output=True, text=True).stdout.strip()


def padres_de_head(destino):
    return git(destino, "rev-list", "--parents", "-n", "1", "HEAD").split()[1:]


def repo_de_ejemplo(destino, origin_main=True, commits_del_pr=2):
    """Lo que baja Azure en un PR (refs/pull/N/merge): main con 2 commits (origin/main en el segundo); el PR sale del primero y
    suma `commits_del_pr` commits; HEAD es el commit de fusión, con dos padres: la punta de main y la del PR."""
    git(destino, "init", "-q", "-b", "main")
    for n in (1, 2):
        (destino / "a.txt").write_text(f"base {n}\n")
        git(destino, "add", "-A")
        git(destino, "commit", "-q", "-m", f"base {n}")
    if origin_main:
        git(destino, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(destino, "checkout", "-q", "-b", "pr-commits", "HEAD~1")
    for n in range(commits_del_pr):
        (destino / f"pr{n}.txt").write_text(f"pr {n}\n")
        git(destino, "add", "-A")
        git(destino, "commit", "-q", "-m", f"pr {n}")
    git(destino, "checkout", "-q", "-b", "pr", "main")
    git(destino, "merge", "-q", "--no-ff", "-m", "fusion", "pr-commits")
    assert padres_de_head(destino) == [git(destino, "rev-parse", "main"), git(destino, "rev-parse", "pr-commits")], \
        "el repositorio de ejemplo debe terminar en un commit de fusión (dos padres: main y el PR), como refs/pull/N/merge"


MARCA_DE_LA_FUSION = "valor-solo-en-la-fusion"
MARCA_DE_LA_RAMA = "valor-solo-en-una-rama-remota"


def repo_con_rama_remota(destino):
    """Lo que baja Azure en la revisión diaria: HEAD suelto en la punta de main, `refs/remotes/origin/main` y una rama remota
    (`refs/remotes/origin/otra`) con un commit que no está en main y que suma MARCA_DE_LA_RAMA (el secreto). Esa rama existe solo como
    rama remota (la local se borra): el único camino hasta su commit es `refs/remotes/origin/*`."""
    git(destino, "init", "-q", "-b", "main")
    for n in (1, 2):
        (destino / "a.txt").write_text(f"base {n}\n")
        git(destino, "add", "-A")
        git(destino, "commit", "-q", "-m", f"base {n}")
    git(destino, "checkout", "-q", "-b", "otra")
    (destino / "secreto.txt").write_text(f"{MARCA_DE_LA_RAMA}\n")
    git(destino, "add", "-A")
    git(destino, "commit", "-q", "-m", "rama que nunca llega a un PR")
    git(destino, "update-ref", "refs/remotes/origin/otra", "otra")
    git(destino, "update-ref", "refs/remotes/origin/main", "main")
    git(destino, "checkout", "-q", "--detach", "main")
    git(destino, "branch", "-q", "-D", "otra")
    assert "otra" not in git(destino, "branch", "--format=%(refname:short)").split(), "la rama debe existir solo como rama remota"
    assert git(destino, "rev-parse", "--verify", "refs/remotes/origin/otra")


def repo_con_conflicto(destino):
    """Como `repo_de_ejemplo`, pero main y el PR cambian la misma línea: la fusión tiene conflicto, se resuelve a mano y deja una
    línea (MARCA_DE_LA_FUSION) que no está en ningún padre ni en ningún commit del PR."""
    git(destino, "init", "-q", "-b", "main")
    (destino / "c.txt").write_text("uno\nlinea\ntres\n")
    git(destino, "add", "-A")
    git(destino, "commit", "-q", "-m", "base")
    git(destino, "checkout", "-q", "-b", "pr-commits")
    (destino / "c.txt").write_text("uno\nlinea pr\ntres\n")
    git(destino, "commit", "-q", "-am", "pr 1")
    (destino / "otro.txt").write_text("x\n")
    git(destino, "add", "-A")
    git(destino, "commit", "-q", "-m", "pr 2")
    git(destino, "checkout", "-q", "main")
    (destino / "c.txt").write_text("uno\nlinea main\ntres\n")
    git(destino, "commit", "-q", "-am", "main avanza")
    git(destino, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(destino, "checkout", "-q", "-b", "pr")
    git(destino, "merge", "--no-ff", "pr-commits", check=False)
    assert (destino / ".git" / "MERGE_HEAD").is_file(), "el ejemplo necesita una fusión detenida por un conflicto"
    (destino / "c.txt").write_text(f"uno\n{MARCA_DE_LA_FUSION}\ntres\n")
    git(destino, "add", "-A")
    git(destino, "commit", "-q", "-m", "fusion resuelta")
    assert len(padres_de_head(destino)) == 2


# Lo que Azure le da al paso en un PR hacia main (la rama destino como `refs/heads/main`), con el nombre del contenedor de la corrida 4242.
ENTORNO_DE_UN_PR = {"GITLEAKS_MOTIVO": "PullRequest", "GITLEAKS_DESTINO_PR": "refs/heads/main", "GITLEAKS_CONTENEDOR": "gitleaks-4242"}


def correr_paso(raiz_repo, script, rango, salida_falsa, codigo=0, bin_falso=None, args=None, extra=None):
    """Corre un script del paso con un `docker` falso. Devuelve (código, salida, argumentos del `docker run` o None, llamadas a docker)."""
    llamadas = args.with_name("docker-llamadas.txt")
    entorno = {**os.environ, "PATH": f"{bin_falso}{os.pathsep}{os.environ['PATH']}", "GITLEAKS_RANGO": rango,
               "GITLEAKS_IMAGEN": "ghcr.io/gitleaks/gitleaks:v0.0.0@sha256:" + "0" * 64, "FUENTES": str(raiz_repo),
               "TEMPORAL": str(bin_falso), "DOCKER_ARGS": str(args), "DOCKER_LLAMADAS": str(llamadas),
               "FALSO_SALIDA": salida_falsa, "FALSO_CODIGO": str(codigo),
               "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull, **ENTORNO_DE_UN_PR, **(extra or {})}
    r = subprocess.run(["bash", "-c", script], cwd=raiz_repo, env=entorno, capture_output=True, text=True)
    recibido = args.read_text().splitlines() if args.is_file() else None
    return r.returncode, r.stdout + r.stderr, recibido, llamadas.read_text().splitlines() if llamadas.is_file() else []


def llamadas_ajenas(llamadas, contenedor):
    """Lo que el paso nunca debe hacer en Docker (AGENTS.md): `prune` o quitar algo que no sea el contenedor de esta corrida."""
    malas = [l for l in llamadas if "prune" in l or (l.startswith("docker rm") and l != f"docker rm --force {contenedor}")]
    return f"llamadas de más a docker: {malas}" if malas else ""


def probar_script_gitleaks(script, limpieza, callar=False):
    """Corre el script que revisa y el de la limpieza del paso con un docker falso. Devuelve la lista de fallas. Cada caso dice qué
    debe pasar. Con `callar` no imprime los casos (lo usa la revisión de las mutaciones del script)."""
    fallas = []
    if script is None or limpieza is None:
        return [f"{PASO_GITLEAKS}: sin script que probar"]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        bin_falso = tmp / "bin"
        bin_falso.mkdir()
        (bin_falso / "docker").write_text(DOCKER_FALSO)
        (bin_falso / "docker").chmod(0o755)
        args = tmp / "docker-args.txt"
        ok = "INF 2 commits scanned.\nINF no leaks found"
        contador = []

        def caso(nombre, cuando, rango, salida, codigo, debe_pasar, llama_a_docker, esperado_en_args=(), mensaje="", comprobar=None,
                 entorno=None, cuerpo=None, ausente_en_args=()):
            """`entorno` cambia lo que Azure le da al paso; `cuerpo` es el script que corre (por defecto el que revisa);
            `comprobar(repo, argumentos de run, llamadas a docker)` devuelve un texto si algo no es como debe ser."""
            contador.append(nombre)
            carpeta = tmp / f"caso{len(contador)}"
            carpeta.mkdir()
            for viejo in (args, args.with_name("docker-llamadas.txt")):
                if viejo.is_file():
                    viejo.unlink()
            cuando(carpeta)
            repo = carpeta / "r"
            if not repo.is_dir():
                repo = carpeta
            rc, texto, recibido, llamadas = correr_paso(repo, cuerpo or script, rango, salida, codigo, bin_falso, args, entorno)
            contenedor = {**ENTORNO_DE_UN_PR, **(entorno or {})}["GITLEAKS_CONTENEDOR"]
            bien = (rc == 0) == debe_pasar and (recibido is not None) == llama_a_docker
            bien = bien and all(x in (recibido or []) for x in esperado_en_args) and mensaje in texto
            bien = bien and not any(x in (recibido or []) for x in ausente_en_args)
            extra = (comprobar(repo, recibido or [], llamadas) if comprobar else "") or llamadas_ajenas(llamadas, contenedor)
            bien = bien and not extra
            if not callar:
                print(f"{'ok' if bien else 'FALLA':5} gitleaks (paso): {nombre}: código {rc}, docker {'llamado' if recibido is not None else 'no llamado'}")
            if not bien:
                fallas.append(f"gitleaks (paso): {nombre}: código {rc}, docker {recibido} {extra}\n{texto}")

        def normal(c):
            repo_de_ejemplo(c)

        def sin_origin_main(c):
            repo_de_ejemplo(c, origin_main=False)

        def rango_vacio(c):
            repo_de_ejemplo(c)
            git(c, "checkout", "-q", "main")

        def superficial(c):
            repo_de_ejemplo(c)
            subprocess.run(["git", "clone", "-q", "--depth", "1", "--no-local", "--branch", "pr", f"file://{c}", str(c / "r")],
                           check=True, capture_output=True, env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull})

        def completo(c):
            repo_de_ejemplo(c)
            git(c, "checkout", "-q", "main")

        def con_conflicto(c):
            repo_con_conflicto(c)

        def con_rama_remota(c):
            repo_con_rama_remota(c)

        def pr_con_otra_rama_remota(c):
            """Un PR (HEAD es una fusión) en un clon que además tiene otra rama remota con un secreto que el PR no trae."""
            repo_de_ejemplo(c)
            git(c, "checkout", "-q", "-b", "otra", "main~1")
            (c / "secreto.txt").write_text(f"{MARCA_DE_LA_RAMA}\n")
            git(c, "add", "-A")
            git(c, "commit", "-q", "-m", "otra rama")
            git(c, "update-ref", "refs/remotes/origin/otra", "otra")
            git(c, "checkout", "-q", "pr")
            git(c, "branch", "-q", "-D", "otra")

        def sin_ramas_remotas(c):
            repo_de_ejemplo(c, origin_main=False)
            git(c, "checkout", "-q", "main")

        def head_es_fusion(c):
            repo_de_ejemplo(c)

        def con_release(c):
            """Un PR hacia release/1.2: esa rama está un commit atrás de main, así que su rango tiene un commit más que el de main."""
            repo_de_ejemplo(c)
            git(c, "update-ref", "refs/remotes/origin/release/1.2", "main~1")

        def fusion_en_el_diff(repo, recibido, _llamadas):
            """Lo que gitleaks lee es `git log -p -U0 <log-opts>`: con las opciones que el paso le pasa, la línea que solo existe en la
            fusión resuelta debe aparecer; sin ellas (el paso anterior) no aparecía, y por eso un secreto ahí pasaba sin que nadie lo viera."""
            opts = next((a.split("=", 1)[1] for a in recibido if a.startswith("--log-opts=")), None)
            if opts is None:
                return "docker no recibió --log-opts"
            entorno = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
            con = subprocess.run(["git", "log", "-p", "-U0", *opts.split(" ")], cwd=repo, env=entorno, capture_output=True, text=True).stdout
            sin = subprocess.run(["git", "log", "-p", "-U0", opts.split(" ")[-1]], cwd=repo, env=entorno, capture_output=True, text=True).stdout
            if MARCA_DE_LA_FUSION in sin:
                return "la prueba no distingue: el rango sin opciones ya muestra la línea de la fusión"
            if MARCA_DE_LA_FUSION not in con:
                return f"`git log -p -U0 {opts}` no muestra la línea que solo agregó la fusión resuelta"
            return ""

        def rama_remota_en_el_diff(repo, recibido, _llamadas):
            """Lo que gitleaks lee es `git log -p -U0 <log-opts>`: la línea que solo existe en una rama remota (que no es main ni HEAD) debe
            aparecer con las opciones que el paso le pasa; con `HEAD` solo (la revisión anterior) no aparece, y por eso un secreto en una
            rama que nunca llega a un PR no lo veía ningún pipeline (revisión del 2026-11-20)."""
            opts = next((a.split("=", 1)[1] for a in recibido if a.startswith("--log-opts=")), None)
            if opts is None:
                return "docker no recibió --log-opts"
            entorno = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
            con = subprocess.run(["git", "log", "-p", "-U0", *opts.split(" ")], cwd=repo, env=entorno, capture_output=True, text=True).stdout
            sin = subprocess.run(["git", "log", "-p", "-U0", "HEAD"], cwd=repo, env=entorno, capture_output=True, text=True).stdout
            if MARCA_DE_LA_RAMA in sin:
                return "la prueba no distingue: HEAD solo ya llega al commit de la rama remota"
            if MARCA_DE_LA_RAMA not in con:
                return f"`git log -p -U0 {opts}` no llega al commit de la rama remota"
            return ""

        rango_pr = "origin/main..HEAD"
        rango_ramas = "--log-opts=--diff-merges=first-parent HEAD --remotes=origin"
        caso("PR con 2 commits: gitleaks recibe solo el rango", normal, rango_pr, ok, 0, True, True,
             (f"--log-opts=--diff-merges=first-parent {rango_pr}", "git", "/repo", "--redact", "--no-banner"))

        # La base del rango del PR sale de su rama destino (System.PullRequest.TargetBranch), no de un origin/main fijo.
        def rango_de(base):
            return f"--log-opts=--diff-merges=first-parent {base}..HEAD"

        caso("PR hacia main (refs/heads/main): el rango es origin/main..HEAD", normal, "PR", ok, 0, True, True, (rango_de("origin/main"),))
        caso("PR hacia main con la rama sin refs/heads (main): el mismo rango", normal, "PR", ok, 0, True, True, (rango_de("origin/main"),),
             entorno={"GITLEAKS_DESTINO_PR": "main"})
        caso("PR hacia release/1.2: el rango es origin/release/1.2..HEAD y no origin/main..HEAD", con_release, "PR", ok, 0, True, True,
             (rango_de("origin/release/1.2"),), entorno={"GITLEAKS_DESTINO_PR": "refs/heads/release/1.2"},
             ausente_en_args=(rango_de("origin/main"),))
        caso("PR hacia release/1.2 con la rama sin refs/heads: el mismo rango", con_release, "PR", ok, 0, True, True,
             (rango_de("origin/release/1.2"),), entorno={"GITLEAKS_DESTINO_PR": "release/1.2"})
        caso("PR hacia una rama que no está en el clon: falla sin llamar a gitleaks", normal, "PR", ok, 0, False, False,
             entorno={"GITLEAKS_DESTINO_PR": "refs/heads/release/9.9"},
             mensaje="la referencia origin/release/9.9 del rango origin/release/9.9..HEAD no existe")
        caso("PR sin rama destino (la variable llega sin resolver): falla, no adivina main", normal, "PR", ok, 0, False, False,
             entorno={"GITLEAKS_DESTINO_PR": "$(System.PullRequest.TargetBranch)"}, mensaje="Azure no dio la rama destino")
        caso("PR con la rama destino vacía: falla, no adivina main", normal, "PR", ok, 0, False, False,
             entorno={"GITLEAKS_DESTINO_PR": ""}, mensaje="Azure no dio la rama destino")
        for malo in ("refs/heads/--all", "main --all", "refs/heads/a..b", "main;id", "refs/heads/x$(id)", "main\nHEAD"):
            caso(f"PR con la rama destino {malo!r}, que no es un nombre de rama: falla sin llamar a gitleaks", normal, "PR", ok, 0, False, False,
                 entorno={"GITLEAKS_DESTINO_PR": malo}, mensaje="no tiene un nombre de rama válido")
        caso("corrida sin PR (manual): no hay rama destino y revisa origin/main..HEAD", normal, "PR", ok, 0, True, True, (rango_de("origin/main"),),
             entorno={"GITLEAKS_MOTIVO": "Manual", "GITLEAKS_DESTINO_PR": "$(System.PullRequest.TargetBranch)"})
        caso("la revisión diaria (RAMAS) no depende de la rama destino", completo, "RAMAS", "INF 2 commits scanned.", 0, True, True,
             (rango_ramas,), entorno={"GITLEAKS_MOTIVO": "Schedule", "GITLEAKS_DESTINO_PR": "$(System.PullRequest.TargetBranch)"})
        # Contenedor propio: nombre único por corrida y etiqueta, para quitarlo por nombre si la corrida se corta.
        caso("el contenedor lleva el nombre de la corrida y la etiqueta propia", normal, rango_pr, ok, 0, True, True,
             ("--rm", "--name", "gitleaks-4242", "--label", "alcanzamos.ci=gitleaks"))
        caso("otra corrida, otro nombre (gitleaks-9001) y no el de la anterior", normal, rango_pr, ok, 0, True, True,
             ("--name", "gitleaks-9001"), entorno={"GITLEAKS_CONTENEDOR": "gitleaks-9001"}, ausente_en_args=("gitleaks-4242",))
        caso("sin contenedor previo no se quita nada", normal, rango_pr, ok, 0, True, True,
             comprobar=lambda repo, rec, llamadas: "" if not any(l.startswith("docker rm") for l in llamadas) else f"quitó algo: {llamadas}")
        caso("se vuelve a correr el trabajo y el nombre ya existe: se quita por su nombre exacto, antes de crear el nuevo", normal, rango_pr, ok, 0, True, True,
             entorno={"FALSO_EXISTE": "gitleaks-4242"},
             comprobar=lambda repo, rec, llamadas: "" if [l for l in llamadas if l.startswith(("docker rm", "docker run"))][:2] == [
                 "docker rm --force gitleaks-4242", next((l for l in llamadas if l.startswith("docker run")), "")] else f"llamadas: {llamadas}")
        # La limpieza: siempre, por el nombre exacto, sin `prune` y sin tocar nada más.
        caso("limpieza: el contenedor de la corrida quedó (corrida cortada): se quita por su nombre", normal, "HEAD", "", 0, True, False,
             cuerpo=limpieza, entorno={"FALSO_EXISTE": "gitleaks-4242"},
             comprobar=lambda repo, rec, llamadas: "" if "docker rm --force gitleaks-4242" in llamadas else f"llamadas: {llamadas}")
        caso("limpieza: no quedó contenedor (`--rm` lo borró): no quita nada y no falla", normal, "HEAD", "", 0, True, False, cuerpo=limpieza,
             comprobar=lambda repo, rec, llamadas: "" if not any(l.startswith("docker rm") for l in llamadas) else f"quitó algo: {llamadas}")
        caso("limpieza: filtra por el nombre exacto de la corrida (con ^ y $), no por un parecido", normal, "HEAD", "", 0, True, False, cuerpo=limpieza,
             comprobar=lambda repo, rec, llamadas: "" if any("name=^gitleaks-4242$" in l for l in llamadas) else f"llamadas: {llamadas}")
        caso("gitleaks encuentra un secreto (código 1): el paso falla", normal, rango_pr, "INF 2 commits scanned.\nWRN leaks found: 1", 1, False, True,
             mensaje="leaks found: 1")
        caso("falta origin/main: el paso falla sin llamar a gitleaks", sin_origin_main, rango_pr, ok, 0, False, False,
             mensaje="la referencia origin/main del rango origin/main..HEAD no existe")
        caso("rango vacío (HEAD ya está en origin/main): el paso falla", rango_vacio, rango_pr, ok, 0, False, False,
             mensaje="no tiene ningún commit")
        caso("clon superficial: el paso falla", superficial, rango_pr, ok, 0, False, False, mensaje="el clon es superficial")
        caso("gitleaks revisó 0 commits habiendo commits: el paso falla", normal, rango_pr, "INF 0 commits scanned.\nINF no leaks found", 0, False, True,
             mensaje="gitleaks revisó 0 commits")
        caso("gitleaks no informa cuántos commits revisó: el paso falla", normal, rango_pr, "INF no leaks found", 0, False, True,
             mensaje="gitleaks no informó cuántos commits revisó")
        caso("una referencia inexistente en el rango: el paso falla sin llamar a gitleaks", normal, "origin/otra..HEAD", ok, 0, False, False,
             mensaje="la referencia origin/otra del rango origin/otra..HEAD no existe")
        caso("HEAD del PR es un commit de fusión con dos padres (como refs/pull/N/merge)", head_es_fusion, rango_pr, ok, 0, True, True,
             comprobar=lambda repo, _, __: "" if len(padres_de_head(repo)) == 2 else "HEAD no es un commit de fusión")
        caso("fusión con conflicto resuelto a mano: el diff de la fusión llega a gitleaks", con_conflicto, rango_pr, ok, 0, True, True,
             (f"--log-opts=--diff-merges=first-parent {rango_pr}",), comprobar=fusion_en_el_diff)
        caso("gitleaks sale con 0 pero informa ERR y cuenta commits: el paso falla", normal, rango_pr,
             "ERR git stderr is not empty\nINF 1 commits scanned\nINF no leaks found", 0, False, True, mensaje="gitleaks informó un error")
        caso("gitleaks sale con 0 pero informa FTL: el paso falla", normal, rango_pr,
             "FTL algo grave\nINF 2 commits scanned\nINF no leaks found", 0, False, True, mensaje="gitleaks informó un error")
        caso("ERR con colores del terminal (como lo imprime gitleaks): el paso falla", normal, rango_pr,
             "\x1b[90m7:16PM\x1b[0m \x1b[31mERR\x1b[0m error=\"stderr is not empty\"\n\x1b[90m7:16PM\x1b[0m INF 1 commits scanned.", 0, False, True,
             mensaje="gitleaks informó un error")
        caso("una advertencia WRN o la palabra ERRORES dentro de otra línea no falla el paso", normal, rango_pr,
             "WRN algo menor\nINF carpeta ERRORES sin hallazgos\nINF 2 commits scanned.\nINF no leaks found", 0, True, True)
        caso("revisión diaria: RAMAS revisa HEAD y todas las ramas remotas de origin", completo, "RAMAS", "INF 2 commits scanned.", 0, True, True,
             (rango_ramas,), mensaje="rango HEAD --remotes=origin")
        caso("revisión diaria con un secreto (código 1): el paso falla", completo, "RAMAS", "INF 2 commits scanned.\nWRN leaks found: 1", 1, False, True,
             mensaje="leaks found: 1")
        # R1 (revisión del 2026-11-20): un secreto en una rama remota que nunca llega a un PR hacia main no lo ve ningún PR.
        caso("revisión diaria: un secreto que solo está en una rama remota que no es main llega a gitleaks", con_rama_remota, "RAMAS",
             "INF 3 commits scanned.", 0, True, True, (rango_ramas,), comprobar=rama_remota_en_el_diff)
        caso("revisión diaria: el secreto de una rama remota que gitleaks encuentra (código 1) falla el paso", con_rama_remota, "RAMAS",
             "INF 3 commits scanned.\nWRN leaks found: 1", 1, False, True, (rango_ramas,), mensaje="leaks found: 1",
             comprobar=rama_remota_en_el_diff)
        caso("revisión diaria sin ramas remotas en el clon (el checkout no las bajó): falla sin llamar a gitleaks", sin_ramas_remotas, "RAMAS",
             ok, 0, False, False, mensaje="no hay ramas remotas")
        def pr_sin_otra_rama(repo, recibido, _llamadas):
            opts = next((a.split("=", 1)[1] for a in recibido if a.startswith("--log-opts=")), None)
            if opts is None:
                return "docker no recibió --log-opts"
            entorno = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
            diff = subprocess.run(["git", "log", "-p", "-U0", *opts.split(" ")], cwd=repo, env=entorno, capture_output=True, text=True).stdout
            return "el rango del PR llegó al commit de otra rama remota" if MARCA_DE_LA_RAMA in diff else ""

        # El PR no cambia: sigue revisando solo su rango, aunque en el clon haya otras ramas remotas (corridas 718 y 719).
        caso("PR: el rango sigue siendo el de su rama destino y no entra el commit de otra rama remota", pr_con_otra_rama_remota, "PR", ok, 0, True, True,
             (rango_de("origin/main"),), ausente_en_args=(rango_ramas,),
             comprobar=pr_sin_otra_rama)
    return fallas


def pasos_gitleaks(paso):
    """(script que revisa, script de la limpieza) del paso de gitleaks, o (None, None) si el paso no tiene esos dos."""
    scripts = scripts_del_paso(paso)
    return (scripts[0], scripts[1]) if len(scripts) == 2 else (None, None)


# Cambios al script de gitleaks que sus casos de ejecución deben rechazar: (cuál script: 0 revisa, 1 limpieza; texto; reemplazo).
MUTACIONES_SCRIPT_GITLEAKS = (
    # El secreto que entra al resolver un conflicto de una fusión: sin el diff de la fusión contra su primer padre nadie lo ve.
    (0, "--diff-merges=first-parent ", ""),
    (0, 'rango="origin/$destino..HEAD"', 'rango="origin/main..HEAD"'),
    # La revisión diaria: todas las ramas remotas y no solo HEAD; sin ramas remotas en el clon, falla.
    (0, "revs=(HEAD --remotes=origin)", "revs=(HEAD)"),
    (0, "revs=(HEAD --remotes=origin)", "revs=(HEAD --branches)"),
    (0, "revs=(HEAD --remotes=origin)", "revs=(HEAD --remotes=upstream)"),
    (0, 'if [ "$rango" = RAMAS ]; then', "if false; then"),
    (0, '[ -n "$ramas" ] || fallo "no hay ramas remotas', 'true || fallo "no hay ramas remotas'),
    (0, "refs/remotes/origin | sed", "refs/remotes/upstream | sed"),
    (0, 'destino="${GITLEAKS_DESTINO_PR#refs/heads/}"', 'destino="$GITLEAKS_DESTINO_PR"'),
    (0, '[ "$GITLEAKS_MOTIVO" = PullRequest ]', "true"),
    (0, '[ "$GITLEAKS_MOTIVO" = PullRequest ]', "false"),
    (0, 'fallo "la corrida es de un PR y Azure no dio la rama destino (System.PullRequest.TargetBranch)" ;;', "destino=main ;;"),
    (0, "[A-Za-z0-9._/-]+", ".*"),
    (0, '[[ "$destino" == -* || "$destino" == *..* ]]', "false"),
    (0, '--name "$GITLEAKS_CONTENEDOR" ', ""),
    (0, "--label alcanzamos.ci=gitleaks ", ""),
    (0, 'docker rm --force "$GITLEAKS_CONTENEDOR"', "true"),
    (0, 'docker rm --force "$GITLEAKS_CONTENEDOR"', "docker container prune --force"),
    (0, 'docker rm --force "$GITLEAKS_CONTENEDOR"', "docker rm --force $(docker ps --all --quiet)"),
    (1, 'docker rm --force "$GITLEAKS_CONTENEDOR"', "true"),
    (1, 'docker rm --force "$GITLEAKS_CONTENEDOR"', "docker rm --force gitleaks"),
    (1, 'docker rm --force "$GITLEAKS_CONTENEDOR"', "docker container prune --force"),
    (1, 'docker rm --force "$GITLEAKS_CONTENEDOR"', "docker rm --force $(docker ps --all --quiet)"),
    (1, 'if [ -n "$(docker ps --all --quiet --filter "name=^${GITLEAKS_CONTENEDOR}\\$")" ]; then', "if true; then"),
    (1, '"name=^${GITLEAKS_CONTENEDOR}\\$"', '"name=gitleaks"'),
)


def revisar_mutaciones_script_gitleaks(paso):
    """Cada cambio de MUTACIONES_SCRIPT_GITLEAKS, hecho al script del paso, debe hacer fallar alguno de los casos de ejecución."""
    fallas = []
    original = pasos_gitleaks(paso)
    for cual, viejo, nuevo in MUTACIONES_SCRIPT_GITLEAKS:
        if original[cual] is None or viejo not in original[cual]:
            fallas.append(f"mutación del script sin su texto en {PASO_GITLEAKS}: {viejo!r}")
            continue
        scripts = list(original)
        scripts[cual] = original[cual].replace(viejo, nuevo)
        if not probar_script_gitleaks(scripts[0], scripts[1], callar=True):
            fallas.append(f"los casos de gitleaks (paso) no detectan el cambio {viejo!r} -> {nuevo!r}")
    return fallas


def main():
    textos = {p.stem: p.read_text(encoding="utf-8") for p in sorted(CARPETA.glob("*.yml"))}
    pipelines = {n: filtros_pr(t) for n, t in textos.items()}
    # Los programados no corren en ningún PR: no entran en la simulación de los filtros.
    por_carpeta = {n: f for n, f in pipelines.items() if n != CONTROL and n not in PROGRAMADOS}
    cambios = cargar_cambios()
    fallas = []
    if cambios is None:
        fallas.append("falta pruebas/cambios.py (el mapa de carpetas del control único, D-177)")
        print("FALLA falta pruebas/cambios.py (el mapa de carpetas del control único, D-177)")
    if CONTROL not in pipelines:
        fallas.append("falta control.yml (el control único, D-177)")
        print("FALLA falta control.yml (el control único, D-177)")
    for ruta, esperado in ESPERADO.items():
        corren = {n for n, f in por_carpeta.items() if f is None or any(coincide(x, ruta) for x in f)}
        estado = "ok" if corren == esperado else "FALLA"
        print(f"{estado:5} {ruta}: corren {sorted(corren)}; se esperaba {sorted(esperado)}")
        if corren != esperado:
            fallas.append(ruta)
        if cambios is not None:
            etapas = {"comun"} | {e for e, sí in cambios.etapas_de([ruta]).items() if sí}
            estado = "ok" if etapas == esperado else "FALLA"
            print(f"{estado:5} {ruta}: etapas del control {sorted(etapas)}; se esperaba {sorted(esperado)}")
            if etapas != esperado:
                fallas.append(f"control: {ruta}")
    for p in sorted(CARPETA.glob("*.yml")):
        if p.stem in PROGRAMADOS:
            continue
        faltan = disparadores(p.read_text(encoding="utf-8"))
        print(f"{'ok' if not faltan else 'FALLA':5} {p.name}: disparadores (D-183){'' if not faltan else '; falta ' + ', '.join(faltan)}")
        if faltan:
            fallas.append(f"{p.name}: {faltan}")
    if cambios is not None:
        otras = revisar_mapa(cambios, por_carpeta) + revisar_detector(cambios)
        if CONTROL in pipelines:
            texto = (CARPETA / f"{CONTROL}.yml").read_text(encoding="utf-8")
            otras += revisar_control(texto, list(cambios.CARPETAS)) + revisar_mutaciones(texto, list(cambios.CARPETAS))
        for falla in otras:
            print(f"FALLA {falla}")
        print(f"{'ok' if not otras else 'FALLA':5} control único (D-177): mapa de carpetas, detector y forma de control.yml")
        fallas += otras
    programados = revisar_programados(textos)
    for falla in programados:
        print(f"FALLA {falla}")
    print(f"{'ok' if not programados else 'FALLA':5} programados ({', '.join(sorted(PROGRAMADOS))}): trigger y pr none, "
          "una programación diaria solo sobre main con always: true")
    fallas += programados
    textos_g = textos_gitleaks()
    paso_g = textos_g.get(PASO_GITLEAKS)
    script_g, limpieza_g = pasos_gitleaks(paso_g) if paso_g is not None else (None, None)
    gitleaks = revisar_gitleaks(textos_g) + revisar_mutaciones_gitleaks(textos_g) + (
        probar_script_gitleaks(script_g, limpieza_g) + revisar_mutaciones_script_gitleaks(paso_g) if paso_g is not None else [])
    for falla in gitleaks:
        print(f"FALLA {falla}")
    print(f"{'ok' if not gitleaks else 'FALLA':5} gitleaks: el PR revisa solo sus commits, la revisión diaria todo el historial de todas las ramas remotas, "
          "con el mismo paso y la misma imagen por digest, y ninguna de las dos pasa en silencio")
    fallas += gitleaks
    plantillas = revisar_plantillas()
    for falla in plantillas:
        print(f"FALLA {falla}")
    print(f"{'ok' if not plantillas else 'FALLA':5} cada pipeline corre su plantilla y las plantillas existen")
    fallas += plantillas
    plantilla_api = (CARPETA / "plantillas" / "api.yml").read_text(encoding="utf-8")
    modulos = revisar_modulos_go(plantilla_api, modulos_go(), por_carpeta["api"] or [])
    modulos += revisar_mutaciones_modulos_go(plantilla_api, modulos_go(), por_carpeta["api"] or [])
    for falla in modulos:
        print(f"FALLA {falla}")
    print(f"{'ok' if not modulos else 'FALLA':5} cada módulo de Go aparte (web/servidor) corre sus pruebas en plantillas/api.yml")
    fallas += modulos
    plantillas_por_carpeta = {d.split("/")[0]: (CARPETA / "plantillas" / f"{d.split('/')[0]}.yml").read_text(encoding="utf-8")
                              for d in dockerfiles() if (CARPETA / "plantillas" / f"{d.split('/')[0]}.yml").is_file()}
    imagenes = revisar_imagenes(plantillas_por_carpeta) + revisar_mutaciones_imagenes(plantillas_por_carpeta)
    for falla in imagenes:
        print(f"FALLA {falla}")
    print(f"{'ok' if not imagenes else 'FALLA':5} cada Dockerfile ({', '.join(dockerfiles())}) se construye en su plantilla, sin publicar")
    fallas += imagenes
    agente = revisar_agente({p.name: p.read_text(encoding="utf-8") for p in sorted(CARPETA.glob("*.yml"))}
                            | {f"plantillas/{p.name}": p.read_text(encoding="utf-8") for p in sorted((CARPETA / "plantillas").glob("*.yml"))})
    for falla in agente:
        print(f"FALLA {falla}")
    print(f"{'ok' if not agente else 'FALLA':5} cada pipeline fija su pool una sola vez (no sus trabajos) y cada trabajo empieza con el espacio de trabajo limpio")
    fallas += agente
    nodo = nodo_de_pasos((CARPETA / "plantillas" / "pasos" / "node.yml").read_text(encoding="utf-8"))
    playwright = revisar_playwright((CARPETA / "plantillas" / "web.yml").read_text(encoding="utf-8"),
                                    (RAIZ / "web" / "package.json").read_text(encoding="utf-8"), nodo)
    for falla in playwright:
        print(f"FALLA {falla}")
    print(f"{'ok' if not playwright else 'FALLA':5} el e2e corre en la imagen de Playwright, fijada por digest, con la versión de @playwright/test")
    fallas += playwright
    limpieza = revisar_limpieza_docker({f"plantillas/{p.name}": p.read_text(encoding="utf-8")
                                        for p in sorted((CARPETA / "plantillas").glob("*.yml"))})
    for falla in limpieza:
        print(f"FALLA {falla}")
    print(f"{'ok' if not limpieza else 'FALLA':5} al terminar se quita por nombre solo lo que crea la corrida; las imágenes fijadas quedan (M3)")
    fallas += limpieza
    regresion = revisar_regresion()
    for falla in regresion:
        print(f"FALLA {falla}")
    fallas += regresion
    sin_caso = set(por_carpeta) - set().union(*ESPERADO.values())
    if sin_caso:
        fallas.append(f"pipelines sin caso en ESPERADO: {sorted(sin_caso)}")
        print(f"FALLA pipelines sin caso: {sorted(sin_caso)}")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
