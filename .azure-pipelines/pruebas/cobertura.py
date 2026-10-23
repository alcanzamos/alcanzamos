"""Barrera de cobertura del API (E17-ECO 5.5 y 5.5 bis, D-110, D-146, D-148, D-149).

Lee el perfil de `go test -coverpkg=./src/... -coverprofile=c.out ./test/...` y calcula la cobertura de
sentencias por grupo. Las dos listas de paquetes son explícitas y se comparan por ruta completa relativa a
`api/src/` (`cmd/api` es ese paquete y no «cmd»), tal como están en E17-ECO 5.5:

- «núcleo y seguridad» (90 %): `nucleo` (cuando exista; su ausencia no falla), `seguridad`, `argon2id`, `sesion`,
  `servidor` y `autenticacion`;
- «resto del API» (75 %): `app`, `bd`, `cmd/api`, `config`, `correo`, `cuenta`, `pg`, `reloj`, `tareas` y `web`.

Falla si:

- el grupo «núcleo y seguridad» queda bajo 90 % o el «resto del API» bajo 75 %;
- algún grupo queda bajo la línea base confirmada en `api/test/cobertura-base.json` (sin bajar respecto de `main`);
- aparece un paquete bajo `api/src/` que no está en ninguna de las dos listas. Se busca en el perfil y también en
  un recorrido de las carpetas de `api/src/` con archivos `.go` (se ignoran los generadores con
  `//go:build ignore`, que no son un paquete), para que un paquete sin pruebas tampoco pase inadvertido. Hay que clasificarlo en E17-ECO 5.5 y aquí.

Un PR que sube la cobertura puede subir la base, nunca bajarla. Los ayudantes de prueba (`api/test/`) no entran:
el perfil solo trae `src/`, y lo que no esté bajo `api/src/` se ignora.

Uso (sin dependencias, solo la biblioteca estándar):

    python3 -I -B .azure-pipelines/pruebas/cobertura.py medir api/c.out api/test/cobertura-base.json [api/src]
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
# Listas explícitas de E17-ECO 5.5 (D-149). Un paquete que no esté en ninguna hace fallar la barrera.
PAQUETES_DEL_GRUPO_DE_90 = ("nucleo", "seguridad", "argon2id", "sesion", "servidor", "autenticacion", "cuenta")
PAQUETES_DEL_RESTO = ("app", "bd", "cmd/api", "config", "correo", "pg", "reloj", "tareas", "web")
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
    """Grupo del paquete por ruta completa, o None si no está en ninguna de las dos listas."""
    if paquete in PAQUETES_DEL_GRUPO_DE_90:
        return NUCLEO_Y_SEGURIDAD
    if paquete in PAQUETES_DEL_RESTO:
        return RESTO
    return None


def _es_de_un_paquete(archivo):
    """Un .go con `//go:build ignore` (un generador que se corre con `go run`) no forma parte de ningún paquete."""
    for linea in archivo.read_text(encoding="utf-8").splitlines():
        if linea.startswith("package "):
            return True
        if linea.strip() == "//go:build ignore":
            return False
    return True


def paquetes_en_disco(raiz_src):
    """Paquetes (ruta relativa a `raiz_src`) con archivos .go, incluso sin pruebas. La raíz misma no cuenta."""
    raiz = Path(raiz_src)
    if not raiz.is_dir():
        raise PerfilInvalido(f"no existe la carpeta {raiz} para buscar paquetes")
    return {archivo.parent.relative_to(raiz).as_posix() for archivo in raiz.rglob("*.go")
            if archivo.parent != raiz and _es_de_un_paquete(archivo)}


def medir(bloques):
    """Devuelve ({paquete: [cubiertas, total]}, {grupo: [cubiertas, total]}). Los paquetes sin grupo quedan
    en el primer diccionario y fuera del segundo: `sin_clasificar` los reporta."""
    paquetes, grupos = {}, {NUCLEO_Y_SEGURIDAD: [0, 0], RESTO: [0, 0]}
    for (archivo, _, _), (sentencias, veces) in bloques.items():
        paquete = paquete_de(archivo)
        if paquete is None:
            continue
        cubiertas = sentencias if veces > 0 else 0
        cuentas = [paquetes.setdefault(paquete, [0, 0])]
        if grupo_de(paquete) is not None:
            cuentas.append(grupos[grupo_de(paquete)])
        for cuenta in cuentas:
            cuenta[0] += cubiertas
            cuenta[1] += sentencias
    return paquetes, grupos


def sin_clasificar(paquetes, en_disco):
    """Paquetes del perfil o del disco que no están en ninguna de las dos listas."""
    return sorted(p for p in set(paquetes) | set(en_disco) if grupo_de(p) is None)


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


def evaluar(texto_perfil, texto_base, en_disco=()):
    """Devuelve (lineas_de_la_tabla, fallas). `en_disco`: paquetes con archivos .go bajo api/src/."""
    paquetes, grupos = medir(leer_perfil(texto_perfil))
    base = leer_base(texto_base)
    fallas, tabla = [], []
    for paquete in sin_clasificar(paquetes, en_disco):
        fallas.append(f"el paquete «{paquete}» de api/src/ no está en ninguna de las dos listas de E17-ECO 5.5 "
                      "(núcleo y seguridad, 90 %; resto del API, 75 %): clasifícalo en ese documento y en cobertura.py")
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
    for paquete in sorted(set(paquetes) | set(en_disco)):
        cuenta = paquetes.get(paquete, [0, 0])
        grupo = NOMBRES.get(grupo_de(paquete), "SIN CLASIFICAR")
        lineas.append(f"{paquete:<22} {grupo:<20} {porcentaje(cuenta):5.1f} % ({cuenta[0]}/{cuenta[1]})")
    return lineas, fallas


def comando_medir(ruta_perfil, ruta_base, raiz_src="api/src"):
    lineas, fallas = evaluar(Path(ruta_perfil).read_text(encoding="utf-8"), Path(ruta_base).read_text(encoding="utf-8"),
                             paquetes_en_disco(raiz_src))
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
    """(nombre, perfil, base, fallas esperadas: fragmentos de texto, vacío si debe pasar[, paquetes en disco])."""
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
        ("cada uno de los diez paquetes del resto cuenta en él",
         _perfil(("seguridad/a.go", 100, 1), ("app/a.go", 1, 0), ("bd/a.go", 1, 0), ("cmd/api/a.go", 1, 0), ("config/a.go", 1, 0),
                 ("correo/a.go", 1, 0), ("cuenta/a.go", 1, 0), ("pg/a.go", 1, 0), ("reloj/a.go", 1, 0), ("tareas/a.go", 1, 0),
                 ("web/a.go", 1, 0)),
         _base(0, 0), ["resto del API: 0.0 %"]),
        ("un paquete del grupo de 90 se cuenta al 90, no al 75", _perfil(("sesion/a.go", 80, 1), ("sesion/b.go", 20, 0), ("pg/a.go", 100, 1)),
         _base(0, 0), ["núcleo y seguridad: 80.0 % está bajo el mínimo de 90 %"]),
        ("un paquete del resto se cuenta al 75, no al 90", _perfil(("seguridad/a.go", 100, 1), ("tareas/a.go", 80, 1), ("tareas/b.go", 20, 0)),
         _base(0, 0), []),
        ("cmd/api se compara completo: «cmd» solo no es un paquete listado",
         _perfil(("seguridad/a.go", 100, 1), ("cmd/a.go", 100, 1), ("pg/a.go", 100, 1)), _base(0, 0), ["el paquete «cmd» de api/src/ no está"]),
        ("un subpaquete de uno listado no está listado", _perfil(("servidor/accesorio/a.go", 100, 1), ("seguridad/a.go", 100, 1), ("pg/a.go", 100, 1)),
         _base(0, 0), ["el paquete «servidor/accesorio» de api/src/ no está"]),
        ("un paquete parecido pero distinto no está listado", _perfil(("seguridad/a.go", 100, 1), ("seguridadx/a.go", 100, 1), ("pg/a.go", 100, 1)),
         _base(0, 0), ["el paquete «seguridadx» de api/src/ no está en ninguna de las dos listas de E17-ECO 5.5"]),
        ("un paquete desconocido falla aunque la cobertura sea total", _perfil(("seguridad/a.go", 100, 1), ("pg/a.go", 100, 1), ("nuevo/a.go", 10, 1)),
         _base(0, 0), ["el paquete «nuevo» de api/src/ no está", "E17-ECO 5.5"]),
        ("un paquete en disco y ausente del perfil falla si no está listado", ok_perfil, _base(0, 0),
         ["el paquete «sinpruebas» de api/src/ no está"], {"seguridad", "pg", "sinpruebas"}),
        ("un paquete en disco, listado y ausente del perfil no falla por la lista", ok_perfil, _base(0, 0), [],
         {"seguridad", "pg", "reloj", "cmd/api"}),
        ("nucleo ausente del perfil y del disco no falla", ok_perfil, _base(0, 0), [], {"seguridad", "autenticacion", "pg"}),
        ("nucleo presente cuenta en el grupo de 90", _perfil(("nucleo/a.go", 90, 1), ("nucleo/b.go", 10, 0), ("pg/a.go", 100, 1)),
         _base(90.0, 100.0), []),
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
    for nombre, perfil, base, esperadas, *resto in casos():
        try:
            _, obtenidas = evaluar(perfil, base, resto[0] if resto else ())
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
        src = Path(carpeta) / "src"
        for paquete in ("seguridad", "pg"):
            (src / paquete).mkdir(parents=True)
            (src / paquete / "a.go").write_text("package x\n", encoding="utf-8")
        (src / "web" / "dist").mkdir(parents=True)  # una carpeta sin .go no es un paquete
        (src / "seguridad" / "datos").mkdir()  # solo un generador con `//go:build ignore`: no es un paquete
        (src / "seguridad" / "datos" / "generar.go").write_text("//go:build ignore\n\npackage main\n", encoding="utf-8")
        perfil.write_text(_perfil(("seguridad/a.go", 100, 1), ("pg/a.go", 100, 1)), encoding="utf-8")
        base.write_text(_base(100.0, 100.0), encoding="utf-8")
        if comando_medir(perfil, base, src) != 0:
            fallas.append("comando medir con un perfil que cumple")
        base.write_text(_base(100.0, 100.1), encoding="utf-8")
        if comando_medir(perfil, base, src) != 1:
            fallas.append("comando medir con un perfil bajo la base")
        base.write_text(_base(100.0, 100.0), encoding="utf-8")
        (src / "otro").mkdir()
        (src / "otro" / "a.go").write_text("package otro\n", encoding="utf-8")
        if comando_medir(perfil, base, src) != 1:
            fallas.append("comando medir con un paquete sin pruebas y sin clasificar en el disco")
        if paquetes_en_disco(src) != {"seguridad", "pg", "otro"}:
            fallas.append("paquetes_en_disco")
    if fallas:
        print(f"\n{len(fallas)} caso(s) fallaron: {', '.join(fallas)}")
        return 1
    print("\nTodos los casos pasan.")
    return 0


def main(argv):
    if len(argv) in (4, 5) and argv[1] == "medir":
        try:
            return comando_medir(*argv[2:])
        except (PerfilInvalido, OSError, json.JSONDecodeError) as error:
            print(f"FALLA no se pudo medir: {error}")
            return 1
    if len(argv) == 2 and argv[1] == "probar":
        return comando_probar()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
