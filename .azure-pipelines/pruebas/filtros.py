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
import re
import importlib.util
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
CARPETA = RAIZ / ".azure-pipelines"
# El pipeline del control único (D-177): no filtra por ruta y no entra en la simulación de los pipelines por carpeta.
CONTROL = "control"
# Pipelines programados aceptados a mano (revision-diaria.yml: S3 de la regla de los 7 días). No corren en ningún PR ni
# al fusionar; corren una vez al día sobre main. Un `schedules:` en otro pipeline hace fallar la prueba.
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
    # Pasos compartidos: los de Go los usa plantillas/api.yml; los de Node y npm, plantillas/web.yml y plantillas/movil.yml.
    # La revisión diaria también los usa, pero no corre en ningún PR.
    ".azure-pipelines/plantillas/pasos/go.yml": {"comun", "api"},
    ".azure-pipelines/plantillas/pasos/node.yml": {"comun", "web", "movil"},
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
    "infra/produccion/principal.tf": {"comun", "infra"},
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
    """Forma de un pipeline programado (S3): `trigger: none`, `pr: none` y una sola programación diaria, solo sobre
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
    sin_caso = set(por_carpeta) - set().union(*ESPERADO.values())
    if sin_caso:
        fallas.append(f"pipelines sin caso en ESPERADO: {sorted(sin_caso)}")
        print(f"FALLA pipelines sin caso: {sorted(sin_caso)}")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
