"""Pruebas de `pruebas/citas.py`: cada forma de cita a una nota interna o a un id de tarea se rechaza, los usos legítimos de una
letra con un número pasan, y el árbol actual está limpio. Sin red ni dependencias. `pruebas/filtros.py` corre estas pruebas;
también solas:

    python3 -I -B .azure-pipelines/pruebas/citas_regresion.py
"""
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("citas", pathlib.Path(__file__).resolve().with_name("citas.py"))
citas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(citas)

# Formas que salieron del repositorio (la lista de citas del #147 y la tabla del #146), con su prefijo del nombre de la forma.
S_SUELTA = "spec S: «S<n>» suelta"
PROHIBIDAS = {
    "nota L: «L<n> de la US": [
        "Es el mismo cálculo que L3 de la US-77.",
        "se guarda (L6 (5) de la US-77): ver abajo",
        "// L14 (cambio 2) de la US-77: lo asignado",
        "(L14 (1) de la US-77)",
        "la limpieza (L8 de la tarea del agente propio)",
        "L12 (2) de la US-77",
    ],
    "nota L: «L<n>» suelta": [
        "reglas aprobadas (L10).",
        "(D-164, L10)",
        "al terminar (D-213, L8):",
        "(D3 (L3, L5): el e2e corre dentro de la imagen",
        "# Imagen de Playwright (D3, L3):",
        "// Ítem 294, L14 (4): el aviso es una tarea aparte.",
        "(ítem 294, L10: el servicio de las tareas)",
        "// L3: un regalo de diciembre",
        "// L24 (a): en Azure ni el API",
        "// B1 (L6): «Reenviar el correo»",
        "(L2 y L6 del dueño, sesión 4 del celular)",
        "// L5 (el dueño): el límite de 3 correos",
        "// L8.2 (bug 303): `BotonDeTexto`",
        "mirar con calma» (L3, punto 1).",
        "(opción A, L6)",
        "// Ya era así antes de L17: sin hoja",
    ],
    # Toda S1 a S99 suelta, con las formas que salieron del repositorio y las que el dueño pidió rechazar (L22).
    S_SUELTA: [
        "- **Claves de textos (S2).** `tests/textos/claves.test.ts`",
        "mismo token, sin volver a iniciar sesión (S2).",
        "Por pedido del dueño (S2), tampoco el chip «Tarjeta»",
        "(D-203, S4). El aviso se manda",
        "(US-59, S6)",
        "# (US-44, S3): `tofu test` planea con proveedores simulados.",
        "## Conversión para la web (US-57, S1)",
        "// Bug 233 (USA-008, S2): las pantallas web",
        "(bug 303, S1.1)",
        "(bug 304, 67.6 y 67.7, S1.3)",
        "(S1, Ley 1581)",
        "(S2 de la US-67); hasta entonces",
        "(S2; lo prueba `e2e/autorizacion.spec.ts`",
        "(S3: marcadores {nombre})",
        "// S4 (D-164): el arriendo del 15 de agosto",
        "// S5: {fecha} es el momento real del borrado",
        "// S1/S2: exercise the production task compositor",
        "// S7 (1) y S3: sin aviso, la cuenta no se borra",
        "// S3 en un despliegue: una cuenta del caso 2",
        "    # S2 (dueño, 2026-10-24): una persona nueva",
        "// S5). Devuelve cuántas quedaron avisadas.",
        "// S1/S2/S5: a slow purge cannot shorten the 48 hours",
        "«S2: una persona nueva que entra, autoriza en PN-64»",
        "it('S2: una persona nueva que entra', async () => {",
        "test(\"S2: una persona nueva\", async () => {",
        "los criterios S1/S2 del plan",
        "cubre S3 y S4 (D-160) en Android",
        "// D-192 (c) y S7: un enlace vencido",
        "E17-ECO 4.5 y S4 sobre las hojas CSS",
        "la regla de S4 de la US-51",
        "protege S11 de D-161: `comun` usa",
        "hereda S2 de la US-67",
        "cubre S1–S7 del plan", "(S1–S7)", "S1-S7", "la prueba S2–S13", "(S1-S13)",
        ", S3)", "// D-203, S3).", "texto, S5) y más", "(D-203, S3)", "(S1.1)",
        "- **Prueba de S2** (dueño, 2026-10-24)",
        "Estos casos protegen S11: si alguien le agrega `paths`",
        "Jest nombra las pruebas que fallan, US-59 S6, también con --silent",
        "test(\"USA-003 S2: una persona nueva\")",
        # El pedido del dueño (L22): sin mirar el contexto, tampoco el de un plan ni el de un producto.
        "// Regla del plan: S4 de la US-51",
        "El plan (S2) de la US-51 dice otra cosa",
        "SKU S1", "// SKU (S1)", "nivel S1 de Azure", "Los planes S1/S2 están disponibles.", "Standard S1", "tiers S1 y S2",
        "S99", "(S10)", "const nivel = \"S1: básico\"",
    ],
    "spec S en un identificador": [
        "func TestS13Algo(t *testing.T) {",
        "func TestS2LaPersonaNuevaAutorizaYVeSuPrimerIngreso(t *testing.T) {",
        "func TestS4ElArriendoDelQuinceDeAgosto(t *testing.T) {",
        "type fuenteS13 func(context.Context) (string, error)",
        "\t\t\treturn fuenteS13(func(context.Context) (string, error) {",
        "// del API, TestS2LaPersonaNueva, prueba el lado del servidor",
    ],
    "id de tarea: «(T<n>, web)": [
        "Propuesto en la US-77 (T3, web) y aprobado por el dueño",
        "Propuesto en la US-77 (T4, Android) y aprobado por el dueño",
        "el equivalente de la web (T3, web)",
    ],
    "id de tarea: «(T<n>)» desde la T12": ["http.Error (T20).", "// El servidor manda HSTS (T20)"],
    "id de tarea: «la T<n>»": ["va a E14-PRR 4.1 en la T4 de la US-71: el nombre accesible", "el único texto nuevo de la T4,", "Android los usa desde la T4"],
    "id de tarea: «T<n> de la US": ["lo comprueba el dueño en el celular (T2 de la US-71).", "la tarea T5 de la US-67 en el repositorio"],
    "plan de trabajo: «infra-d205»": ["# Imagen de ca-web (infra-d205 T13, E11-INF 2.16): el servidor", "(infra-d205 T20)."],
}

# Usos que no son citas y deben pasar. Una S suelta de S1 a S99 nunca pasa aquí: solo por una excepción (ExcepcionesDeS).
LEGITIMAS = [
    "SKU S0", "(SKU S0)", "// S0: básico", "S0", "(S0)", "sku: S256", "sha256: S256 y S512", "S256", "const nivel = \"S0: básico\"",
    "min_version = TLS12", "tls.VersionTLS12", "TLS1.2", "var rutasDeUS60 = map[string]bool{}", "func TestIntegracionConUS60(t *testing.T) {", "US60",
    "Standard_S2", "sku_name = \"Standard_S2\"", "Standard_S2 y Standard_S3", "TestSEG002ElAporteLlegaCompartido", "RS256 y ES256", "IS2 es otra cosa",
    "type fuenteDeTokensFalsa func(context.Context) (string, error)", "Tests S 12 S", "S3bucket", "mS1", "S1a", "S_1", "S100",
    "M12 3 L12 12", 'd="M12 3 L12 12 L20.5 15"', '<path d="M0 0L12 12"/>', "d='M12,3 L12,12 L20.5,15'", "L12,12",
    "// E14-PCP 4.16 (T6, T11), palabra por palabra.", "Textos de avisos de E14-PCP 4.1, 4.2 y 4.16 (T6, T11)", "describe(\"MensajeDeEstado (E14-PCP 4.16 T11)\")",
    "429 dice T1", "errores de campo, 429 (T1), sin conexión (T10) y 5xx (T7)", "PN-59 sin la dirección (T3 y T4)", "los textos (T1 a T11)", "la otra entrada provisional de T2 ter",
    "{nombre: \"T1 dec\", f: rDec(e)}", "Hoy es el 26 de octubre de 2026 (D-164 (3))", "E14-PPA v1.9, 4.1; E14-SDD v2.5, 5.12", "D-203 (17) y (18)", "bug 303, E14-SDD v2.6, 5.2",
    "versión 2.5, sección 5.12", "T12Z y 2026-11-24T12:00:00Z", "const x = `${hoy}T12:00:00Z`;",
    "Intl.NumberFormat('es-CO') y L'Oréal", "CU-10 2a y 3", "la T",
]


class FormasProhibidas(unittest.TestCase):
    def test_rechaza_todo_el_rango_suelto(self):
        for numero in range(1, 100):
            with self.subTest(numero=numero):
                self.assertEqual(
                    len(citas.revisar_texto("web/x.md", f"(S{numero})")), 1
                )

    def test_cada_forma_prohibida_se_rechaza_con_su_nombre(self):
        for prefijo, textos in PROHIBIDAS.items():
            for texto in textos:
                with self.subTest(texto=texto):
                    fallas = citas.revisar_texto("a.go", texto)
                    self.assertEqual(len(fallas), 1, f"no rechazó (o rechazó dos veces): {texto!r}")
                    self.assertTrue(fallas[0].startswith("a.go:1: "), fallas[0])
                    self.assertIn(prefijo, fallas[0], f"la forma que lo rechazó no es la esperada: {fallas[0]}")

    def test_cada_forma_tiene_una_prueba(self):
        usadas = {nombre for nombre, _ in citas.FORMAS if any(nombre.startswith(p) for p in PROHIBIDAS)}
        self.assertEqual(usadas, {nombre for nombre, _ in citas.FORMAS}, "hay formas sin ningún caso prohibido")

    def test_se_dice_la_linea(self):
        fallas = citas.revisar_texto("web/README.md", "una línea limpia\notra limpia\nPropuesto en la US-77 (T3, web) y aprobado\nuna más\n// L3: algo\n")
        self.assertEqual([f.split(": ")[0] for f in fallas], ["web/README.md:3", "web/README.md:5"])


class NombresDeArchivo(unittest.TestCase):
    def test_un_nombre_que_empieza_con_su_spec_se_rechaza(self):
        for ruta in ["api/test/bd/s13_verificador_test.go", "s2_algo.go", "web/e2e/s4_arriendo.spec.ts"]:
            with self.subTest(ruta=ruta):
                falla = citas.revisar_nombre(ruta)
                self.assertIsNotNone(falla)
                self.assertTrue(falla.startswith(f"{ruta}: spec S en el nombre del archivo"), falla)

    def test_los_nombres_normales_pasan(self):
        for ruta in ["api/test/bd/identidad_verificador_test.go", "api/test/registro/seg006_integracion_test.go", "web/src/s.ts",
                     "api/test/s3/fuente.go", "movil/src/sesion_nueva.ts", "web/src/sku_s1.ts", "api/test/cuenta/es2_no.go"]:
            with self.subTest(ruta=ruta):
                self.assertIsNone(citas.revisar_nombre(ruta))


class UsosLegitimos(unittest.TestCase):
    def test_una_letra_con_un_numero_que_no_es_una_cita_pasa(self):
        for texto in LEGITIMAS:
            with self.subTest(texto=texto):
                self.assertEqual(citas.revisar_texto("a.go", texto), [])

    def test_una_nota_L_partida_en_dos_lineas_se_rechaza_por_su_L(self):
        fallas = citas.revisar_texto("a.go", "// (L3 de\n// la US-77)")
        self.assertEqual([f.split(": ")[0] for f in fallas], ["a.go:1"])


class ExcepcionesDeS(unittest.TestCase):
    """Un uso legítimo de una `S<n>` suelta va en EXCEPCIONES (ruta, texto exacto de la línea, razón); una excepción que ya no se usa
    hace fallar la revisión."""
    LINEA = "El SKU S1 de la base de datos es de pago."
    EXCEPCION = ("web/nota.md", LINEA, "S1 es el nivel de un producto, no una spec")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.raiz = pathlib.Path(self.tmp.name)

    def escribir(self, ruta, texto):
        destino = self.raiz / ruta
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(texto, encoding="utf-8")

    def test_sku_s1_falla_sin_excepcion_y_pasa_con_ella(self):
        self.assertEqual(len(citas.revisar_texto("web/nota.md", self.LINEA, ())), 1)
        usadas = set()
        self.assertEqual(citas.revisar_texto("web/nota.md", self.LINEA + "\n", (self.EXCEPCION,), usadas), [])
        self.assertEqual(usadas, {("web/nota.md", self.LINEA)})

    def test_la_excepcion_vale_solo_para_su_ruta_y_su_texto_exacto(self):
        for ruta, texto in [("api/nota.md", self.LINEA), ("web/nota.md", self.LINEA + " Más."), ("web/nota.md", "El sku S1 de la base de datos es de pago.")]:
            with self.subTest(ruta=ruta, texto=texto):
                self.assertEqual(len(citas.revisar_texto(ruta, texto, (self.EXCEPCION,))), 1)

    def test_la_excepcion_no_tapa_otras_formas_de_la_misma_linea(self):
        linea = "El SKU S1 de la base de datos es de pago (L3)."
        fallas = citas.revisar_texto("web/nota.md", linea, (("web/nota.md", linea, "razón"),))
        self.assertEqual(len(fallas), 1)
        self.assertIn("nota L", fallas[0])

    def test_una_excepcion_que_se_usa_deja_pasar_la_revision(self):
        self.escribir("web/nota.md", f"uno\n  {self.LINEA}  \ndos\n")
        self.assertEqual(citas.revisar(self.raiz, ["web/nota.md"], (self.EXCEPCION,)), [])

    def test_una_excepcion_sin_uso_hace_fallar_la_revision(self):
        self.escribir("web/nota.md", "una línea limpia\n")
        fallas = citas.revisar(self.raiz, ["web/nota.md"], (self.EXCEPCION,))
        self.assertEqual(len(fallas), 1)
        self.assertIn("excepción sin uso", fallas[0])
        self.assertIn(self.LINEA, fallas[0])

    def test_una_excepcion_cuya_linea_ya_no_cumple_la_regla_esta_sin_uso(self):
        # La línea sigue en el archivo, pero ya no trae una S de S1 a S99: la excepción sobra.
        self.escribir("web/nota.md", "El SKU S0 de la base de datos es de pago.\n")
        fallas = citas.revisar(self.raiz, ["web/nota.md"], (("web/nota.md", "El SKU S0 de la base de datos es de pago.", "razón"),))
        self.assertEqual(len(fallas), 1)
        self.assertIn("excepción sin uso", fallas[0])

    def test_la_lista_del_arbol_esta_vacia(self):
        self.assertEqual(citas.EXCEPCIONES, ())


class QueArchivosSeRevisan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.raiz = pathlib.Path(self.tmp.name)

    def escribir(self, ruta, contenido, binario=False):
        destino = self.raiz / ruta
        destino.parent.mkdir(parents=True, exist_ok=True)
        if binario:
            destino.write_bytes(contenido)
        else:
            destino.write_text(contenido, encoding="utf-8")

    def test_revisa_cada_carpeta_y_dice_ruta_y_linea(self):
        for carpeta in citas.CARPETAS:
            self.escribir(f"{carpeta}/x/nota.txt", "uno\ndos (L3)\n")
        fallas = citas.revisar(self.raiz, [f"{c}/x/nota.txt" for c in citas.CARPETAS])
        self.assertEqual(len(fallas), len(citas.CARPETAS))
        for carpeta, falla in zip(sorted(citas.CARPETAS), fallas):
            self.assertTrue(falla.startswith(f"{carpeta}/x/nota.txt:2: "), falla)

    def test_no_revisa_lo_que_no_es_texto_de_codigo_ni_las_otras_carpetas(self):
        self.escribir("web/package-lock.json", "(L3)\n")
        self.escribir("api/go.sum", "(L3)\n")
        self.escribir("web/icono.svg", '<path d="M12 3 L12 12"/> (L3)\n')
        self.escribir("web/fuente.ttf", b"\xff\xfe(L3)\n", binario=True)
        self.escribir("movil/assets/foto.bin", b"\x00\x01\xff\xfe(L3)\n", binario=True)
        self.escribir("odd/tasks/plan.md", "(L3 de la US-77)\n")
        self.escribir("infra/azure/README.md", "(L3 de la US-77)\n")
        self.escribir(".azure-pipelines/pruebas/citas.py", "# (L3 de la US-77)\n")
        self.escribir(".azure-pipelines/pruebas/citas_regresion.py", "# (L3 de la US-77)\n")
        archivos = ["web/package-lock.json", "api/go.sum", "web/icono.svg", "web/fuente.ttf", "movil/assets/foto.bin",
                    "odd/tasks/plan.md", "infra/azure/README.md", ".azure-pipelines/pruebas/citas.py",
                    ".azure-pipelines/pruebas/citas_regresion.py"]
        self.assertEqual(citas.revisar(self.raiz, archivos), [])

    def test_rechaza_un_archivo_cuyo_nombre_lleva_su_spec(self):
        self.escribir("api/test/bd/s13_verificador_test.go", "package bd_test\n")
        self.assertEqual(citas.revisar(self.raiz, ["api/test/bd/s13_verificador_test.go"]),
                         ["api/test/bd/s13_verificador_test.go: spec S en el nombre del archivo: «s13_verificador_test.go»"])

    def test_un_archivo_que_ya_no_existe_se_salta(self):
        self.assertEqual(citas.revisar(self.raiz, ["web/borrado.ts"]), [])


class ElArbolActual(unittest.TestCase):
    def test_los_archivos_de_git_no_traen_ninguna_cita(self):
        self.assertEqual(citas.revisar(citas.RAIZ), [])

    def test_los_archivos_propios_son_los_unicos_exceptuados_por_nombre(self):
        self.assertEqual(citas.PROPIOS, {".azure-pipelines/pruebas/citas.py", ".azure-pipelines/pruebas/citas_regresion.py"})
        for ruta in citas.PROPIOS:
            self.assertTrue((citas.RAIZ / ruta).is_file(), ruta)


if __name__ == "__main__":
    unittest.main()
