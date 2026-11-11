"""Etapas del control único que corren en un PR (D-177, D-178 (4)).

Lee la lista de archivos que cambia el PR (la salida de `git diff --name-only --no-renames -z`, separada por NUL para
que git no cite los nombres con «ñ» ni otros caracteres) y fija, para cada etapa por carpeta de `control.yml`, una
variable de salida `true` o `false` (el comando `task.setvariable` del agente, con `isOutput=true`). La etapa corre
solo si es `true`; `comun` no está aquí porque corre siempre.

CARPETAS es el mapa de cada etapa a sus rutas, con las mismas reglas de los `paths.include` de Azure Pipelines:
`carpeta/*` cubre todo lo que está debajo de la carpeta; una ruta sin comodín cubre ese archivo. Es igual a los
filtros de cada pipeline por carpeta (`<etapa>.yml`); `pruebas/filtros.py` lo comprueba y prueba sus casos.

Uso (sin dependencias, solo la biblioteca estándar):

    git diff --name-only --no-renames -z HEAD^1 HEAD | python3 -I -B .azure-pipelines/pruebas/cambios.py detectar
    python3 -I -B .azure-pipelines/pruebas/cambios.py todas    # sin un PR que comparar: corren todas las etapas
"""
import sys

CARPETAS = {
    "reglas": (
        "reglas/*",
        "api/src/interpretacion/reglas.json",
        ".azure-pipelines/reglas.yml",
        ".azure-pipelines/plantillas/reglas.yml",
    ),
    "api": (
        "api/*",
        "web/*",
        "diseno/*",
        "marca/logo-horizontal-color.svg",
        ".azure-pipelines/api.yml",
        ".azure-pipelines/plantillas/api.yml",
        ".azure-pipelines/plantillas/pasos/go.yml",
        ".azure-pipelines/plantillas/pasos/vulnerabilidades.yml",
        ".azure-pipelines/pruebas/cobertura.py",
        ".azure-pipelines/pruebas/vulnerabilidades.py",
        ".azure-pipelines/pruebas/vulnerabilidades_regresion.py",
    ),
    "web": (
        "web/*",
        "diseno/*",
        "marca/logo-horizontal-color.svg",
        ".azure-pipelines/web.yml",
        ".azure-pipelines/plantillas/web.yml",
        ".azure-pipelines/plantillas/pasos/node.yml",
    ),
    "movil": (
        "movil/*",
        "diseno/*",
        "marca/logo-horizontal-color.svg",
        ".azure-pipelines/movil.yml",
        ".azure-pipelines/plantillas/movil.yml",
        ".azure-pipelines/plantillas/pasos/node.yml",
    ),
    "infra": (
        "infra/*",
        ".azure-pipelines/infra.yml",
        ".azure-pipelines/plantillas/infra.yml",
    ),
}


def coincide(patron, ruta):
    if patron.endswith("/*"):
        return ruta.startswith(patron[:-1])
    return ruta == patron


def leer(datos):
    """Rutas de la salida de `git diff --name-only -z` (bytes separados por NUL)."""
    return [r for r in datos.decode("utf-8").split("\0") if r]


def etapas_de(rutas):
    """{etapa: corre} para la lista de rutas cambiadas."""
    return {etapa: any(coincide(p, r) for p in patrones for r in rutas) for etapa, patrones in CARPETAS.items()}


def visible(ruta):
    """Un nombre de archivo no puede dar comandos al agente: sin saltos de línea ni «##» en el registro."""
    return ruta.replace("\r", "\\r").replace("\n", "\\n").replace("##", "#\\#")


def salida(rutas):
    """Texto para el registro del pipeline: una tabla y una variable de salida por etapa. `rutas` None: todas corren."""
    corren = {etapa: True for etapa in CARPETAS} if rutas is None else etapas_de(rutas)
    lineas = []
    if rutas is not None:
        lineas.append(f"{len(rutas)} archivo(s) cambiado(s) respecto de la rama de destino:")
        lineas += [f"  {visible(r)}" for r in rutas]
    for etapa, sí in corren.items():
        lineas.append(f"{etapa}: {'corre' if sí else 'no cambió, se salta'}")
        lineas.append(f"##vso[task.setvariable variable={etapa};isOutput=true]{'true' if sí else 'false'}")
    return "\n".join(lineas)


def main(argv):
    if argv[1:] == ["detectar"]:
        print(salida(leer(sys.stdin.buffer.read())))
        return 0
    if argv[1:] == ["todas"]:
        print(salida(None))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
