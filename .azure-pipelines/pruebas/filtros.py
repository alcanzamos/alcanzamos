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
"""
import io
import json
import re
import importlib.util
import pathlib
import shlex
import sys
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
    # La imagen de ca-web (T13): la construye plantillas/web.yml, en la etapa web; la etapa api no la construye.
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
    `docker push` (T13, E11-INF 2.16)."""
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


# Imagen de Playwright (D3, L3): plantillas/web.yml corre `npm run e2e` dentro de la imagen oficial, fijada por digest y con la
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


# Lo que cada plantilla crea en Docker y debe quitar por nombre al terminar (L8 de la tarea del agente propio, D-213): sus
# contenedores con nombre y las imágenes que construye con la etiqueta de la corrida.
CREA_EN_DOCKER = {
    "plantillas/api.yml": ("docker rm --force pg-cobertura", 'imagen="alcanzamos-api:$(Build.BuildId)"'),
    "plantillas/web.yml": ('imagen="alcanzamos-web:$(Build.BuildId)"',),
}


def revisar_limpieza_docker(textos):
    """Limpieza de Docker al terminar (D-213, L8): se quita solo lo que la corrida crea (sus contenedores con nombre y las
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
