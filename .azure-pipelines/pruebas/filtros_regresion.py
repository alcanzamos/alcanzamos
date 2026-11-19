"""Pruebas de regresión de `revisar_modulos_go` (pruebas/filtros.py), a partir de lo que halló un verificador independiente.

Cada módulo de Go aparte (hoy web/servidor) debe correr de verdad, en su carpeta, `gofmt -l` con una prueba que falla,
`go vet ./...`, `golangci-lint run` y `go test -race ./...`, y el filtro de la etapa api debe cubrir todo su código, no
solo su go.mod. Los casos parten de una plantilla pequeña y cambian solo lo ejecutable (el comando, el `condition`, el
`workingDirectory`) sin tocar los nombres ni los comentarios: así se prueba que la revisión lee lo que el agente
ejecuta y no el texto suelto. Sin red ni dependencias. `pruebas/filtros.py` corre estas pruebas; también solas:

    python3 -I -B .azure-pipelines/pruebas/filtros_regresion.py
"""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("filtros", pathlib.Path(__file__).resolve().with_name("filtros.py"))
filtros = importlib.util.module_from_spec(spec)
spec.loader.exec_module(filtros)

MODULOS = ["api", "web/servidor"]
FILTROS = ["web/*"]

# Misma forma que plantillas/api.yml: los pasos de api y los cuatro de web/servidor.
PLANTILLA = """jobs:
  - job: api
    steps:
      - script: test -z "$(gofmt -l .)"
        workingDirectory: api
        displayName: formato

      - script: go test -race ./...
        workingDirectory: api
        displayName: pruebas

      # web/servidor es un módulo aparte.
      - script: test -z "$(gofmt -l .)"
        workingDirectory: web/servidor
        displayName: web/servidor, formato

      - script: go vet ./...
        workingDirectory: web/servidor
        displayName: web/servidor, go vet

      - script: |
          set -eu
          golangci_lint="$(go -C ../../api tool -n golangci-lint)"
          "$golangci_lint" run
        workingDirectory: web/servidor
        displayName: web/servidor, lint

      - script: go test -race ./...
        workingDirectory: web/servidor
        displayName: web/servidor, pruebas
"""

FORMATO = '      - script: test -z "$(gofmt -l .)"\n        workingDirectory: web/servidor\n'
VET = "      - script: go vet ./...\n        workingDirectory: web/servidor\n"
LINT = '          "$golangci_lint" run\n'
CARRERAS = "      - script: go test -race ./...\n        workingDirectory: web/servidor\n"
PRUEBAS = "workingDirectory: web/servidor\n        displayName: web/servidor, pruebas"


def cambiar(texto, viejo, nuevo):
    assert texto.count(viejo) == 1, viejo
    return texto.replace(viejo, nuevo)


class ModulosGo(unittest.TestCase):
    def revisar(self, plantilla=PLANTILLA, filtros_api=FILTROS):
        return filtros.revisar_modulos_go(plantilla, MODULOS, filtros_api)

    def rechaza(self, plantilla=PLANTILLA, filtros_api=FILTROS, menciona=None):
        fallas = self.revisar(plantilla, filtros_api)
        self.assertTrue(fallas, "la revisión debía rechazar el cambio")
        self.assertTrue(all("web/servidor" in f for f in fallas), fallas)
        if menciona:
            self.assertIn(menciona, "\n".join(fallas))

    def test_la_plantilla_completa_pasa(self):
        for filtro in (["web/*"], ["web/servidor/*"], ["api/*", "web/*"]):
            with self.subTest(filtro=filtro):
                self.assertEqual(self.revisar(filtros_api=filtro), [])

    def test_el_modulo_api_no_se_revisa_como_aparte(self):
        self.assertEqual(filtros.revisar_modulos_go("jobs: []\n", ["api", ""], []), [])

    # Los tres cambios del verificador (a): solo cambia lo ejecutable.
    def test_lint_reemplazado_por_un_echo(self):
        self.rechaza(cambiar(PLANTILLA, LINT, "          echo omitido\n"), menciona="golangci-lint")

    def test_go_vet_comentado_en_el_script(self):
        self.rechaza(cambiar(PLANTILLA, VET, VET.replace("go vet ./...", "echo omitido # go vet ./...")), menciona="go vet")

    def test_pruebas_con_carreras_con_condition_false(self):
        self.rechaza(cambiar(PLANTILLA, PRUEBAS, PRUEBAS.replace("\n        displayName", "\n        condition: false\n        displayName")),
                     menciona="go test -race")

    # Otras formas de no ejecutar el paso.
    def test_formato_que_no_falla(self):
        for nuevo in ('      - script: test -z "$(gofmt -l .)" || true\n', '      - script: echo omitido # test -z "$(gofmt -l .)"\n',
                      '      - script: gofmt -l .\n', '      - script: echo test -z "$(gofmt -l .)"\n'):
            with self.subTest(nuevo=nuevo):
                self.rechaza(cambiar(PLANTILLA, FORMATO, FORMATO.replace(FORMATO.split("\n")[0] + "\n", nuevo)), menciona="gofmt")

    def test_condiciones_que_apagan_el_paso(self):
        for condicion in ("condition: false", "condition: eq(1, 2)", "enabled: false", "continueOnError: true"):
            for paso in (FORMATO, VET, CARRERAS):
                with self.subTest(condicion=condicion, paso=paso.splitlines()[0]):
                    self.rechaza(cambiar(PLANTILLA, paso, paso + f"        {condicion}\n"))

    def test_condiciones_que_no_apagan_el_paso(self):
        for condicion in ("condition: succeeded()", "condition: always()", "continueOnError: false"):
            with self.subTest(condicion=condicion):
                self.assertEqual(self.revisar(cambiar(PLANTILLA, VET, VET + f"        {condicion}\n")), [])

    def test_job_con_condition(self):
        fallas = self.revisar(cambiar(PLANTILLA, "  - job: api\n", "  - job: api\n    condition: false\n"))
        self.assertEqual(len(fallas), 1)
        self.assertIn("condition", fallas[0])

    def test_paso_en_otra_carpeta(self):
        for paso in (VET, CARRERAS):
            with self.subTest(paso=paso.splitlines()[0]):
                self.rechaza(cambiar(PLANTILLA, paso, paso.replace("web/servidor", "api")), menciona="web/servidor")

    def test_paso_comentado_o_ausente(self):
        comentado = "      # - script: go vet ./...\n      #   workingDirectory: web/servidor\n"
        self.rechaza(cambiar(PLANTILLA, VET, comentado), menciona="go vet")

    def test_el_comando_no_es_la_ultima_orden_o_sale_antes(self):
        self.rechaza(cambiar(PLANTILLA, LINT, LINT + "          true\n"), menciona="golangci-lint")
        self.rechaza(cambiar(PLANTILLA, '          set -eu\n', '          set -eu\n          exit 0\n'), menciona="golangci-lint")

    def test_salida_exitosa_antes_del_lint(self):
        for orden in ("true && exit 0", "command exit 0"):
            with self.subTest(orden=orden):
                self.rechaza(cambiar(PLANTILLA, "          set -eu\n", "          set -eu\n          " + orden + "\n"), menciona="golangci-lint")

    def test_variable_del_lint_sobrescrita(self):
        self.rechaza(cambiar(PLANTILLA, LINT, "          golangci_lint=true\n" + LINT), menciona="golangci-lint")

    def test_lint_con_go_tool_en_el_propio_modulo(self):
        lint = PLANTILLA[PLANTILLA.index("      - script: |"):PLANTILLA.index("        displayName: web/servidor, lint")]
        propio = "      - script: go tool golangci-lint run\n        workingDirectory: web/servidor\n"
        self.assertEqual(self.revisar(PLANTILLA.replace(lint, propio)), [])

    # El caso del verificador (b): el filtro cubre el go.mod y no el código.
    def test_filtro_solo_con_el_go_mod(self):
        self.rechaza(filtros_api=["web/servidor/go.mod"], menciona="main.go")

    def test_filtro_parcial_o_de_otra_carpeta(self):
        for filtro in (["web/servidor/internal/*"], ["web/servidor/go.mod", "web/servidor/main.go"], ["api/*"], []):
            with self.subTest(filtro=filtro):
                self.rechaza(filtros_api=filtro)


class ImagenesT13(unittest.TestCase):
    """`revisar_imagenes`: la imagen se construye de verdad, desde la raíz y sin publicar (T13, E11-INF 2.16)."""
    PLANTILLA = """jobs:
  - job: web
    steps:
      - script: docker build --file web/Dockerfile --tag prueba .
"""

    def revisar(self, texto):
        with patch.object(filtros, "dockerfiles", return_value=["web/Dockerfile"]):
            return filtros.revisar_imagenes({"web": texto})

    def rechaza(self, texto):
        fallas = self.revisar(texto)
        self.assertEqual(len(fallas), 1, fallas)
        self.assertIn("web/Dockerfile", fallas[0])

    def test_build_desde_raiz_pasa(self):
        self.assertEqual(self.revisar(self.PLANTILLA), [])
        self.assertEqual(self.revisar(self.PLANTILLA + "        workingDirectory: .\n"), [])

    def test_job_apagado_se_rechaza(self):
        for extra in ("condition: false", "enabled: false", "condition: eq(1, 2)"):
            with self.subTest(extra=extra):
                self.rechaza(self.PLANTILLA.replace("  - job: web\n", f"  - job: web\n    {extra}\n"))

    def test_job_con_condicion_que_corre_pasa(self):
        self.assertEqual(self.revisar(self.PLANTILLA.replace("  - job: web\n", "  - job: web\n    displayName: imagen\n")), [])

    def test_build_en_otra_carpeta_se_rechaza(self):
        self.rechaza(self.PLANTILLA + "        workingDirectory: web\n")
        self.rechaza(self.PLANTILLA.replace("      - script: docker build", "      - script: cd web && docker build"))
        self.rechaza(self.PLANTILLA.replace("      - script: docker build", "      - script: |\n          cd web\n          docker build"))

    def test_push_en_cualquier_forma_se_rechaza(self):
        for bandera in ("--push", "--push=true", "--push=false", "--output type=registry", "--output=type=registry", "-o type=registry",
                        "--cache-to type=registry,ref=ghcr.io/x/y"):
            with self.subTest(bandera=bandera):
                self.rechaza(self.PLANTILLA.replace("docker build ", f"docker build {bandera} "))

    def test_docker_push_antes_se_rechaza(self):
        self.rechaza(self.PLANTILLA.replace("      - script: docker build", "      - script: |\n          docker push ghcr.io/x/y\n          docker build"))


if __name__ == "__main__":
    unittest.main()
