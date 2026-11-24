"""Citas a notas internas de trabajo (D-223, D-224; pedido del dueño del 2026-11-23).

El código, los README y los textos citan decisiones (D-xxx) y documentos con su versión y su sección (E14-PPA v1.9, 4.1),
nunca las notas de los planes de trabajo del asistente (que no están versionadas ni se pueden leer fuera de su máquina)
ni los ids de tarea. Esta revisión recorre los archivos de git de `api/`, `web/`, `movil/`, `diseno/` y `.azure-pipelines/`
y falla si alguno trae una de las formas de abajo. Corre en `comun` (siempre, sin filtro de ruta) dentro de `pruebas/filtros.py`,
y sola:

    python3 -I -B .azure-pipelines/pruebas/citas.py

Las formas (cada una con ejemplos de lo que rechaza; este archivo y `pruebas/citas_regresion.py` son los únicos que pueden
decirlos, porque la revisión no los mira):
  nota L         «L3 de la US-77», «L6 (5) de la US-77», «L14 de la tarea», «(L10)», «(D-164, L10)», «ítem 294, L14», «// L3: …»
                 (una `L<n>` suelta, salvo en un trazado SVG como `M12 3 L12 12`)
  spec S         toda «S» seguida de 1 o 2 cifras, de S1 a S99, suelta: «(S2)», «(US-59, S6)», «S1–S7», «S11 de D-161»,
                 «Regla del plan: S4 de la US-51», «El plan (S2) de la US-51», «SKU S1», «**Prueba de S2**», «USA-003 S2:».
                 Suelta quiere decir que no toca otro carácter de palabra a ningún lado: `S0` (no es de S1 a S99), `S256` (tres cifras),
                 `TLS12`, `US60` y `Standard_S2` no cuentan. En cualquier parte del texto, sin mirar el contexto: un uso
                 legítimo (por ejemplo, un SKU `S1`) va en EXCEPCIONES.
  identificador  un nombre de prueba, de tipo o de archivo con su spec: «TestS13Algo», «fuenteS13», «s13_verificador_test.go»
  id de tarea    «(T3, web)», «(T4, Android)», «la T4», «T2 de la US-71», «(T20)», «infra-d205 T13»
Una fila de E14 como «4.16 (T6, T11)» no es un id de tarea.

Qué no se revisa (cada excepción tiene su razón):
  * Ninguna para los nombres de prueba, de tipo ni de archivo: se rechazan.
  * Los archivos que no son texto de código o de documentación (binarios, fuentes, imágenes), `package-lock.json`, `go.sum`
    y los `.svg` (datos de trazados como `M12 3 L12 12`): ahí una letra con un número no es una cita.
  * Los dos archivos de esta revisión (`pruebas/citas.py` y `pruebas/citas_regresion.py`): dicen las formas prohibidas
    como ejemplos.
  * Las líneas de EXCEPCIONES (ruta, texto exacto de la línea y razón). Una excepción solo vale para la regla de la spec `S<n>`, y la
    revisión falla si una excepción ya no coincide con ninguna línea.
La revisión mira cada línea por separado: una nota «L<n>» partida en dos líneas se ve por su «L<n>».
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
# Una spec «S<n>»: una «S» seguida de 1 o 2 cifras (de S1 a S99, nunca S0), suelta: sin otro carácter de palabra pegado a ningún
# lado (`S256`, `TLS12`, `US60`, `Standard_S2` no cuentan). Una sola regla, sin mirar el contexto.
_NUM = r"(?:1[0-3]|[1-9])"   # solo para los nombres de pruebas y de archivos de abajo
_S = r"(?<!\w)S[1-9]\d?(?!\w)"

# Usos legítimos de una `S<n>` suelta: (ruta, texto exacto de la línea sin espacios en los extremos, razón). Una línea que cumple
# la regla de la spec pasa solo si su (ruta, texto) está aquí; si una excepción ya no coincide con ninguna línea, la revisión falla.
# Vacía: el árbol no necesita ninguna.
EXCEPCIONES = ()
FORMA_S = "spec S: «S<n>» suelta (de S1 a S99)"

FORMAS = (
    ("nota L: «L<n> de la US-<n>» o «de la tarea»", re.compile(r"\bL\d{1,2}(?:\.\d+)?(?: \([^)]{1,12}\))? de la (?:US-\d+|tarea)")),
    ("nota L: «L<n>» suelta («(L<n>)», «, L<n>)», «ítem 294, L<n>», «// L<n>:»)", re.compile(_L)),
    (FORMA_S, re.compile(_S)),
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


def revisar_texto(ruta, texto, excepciones=EXCEPCIONES, usadas=None):
    """Citas de un texto: lista de «ruta:línea: forma: lo que dice la línea». Una línea de la spec `S<n>` que está en `excepciones`
    pasa y se anota en `usadas` (un conjunto de (ruta, texto))."""
    permitidas = {(r, t) for r, t, _ in excepciones}
    fallas = []
    for numero, linea in enumerate(texto.splitlines(), 1):
        for nombre, forma in FORMAS:
            encontrada = forma.search(linea)
            if not encontrada:
                continue
            if nombre == FORMA_S and (ruta, linea.strip()) in permitidas:
                if usadas is not None:
                    usadas.add((ruta, linea.strip()))
                continue
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


def revisar(raiz, archivos=None, excepciones=EXCEPCIONES):
    """Citas de los archivos de git (o de `archivos`, rutas relativas con `/`) bajo `raiz`. Un archivo que no es UTF-8 no es texto
    y se salta. Falla también por cada excepción de `excepciones` que no coincide con ninguna línea."""
    fallas = []
    usadas = set()
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
        fallas += revisar_texto(ruta, texto, excepciones, usadas)
    for ruta, texto, razon in excepciones:
        if (ruta, texto) not in usadas:
            fallas.append(f"{ruta}: excepción sin uso (ya no coincide con ninguna línea de la spec S<n>): «{texto}» ({razon})")
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
