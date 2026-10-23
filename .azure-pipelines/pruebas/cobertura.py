"""Barrera de cobertura del API (E17-ECO 5.5 y 5.5 bis, D-110, D-146, D-148).

Lee el perfil de `go test -coverpkg=./src/... -coverprofile=c.out ./test/...` y calcula la cobertura de
sentencias por grupo. Falla si:

- el grupo «núcleo y seguridad» (`nucleo`, `seguridad`, `argon2id`, `sesion`, `servidor` y `autenticacion`,
  bajo `api/src/`) queda bajo 90 %;
- el grupo «resto del API» (todo lo demás bajo `api/src/`) queda bajo 75 %;
- algún grupo queda bajo la línea base confirmada en `api/test/cobertura-base.json` (sin bajar respecto de `main`).

Un PR que sube la cobertura puede subir la base, nunca bajarla. Los ayudantes de prueba (`api/test/`) no entran:
el perfil solo trae `src/`, y lo que no esté bajo `api/src/` se ignora.

Uso (sin dependencias, solo la biblioteca estándar):

    python3 -I -B .azure-pipelines/pruebas/cobertura.py medir api/c.out api/test/cobertura-base.json
    python3 -I -B .azure-pipelines/pruebas/cobertura.py probar
"""
import json
import math
import re
import sys
import tempfile
from pathlib import Path

NUCLEO_Y_SEGURIDAD = "nucleo_y_seguridad"
RESTO = "resto"
PAQUETES_DEL_GRUPO_DE_90 = ("nucleo", "seguridad", "argon2id", "sesion", "servidor", "autenticacion")
MINIMOS = {NUCLEO_Y_SEGURIDAD: 90.0, RESTO: 75.0}
NOMBRES = {NUCLEO_Y_SEGURIDAD: "núcleo y seguridad", RESTO: "resto del API"}

LINEA = re.compile(r"^(?P<archivo>.+):(?P<ini>\d+\.\d+),(?P<fin>\d+\.\d+) (?P<sentencias>\d+) (?P<veces>\d+)$")
RAIZ_SRC = "/api/src/"


class PerfilInvalido(Exception):
    pass


def leer_perfil(texto):
    """Devuelve {(archivo, inicio, fin): [sentencias, veces]}. Un bloque repetido (el mismo código medido desde
    varios paquetes de prueba) se cuenta una vez y vale como cubierto si algún paquete lo ejecutó."""
    bloques = {}
    lineas = texto.splitlines()
    if not lineas or not lineas[0].startswith("mode: "):
        raise PerfilInvalido("el perfil no empieza con «mode:»")
    for n, linea in enumerate(lineas[1:], start=2):
        if not linea.strip():
            continue
        m = LINEA.match(linea.strip())
        if not m:
            raise PerfilInvalido(f"línea {n} del perfil con formato desconocido: {linea!r}")
        clave = (m["archivo"], m["ini"], m["fin"])
        sentencias, veces = int(m["sentencias"]), int(m["veces"])
        previo = bloques.get(clave)
        if previo is None:
            bloques[clave] = [sentencias, veces]
        else:
            if previo[0] != sentencias:
                raise PerfilInvalido(f"el bloque {clave} aparece con distinto número de sentencias")
            previo[1] = max(previo[1], veces)
    return bloques


def paquete_de(archivo):
    """Paquete relativo a api/src/ («seguridad», «cmd/api») o None si el archivo no es de api/src/."""
    i = archivo.find(RAIZ_SRC)
    if i < 0:
        return None
    ruta = archivo[i + len(RAIZ_SRC):]
    return ruta.rsplit("/", 1)[0] if "/" in ruta else None


def grupo_de(paquete):
    return NUCLEO_Y_SEGURIDAD if paquete.split("/", 1)[0] in PAQUETES_DEL_GRUPO_DE_90 else RESTO


def medir(bloques):
    """Devuelve ({paquete: [cubiertas, total]}, {grupo: [cubiertas, total]})."""
    paquetes, grupos = {}, {NUCLEO_Y_SEGURIDAD: [0, 0], RESTO: [0, 0]}
    for (archivo, _, _), (sentencias, veces) in bloques.items():
        paquete = paquete_de(archivo)
        if paquete is None:
            continue
        cubiertas = sentencias if veces > 0 else 0
        for cuenta in (paquetes.setdefault(paquete, [0, 0]), grupos[grupo_de(paquete)]):
            cuenta[0] += cubiertas
            cuenta[1] += sentencias
    return paquetes, grupos


def porcentaje(cuenta):
    return 100.0 * cuenta[0] / cuenta[1] if cuenta[1] else 0.0


def hacia_abajo(valor):
    """Un decimal, redondeando hacia abajo: así la base nunca queda por encima de lo medido."""
    return math.floor(valor * 10 + 1e-9) / 10


def leer_base(texto):
    base = json.loads(texto)
    for grupo in MINIMOS:
        if not isinstance(base.get(grupo), (int, float)):
            raise PerfilInvalido(f"la base no tiene el grupo {grupo!r}")
    return base


def evaluar(texto_perfil, texto_base):
    """Devuelve (lineas_de_la_tabla, fallas)."""
    paquetes, grupos = medir(leer_perfil(texto_perfil))
    base = leer_base(texto_base)
    fallas, tabla = [], []
    for grupo in (NUCLEO_Y_SEGURIDAD, RESTO):
        cuenta = grupos[grupo]
        if cuenta[1] == 0:
            fallas.append(f"{NOMBRES[grupo]}: el perfil no trae sentencias de este grupo")
            tabla.append((NOMBRES[grupo], "sin datos", MINIMOS[grupo], base[grupo], "FALLA"))
            continue
        pct = porcentaje(cuenta)
        motivos = []
        if pct < MINIMOS[grupo]:
            motivos.append(f"{pct:.1f} % está bajo el mínimo de {MINIMOS[grupo]:.0f} %")
        if pct < base[grupo]:
            motivos.append(f"{pct:.1f} % está bajo la base de {base[grupo]:.1f} % (api/test/cobertura-base.json)")
        for motivo in motivos:
            fallas.append(f"{NOMBRES[grupo]}: {motivo}")
        tabla.append((NOMBRES[grupo], f"{pct:.1f} % ({cuenta[0]}/{cuenta[1]})", MINIMOS[grupo], base[grupo],
                      "FALLA" if motivos else "ok"))
    lineas = [f"{'grupo':<22} {'cobertura':<18} {'mínimo':>7} {'base':>7}  estado"]
    for nombre, cobertura, minimo, b, estado in tabla:
        lineas.append(f"{nombre:<22} {cobertura:<18} {minimo:>6.1f}% {b:>6.1f}%  {estado}")
    lineas.append("")
    lineas.append(f"{'paquete':<22} {'grupo':<20} cobertura")
    for paquete in sorted(paquetes):
        cuenta = paquetes[paquete]
        lineas.append(f"{paquete:<22} {NOMBRES[grupo_de(paquete)]:<20} {porcentaje(cuenta):5.1f} % ({cuenta[0]}/{cuenta[1]})")
    return lineas, fallas


def comando_medir(ruta_perfil, ruta_base):
    lineas, fallas = evaluar(Path(ruta_perfil).read_text(encoding="utf-8"), Path(ruta_base).read_text(encoding="utf-8"))
    print("\n".join(lineas))
    if fallas:
        print()
        for falla in fallas:
            print(f"FALLA {falla}")
        print("Un PR que sube la cobertura puede subir la base; nunca bajarla.")
        return 1
    print("\nLa cobertura cumple los mínimos y no baja respecto de la base.")
    return 0


# --- Prueba de este script: perfiles de ejemplo y el resultado que debe dar cada uno. ---

def _perfil(*bloques):
    """bloques: (archivo bajo api/src, sentencias, veces). Cada uno en una línea distinta."""
    lineas = ["mode: set"]
    for i, (archivo, sentencias, veces) in enumerate(bloques, start=1):
        lineas.append(f"github.com/alcanzamos/alcanzamos/api/src/{archivo}:{i}.1,{i}.9 {sentencias} {veces}")
    return "\n".join(lineas) + "\n"


def _base(nucleo, resto):
    return json.dumps({NUCLEO_Y_SEGURIDAD: nucleo, RESTO: resto})


def casos():
    """(nombre, perfil, base, fallas esperadas: fragmentos de texto, vacío si debe pasar)."""
    ok_perfil = _perfil(("seguridad/a.go", 100, 1), ("autenticacion/a.go", 100, 1), ("pg/a.go", 80, 1), ("pg/a.go", 20, 0))
    return [
        ("todo por encima de los mínimos y de la base", ok_perfil, _base(100.0, 80.0), []),
        ("exactamente en el mínimo del grupo de 90", _perfil(("seguridad/a.go", 90, 1), ("seguridad/b.go", 10, 0), ("pg/a.go", 75, 1), ("pg/b.go", 25, 0)),
         _base(90.0, 75.0), []),
        ("núcleo y seguridad bajo 90", _perfil(("seguridad/a.go", 89, 1), ("seguridad/b.go", 11, 0), ("pg/a.go", 100, 1)),
         _base(0, 0), ["núcleo y seguridad: 89.0 % está bajo el mínimo de 90 %"]),
        ("resto bajo 75", _perfil(("seguridad/a.go", 100, 1), ("pg/a.go", 74, 1), ("pg/b.go", 26, 0)),
         _base(0, 0), ["resto del API: 74.0 % está bajo el mínimo de 75 %"]),
        ("un grupo baja respecto de la base aunque pase el mínimo", ok_perfil, _base(100.0, 80.1),
         ["resto del API: 80.0 % está bajo la base de 80.1 %"]),
        ("el núcleo baja respecto de la base", ok_perfil, _base(100.1, 80.0),
         ["núcleo y seguridad: 100.0 % está bajo la base de 100.1 %"]),
        ("los dos grupos fallan a la vez", _perfil(("sesion/a.go", 1, 0), ("tareas/a.go", 1, 0)), _base(0, 0),
         ["núcleo y seguridad: 0.0 %", "resto del API: 0.0 %"]),
        ("cada uno de los seis paquetes del grupo de 90 cuenta en él",
         _perfil(("nucleo/a.go", 1, 0), ("seguridad/a.go", 1, 0), ("argon2id/a.go", 1, 0), ("sesion/a.go", 1, 0),
                 ("servidor/a.go", 1, 0), ("autenticacion/a.go", 1, 0), ("pg/a.go", 100, 1)),
         _base(0, 0), ["núcleo y seguridad: 0.0 %"]),
        ("un subpaquete del grupo de 90 cuenta en él", _perfil(("servidor/accesorio/a.go", 100, 0), ("pg/a.go", 100, 1)), _base(0, 0),
         ["núcleo y seguridad: 0.0 %"]),
        ("un paquete parecido pero distinto va al resto", _perfil(("seguridad/a.go", 100, 1), ("seguridadx/a.go", 100, 0)), _base(0, 0),
         ["resto del API: 0.0 %"]),
        ("un bloque medido desde dos paquetes de prueba se cuenta una vez y vale si alguno lo cubrió",
         "mode: set\n"
         "github.com/alcanzamos/alcanzamos/api/src/seguridad/a.go:1.1,2.2 10 0\n"
         "github.com/alcanzamos/alcanzamos/api/src/seguridad/a.go:1.1,2.2 10 1\n"
         "github.com/alcanzamos/alcanzamos/api/src/pg/a.go:1.1,2.2 10 1\n", _base(100.0, 100.0), []),
        ("lo que no está bajo api/src no cuenta (ayudantes de prueba)",
         _perfil(("seguridad/a.go", 100, 1), ("pg/a.go", 100, 1)) + "github.com/alcanzamos/alcanzamos/api/test/pgtest/a.go:1.1,2.2 50 0\n",
         _base(100.0, 100.0), []),
        ("sin el grupo del núcleo en el perfil", _perfil(("pg/a.go", 100, 1)), _base(0, 0),
         ["núcleo y seguridad: el perfil no trae sentencias"]),
        ("perfil que no es de Go", "esto no es un perfil\n", _base(0, 0), ["PerfilInvalido"]),
        ("línea mal formada", "mode: set\nbasura\n", _base(0, 0), ["PerfilInvalido"]),
        ("base sin uno de los grupos", ok_perfil, json.dumps({NUCLEO_Y_SEGURIDAD: 1}), ["PerfilInvalido"]),
    ]


def comando_probar():
    fallas = []
    for nombre, perfil, base, esperadas in casos():
        try:
            _, obtenidas = evaluar(perfil, base)
        except PerfilInvalido:
            obtenidas = ["PerfilInvalido"]
        junto = "\n".join(obtenidas)
        bien = all(e in junto for e in esperadas) and (bool(obtenidas) == bool(esperadas))
        print(f"{'ok  ' if bien else 'FALLA'}  {nombre}: {'pasa' if not obtenidas else '; '.join(obtenidas)}")
        if not bien:
            fallas.append(nombre)
    for valor, esperado in ((99.99, 99.9), (90.0, 90.0), (87.04839, 87.0), (0.04, 0.0), (100.0, 100.0)):
        if hacia_abajo(valor) != esperado:
            print(f"FALLA  hacia_abajo({valor}) = {hacia_abajo(valor)}, se esperaba {esperado}")
            fallas.append("hacia_abajo")
    with tempfile.TemporaryDirectory() as carpeta:  # la lectura desde archivos y el código de salida
        perfil, base = Path(carpeta) / "c.out", Path(carpeta) / "base.json"
        perfil.write_text(_perfil(("seguridad/a.go", 100, 1), ("pg/a.go", 100, 1)), encoding="utf-8")
        base.write_text(_base(100.0, 100.0), encoding="utf-8")
        if comando_medir(perfil, base) != 0:
            fallas.append("comando medir con un perfil que cumple")
        base.write_text(_base(100.0, 100.1), encoding="utf-8")
        if comando_medir(perfil, base) != 1:
            fallas.append("comando medir con un perfil bajo la base")
    if fallas:
        print(f"\n{len(fallas)} caso(s) fallaron: {', '.join(fallas)}")
        return 1
    print("\nTodos los casos pasan.")
    return 0


def main(argv):
    if len(argv) == 4 and argv[1] == "medir":
        try:
            return comando_medir(argv[2], argv[3])
        except (PerfilInvalido, OSError, json.JSONDecodeError) as error:
            print(f"FALLA no se pudo medir: {error}")
            return 1
    if len(argv) == 2 and argv[1] == "probar":
        return comando_probar()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
