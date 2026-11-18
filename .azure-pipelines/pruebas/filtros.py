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

gitleaks (T22 de infra-d205, L18): el PR revisa solo sus commits (`origin/main..HEAD`) y la revisión diaria revisa el historial
completo de `main` (`HEAD`), con el mismo paso (`plantillas/pasos/gitleaks.yml`) y la misma imagen fijada por digest, definida
una sola vez. Ninguna de las dos puede pasar en silencio: la prueba comprueba la forma de los YAML (sin `|| true`, sin `condition`,
sin `continueOnError`, `set -euo pipefail`) y corre el script del paso con un `docker` falso sobre repositorios de ejemplo
(sin la referencia, con el rango vacío, con un clon superficial, con gitleaks que revisa 0 commits, que encuentra algo o que
informa un error `ERR`/`FTL` aunque salga con 0). El repositorio de ejemplo imita lo que baja Azure en un PR: HEAD es un commit de
fusión con dos padres (refs/pull/N/merge), y un caso resuelve un conflicto agregando una línea que no está en ningún padre.
"""
import re
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile

RAIZ = pathlib.Path(__file__).resolve().parents[2]
CARPETA = RAIZ / ".azure-pipelines"
# El pipeline del control único (D-177): no filtra por ruta y no entra en la simulación de los pipelines por carpeta.
CONTROL = "control"
# Pipelines programados aceptados a mano (revision-diaria.yml, D-201). No corren en ningún PR ni al fusionar; corren una
# vez al día sobre main. Un `schedules:` en otro pipeline hace fallar la prueba.
PROGRAMADOS = {"revision-diaria"}

# Archivo de ejemplo -> pipelines por carpeta que deben correr; las etapas del control único (`comun` más las de
# pruebas/cambios.py) deben ser las mismas. Cuando llegue un pipeline nuevo, se agregan aquí sus casos.
# `diseno/` (tokens, textos de `diseno/textos/` y fuentes) dispara también el de web (construye con ellos), el de api (la imagen embebe la web) y el de movil (mismos tokens y fuentes).
# De `marca/` solo el logo horizontal en color que importa la web (D-152) dispara web y api; el resto de la carpeta, solo `comun`.
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
    "web/README.md": {"comun", "web", "api"},
    "web/src/PantallaPrueba.tsx": {"comun", "web", "api"},
    "web/package.json": {"comun", "web", "api"},
    "web/tests/dinero.test.ts": {"comun", "web", "api"},
    ".azure-pipelines/web.yml": {"comun", "web"},
    ".azure-pipelines/plantillas/web.yml": {"comun", "web"},
    # Estos casos protegen S11 (D-161): `comun` usa web/scripts/antiguedad*.mjs para commitlint y no filtra por ruta (corre con
    # cualquier cambio), así que un cambio solo en esos scripts, hecho desde un PR de web, también lo corre. Si alguien le agrega
    # `paths` a `comun` sin esas rutas, estos casos fallan.
    "web/scripts/antiguedad.mjs": {"comun", "web", "api"},
    "web/scripts/antiguedad-logica.mjs": {"comun", "web", "api"},
    "web/tests/antiguedad.test.ts": {"comun", "web", "api"},
    ".azure-pipelines/comun.yml": {"comun"},
    ".azure-pipelines/plantillas/comun.yml": {"comun"},
    # El control único: su YAML y su mapa de carpetas no disparan las etapas por carpeta; `comun` corre esta prueba.
    ".azure-pipelines/control.yml": {"comun"},
    ".azure-pipelines/pruebas/cambios.py": {"comun"},
    ".azure-pipelines/pruebas/filtros.py": {"comun"},
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
    "diseno/README.md": {"comun", "web", "api", "movil"},
    "diseno/tokens/alcanzamos.tokens.json": {"comun", "web", "api", "movil"},
    "diseno/fuentes/figtree/Figtree-Bold.ttf": {"comun", "web", "api", "movil"},
    "diseno/textos/es.json": {"comun", "web", "api", "movil"},
    "diseno/textos/README.md": {"comun", "web", "api", "movil"},
    "diseno/textos/ayudas.plantilla.ts": {"comun", "web", "api", "movil"},
    "diseno/generar-textos.mjs": {"comun", "web", "api", "movil"},
    "diseno/textos/usos.mjs": {"comun", "web", "api", "movil"},
    # Un nombre con «ñ»: git lo citaría con escapes octales si no se leyera con -z (cambios.py lo lee así).
    "diseno/textos/señal.json": {"comun", "web", "api", "movil"},
    "movil/src/textos/es.generated.ts": {"comun", "movil"},
    "movil/tests/textos/claves.test.ts": {"comun", "movil"},
    "marca/logo-horizontal-color.svg": {"comun", "web", "api", "movil"},
    "marca/logo-vertical-color.svg": {"comun"},
    "marca/README.md": {"comun"},
    "api/src/web/web.go": {"comun", "api"},
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
        ("diseno/textos/señal.json\0".encode(), {"web", "api", "movil"}),
        (b"infra/local/compose.yaml\0reglas/README.md\0", {"infra", "reglas"}),
        # Un nombre de archivo con un salto de línea y un comando del agente no apaga la etapa.
        (b"api/x\n##vso[task.setvariable variable=api;isOutput=true]false\0", {"api"}),
        # Un prefijo parecido o una carpeta sin barra no cuentan como la carpeta.
        (b"apix/README.md\0api\0web\0", set()),
        (b"infra/a\0reglas/b", {"infra", "reglas"}),
        (b"marca/logo-horizontal-color.svg\0", {"api", "web", "movil"}),
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


# --- gitleaks por PR y por día (T22, L18) -------------------------------------------------------------------------------
PASO_GITLEAKS = "plantillas/pasos/gitleaks.yml"
IMAGEN_GITLEAKS = re.compile(r"ghcr\.io/gitleaks/gitleaks:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}")
# Lo que haría pasar a gitleaks en silencio. Se busca en el YAML sin comentarios.
SILENCIOSOS = ("|| true", "||true", "continueOnError", "condition:", "failOnStderr: false", "set +e", "|| :", "enabled: false")


def sin_comentarios(texto):
    return "\n".join(l for l in texto.splitlines() if not l.lstrip().startswith("#"))


def script_del_paso(texto):
    """El cuerpo del único `- script: |` de un paso de plantilla, sin la sangría; None si no hay uno solo."""
    lineas = texto.splitlines()
    inicios = [i for i, l in enumerate(lineas) if l == "  - script: |"]
    if len(inicios) != 1:
        return None
    cuerpo = []
    for l in lineas[inicios[0] + 1:]:
        if l.strip() and not l.startswith("      "):
            break
        cuerpo.append(l[6:])
    return "\n".join(cuerpo) + "\n"


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
    limpio = sin_comentarios(paso)
    # La imagen se define una sola vez, por digest, en el paso; ningún otro YAML nombra una imagen de gitleaks.
    imagenes = {ruta: re.findall(r"ghcr\.io/gitleaks/gitleaks\S*", sin_comentarios(t)) for ruta, t in textos.items()}
    imagenes = {r: i for r, i in imagenes.items() if i}
    if list(imagenes) != [PASO_GITLEAKS] or len(imagenes[PASO_GITLEAKS]) != 1:
        fallas.append(f"la imagen de gitleaks se define una sola vez, en {PASO_GITLEAKS}; aparece en {imagenes}")
    elif not IMAGEN_GITLEAKS.fullmatch(imagenes[PASO_GITLEAKS][0]):
        fallas.append(f"la imagen de gitleaks debe ir fijada por etiqueta y digest sha256 de 64 hex: {imagenes[PASO_GITLEAKS][0]}")
    script = script_del_paso(paso)
    if script is None:
        return fallas + [f"{PASO_GITLEAKS}: debe tener un solo `- script: |`"]
    sin_script = limpio.replace(sin_comentarios(script), "")
    for malo in SILENCIOSOS:
        if malo in limpio:
            fallas.append(f"{PASO_GITLEAKS}: `{malo}` dejaría pasar a gitleaks en silencio")
    if "set -euo pipefail" not in script.splitlines():
        fallas.append(f"{PASO_GITLEAKS}: el script debe empezar con `set -euo pipefail` (sin pipefail, `| tee` esconde el código de gitleaks)")
    for debe, por_que in (
        ('--log-opts="--diff-merges=first-parent $GITLEAKS_RANGO"', "gitleaks revisa solo el rango, con el diff de cada fusión contra su primer padre (sin eso omite lo que se resuelve en un conflicto)"),
        (r"(ERR|FTL)", "una línea ERR o FTL de gitleaks falla el paso aunque salga con 0 (referencia que no existe, git que falla)"),
        ('"$GITLEAKS_IMAGEN" git /repo', "gitleaks corre con la imagen del parámetro"),
        (":/repo:ro", "el repositorio entra de solo lectura"),
        ("docker run --rm", "el contenedor se borra solo"),
        ("is-shallow-repository", "un clon superficial no sirve para un rango"),
        ("rev-parse --verify", "cada extremo del rango debe existir (gitleaks sale con 0 si no existe)"),
        ('total=$(git rev-list --count "$GITLEAKS_RANGO")', "un rango vacío debe fallar (gitleaks sale con 0 sin revisar nada)"),
        ("rev-list --count --no-merges", "gitleaks no mira el diff de las fusiones: se cuentan aparte"),
        (r"\) commits scanned", "si gitleaks revisó 0 commits habiendo commits, debe fallar"),
    ):
        if debe not in script:
            fallas.append(f"{PASO_GITLEAKS}: falta `{debe}` ({por_que})")
    if "name: rango" not in limpio or "default:" in limpio.split("name: rango", 1)[1].split("- name:")[0]:
        fallas.append(f"{PASO_GITLEAKS}: el parámetro `rango` es obligatorio (sin valor por defecto: quien usa el paso elige qué revisa)")
    # El PR: `comun` revisa solo sus commits. Con fetchDepth 0 (un rango necesita la historia) y sin el paso viejo.
    comun = textos.get("plantillas/comun.yml", "")
    limpio_comun = sin_comentarios(comun)
    # El trabajo `comun` (sangría de 4) no puede apagarse ni tolerar fallas; las condiciones de otros pasos (sangría de 8) son de ellos.
    for l in limpio_comun.splitlines():
        if re.match(r"    (condition|enabled|continueOnError):", l):
            fallas.append(f"plantillas/comun.yml: el trabajo `comun` no puede llevar `{l.strip()}` (apagaría gitleaks en cada PR)")
    if "- template: pasos/gitleaks.yml\n        parameters:\n          rango: origin/main..HEAD\n" not in limpio_comun + "\n":
        fallas.append("plantillas/comun.yml: debe usar pasos/gitleaks.yml con `rango: origin/main..HEAD` (solo los commits del PR)")
    if "checkout: self\n        fetchDepth: 0\n" not in limpio_comun:
        fallas.append("plantillas/comun.yml: el checkout necesita `fetchDepth: 0` (un rango sin la historia da un resultado falso)")
    if "gitleaks" in limpio_comun.replace("pasos/gitleaks.yml", "").replace("displayName", ""):
        fallas.append("plantillas/comun.yml: gitleaks no va en línea ni con su propia imagen; solo el paso compartido")
    # La revisión diaria: el historial completo de main con el mismo paso.
    diaria = textos.get("../revision-diaria.yml", "")
    job = trabajo(diaria, "gitleaks")
    if job is None:
        fallas.append("revision-diaria.yml: falta el trabajo `gitleaks` (el historial completo se revisa cada día)")
    else:
        limpio_job = sin_comentarios(job)
        if "      - template: plantillas/pasos/gitleaks.yml\n        parameters:\n          rango: HEAD\n" not in limpio_job + "\n":
            fallas.append("revision-diaria.yml: el trabajo gitleaks debe usar plantillas/pasos/gitleaks.yml con `rango: HEAD` (todo el historial de main)")
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
    (PASO_GITLEAKS, '--log-opts="--diff-merges=first-parent $GITLEAKS_RANGO"', "--redact"),
    (PASO_GITLEAKS, '--log-opts="--diff-merges=first-parent $GITLEAKS_RANGO"', '--log-opts="$GITLEAKS_RANGO"'),
    (PASO_GITLEAKS, "(ERR|FTL)", "(XXX)"),
    (PASO_GITLEAKS, "    displayName:", "    enabled: false\n    displayName:"),
    (PASO_GITLEAKS, ":/repo:ro", ":/repo"),
    (PASO_GITLEAKS, "$GITLEAKS_RANGO\" 2>&1 | tee", "$GITLEAKS_RANGO\" 2>&1 || true | tee"),
    (PASO_GITLEAKS, "    displayName:", "    condition: false\n    displayName:"),
    (PASO_GITLEAKS, "    displayName:", "    continueOnError: true\n    displayName:"),
    (PASO_GITLEAKS, "is-shallow-repository", "rev-parse"),
    (PASO_GITLEAKS, 'total=$(git rev-list --count "$GITLEAKS_RANGO")', 'total=$(git rev-list "$GITLEAKS_RANGO" | wc -l)'),
    (PASO_GITLEAKS, "rev-list --count --no-merges", "rev-list --count"),
    (PASO_GITLEAKS, r"\) commits scanned", r"\) commits"),
    (PASO_GITLEAKS, "@sha256:", "@sha257:"),
    (PASO_GITLEAKS, "  - name: rango\n    type: string\n", "  - name: rango\n    type: string\n    default: HEAD\n"),
    ("plantillas/comun.yml", "rango: origin/main..HEAD", "rango: HEAD"),
    ("plantillas/comun.yml", "        fetchDepth: 0\n", "        fetchDepth: 50\n"),
    ("plantillas/comun.yml", "      - template: pasos/gitleaks.yml\n", "      - script: docker run ghcr.io/gitleaks/gitleaks:latest git /repo\n      - template: pasos/gitleaks.yml\n"),
    ("../revision-diaria.yml", "rango: HEAD", "rango: HEAD~1..HEAD"),
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


DOCKER_FALSO = """#!/usr/bin/env bash
printf '%s\\n' "$@" > "$DOCKER_ARGS"
printf '%s\\n' "$FALSO_SALIDA"
exit "${FALSO_CODIGO:-0}"
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


def correr_paso(raiz_repo, script, rango, salida_falsa, codigo=0, bin_falso=None, args=None):
    """Corre el script del paso con un `docker` falso. Devuelve (código, salida, argumentos que recibió docker o None)."""
    entorno = {**os.environ, "PATH": f"{bin_falso}{os.pathsep}{os.environ['PATH']}", "GITLEAKS_RANGO": rango,
               "GITLEAKS_IMAGEN": "ghcr.io/gitleaks/gitleaks:v0.0.0@sha256:" + "0" * 64, "FUENTES": str(raiz_repo),
               "TEMPORAL": str(bin_falso), "DOCKER_ARGS": str(args), "FALSO_SALIDA": salida_falsa, "FALSO_CODIGO": str(codigo),
               "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
    r = subprocess.run(["bash", "-c", script], cwd=raiz_repo, env=entorno, capture_output=True, text=True)
    recibido = args.read_text().splitlines() if args.is_file() else None
    return r.returncode, r.stdout + r.stderr, recibido


def probar_script_gitleaks(script):
    """Corre el script del paso con un docker falso. Devuelve la lista de fallas. Cada caso dice qué debe pasar."""
    fallas = []
    if script is None:
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

        def caso(nombre, cuando, rango, salida, codigo, debe_pasar, llama_a_docker, esperado_en_args=(), mensaje="", comprobar=None):
            contador.append(nombre)
            carpeta = tmp / f"caso{len(contador)}"
            carpeta.mkdir()
            if args.is_file():
                args.unlink()
            cuando(carpeta)
            repo = carpeta / "r"
            if not repo.is_dir():
                repo = carpeta
            rc, texto, recibido = correr_paso(repo, script, rango, salida, codigo, bin_falso, args)
            bien = (rc == 0) == debe_pasar and (recibido is not None) == llama_a_docker
            bien = bien and all(x in (recibido or []) for x in esperado_en_args) and mensaje in texto
            extra = comprobar(repo, recibido or []) if comprobar else ""
            bien = bien and not extra
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

        def head_es_fusion(c):
            repo_de_ejemplo(c)

        def fusion_en_el_diff(repo, recibido):
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

        rango_pr = "origin/main..HEAD"
        caso("PR con 2 commits: gitleaks recibe solo el rango", normal, rango_pr, ok, 0, True, True,
             (f"--log-opts=--diff-merges=first-parent {rango_pr}", "git", "/repo", "--redact", "--no-banner"))
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
             comprobar=lambda repo, _: "" if len(padres_de_head(repo)) == 2 else "HEAD no es un commit de fusión")
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
        caso("revisión diaria: HEAD revisa todo el historial de main", completo, "HEAD", "INF 2 commits scanned.", 0, True, True,
             ("--log-opts=--diff-merges=first-parent HEAD",))
        caso("revisión diaria con un secreto (código 1): el paso falla", completo, "HEAD", "INF 2 commits scanned.\nWRN leaks found: 1", 1, False, True,
             mensaje="leaks found: 1")
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
    gitleaks = revisar_gitleaks(textos_g) + revisar_mutaciones_gitleaks(textos_g) + (
        probar_script_gitleaks(script_del_paso(paso_g)) if paso_g is not None else [])
    for falla in gitleaks:
        print(f"FALLA {falla}")
    print(f"{'ok' if not gitleaks else 'FALLA':5} gitleaks (T22): el PR revisa solo sus commits, la revisión diaria todo el historial, "
          "con el mismo paso y la misma imagen por digest, y ninguna de las dos pasa en silencio")
    fallas += gitleaks
    plantillas = revisar_plantillas()
    for falla in plantillas:
        print(f"FALLA {falla}")
    print(f"{'ok' if not plantillas else 'FALLA':5} cada pipeline corre su plantilla y las plantillas existen")
    fallas += plantillas
    sin_caso = set(por_carpeta) - set().union(*ESPERADO.values())
    if sin_caso:
        fallas.append(f"pipelines sin caso en ESPERADO: {sorted(sin_caso)}")
        print(f"FALLA pipelines sin caso: {sorted(sin_caso)}")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
