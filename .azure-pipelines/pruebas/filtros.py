"""Prueba de los filtros por carpeta (ADR-001, E17-ECO Q-11).

Lee los `paths.include` de la sección `pr` de cada pipeline y comprueba, con archivos de ejemplo,
que cada cambio dispara solo los pipelines que le corresponden. Sin dependencias: el formato de
los YAML de esta carpeta es fijo y se lee con un analizador mínimo.

Reglas de coincidencia (como Azure Pipelines): `carpeta/*` cubre todo lo que está debajo de la
carpeta; una ruta sin comodín cubre ese archivo. Un pipeline sin `paths` corre con cualquier cambio.
"""
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
CARPETA = RAIZ / ".azure-pipelines"

# Archivo de ejemplo -> pipelines que deben correr. Cuando llegue un pipeline nuevo
# (movil), se agregan aquí sus casos. `diseno/` dispara también el de web (construye con sus tokens y fuentes) y el de api (la imagen embebe la web).
ESPERADO = {
    "reglas/conjuntos/conjunto-de-prueba.jsonl": {"comun", "reglas"},
    "reglas/README.md": {"comun", "reglas"},
    ".azure-pipelines/reglas.yml": {"comun", "reglas"},
    "api/README.md": {"comun", "api"},
    "api/cmd/api/main.go": {"comun", "api"},
    "api/Dockerfile": {"comun", "api"},
    ".azure-pipelines/api.yml": {"comun", "api"},
    "web/README.md": {"comun", "web", "api"},
    "web/src/PantallaPrueba.tsx": {"comun", "web", "api"},
    "web/package.json": {"comun", "web", "api"},
    ".azure-pipelines/web.yml": {"comun", "web"},
    "movil/README.md": {"comun"},
    "diseno/README.md": {"comun", "web", "api"},
    "diseno/tokens/alcanzamos.tokens.json": {"comun", "web", "api"},
    "diseno/fuentes/figtree/Figtree-Bold.ttf": {"comun", "web", "api"},
    "api/internal/web/web.go": {"comun", "api"},
    "apix/README.md": {"comun"},
    "infra/README.md": {"comun", "infra"},
    "infra/bootstrap/principal.tf": {"comun", "infra"},
    "infra/produccion/principal.tf": {"comun", "infra"},
    "infra/local/compose.yaml": {"comun", "infra"},
    ".azure-pipelines/infra.yml": {"comun", "infra"},
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


def coincide(patron, ruta):
    if patron.endswith("/*"):
        return ruta.startswith(patron[:-1])
    return ruta == patron


def main():
    pipelines = {p.stem: filtros_pr(p.read_text(encoding="utf-8")) for p in sorted(CARPETA.glob("*.yml"))}
    fallas = []
    for ruta, esperado in ESPERADO.items():
        corren = {n for n, f in pipelines.items() if f is None or any(coincide(x, ruta) for x in f)}
        estado = "ok" if corren == esperado else "FALLA"
        print(f"{estado:5} {ruta}: corren {sorted(corren)}; se esperaba {sorted(esperado)}")
        if corren != esperado:
            fallas.append(ruta)
    sin_caso = set(pipelines) - set().union(*ESPERADO.values())
    if sin_caso:
        fallas.append(f"pipelines sin caso en ESPERADO: {sorted(sin_caso)}")
        print(f"FALLA pipelines sin caso: {sorted(sin_caso)}")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
