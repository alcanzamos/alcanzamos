"""Barrera de vulnerabilidades del API con la regla de los 7 días (D-201, D-158).

Lee la salida de `go tool govulncheck -format json ./...` (v1.9.0, protocolo v1.0.0). Con `-format json`,
govulncheck sale con 0 aunque encuentre vulnerabilidades: este script es la única barrera.

Cuenta solo las vulnerabilidades que el código alcanza, las mismas que hacen salir a govulncheck con código 3 con la
salida de texto: los mensajes `finding` cuyo primer marco de la traza (`trace[0]`) tiene `function`, en un análisis
de nivel `symbol` (`isCalled` en golang.org/x/vuln/internal/scan/template.go). Los hallazgos solo de módulo (sin
`package`) o de paquete (sin `function`) no cuentan. Por cada una, con la versión que la corrige (`fixed_version`):

- si el arreglo se publicó hace menos de 7 días: avisa (`##vso[task.logissue type=warning]`) con el aviso, la
  versión que lo corrige y el momento UTC en que cumple 7 días, y no falla;
- si el arreglo tiene 7 días o más: falla;
- si no hay arreglo (`fixed_version` vacío) o el arreglo es solo una pseudo-versión: falla;
- si no puede obtener la fecha de publicación: falla. No la da por buena, igual que antiguedad (D-158).

Nada de CVSS, EPSS ni KEV: lo urgente lo decide el dueño ante cada aviso. El aviso solo vale para fusionar, no
para desplegar.

Fecha de publicación (nunca la del commit):

- Go (módulos `stdlib` y `toolchain`; v1.27.4 es go1.27.4): el día de «goX.Y.Z (released AAAA-MM-DD)» en
  https://go.dev/doc/devel/release, que debe aparecer una sola vez. La página da solo el día, y los 7 días se cuentan
  desde su final, las 00:00 UTC del día siguiente (D-201): go1.27.4, publicado el 2026-11-10, cumple 7 días el
  2026-11-18 a las 00:00:00 UTC. El principio: la regla que obliga a adoptar una versión nunca se adelanta a la que
  permite adoptarla. Las dos revisiones no tienen que dar la misma fecha: la de antigüedad (la que permite adoptar Go;
  todavía por construir) usa el `Last-Modified` del tarball y de la imagen, y esta, el final del día. Si una imagen
  sale al día siguiente y esta barrera empieza a fallar antes de que se pueda adoptar, los PR de api/ esperan; no se
  abre una excepción por eso. Una fecha de la página posterior a ahora se rechaza desde el comienzo del día, así que
  el mismo día de la publicación avisa. go.dev/dl/?mode=json no trae fechas y proxy.golang.org da la del commit.
- Los demás módulos: el `Timestamp` con que index.golang.org registra la primera vez que proxy.golang.org guardó
  esa versión. Primero se mira una página del índice desde poco antes del `Last-Modified` del `.mod` en el proxy
  (coincide con esa primera vez; es solo una pista). Si ahí no está, se recorre el índice desde la hora del commit
  (`Time` de proxy.golang.org/<módulo>/@v/<versión>.info) menos una hora, hasta 30 páginas de 2000 entradas; si no
  aparece, falla. deps.dev (`publishedAt`) y el `.info` dan la hora del commit, no la de publicación.

Cada consulta: hasta 3 intentos, como antiguedad, con 60 s por lectura (una página del índice tardó hasta 25 s);
un 404 o 410 no se reintenta.

Falla también si la salida está vacía o no es JSON estricto (NaN, Infinity o una clave repetida en cualquier nivel,
que en Python borraría a la anterior; tampoco se aceptan en las respuestas del proxy y del índice), si no empieza con `config`, si el análisis no es de nivel
`symbol` y modo `source`, si falta el `SBOM` o el progreso «Checking the code against the vulnerabilities...»
(govulncheck no lo emite si no pudo bajar la base), o si un hallazgo no tiene la forma que valida govulncheck.

Uso (sin dependencias, solo la biblioteca estándar):

    go tool govulncheck -format json ./... > govulncheck.json      # en api/
    python3 -I -B .azure-pipelines/pruebas/vulnerabilidades.py revisar govulncheck.json   # o «revisar -» (entrada estándar)
    python3 -I -B .azure-pipelines/pruebas/vulnerabilidades.py probar
    python3 -I -B .azure-pipelines/pruebas/vulnerabilidades.py fecha stdlib v1.27.4        # consulta en vivo
"""
import contextlib
import datetime
import email.utils
import html
import io
import json
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DIAS = 7
UTC = datetime.timezone.utc
PAGINA_DE_GO = "https://go.dev/doc/devel/release"
PROXY = "https://proxy.golang.org"
INDICE = "https://index.golang.org/index"
LIMITE_DEL_INDICE = 2000  # el máximo que acepta index.golang.org
MARGEN_DEL_INDICE = datetime.timedelta(hours=1)  # antes de la hora del commit, por relojes desfasados
ANTES_DE_LA_PISTA = datetime.timedelta(minutes=2)  # antes del Last-Modified, que viene sin fracción de segundo
MAX_PAGINAS = 30  # unas 4 horas del índice (2000 entradas son unos 8 minutos); si no aparece, falla
# Tres intentos como antiguedad (D-158), con 60 s por lectura: una página del índice tardó hasta 25 s (2026-11-11).
INTENTOS, ESPERA_S, MAXIMO_DE_BYTES = 3, 60, 20_000_000
MODULOS_DE_GO = ("stdlib", "toolchain")

PROTOCOLO = "v1.0.0"
REVISANDO = "Checking the code against the vulnerabilities..."
TIPOS = ("config", "progress", "SBOM", "osv", "finding")

SEMVER = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
                    r"(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$")
# La misma expresión que golang.org/x/mod/module.IsPseudoVersion.
PSEUDO = re.compile(r"^v[0-9]+\.(0\.0-|\d+\.\d+-([^+]*\.)?0\.)\d{14}-[A-Za-z0-9]+(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$")
INSTANTE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$")


class SalidaInvalida(Exception):
    """La salida de govulncheck no se puede usar: la barrera falla."""


class SinFecha(Exception):
    """No se pudo obtener la fecha de publicación de un arreglo."""


class JSONNoEstricto(ValueError):
    """JSON que Python acepta y Go no: NaN, Infinity, -Infinity o una clave repetida."""


SALTOS_DE_LINEA = re.compile("[\r\n\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]")


def visible(texto):
    """Un texto que viene de afuera no puede dar comandos al agente, que busca «##vso[» (y «##[») en cualquier parte
    de una línea: sin saltos de línea (se escriben «\\r», «\\n», «\\x0b»…) y sin ningún «##», con cualquier número de «#»
    seguidos («###» queda «#\\#\\#»). El texto va siempre después del «]» de task.logissue, como mensaje: ahí «;» y
    «]» no cambian el comando."""
    texto = SALTOS_DE_LINEA.sub(lambda m: {"\r": "\\r", "\n": "\\n"}.get(
        m[0], m[0].encode("unicode_escape").decode("ascii")), str(texto))
    while "##" in texto:  # cada vuelta separa pares; con una sola, «###» dejaría «#\##»
        texto = texto.replace("##", "#\\#")
    return texto


def json_estricto(texto):
    """json.loads sin NaN, Infinity ni claves repetidas. JSONDecodeError o JSONNoEstricto (las dos son ValueError)."""
    return json.loads(texto, parse_constant=_sin_constantes, object_pairs_hook=_sin_claves_repetidas)


def _sin_constantes(valor):
    raise JSONNoEstricto(f"«{valor}» no es un valor JSON")


def _sin_claves_repetidas(pares):
    objeto = {}
    for clave, valor in pares:
        if clave in objeto:
            raise JSONNoEstricto(f"la clave «{clave}» está repetida")
        objeto[clave] = valor
    return objeto


def momento(instante):
    """El instante exacto en UTC: con microsegundos si no es un segundo entero."""
    utc = instante.astimezone(UTC)
    return utc.strftime("%Y-%m-%d a las %H:%M:%S" + (".%f" if utc.microsecond else "") + " UTC")


def leer_instante(texto):
    """Instante RFC 3339 en UTC («2026-10-09T16:42:23.567735Z»), o SinFecha."""
    m = INSTANTE.match(texto) if isinstance(texto, str) else None
    if not m:
        raise SinFecha(f"instante con formato desconocido: {texto!r}")
    fraccion = (m[7] or "0")[:6].ljust(6, "0")
    try:
        return datetime.datetime(*(int(m[i]) for i in range(1, 7)), int(fraccion), tzinfo=UTC)
    except ValueError as error:
        raise SinFecha(f"instante inválido {texto!r}: {error}") from None


# --- La salida de govulncheck ---

def leer_mensajes(texto):
    """Mensajes del flujo JSON de govulncheck (objetos seguidos, con sangría). SalidaInvalida si no se puede leer."""
    if not texto.strip():
        raise SalidaInvalida("la salida de govulncheck está vacía")
    decodificador = json.JSONDecoder(parse_constant=_sin_constantes, object_pairs_hook=_sin_claves_repetidas)
    i, mensajes = 0, []
    while True:
        while i < len(texto) and texto[i].isspace():
            i += 1
        if i >= len(texto):
            return mensajes
        try:
            mensaje, i = decodificador.raw_decode(texto, i)
        except json.JSONDecodeError as error:
            raise SalidaInvalida(f"la salida de govulncheck no es JSON válido (mensaje {len(mensajes) + 1}, "
                                 f"carácter {error.pos}): {error.msg}") from None
        except JSONNoEstricto as error:
            raise SalidaInvalida(f"la salida de govulncheck no es JSON estricto (mensaje {len(mensajes) + 1}): "
                                 f"{error}") from None
        if not isinstance(mensaje, dict) or len(mensaje) != 1 or next(iter(mensaje)) not in TIPOS \
                or not isinstance(next(iter(mensaje.values())), dict):
            raise SalidaInvalida(f"el mensaje {len(mensajes) + 1} no es uno de {', '.join(TIPOS)} con un objeto")
        mensajes.append(mensaje)


def _texto(valor):
    return isinstance(valor, str) and valor != ""


def validar_hallazgo(hallazgo, n):
    """Las mismas reglas que validateFindings de govulncheck (internal/scan/util.go), más los tipos."""
    if not _texto(hallazgo.get("osv")):
        raise SalidaInvalida(f"el hallazgo {n} no tiene «osv»")
    if not isinstance(hallazgo.get("fixed_version", ""), str):
        raise SalidaInvalida(f"el hallazgo {n} tiene «fixed_version» que no es texto")
    traza = hallazgo.get("trace")
    if not isinstance(traza, list) or not traza or not all(isinstance(m, dict) for m in traza):
        raise SalidaInvalida(f"el hallazgo {n} no tiene una traza con al menos un marco")
    for marco in traza:
        for campo in ("module", "version", "package", "function"):
            if not isinstance(marco.get(campo, ""), str):
                raise SalidaInvalida(f"el hallazgo {n} tiene «{campo}» que no es texto")
        if (marco.get("version") or marco.get("package")) and not marco.get("module"):
            raise SalidaInvalida(f"el hallazgo {n} tiene un marco con versión o paquete y sin módulo")
        if marco.get("function") and not marco.get("package"):
            raise SalidaInvalida(f"el hallazgo {n} tiene un marco con función y sin paquete")


def alcanzadas(mensajes):
    """Comprueba que el análisis esté completo y devuelve (config, {(osv, módulo, arreglo): número de trazas}) de las
    vulnerabilidades que el código alcanza."""
    if not mensajes or "config" not in mensajes[0]:
        raise SalidaInvalida("la salida de govulncheck no empieza con «config»")
    configs = [m["config"] for m in mensajes if "config" in m]
    if len(configs) != 1:
        raise SalidaInvalida(f"la salida trae {len(configs)} mensajes «config»; se esperaba uno")
    config = configs[0]
    esperado = {"protocol_version": PROTOCOLO, "scanner_name": "govulncheck", "scan_level": "symbol",
                "scan_mode": "source"}
    for campo, valor in esperado.items():
        if config.get(campo) != valor:
            raise SalidaInvalida(f"«config» trae {campo} = {config.get(campo)!r}; se esperaba {valor!r}")
    sboms = [m["SBOM"] for m in mensajes if "SBOM" in m]
    if not sboms or not all(_texto(s.get("go_version")) and isinstance(s.get("roots"), list) and s["roots"]
                            for s in sboms):
        raise SalidaInvalida("falta el «SBOM» con la versión de Go y los paquetes analizados")
    if not any(m["progress"].get("message") == REVISANDO for m in mensajes if "progress" in m):
        raise SalidaInvalida(f"falta el progreso «{REVISANDO}»: el análisis no llegó a revisar el código")
    osvs = set()
    for m in mensajes:
        if "osv" in m:
            if not _texto(m["osv"].get("id")):
                raise SalidaInvalida("un mensaje «osv» no tiene «id»")
            osvs.add(m["osv"]["id"])
    grupos = {}
    for n, hallazgo in enumerate((m["finding"] for m in mensajes if "finding" in m), start=1):
        validar_hallazgo(hallazgo, n)
        primero = hallazgo["trace"][0]
        if not primero.get("function"):
            continue  # solo de módulo o de paquete: el código no la llama
        if hallazgo["osv"] not in osvs:
            raise SalidaInvalida(f"el hallazgo {n} ({visible(hallazgo['osv'])}) no tiene su mensaje «osv»")
        clave = (hallazgo["osv"], primero["module"], hallazgo.get("fixed_version", ""))
        grupos[clave] = grupos.get(clave, 0) + 1
    return config, grupos


# --- Versiones ---

def es_semver(version):
    return isinstance(version, str) and bool(SEMVER.match(version))


def es_pseudo(version):
    return es_semver(version) and version.count("-") >= 2 and bool(PSEUDO.match(version))


def nombre_de_go(version):
    """v1.27.4 -> go1.27.4; antes de Go 1.21 la versión .0 se llamaba go1.20. None si no es una versión publicada
    (una rc o una beta no están en la página de versiones)."""
    m = re.match(r"^v1\.(\d+)\.(\d+)$", version)
    if not m:
        return None
    menor, parche = int(m[1]), int(m[2])
    return f"go1.{menor}" if parche == 0 and menor < 21 else f"go1.{menor}.{parche}"


# --- Fechas de publicación ---

def fecha_en_la_pagina_de_go(pagina, nombre):
    """Día (datetime.date, sin hora: la página no la da) de «<nombre> (released AAAA-MM-DD)» en el HTML de
    go.dev/doc/devel/release. La regla lo cuenta desde su final (`final_del_dia`, en `publicacion`)."""
    texto = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", pagina)))
    dias = re.findall(r"(?<![\w.])" + re.escape(nombre) + r" \(released (\d{4}-\d{2}-\d{2})\)", texto)
    if not dias:
        raise SinFecha(f"{nombre} no aparece con «(released AAAA-MM-DD)» en {PAGINA_DE_GO}")
    if len(set(dias)) > 1:
        raise SinFecha(f"{nombre} aparece con fechas distintas en {PAGINA_DE_GO}: {', '.join(sorted(set(dias)))}")
    if len(dias) > 1:  # aunque sea con la misma fecha: la página no es la que se conoce
        raise SinFecha(f"{nombre} aparece {len(dias)} veces con «(released {dias[0]})» en {PAGINA_DE_GO}; "
                       "se esperaba una sola")
    try:
        return datetime.datetime.strptime(dias[0], "%Y-%m-%d").date()
    except ValueError as error:
        raise SinFecha(f"fecha inválida de {nombre} en {PAGINA_DE_GO}: {error}") from None


def final_del_dia(dia):
    """El final de un día UTC: las 00:00 UTC del día siguiente."""
    return datetime.datetime.combine(dia + datetime.timedelta(days=1), datetime.time(), tzinfo=UTC)


def escapar(ruta):
    """Ruta de módulo o versión para el proxy: cada mayúscula pasa a «!» y minúscula (module.EscapePath)."""
    return urllib.parse.quote(re.sub(r"[A-Z]", lambda m: "!" + m[0].lower(), ruta), safe="/!+~")


def fecha_en_el_indice(modulo, version, traer, ahora, max_paginas=MAX_PAGINAS):
    """Primera vez que proxy.golang.org guardó modulo@version, según index.golang.org (la única fecha que se usa).

    Para no recorrer el índice página a página (cada una tarda de 1 a 25 s), primero se busca en una sola página desde
    poco antes del `Last-Modified` del `.mod` en el proxy, que coincide con esa primera vez. Es solo una pista: si ahí
    no está (o el proxy no la da), se recorre el índice desde la hora del commit menos una hora."""
    base = f"{PROXY}/{escapar(modulo)}/@v/{escapar(version)}"
    respuesta = traer(f"{base}.info")
    try:
        info = json_estricto(respuesta)
    except ValueError as error:
        raise SinFecha(f"proxy.golang.org no devolvió JSON estricto para {modulo}@{version}: {error}") from None
    if not isinstance(info, dict) or info.get("Version") != version:
        raise SinFecha(f"proxy.golang.org no conoce {modulo}@{version}")
    commit = leer_instante(info.get("Time"))
    try:
        pista = email.utils.parsedate_to_datetime(traer(f"{base}.mod", cabecera="Last-Modified")).astimezone(UTC)
    except (SinFecha, TypeError, ValueError, IndexError):
        pista = None
    if pista is not None:
        encontrado = _buscar_en_el_indice(modulo, version, traer, min(pista, ahora) - ANTES_DE_LA_PISTA, 1)
        if encontrado is not None:
            return encontrado
    desde = min(commit, ahora) - MARGEN_DEL_INDICE
    encontrado = _buscar_en_el_indice(modulo, version, traer, desde, max_paginas)
    if encontrado is None:
        raise SinFecha(f"{modulo}@{version} no aparece en index.golang.org desde {desde.isoformat()} "
                       f"(hasta ahora o en {max_paginas} páginas)")
    return encontrado


def _buscar_en_el_indice(modulo, version, traer, desde, max_paginas):
    """Timestamp de modulo@version en index.golang.org desde `desde`, o None si no aparece hasta el final del índice
    o en `max_paginas` páginas. SinFecha si el índice no responde o responde algo que no se puede leer."""
    for _ in range(max_paginas):
        consulta = urllib.parse.urlencode({"since": desde.strftime("%Y-%m-%dT%H:%M:%S.%fZ"), "limit": LIMITE_DEL_INDICE})
        entradas = []
        for linea in traer(f"{INDICE}?{consulta}").splitlines():
            if not linea.strip():
                continue
            try:
                entrada = json_estricto(linea)
            except ValueError as error:
                raise SinFecha(f"index.golang.org devolvió una línea que no es JSON estricto: {error}") from None
            if not isinstance(entrada, dict) or not all(_texto(entrada.get(c)) for c in ("Path", "Version", "Timestamp")):
                raise SinFecha("index.golang.org devolvió una entrada sin Path, Version o Timestamp")
            entradas.append(entrada)
        for entrada in entradas:
            if entrada["Path"] == modulo and entrada["Version"] == version:
                return leer_instante(entrada["Timestamp"])
        if len(entradas) < LIMITE_DEL_INDICE:
            return None
        ultimo = leer_instante(entradas[-1]["Timestamp"])
        if ultimo <= desde:
            raise SinFecha("index.golang.org no avanza: más de 2000 entradas con el mismo instante")
        desde = ultimo
    return None


def publicacion(modulo, version, traer, ahora):
    """(desde cuándo se cuentan los 7 días, primer instante en que pudo publicarse, nombre del arreglo, «publicado el …»
    con su fuente). SinFecha si no se puede obtener.

    Go: la página da solo el día y se cuenta desde su final, 00:00 UTC del día siguiente (D-201); el primer instante
    posible es el comienzo de ese día. Módulos: el instante del índice, para las dos cosas."""
    if modulo in MODULOS_DE_GO:
        nombre = nombre_de_go(version)
        if nombre is None:
            raise SinFecha(f"{version} no es una versión publicada de Go")
        dia = fecha_en_la_pagina_de_go(traer(PAGINA_DE_GO), nombre)
        cuenta = final_del_dia(dia)
        return (cuenta, cuenta - datetime.timedelta(days=1), nombre,
                f"publicado el {dia.isoformat()} según go.dev/doc/devel/release; se cuenta desde el final de ese día, "
                f"el {momento(cuenta)}")
    instante = fecha_en_el_indice(modulo, version, traer, ahora)
    return (instante, instante, f"{modulo}@{version}",
            f"publicado el {momento(instante)} según index.golang.org (primera vez en proxy.golang.org)")


# --- La regla ---

def evaluar(texto, ahora, traer):
    """Devuelve (encabezado, avisos, fallas). Las fallas de la salida de govulncheck salen como una falla."""
    try:
        config, grupos = alcanzadas(leer_mensajes(texto))
    except SalidaInvalida as error:
        return [], [], [f"no se puede usar la salida de govulncheck: {visible(error)}"]
    encabezado = [f"govulncheck {visible(config.get('scanner_version', '?'))} con {visible(config.get('go_version', '?'))}, "
                  f"base {visible(config.get('db', '?'))} del {visible(config.get('db_last_modified', '?'))}; "
                  f"vulnerabilidades que el código alcanza: {len({osv for osv, _, _ in grupos})}"]
    traer = con_memoria(traer)
    avisos, fallas = [], []
    for (osv, modulo, arreglo), trazas in sorted(grupos.items()):
        sujeto = f"{visible(osv)} en {visible(modulo)} ({trazas} traza{'s' if trazas != 1 else ''})"
        if not arreglo:
            fallas.append(f"{sujeto}: no tiene arreglo publicado y el código la alcanza")
            continue
        if not es_semver(arreglo):
            fallas.append(f"{sujeto}: el arreglo «{visible(arreglo)}» no es una versión válida")
            continue
        if es_pseudo(arreglo):
            fallas.append(f"{sujeto}: el arreglo es solo la pseudo-versión {visible(arreglo)}, sin versión publicada")
            continue
        try:
            cuenta, primero, nombre, publicado = publicacion(modulo, arreglo, traer, ahora)
        except SinFecha as error:
            fallas.append(f"{sujeto}: no se pudo obtener la fecha de publicación de {visible(arreglo)}: "
                          f"{visible(error)}. No se da por buena (D-158)")
            continue
        if primero > ahora:
            fallas.append(f"{sujeto}: la fecha de publicación de {visible(nombre)} es posterior a ahora "
                          f"({publicado}); no se da por buena")
            continue
        cumple = cuenta + datetime.timedelta(days=DIAS)
        detalle = f"lo corrige {visible(nombre)}, {publicado}"
        if ahora >= cumple:
            fallas.append(f"{sujeto}: {detalle}; cumplió {DIAS} días el {momento(cumple)}. Actualiza a {visible(nombre)} "
                          "o una versión posterior")
        else:
            avisos.append(f"{sujeto}: {detalle}; cumple {DIAS} días el {momento(cumple)}. Hasta entonces no falla; "
                          "desde ese momento, sí")
    return encabezado, avisos, fallas


def con_memoria(traer):
    memoria = {}

    def traer_una_vez(url, cabecera=None):
        clave = (url, cabecera)
        if clave not in memoria:
            try:
                memoria[clave] = ("ok", traer(url, cabecera=cabecera) if cabecera else traer(url))
            except SinFecha as error:
                memoria[clave] = ("error", error)
        estado, valor = memoria[clave]
        if estado == "error":
            raise valor
        return valor
    return traer_una_vez


def traer_http(url, cabecera=None):
    """Texto de una dirección https, o con `cabecera` el valor de esa cabecera (con HEAD). Tres intentos ante fallas de
    red o del servidor; un 404 o 410 no se reintenta."""
    ultimo = None
    for intento in range(1, INTENTOS + 1):
        try:
            pedido = urllib.request.Request(url, method="HEAD" if cabecera else "GET",
                                            headers={"User-Agent": "alcanzamos-barrera-de-vulnerabilidades"})
            with urllib.request.urlopen(pedido, timeout=ESPERA_S) as respuesta:
                if cabecera:
                    valor = respuesta.headers.get(cabecera)
                    if not valor:
                        raise SinFecha(f"{url} no trae la cabecera {cabecera}")
                    return valor
                datos = respuesta.read(MAXIMO_DE_BYTES + 1)
            if len(datos) > MAXIMO_DE_BYTES:
                raise SinFecha(f"{url} devolvió más de {MAXIMO_DE_BYTES} bytes")
            return datos.decode("utf-8")
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                raise SinFecha(f"{url} respondió {error.code}") from None
            ultimo = f"{url} respondió {error.code}"
        except (urllib.error.URLError, OSError, UnicodeDecodeError) as error:
            ultimo = f"{url}: {error}"
        if intento < INTENTOS:
            time.sleep(intento)
    raise SinFecha(f"{ultimo} ({INTENTOS} intentos)")


def informar(encabezado, avisos, fallas):
    """Imprime el resultado con los comandos del agente y devuelve el código de salida."""
    for linea in encabezado:
        print(linea)
    for aviso in avisos:
        print(f"##vso[task.logissue type=warning]{aviso}")
    for falla in fallas:
        print(f"##vso[task.logissue type=error]{falla}")
    if fallas:
        print(f"Falla con {len(fallas)} error(es): la barrera de vulnerabilidades no deja pasar.")
        return 1
    if avisos:
        print(f"Pasa con {len(avisos)} aviso(s): el arreglo tiene menos de {DIAS} días. Este aviso solo vale para "
              "fusionar; el despliegue falla con cualquier vulnerabilidad alcanzada que tenga arreglo (D-201).")
        return 0
    print("El código no alcanza ninguna vulnerabilidad conocida.")
    return 0


def comando_revisar(ruta, ahora=None, traer=traer_http, entrada=None):
    try:
        texto = (entrada or sys.stdin).read() if ruta == "-" else Path(ruta).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        print(f"##vso[task.logissue type=error]no se pudo leer la salida de govulncheck: {visible(error)}")
        return 1
    return informar(*evaluar(texto, ahora or datetime.datetime.now(UTC), traer))


def comando_fecha(modulo, version, traer=traer_http):
    """Consulta en vivo la fecha de publicación que usaría la barrera."""
    try:
        cuenta, _, nombre, publicado = publicacion(modulo, version, traer, datetime.datetime.now(UTC))
    except SinFecha as error:
        print(f"FALLA no se pudo obtener la fecha: {visible(error)}")
        return 1
    print(f"{visible(nombre)}: {publicado}; cumple {DIAS} días el {momento(cuenta + datetime.timedelta(days=DIAS))}")
    return 0


# --- Prueba de este script: salidas de ejemplo, consultas simuladas y el resultado que debe dar cada una. ---

AHORA = datetime.datetime(2026, 11, 11, 15, 0, tzinfo=UTC)

# Fragmento de https://go.dev/doc/devel/release tal como estaba el 2026-11-11 (go1.27.0, go1.27.3 y go1.27.4).
PAGINA_DE_GO_DE_PRUEBA = """
	<h2 id="go1.27.0">go1.27.0 (released 2026-08-19)</h2>
	<p>
	Go 1.27.0 is a major release of Go.
	Read the <a href="/doc/go1.27">Go 1.27 Release Notes</a> for more information.
	</p>
	<h3 id="go1.27.minor">Minor revisions</h3>
		<p id="go1.27.3">
		go1.27.3
		(released 2026-10-19)
			includes
				security
				fixes to the <code>crypto/x509</code> package.
			See the
			<a href="https://github.com/golang/go/issues?q=milestone%3AGo1.27.3+label%3ACherryPickApproved">Go 1.27.3 milestone</a>
			on our issue tracker for details.
		</p>
		<p id="go1.27.4">
		go1.27.4
		(released 2026-11-10)
			includes
				security
				fixes to cgo, the <code>go</code> command, the compiler, the linker, and the <code>net/http</code> package, as well as
				bug
				fixes to the assembler, the compiler, the runtime, toolchain bootstrapping, and the <code>crypto/fips140</code>, <code>crypto/hkdf</code>, <code>crypto/rsa</code>, <code>crypto/tls</code>, and <code>net</code> packages.
			See the
			<a href="https://github.com/golang/go/issues?q=milestone%3AGo1.27.4+label%3ACherryPickApproved">Go 1.27.4 milestone</a>
			on our issue tracker for details.
		</p>
	<h2 id="go1.20">go1.20 (released 2023-02-01)</h2>
"""
# Trampas: una versión que empieza igual (go1.27.41) y el mismo nombre con dos fechas.
PAGINA_CON_TRAMPAS = PAGINA_DE_GO_DE_PRUEBA + "<p>go1.27.41 (released 2030-01-01)</p><p>xgo1.27.5 (released 2026-11-01)</p>"
PAGINA_CON_DOS_FECHAS = PAGINA_DE_GO_DE_PRUEBA + "<p>go1.27.4 (released 2026-11-01)</p>"
# La misma entrada dos veces, con la misma fecha: tampoco se sabe cuál es la buena.
PAGINA_CON_ENTRADA_REPETIDA = PAGINA_DE_GO_DE_PRUEBA + '<p id="go1.27.4">go1.27.4 (released 2026-11-10)</p>'


def _flujo(*hallazgos, config=None, sbom=True, progreso=True, osvs=None, extra=()):
    """Salida de govulncheck -format json como la escribe (objetos con sangría, uno tras otro)."""
    cfg = {"protocol_version": PROTOCOLO, "scanner_name": "govulncheck", "scanner_version": "v1.9.0",
           "db": "https://vuln.go.dev", "db_last_modified": "2026-11-11T02:51:11Z", "go_version": "go1.27.3",
           "scan_level": "symbol", "scan_mode": "source"}
    cfg.update(config if isinstance(config, dict) else {})
    mensajes = [] if config == "sin" else [{"config": {k: v for k, v in cfg.items() if v is not None}}]
    if sbom:
        mensajes.append({"SBOM": {"go_version": "go1.27.3", "modules": [{"path": "github.com/alcanzamos/alcanzamos/api"}],
                                  "roots": ["github.com/alcanzamos/alcanzamos/api/src/servidor"]}})
    mensajes.append({"progress": {"message": "Fetching vulnerabilities from the database..."}})
    ids = osvs if osvs is not None else sorted({h["osv"] for h in hallazgos})
    mensajes += [{"osv": {"id": i, "modified": "2026-11-10T00:00:00Z"}} for i in ids]
    if progreso:
        mensajes.append({"progress": {"message": REVISANDO}})
    mensajes += [{"finding": h} for h in hallazgos]
    mensajes += list(extra)
    return "".join(json.dumps(m, indent=2) + "\n" for m in mensajes)


def _llamado(osv, modulo, version, arreglo, paquete="net/http", funcion="Read"):
    traza = [{"module": modulo, "version": version, "package": paquete, "function": funcion, "receiver": "*connReader",
              "position": {"filename": "src/net/http/server.go", "offset": 1, "line": 823, "column": 23}},
             {"module": "github.com/alcanzamos/alcanzamos/api", "package": "github.com/alcanzamos/alcanzamos/api/src/servidor",
              "function": "Servir", "position": {"filename": "src/servidor/servidor.go", "offset": 1, "line": 74, "column": 40}}]
    return {"osv": osv, **({"fixed_version": arreglo} if arreglo else {}), "trace": traza}


def _de_paquete(osv, modulo, version, arreglo, paquete="net/http"):
    return {"osv": osv, **({"fixed_version": arreglo} if arreglo else {}),
            "trace": [{"module": modulo, "version": version, "package": paquete}]}


def _de_modulo(osv, modulo, version, arreglo):
    return {"osv": osv, **({"fixed_version": arreglo} if arreglo else {}), "trace": [{"module": modulo, "version": version}]}


MODULO = "github.com/Ejemplo/vulnerable"  # con mayúscula: el proxy la escribe «!ejemplo»
INDICE_DE_PRUEBA = (
    [{"Path": f"example.com/relleno{i}", "Version": "v1.0.0", "Timestamp": f"2026-11-03T10:{i // 60:02d}:{i % 60:02d}.000001Z"}
     for i in range(2500)]  # más de una página antes de la versión buscada
    + [{"Path": MODULO, "Version": "v1.2.3", "Timestamp": "2026-11-04T12:30:00.123456Z"},
       {"Path": MODULO, "Version": "v1.2.6", "Timestamp": "2026-11-06T09:00:00Z"},
       {"Path": MODULO, "Version": "v1.2.4", "Timestamp": "2026-11-10T08:00:00.5Z"},
       {"Path": "example.com/otro", "Version": "v0.1.0", "Timestamp": "2026-11-10T09:00:00Z"}]
)
# Last-Modified del .mod en el proxy: el de v1.2.6 coincide con el índice; el de v1.2.4 es posterior (no sirve de pista).
ULTIMA_MODIFICACION_DE_PRUEBA = {(MODULO, "v1.2.6"): "Fri, 06 Nov 2026 09:00:00 GMT",
                                 (MODULO, "v1.2.4"): "Tue, 10 Nov 2026 12:00:00 GMT"}
INFO_DE_PRUEBA = {(MODULO, "v1.2.3"): "2026-11-03T10:20:00Z", (MODULO, "v1.2.4"): "2026-11-10T07:55:00Z",
                  (MODULO, "v1.2.5"): "2026-11-10T08:30:00Z",
                  # Commit del 2026-11-01 (ya tendría 7 días) etiquetado y publicado el 2026-11-06.
                  (MODULO, "v1.2.6"): "2026-11-01T00:00:00Z"}


def _traer_de_prueba(pagina=PAGINA_DE_GO_DE_PRUEBA, indice=INDICE_DE_PRUEBA, info=None, falla_con=None, consultas=None):
    """Simula go.dev, proxy.golang.org e index.golang.org sin red. `falla_con`: prefijo de dirección que no responde."""
    info = INFO_DE_PRUEBA if info is None else info

    def traer(url, cabecera=None):
        if consultas is not None:
            consultas.append(url)
        if falla_con and url.startswith(falla_con):
            raise SinFecha(f"{url}: sin conexión (prueba)")
        if cabecera == "Last-Modified" and url.endswith(".mod"):
            for (modulo, version), valor in ULTIMA_MODIFICACION_DE_PRUEBA.items():
                if url == f"{PROXY}/{escapar(modulo)}/@v/{escapar(version)}.mod":
                    return valor
            raise SinFecha(f"{url} no trae la cabecera {cabecera}")
        if cabecera:
            raise SinFecha(f"{url}: cabecera inesperada en la prueba")
        if url == PAGINA_DE_GO:
            return pagina
        if url.startswith(PROXY + "/") and url.endswith(".info"):
            for (modulo, version), hora in info.items():
                if url == f"{PROXY}/{escapar(modulo)}/@v/{escapar(version)}.info":
                    return json.dumps({"Version": version, "Time": hora})
            raise SinFecha(f"{url} respondió 404")
        if url.startswith(INDICE + "?"):
            consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            desde, limite = leer_instante(consulta["since"][0]), int(consulta["limit"][0])
            elegidas = [e for e in indice if leer_instante(e["Timestamp"]) >= desde][:limite]
            return "".join(json.dumps(e) + "\n" for e in elegidas)
        raise SinFecha(f"{url}: dirección inesperada en la prueba")
    return traer


GO_6859 = _llamado("GO-2026-6859", "stdlib", "v1.27.3", "v1.27.4")


def casos():
    """(nombre, salida de govulncheck, ahora, consultas simuladas, resultado: "pasa", "aviso" o "falla",
    fragmentos que deben aparecer en lo impreso)."""
    t = _traer_de_prueba
    micro = datetime.timedelta(microseconds=1)
    # go1.27.4 salió el 2026-11-10: se cuenta desde el final de ese día (2026-11-11 00:00 UTC) y cumple 7 días el
    # 2026-11-18 a las 00:00 UTC (D-201).
    limite_6859 = datetime.datetime(2026, 11, 18, tzinfo=UTC)
    return [
        # Pasan.
        ("sin vulnerabilidades alcanzadas ni hallazgos", _flujo(), AHORA, t(), "pasa", ["no alcanza ninguna"]),
        ("solo hallazgos de módulo y de paquete (no los llama): no cuentan, aunque no tengan arreglo o sea pseudo-versión",
         _flujo(_de_modulo("GO-2026-5932", "golang.org/x/crypto", "v0.58.0", "v0.58.1-0.20261009181718-2f1f834330b2"),
                _de_modulo("GO-2026-0002", "example.com/sinarreglo", "v1.0.0", ""),
                _de_modulo("GO-2026-6859", "stdlib", "v1.27.3", "v1.27.4"),
                _de_paquete("GO-2026-6859", "stdlib", "v1.27.3", "v1.20.1")),
         AHORA, t(), "pasa", ["alcanza: 0"]),
        # Avisan y pasan.
        ("Go: GO-2026-6859 con go1.27.4 (2026-11-10), menos de 7 días: avisa y pasa", _flujo(GO_6859), AHORA, t(), "aviso",
         ["##vso[task.logissue type=warning]GO-2026-6859 en stdlib (1 traza): lo corrige go1.27.4, publicado el "
          "2026-11-10 según go.dev/doc/devel/release; se cuenta desde el final de ese día, el 2026-11-11 a las 00:00:00 UTC",
          "cumple 7 días el 2026-11-18 a las 00:00:00 UTC", "solo vale para fusionar"]),
        ("Go: el mismo día de la publicación (2026-11-10 16:48 UTC, la hora del tarball): avisa, no es una fecha futura",
         _flujo(GO_6859), datetime.datetime(2026, 11, 10, 16, 48, tzinfo=UTC), t(), "aviso",
         ["cumple 7 días el 2026-11-18 a las 00:00:00 UTC"]),
        ("Go: al comienzo del día de la publicación (2026-11-10 00:00 UTC): avisa", _flujo(GO_6859),
         datetime.datetime(2026, 11, 10, tzinfo=UTC), t(), "aviso", ["cumple 7 días el 2026-11-18 a las 00:00:00 UTC"]),
        ("las 24 trazas de una misma vulnerabilidad cuentan como una, con un solo aviso",
         _flujo(*[GO_6859] * 24, _de_modulo("GO-2026-6859", "stdlib", "v1.27.3", "v1.27.4"),
                _de_paquete("GO-2026-6859", "stdlib", "v1.27.3", "v1.27.4")),
         AHORA, t(), "aviso", ["(24 trazas)", "Pasa con 1 aviso"]),
        ("Go: 2026-11-17 23:59:59.999999 UTC, un microsegundo antes del final del día + 7: avisa", _flujo(GO_6859),
         limite_6859 - micro, t(), "aviso", ["cumple 7 días el 2026-11-18 a las 00:00:00 UTC"]),
        ("Go: 2026-11-17 00:00 UTC (7 días desde el comienzo del día, no desde el final): todavía avisa", _flujo(GO_6859),
         datetime.datetime(2026, 11, 17, tzinfo=UTC), t(), "aviso", ["cumple 7 días el 2026-11-18 a las 00:00:00 UTC"]),
        ("módulo: el commit tiene más de 7 días y el arreglo apareció en el índice hace menos: avisa con la hora del índice",
         _flujo(_llamado("GO-2026-0010", MODULO, "v1.2.0", "v1.2.6", paquete=MODULO)), AHORA, t(), "aviso",
         [f"lo corrige {MODULO}@v1.2.6, publicado el 2026-11-06 a las 09:00:00 UTC según index.golang.org",
          "cumple 7 días el 2026-11-13 a las 09:00:00 UTC"]),
        ("módulo: arreglo publicado ayer en el índice, con fracción de segundo: el momento exacto",
         _flujo(_llamado("GO-2026-0015", MODULO, "v1.2.0", "v1.2.4", paquete=MODULO)), AHORA, t(), "aviso",
         ["publicado el 2026-11-10 a las 08:00:00.500000 UTC", "cumple 7 días el 2026-11-17 a las 08:00:00.500000 UTC"]),
        # Fallan.
        ("Go: el arreglo tiene 7 días o más (go1.27.3, 2026-10-19)",
         _flujo(_llamado("GO-2026-0001", "stdlib", "v1.27.2", "v1.27.3")), AHORA, t(), "falla",
         ["##vso[task.logissue type=error]GO-2026-0001 en stdlib", "cumplió 7 días el 2026-10-27 a las 00:00:00 UTC",
          "Actualiza a go1.27.3"]),
        ("Go: 2026-11-18 00:00 UTC, justo al cumplir 7 días desde el final del día: falla", _flujo(GO_6859), limite_6859,
         t(), "falla", ["cumplió 7 días el 2026-11-18 a las 00:00:00 UTC"]),
        ("Go: una versión .0 de la página (go1.27.0)", _flujo(_llamado("GO-2026-0003", "toolchain", "v1.26.9", "v1.27.0")),
         AHORA, t(), "falla", ["go1.27.0, publicado el 2026-08-19"]),
        ("Go antes de 1.21: v1.20.0 es go1.20", _flujo(_llamado("GO-2023-0001", "stdlib", "v1.19.9", "v1.20.0")),
         AHORA, t(), "falla", ["go1.20, publicado el 2023-02-01"]),
        ("módulo: el arreglo apareció en el índice hace 7 días o más (en la segunda página; no la hora del commit)",
         _flujo(_llamado("GO-2026-0011", MODULO, "v1.2.0", "v1.2.3", paquete=MODULO)), AHORA, t(), "falla",
         ["publicado el 2026-11-04 a las 12:30:00.123456 UTC según index.golang.org",
          "cumplió 7 días el 2026-11-11 a las 12:30:00.123456 UTC"]),
        ("sin arreglo", _flujo(_llamado("GO-2026-0004", "example.com/m", "v1.0.0", "", paquete="example.com/m")),
         AHORA, t(), "falla", ["no tiene arreglo publicado"]),
        ("el arreglo es solo una pseudo-versión",
         _flujo(_llamado("GO-2026-5932", "golang.org/x/crypto", "v0.58.0", "v0.58.1-0.20261009181718-2f1f834330b2",
                         paquete="golang.org/x/crypto/openpgp")),
         AHORA, t(), "falla", ["solo la pseudo-versión v0.58.1-0.20261009181718-2f1f834330b2"]),
        ("el arreglo no es una versión válida", _flujo(_llamado("GO-2026-0005", "example.com/m", "v1", "1.2", paquete="example.com/m")),
         AHORA, t(), "falla", ["no es una versión válida"]),
        ("Go: una rc no es una versión publicada", _flujo(_llamado("GO-2026-0006", "stdlib", "v1.27.3", "v1.28.0-rc.1")),
         AHORA, t(), "falla", ["no es una versión publicada de Go"]),
        ("Go: la versión no está en la página", _flujo(_llamado("GO-2026-0007", "stdlib", "v1.27.4", "v1.27.5")),
         AHORA, t(), "falla", ["go1.27.5 no aparece"]),
        ("Go: go.dev no responde", _flujo(GO_6859), AHORA, t(falla_con=PAGINA_DE_GO), "falla",
         ["no se pudo obtener la fecha de publicación de v1.27.4", "sin conexión", "No se da por buena (D-158)"]),
        ("Go: la página trae dos fechas para la misma versión", _flujo(GO_6859), AHORA, t(pagina=PAGINA_CON_DOS_FECHAS),
         "falla", ["fechas distintas"]),
        ("Go: la página trae la misma entrada dos veces, con la misma fecha", _flujo(GO_6859), AHORA,
         t(pagina=PAGINA_CON_ENTRADA_REPETIDA), "falla", ["go1.27.4 aparece 2 veces"]),
        ("Go: go1.27.41 y xgo1.27.5 no se confunden con go1.27.4 ni go1.27.5",
         _flujo(GO_6859, _llamado("GO-2026-0007", "stdlib", "v1.27.4", "v1.27.5")), AHORA, t(pagina=PAGINA_CON_TRAMPAS),
         "falla", ["cumple 7 días el 2026-11-18 a las 00:00:00 UTC", "go1.27.5 no aparece"]),
        ("módulo: proxy.golang.org no tiene la versión (404)",
         _flujo(_llamado("GO-2026-0012", MODULO, "v1.2.0", "v1.2.9", paquete=MODULO)), AHORA, t(), "falla",
         ["respondió 404", "No se da por buena"]),
        ("módulo: la versión no aparece en el índice", _flujo(_llamado("GO-2026-0013", MODULO, "v1.2.0", "v1.2.5", paquete=MODULO)),
         AHORA, t(), "falla", ["no aparece en index.golang.org"]),
        ("módulo: index.golang.org no responde", _flujo(_llamado("GO-2026-0014", MODULO, "v1.2.0", "v1.2.4", paquete=MODULO)),
         AHORA, t(falla_con=INDICE), "falla", ["sin conexión"]),
        ("Go: una fecha de publicación posterior a ahora (el día anterior, 23:59:59.999999 UTC) no se da por buena",
         _flujo(GO_6859), datetime.datetime(2026, 11, 10, tzinfo=UTC) - micro, t(), "falla", ["posterior a ahora"]),
        ("un aviso y una falla a la vez: falla y muestra los dos",
         _flujo(GO_6859, _llamado("GO-2026-0004", "example.com/m", "v1.0.0", "", paquete="example.com/m")), AHORA, t(),
         "falla", ["type=warning]GO-2026-6859", "type=error]GO-2026-0004"]),
        ("la misma vulnerabilidad en dos módulos se evalúa en cada uno",
         _flujo(GO_6859, _llamado("GO-2026-6859", "example.com/m", "v1.0.0", "", paquete="example.com/m")), AHORA, t(),
         "falla", ["type=warning]GO-2026-6859 en stdlib", "type=error]GO-2026-6859 en example.com/m"]),
        # Salidas de govulncheck que no se pueden usar.
        ("salida vacía", "", AHORA, t(), "falla", ["está vacía"]),
        ("salida en blanco", " \n\n", AHORA, t(), "falla", ["está vacía"]),
        ("salida que no es JSON", "esto no es JSON\n", AHORA, t(), "falla", ["no es JSON válido"]),
        ("salida cortada a la mitad", _flujo(GO_6859)[:-40], AHORA, t(), "falla", ["no es JSON válido"]),
        ("un mensaje que no es de govulncheck", _flujo(extra=[{"otro": {}}]), AHORA, t(), "falla", ["no es uno de"]),
        # JSON no estricto: Python acepta NaN, Infinity y claves repetidas (la última borra a las anteriores); Go no.
        *[(f"un valor {c} (no es JSON) falla", _flujo() + '{"progress": {"message": ' + c + "}}\n", AHORA, t(), "falla",
           [f"«{c}» no es un valor JSON"]) for c in ("NaN", "Infinity", "-Infinity")],
        ("una clave «finding» repetida no borra el hallazgo alcanzado",
         _flujo() + '{"osv": {"id": "GO-2026-0004"}}\n{"finding": '
         + json.dumps(_llamado("GO-2026-0004", "example.com/m", "v1.0.0", "", paquete="example.com/m"))
         + ', "finding": ' + json.dumps(_de_modulo("GO-2026-0004", "example.com/m", "v1.0.0", "")) + "}\n",
         AHORA, t(), "falla", ["la clave «finding» está repetida"]),
        ("una clave repetida dentro de un marco de la traza falla",
         _flujo(extra=[{"osv": {"id": "GO-2026-0004"}}])
         + '{"finding": {"osv": "GO-2026-0004", "trace": [{"module": "m", "package": "m", "function": "F", "function": ""}]}}\n',
         AHORA, t(), "falla", ["la clave «function» está repetida"]),
        ("una lista en lugar de un mensaje", "[]", AHORA, t(), "falla", ["no es uno de"]),
        ("sin «config»", _flujo(GO_6859, config="sin"), AHORA, t(), "falla", ["no empieza con «config»"]),
        ("«config» que no va primero", '{"SBOM": {"go_version": "go1.27.3", "roots": ["x"]}}\n' + _flujo(sbom=False),
         AHORA, t(), "falla", ["no empieza con «config»"]),
        ("«config» repetido", _flujo(extra=[{"config": {"protocol_version": PROTOCOLO}}]), AHORA, t(), "falla", ["2 mensajes «config»"]),
        ("nivel package: no puede ver si el código llama", _flujo(GO_6859, config={"scan_level": "package"}), AHORA, t(), "falla",
         ["scan_level"]),
        ("modo binary", _flujo(config={"scan_mode": "binary"}), AHORA, t(), "falla", ["scan_mode"]),
        ("otro protocolo", _flujo(config={"protocol_version": "v2.0.0"}), AHORA, t(), "falla", ["protocol_version"]),
        ("un campo de config con un comando del agente no da órdenes",
         _flujo(config={"scan_mode": "x\n##vso[task.complete result=Succeeded]"}), AHORA, t(), "falla", ["#\\#vso[task.complete"]),
        ("sin SBOM", _flujo(sbom=False), AHORA, t(), "falla", ["falta el «SBOM»"]),
        ("sin el progreso de revisión del código (no bajó la base)", _flujo(progreso=False), AHORA, t(), "falla",
         ["no llegó a revisar el código"]),
        ("un hallazgo alcanzado sin su mensaje osv", _flujo(GO_6859, osvs=[]), AHORA, t(), "falla", ["no tiene su mensaje «osv»"]),
        ("un hallazgo sin traza", _flujo({"osv": "GO-2026-6859", "fixed_version": "v1.27.4", "trace": []}), AHORA, t(), "falla",
         ["traza con al menos un marco"]),
        ("un marco con función y sin paquete",
         _flujo({"osv": "GO-2026-6859", "trace": [{"module": "stdlib", "function": "Read"}]}), AHORA, t(), "falla",
         ["función y sin paquete"]),
        ("un nombre con un comando del agente no da órdenes",
         _flujo(_llamado("GO-2026-0004\n##vso[task.complete result=Succeeded]", "example.com/m", "v1.0.0", "",
                         paquete="example.com/m")), AHORA, t(), "falla", ["#\\#vso[task.complete"]),
        # Con 2 a 7 «#» seguidos tampoco queda ningún «##» (ni «##vso[») en lo impreso; lo comprueba comando_probar.
        *[(f"un nombre y un módulo con {n} «#» antes de vso[ no dan órdenes",
           _flujo(_llamado("GO-2026-0004\r" + "#" * n + "vso[task.complete result=Succeeded;]", "#" * n + "VSO[x]",
                           "v1.0.0", "", paquete="example.com/m")), AHORA, t(), "falla", ["type=error]GO-2026-0004\\r#\\#"])
          for n in range(2, 8)],
        ("un campo de config con ### antes de vso[ no da órdenes",
         _flujo(config={"scan_mode": "###vso[task.complete result=Succeeded;]"}), AHORA, t(), "falla", ["scan_mode"]),
    ]


def _impreso(llamada):
    """Lo que imprime `llamada`."""
    salida = io.StringIO()
    with contextlib.redirect_stdout(salida):
        llamada()
    return salida.getvalue()


def _correr(texto, ahora, traer):
    """Corre `revisar` con la salida y las consultas simuladas. Devuelve (código, lo impreso)."""
    salida = io.StringIO()
    with contextlib.redirect_stdout(salida):
        codigo = comando_revisar("-", ahora=ahora, traer=traer, entrada=io.StringIO(texto))
    return codigo, salida.getvalue()


COMANDOS_PROPIOS = ("##vso[task.logissue type=warning]", "##vso[task.logissue type=error]")


def _comandos_ajenos(impreso):
    """Líneas con un «##» que no es el de un comando propio al comienzo: nada de afuera da órdenes al agente, que
    busca «##vso[» y «##[» en cualquier parte de la línea y sin distinguir mayúsculas."""
    ajenas = []
    for linea in impreso.splitlines():
        propio = next((p for p in COMANDOS_PROPIOS if linea.startswith(p)), "")
        if "##" in linea[len(propio):]:
            ajenas.append(linea)
    return ajenas


def comando_probar():
    fallas = []
    for nombre, texto, ahora, traer, esperado, fragmentos in casos():
        codigo, impreso = _correr(texto, ahora, traer)
        obtenido = "falla" if codigo == 1 else ("aviso" if "type=warning]" in impreso else "pasa")
        faltan = [f for f in fragmentos if f not in impreso]
        intrusos = _comandos_ajenos(impreso)
        if esperado == "falla" and codigo == 1 and "type=error]" not in impreso:
            faltan.append("una línea ##vso[task.logissue type=error]")
        bien = obtenido == esperado and codigo in (0, 1) and not faltan and not intrusos
        print(f"{'ok  ' if bien else 'FALLA'}  {nombre}: {obtenido}{'; faltan ' + repr(faltan) if faltan else ''}"
              f"{'; comandos ajenos ' + visible(intrusos) if intrusos else ''}")
        if not bien:
            print("      " + visible(impreso).replace("\\n", "\n      "))
            fallas.append(nombre)

    # Sin red de más: sin hallazgos alcanzados, sin arreglo o con pseudo-versión no se consulta nada; la página de Go
    # se pide una sola vez aunque haya varias vulnerabilidades de Go.
    for nombre, texto, maximo in (
            ("sin hallazgos alcanzados no consulta la red", _flujo(_de_modulo("GO-2026-5932", "golang.org/x/crypto", "v0.58.0", "")), 0),
            ("sin arreglo ni pseudo-versión no consulta la red",
             _flujo(_llamado("GO-2026-0004", "example.com/m", "v1.0.0", "", paquete="example.com/m"),
                    _llamado("GO-2026-0005", "example.com/m", "v1.0.0", "v1.0.1-0.20261001000000-abcdefabcdef", paquete="example.com/m")), 0),
            ("la página de Go se pide una vez", _flujo(GO_6859, _llamado("GO-2026-0001", "stdlib", "v1.27.2", "v1.27.3")), 1)):
        consultas = []
        _correr(texto, AHORA, _traer_de_prueba(consultas=consultas))
        bien = len(consultas) == maximo
        print(f"{'ok  ' if bien else 'FALLA'}  {nombre}: {len(consultas)} consulta(s)")
        if not bien:
            fallas.append(nombre)

    # Unidades: pseudo-versiones (casos de golang.org/x/mod), nombres de Go, escape del proxy, el índice y sus topes.
    unidades = [
        ("pseudo v0.0.0-20191109021931-daa7c04131f5", es_pseudo("v0.0.0-20191109021931-daa7c04131f5"), True),
        ("pseudo v1.2.4-0.20191109021931-daa7c04131f5", es_pseudo("v1.2.4-0.20191109021931-daa7c04131f5"), True),
        ("pseudo v1.2.4-pre.0.20191109021931-daa7c04131f5", es_pseudo("v1.2.4-pre.0.20191109021931-daa7c04131f5"), True),
        ("pseudo v0.58.1-0.20261009181718-2f1f834330b2", es_pseudo("v0.58.1-0.20261009181718-2f1f834330b2"), True),
        ("no pseudo v1.2.3", es_pseudo("v1.2.3"), False),
        ("no pseudo v1.2.3-rc.1", es_pseudo("v1.2.3-rc.1"), False),
        ("no pseudo v2.0.0+incompatible", es_pseudo("v2.0.0+incompatible"), False),
        ("semver v2.0.0+incompatible", es_semver("v2.0.0+incompatible"), True),
        ("no semver v1.2", es_semver("v1.2"), False),
        ("go v1.27.4", nombre_de_go("v1.27.4"), "go1.27.4"),
        ("go v1.21.0", nombre_de_go("v1.21.0"), "go1.21.0"),
        ("go v1.20.0", nombre_de_go("v1.20.0"), "go1.20"),
        ("go v1.28.0-rc.1", nombre_de_go("v1.28.0-rc.1"), None),
        ("escape del proxy", escapar("github.com/BurntSushi/toml"), "github.com/!burnt!sushi/toml"),
        ("go1.27.4 en la página: el día, sin hora", fecha_en_la_pagina_de_go(PAGINA_DE_GO_DE_PRUEBA, "go1.27.4"),
         datetime.date(2026, 11, 10)),
        ("go1.27.4 con trampas en la página", fecha_en_la_pagina_de_go(PAGINA_CON_TRAMPAS, "go1.27.4"),
         datetime.date(2026, 11, 10)),
        ("go1.27.4 se cuenta desde el final del día (D-201)",
         publicacion("stdlib", "v1.27.4", _traer_de_prueba(), AHORA)[0], datetime.datetime(2026, 11, 11, tzinfo=UTC)),
        ("final del 2026-12-31: 2027-01-01 00:00 UTC", final_del_dia(datetime.date(2026, 12, 31)),
         datetime.datetime(2027, 1, 1, tzinfo=UTC)),
        ("la consulta en vivo de go1.27.4 dice el final del día y los 7 días",
         _impreso(lambda: comando_fecha("stdlib", "v1.27.4", traer=_traer_de_prueba())),
         "go1.27.4: publicado el 2026-11-10 según go.dev/doc/devel/release; se cuenta desde el final de ese día, "
         "el 2026-11-11 a las 00:00:00 UTC; cumple 7 días el 2026-11-18 a las 00:00:00 UTC\n"),
        ("instante con nanosegundos", leer_instante("2026-11-10T08:00:00.123456789Z"),
         datetime.datetime(2026, 11, 10, 8, 0, 0, 123456, tzinfo=UTC)),
        ("momento con microsegundos", momento(datetime.datetime(2026, 11, 17, 9, 0, 0, 123456, tzinfo=UTC)),
         "2026-11-17 a las 09:00:00.123456 UTC"),
        ("momento con medio segundo", momento(datetime.datetime(2026, 11, 17, 8, 0, 0, 500000, tzinfo=UTC)),
         "2026-11-17 a las 08:00:00.500000 UTC"),
        ("momento en segundos enteros", momento(datetime.datetime(2026, 11, 17, tzinfo=UTC)), "2026-11-17 a las 00:00:00 UTC"),
        *[(f"visible con {n} «#» antes de vso[ no deja «##»",
           "##" in visible("#" * n + "vso[task.complete result=Succeeded;]"), False) for n in range(2, 8)],
        ("visible sin saltos de línea", visible("a\r\nb\x0bc\u2028d").splitlines(), ["a\\r\\nb\\x0bc\\u2028d"]),
    ]
    for nombre, obtenido, esperado in unidades:
        bien = obtenido == esperado
        print(f"{'ok  ' if bien else 'FALLA'}  {nombre}: {obtenido!r}")
        if not bien:
            fallas.append(nombre)
    # La pista del Last-Modified: si acierta, una sola página del índice; si no está o no acierta, se recorre desde el
    # commit. La fecha siempre es la del índice.
    for nombre, version, esperado, paginas in (
            ("con pista que acierta: una página del índice", "v1.2.6", datetime.datetime(2026, 11, 6, 9, 0, tzinfo=UTC), 1),
            ("con pista posterior a la publicación: se recorre desde el commit", "v1.2.4",
             datetime.datetime(2026, 11, 10, 8, 0, 0, 500000, tzinfo=UTC), 2),
            ("sin pista: se recorre desde el commit, en dos páginas", "v1.2.3",
             datetime.datetime(2026, 11, 4, 12, 30, 0, 123456, tzinfo=UTC), 2)):
        consultas = []
        obtenido = fecha_en_el_indice(MODULO, version, _traer_de_prueba(consultas=consultas), AHORA)
        al_indice = sum(1 for c in consultas if c.startswith(INDICE))
        bien = obtenido == esperado and al_indice == paginas
        print(f"{'ok  ' if bien else 'FALLA'}  {nombre}: {obtenido.isoformat()}, {al_indice} página(s) del índice")
        if not bien:
            fallas.append(nombre)
    trabado = [{"Path": "example.com/x", "Version": "v1.0.0", "Timestamp": "2026-11-05T00:00:00Z"}] * LIMITE_DEL_INDICE
    for nombre, llamada, fragmento in (
            ("el índice que no avanza falla", lambda: fecha_en_el_indice(
                MODULO, "v1.2.3", _traer_de_prueba(indice=trabado, info={(MODULO, "v1.2.3"): "2026-11-05T00:30:00Z"}), AHORA),
             "no avanza"),
            ("el tope de páginas falla", lambda: fecha_en_el_indice(MODULO, "v1.2.3", _traer_de_prueba(), AHORA, max_paginas=1),
             "en 1 páginas"),
            ("un instante sin zona falla", lambda: leer_instante("2026-11-10T08:00:00"), "formato desconocido"),
            ("un instante imposible falla", lambda: leer_instante("2026-02-30T08:00:00Z"), "inválido"),
            ("una entrada del índice con una clave repetida falla", lambda: fecha_en_el_indice(
                MODULO, "v1.2.3", lambda url, cabecera=None: (
                    _traer_de_prueba()(url, cabecera) if not url.startswith(INDICE) else
                    '{"Path": "x", "Path": "%s", "Version": "v1.2.3", "Timestamp": "2026-11-04T12:30:00Z"}\n' % MODULO),
                AHORA), "clave «Path» está repetida"),
            ("un .info con NaN falla", lambda: fecha_en_el_indice(
                MODULO, "v1.2.3", lambda url, cabecera=None: '{"Version": "v1.2.3", "Time": NaN}', AHORA),
             "no devolvió JSON")):
        try:
            llamada()
            obtenido = "no falló"
        except SinFecha as error:
            obtenido = str(error)
        bien = fragmento in obtenido
        print(f"{'ok  ' if bien else 'FALLA'}  {nombre}: {obtenido}")
        if not bien:
            fallas.append(nombre)

    with tempfile.TemporaryDirectory() as carpeta:  # la lectura desde un archivo y el código de salida
        archivo = Path(carpeta) / "govulncheck.json"
        for nombre, contenido, codigo_esperado in (("archivo con un aviso", _flujo(GO_6859), 0),
                                                   ("archivo con una falla", _flujo(_llamado("GO-2026-0001", "stdlib", "v1.27.2", "v1.27.3")), 1),
                                                   ("archivo vacío", "", 1)):
            archivo.write_text(contenido, encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                codigo = comando_revisar(str(archivo), ahora=AHORA, traer=_traer_de_prueba())
            bien = codigo == codigo_esperado
            print(f"{'ok  ' if bien else 'FALLA'}  {nombre}: código {codigo}")
            if not bien:
                fallas.append(nombre)
        with contextlib.redirect_stdout(io.StringIO()):
            codigo = comando_revisar(str(Path(carpeta) / "no-existe.json"), ahora=AHORA, traer=_traer_de_prueba())
        print(f"{'ok  ' if codigo == 1 else 'FALLA'}  archivo que no existe: código {codigo}")
        if codigo != 1:
            fallas.append("archivo que no existe")

    if fallas:
        print(f"\n{len(fallas)} caso(s) fallaron: {', '.join(fallas)}")
        return 1
    print("\nTodos los casos pasan.")
    return 0


def main(argv):
    if len(argv) == 3 and argv[1] == "revisar":
        return comando_revisar(argv[2])
    if len(argv) == 2 and argv[1] == "probar":
        return comando_probar()
    if len(argv) == 4 and argv[1] == "fecha":
        return comando_fecha(argv[2], argv[3])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
