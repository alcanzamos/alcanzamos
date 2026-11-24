"""Citas a notas internas de trabajo (D-223, D-224; pedido del dueño del 2026-11-23).

El código, los README y los textos citan decisiones (D-xxx) y documentos con su versión y su sección (E14-PPA v1.9, 4.1),
nunca las notas de los planes de trabajo del asistente (que no están versionadas ni se pueden leer fuera de su máquina)
ni los ids de tarea. Esta revisión recorre los archivos de git de `api/`, `web/`, `movil/`, `diseno/` y `.azure-pipelines/`
y falla si alguno trae una cita de esas formas. Corre en `comun` (siempre, sin filtro de ruta) dentro de `pruebas/filtros.py`,
y sola:

    python3 -I -B .azure-pipelines/pruebas/citas.py

Rechaza solo las formas de cita que salieron de este repositorio, no cualquier letra con un número: un SKU `S0`, `S256`,
`TLS12`, `US60`, un SKU o un nivel de producto (`SKU (S1)`, `nivel S1 de Azure`, `Standard_S2`), los datos de un trazado SVG (`M12 3 L12 12`) y las filas
de E14 (`4.16 (T6, T11)`) pasan. `pruebas/citas_regresion.py` prueba cada forma prohibida y cada uso legítimo.

Las formas (cada una con un ejemplo de lo que rechaza):
  nota L         «L3 de la US-77», «L6 (5) de la US-77», «L14 de la tarea», «(L10)», «(D-164, L10)», «ítem 294, L14», «// L3: …»
  spec S         «(S2)», «(US-59, S6)», «// S4 (D-164): …», «S1/S2», «S11 de D-161», «**Prueba de S2**», ««S2: …»», «USA-003 S2:»
  identificador  un nombre de prueba, de tipo o de archivo con su spec: «TestS13Algo», «fuenteS13», «s13_verificador_test.go»
  id de tarea    «(T3, web)», «(T4, Android)», «la T4», «T2 de la US-71», «(T20)», «infra-d205 T13»

Qué no se revisa (cada excepción tiene su razón):
  * Ninguna para los nombres de prueba, de tipo ni de archivo: se rechazan.
  * Los archivos que no son texto de código o de documentación (binarios, fuentes, imágenes), `package-lock.json`, `go.sum`
    y los `.svg` (datos de trazados como `M12 3 L12 12`): ahí una letra con un número no es una cita.
  * Los dos archivos de esta revisión (`pruebas/citas.py` y `pruebas/citas_regresion.py`): dicen las formas prohibidas
    como ejemplos.
La revisión mira cada línea por separado: una nota «L<n>» partida en dos líneas se ve por su «L<n>»; una cita «S<n>» partida puede no verse.
"""
import pathlib
import re
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[2]
CARPETAS = ("api", "web", "movil", "diseno", ".azure-pipelines")
# Nombres y sufijos que no se revisan: no son texto de código ni de documentación, o traen trazados y sumas.
SIN_REVISAR_NOMBRES = {"package-lock.json", "go.sum"}
SIN_REVISAR_SUFIJOS = (".svg", ".lock", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".ttf", ".otf", ".woff", ".woff2", ".zip", ".gz")
# Archivos de esta revisión: traen las formas prohibidas como ejemplos.
PROPIOS = {".azure-pipelines/pruebas/citas.py", ".azure-pipelines/pruebas/citas_regresion.py"}

# Una nota «L<n>» suelta, sin que sea un trazado SVG: ni pegada a otra palabra, ruta o guion, ni seguida de otro número
# (`L12 12`, `L12,3`): lo que sigue a una cita nunca es un número.
_L = r"(?<![\w./-])L\d{1,2}(?:\.\d{1,2})?(?![\w/-])(?!\.\d)(?!\s*,?\s*-?\d)"
# Una spec «S<n>» como la de las citas que salieron de este repositorio: S1 a S13, con «.n» opcional (nunca S0 ni S14 en
# adelante), sin pegarse a otra palabra (`TLS12`, `US60`, `Standard_S2`).
_NUM = r"(?:1[0-3]|[1-9])"
_S = r"(?<!\w)S" + _NUM + r"(?:\.\d)?(?!\d)"
TOKEN_S = re.compile(_S)

# Contexto de producto (SKU, niveles, planes de Azure): un `S<n>` que está en él no es una spec. Una sola regla para todas las
# formas de S, aparte de las regex de cada forma: se mira una ventana corta de la misma línea antes del `S<n>` (hasta
# VENTANA caracteres) y una palabra de producto justo después, sin distinguir mayúsculas.
#   antes:   sku, nivel(es), tier(s), plan(es) o standard, seguidos solo de puntuación, espacios, paréntesis y otros `S<n>` de la
#            misma lista («SKU S1», «Sku: (S1)», «SKU:S1», «Planes (S1/S2)», «tiers S1 y S2», «SKU (S1, S2)», «Standard_S2»)
#   después: «de Azure», o nivel(es), SKU(s), tier(s), plan(es) con «son», «es» o «y» opcional («S1 de Azure», «S1 son niveles»)
# Si algún `S<n>` de la coincidencia (de «S<n>/S<n>» o «S<n> y S<n>» basta uno) está en ese contexto, la coincidencia no cuenta.
VENTANA = 15
PRODUCTO_ANTES = re.compile(r"\b(?:sku|niveles|nivel|tiers|tier|planes|plan|standard)(?:[\s:;,.()_/-]|S\d{1,2}(?:\.\d)?|\by\b)*$",
                            re.IGNORECASE)
PRODUCTO_DESPUES = re.compile(r"\s+(?:(?:son|es|y)\s+)?(?:niveles?|skus?|tiers?|planes?|de\s+azure)\b", re.IGNORECASE)


def es_de_producto(linea, coincidencia):
    """Si algún `S<n>` de la coincidencia está en un contexto de producto (SKU, nivel, tier, plan, standard)."""
    for token in TOKEN_S.finditer(coincidencia.group(0)):
        inicio = coincidencia.start() + token.start()
        fin = coincidencia.start() + token.end()
        if PRODUCTO_ANTES.search(linea[max(0, inicio - VENTANA):inicio]) or PRODUCTO_DESPUES.match(linea, fin, fin + 25):
            return True
    return False


FORMAS = (
    ("nota L: «L<n> de la US-<n>» o «de la tarea»", re.compile(r"\bL\d{1,2}(?:\.\d+)?(?: \([^)]{1,12}\))? de la (?:US-\d+|tarea)")),
    ("nota L: «L<n>» suelta («(L<n>)», «, L<n>)», «ítem 294, L<n>», «// L<n>:»)", re.compile(_L)),
    ("spec S: «(S<n>)» o «(…, S<n>…)»", re.compile(r"\((?:[^()]*, )?" + _S + r"(?=[,:;)/ ])")),
    ("spec S: «, S<n>)» (el final de una cita)", re.compile(r",\s*" + _S + r"\)")),
    ("spec S: rango «S<n>–S<n>» (guion o raya)", re.compile(_S + r"[–-]S?" + _NUM + r"(?!\d)")),
    ("spec S: al empezar un comentario («// S<n> …», «// S<n>:», «// S1/S2:»)",
     re.compile(r"(?:^|[\s(])(?://|#|\*|/\*)\s*" + _S + r"(?=[:/,)\s])")),
    ("spec S: al empezar un título o un texto citado («S<n>: …» tras ««», «it('», «test(\"», o al empezar la línea)",
     re.compile(r"(?:«|\b(?:it|test|describe|paso)\(\s*[\"']|^\s*[\"'])" + _S + r": ")),
    ("spec S: «S<n>/S<n>» o «S<n> y S<n>»", re.compile(_S + r"(?:/" + _S + r")+|" + _S + r" y " + _S)),
    ("spec S: «… y S<n>» detrás de una sección o un paréntesis", re.compile(r"(?:(?<!\w)\d+(?:\.\d+)*|\)) y " + _S)),
    ("spec S: «S<n> de la US-<n>» o «S<n> de D-<n>»", re.compile(_S + r" de (?:la US-\d+|D-\d+)")),
    ("spec S: «Prueba de S<n>», «protegen S<n>»", re.compile(r"\b(?:Prueba de|protegen) " + _S)),
    ("spec S: «US-<n> S<n>» o «USA-<n> S<n>»", re.compile(r"\b(?:US|USA)-\d+,? " + _S)),
    ("spec S en un identificador: «TestS<n>…», «fuenteS<n>…»", re.compile(r"\b(?:Test|fuente)S" + _NUM + r"(?![0-9a-z])")),
    ("id de tarea: «(T<n>, web)», «(T<n>, Android)» (una fila de E14 como «(T6, T11)» no)", re.compile(r"\(T\d{1,2}, (?!T\d)[^)]+\)")),
    ("id de tarea: «(T<n>)» desde la T12 (las filas de E14-PCP 4.16 son T1 a T11)", re.compile(r"\(T(?:1[2-9]|[2-9]\d)\)")),
    ("id de tarea: «la T<n>»", re.compile(r"\bla T\d{1,2}\b")),
    ("id de tarea: «T<n> de la US-<n>» o «tarea T<n>»", re.compile(r"\bT\d{1,2} de la US-\d+|\btarea T\d{1,2}\b")),
    ("plan de trabajo: «infra-d205»", re.compile(r"\binfra-d205\b")),
)


# Un archivo cuyo nombre empieza con su spec («s13_verificador_test.go»).
NOMBRE_CON_SPEC = re.compile(r"(?:^|/)s" + _NUM + r"_[^/]*$")


def revisar_nombre(ruta):
    """Falla de un nombre de archivo que empieza con un id de spec, o None."""
    if NOMBRE_CON_SPEC.search(ruta):
        return f"{ruta}: spec S en el nombre del archivo: «{ruta.rsplit('/', 1)[-1]}»"
    return None


def revisar_texto(ruta, texto):
    """Citas de un texto: lista de «ruta:línea: forma: lo que dice la línea»."""
    fallas = []
    for numero, linea in enumerate(texto.splitlines(), 1):
        for nombre, forma in FORMAS:
            encontrada = next((c for c in forma.finditer(linea) if not es_de_producto(linea, c)), None)
            if encontrada:
                fallas.append(f"{ruta}:{numero}: {nombre}: «{encontrada.group(0).strip()}»")
                break
    return fallas


def se_revisa(ruta):
    """Si una ruta de git (con `/`) entra en la revisión."""
    nombre = ruta.rsplit("/", 1)[-1]
    return (ruta.split("/", 1)[0] in CARPETAS and ruta not in PROPIOS
            and nombre not in SIN_REVISAR_NOMBRES and not nombre.lower().endswith(SIN_REVISAR_SUFIJOS))


def archivos_de_git(raiz):
    salida = subprocess.run(["git", "-C", str(raiz), "ls-files", "-z", "--", *CARPETAS],
                            check=True, capture_output=True).stdout
    return [r for r in salida.decode("utf-8").split("\0") if r]


def revisar(raiz, archivos=None):
    """Citas de los archivos de git (o de `archivos`, rutas relativas con `/`) bajo `raiz`. Un archivo que no es UTF-8 no es texto
    y se salta."""
    fallas = []
    for ruta in sorted(archivos if archivos is not None else archivos_de_git(raiz)):
        if ruta.split("/", 1)[0] in CARPETAS and ruta not in PROPIOS and (pathlib.Path(raiz) / ruta).is_file():
            nombre = revisar_nombre(ruta)
            if nombre:
                fallas.append(nombre)
        if not se_revisa(ruta) or not (pathlib.Path(raiz) / ruta).is_file():
            continue
        try:
            texto = (pathlib.Path(raiz) / ruta).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        fallas += revisar_texto(ruta, texto)
    return fallas


def main():
    fallas = revisar(RAIZ)
    for falla in fallas:
        print(f"FALLA {falla}")
    print(f"{'ok' if not fallas else 'FALLA':5} sin citas a notas internas ni ids de tarea en api, web, movil, diseno y .azure-pipelines"
          f"{'' if not fallas else f' ({len(fallas)} líneas; cite la decisión D-xxx o el documento con su versión y su sección)'}")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
