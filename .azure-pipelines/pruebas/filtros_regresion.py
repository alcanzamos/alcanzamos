"""Pruebas de regresión de `revisar_modulos_go`, `revisar_imagenes`, `revisar_playwright`, `revisar_agente` y `revisar_limpieza_docker` (pruebas/filtros.py),
a partir de lo que halló un verificador independiente.

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


class ImagenesDeCaWeb(unittest.TestCase):
    """`revisar_imagenes`: la imagen se construye de verdad, desde la raíz y sin publicar (E11-INF 2.16)."""
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


IMAGEN_PW = "mcr.microsoft.com/playwright:v1.64.1-noble@sha256:" + "ab" * 32
PAQUETE_PW = '{"devDependencies": {"@playwright/test": "1.64.1"}}'


class PlaywrightD3(unittest.TestCase):
    """`revisar_playwright`: el e2e corre en la imagen oficial, fijada por digest y con la versión de `@playwright/test` (D3)."""
    PLANTILLA = f"""jobs:
  - job: web
    variables:
      PLAYWRIGHT_IMAGEN: {IMAGEN_PW}
    steps:
      - script: npm run build
        workingDirectory: web
        displayName: build

      # npx playwright install --with-deps chromium, ya no: viene en la imagen.
      - script: |
          set -eu
          node_del_agente="$(Agent.TempDirectory)/node/node-v24.22.1-linux-x64"
          docker run --rm --init --ipc=host \\
            --volume "$(Build.SourcesDirectory):$(Build.SourcesDirectory)" \\
            --volume "$node_del_agente:/opt/node:ro" \\
            --workdir "$(Build.SourcesDirectory)/web" \\
            --env CI=true \\
            --env PATH=/opt/node/bin:/usr/bin:/bin \\
            "$(PLAYWRIGHT_IMAGEN)" npm run e2e
        displayName: e2e
"""

    def revisar(self, plantilla=None, paquete=PAQUETE_PW, nodo="24.22.1"):
        return filtros.revisar_playwright(self.PLANTILLA if plantilla is None else plantilla, paquete, nodo)

    def rechaza(self, plantilla=None, menciona="", **kwargs):
        fallas = self.revisar(plantilla, **kwargs)
        self.assertTrue(fallas, "la revisión debía rechazar el cambio")
        self.assertIn(menciona, "\n".join(fallas))

    def test_la_plantilla_completa_pasa(self):
        self.assertEqual(self.revisar(), [])

    def test_version_de_la_imagen_distinta_a_la_de_playwright(self):
        # Alguien sube @playwright/test y no cambia la imagen (o al revés): el control falla.
        self.rechaza(paquete='{"devDependencies": {"@playwright/test": "1.65.0"}}', menciona="deben ser la misma versión")
        self.rechaza(self.PLANTILLA.replace("playwright:v1.64.1-", "playwright:v1.63.0-"), menciona="deben ser la misma versión")
        self.rechaza(paquete='{"dependencies": {"@playwright/test": "1.65.0"}}', menciona="deben ser la misma versión")

    def test_version_de_playwright_con_rango_o_ausente(self):
        for version in ('"^1.64.1"', '"~1.64.1"', '"latest"'):
            with self.subTest(version=version):
                self.rechaza(paquete='{"devDependencies": {"@playwright/test": %s}}' % version, menciona="versión exacta")
        self.rechaza(paquete="{}", menciona="versión exacta")

    def test_imagen_sin_digest_o_repetida(self):
        sin = self.PLANTILLA.replace("@sha256:" + "ab" * 32, "")
        self.rechaza(sin, menciona="una sola imagen de Playwright fijada por digest")
        otra = self.PLANTILLA.replace("      - script: npm run build\n", f"      - script: echo mcr.microsoft.com/playwright:v1.64.1-jammy@sha256:{'cd' * 32}\n")
        self.rechaza(otra, menciona="una sola imagen de Playwright fijada por digest")

    def test_imagen_fuera_de_la_variable(self):
        inline = self.PLANTILLA.replace('"$(PLAYWRIGHT_IMAGEN)"', f'"{IMAGEN_PW}"')
        self.rechaza(inline, menciona="PLAYWRIGHT_IMAGEN")

    def test_instalar_el_navegador_otra_vez(self):
        self.rechaza(self.PLANTILLA.replace("      - script: npm run build\n", "      - script: npx playwright install --with-deps chromium\n"), menciona="playwright install")

    def test_e2e_fuera_del_contenedor(self):
        self.rechaza(self.PLANTILLA.replace("      - script: npm run build\n", "      - script: npm run e2e\n"), menciona="dentro del contenedor")

    def test_sin_el_paso_del_e2e(self):
        self.rechaza(self.PLANTILLA.replace("npm run e2e", "npm test"), menciona="un solo paso")

    def test_opciones_del_docker_run(self):
        for bandera in ("--rm", "--init", "--ipc=host"):
            with self.subTest(bandera=bandera):
                self.rechaza(self.PLANTILLA.replace(f" {bandera}", "", 1), menciona=bandera)

    def test_el_node_montado_no_es_el_de_node_yml(self):
        self.rechaza(nodo="24.23.0", menciona="deben ser el mismo")
        self.rechaza(self.PLANTILLA.replace("node-v24.22.1-linux-x64", "node-v24.20.0-linux-x64"), menciona="deben ser el mismo")

    def test_el_node_sin_solo_lectura_o_sin_path(self):
        self.rechaza(self.PLANTILLA.replace(":/opt/node:ro", ":/opt/node"), menciona=":ro")
        self.rechaza(self.PLANTILLA.replace("/opt/node/bin", "/opt/otro/bin"), menciona="/opt/node/bin")

    def test_paso_del_e2e_apagado(self):
        for extra in ("condition: false", "enabled: false", "continueOnError: true"):
            with self.subTest(extra=extra):
                self.rechaza(self.PLANTILLA.replace("        displayName: e2e\n", f"        {extra}\n        displayName: e2e\n"), menciona="apaguen")

    def test_nodo_de_pasos(self):
        texto = "parameters:\n  # versión\n  - name: nodeVersion\n    type: string\n    default: 24.22.1\n  - name: nodeSha256\n"
        self.assertEqual(filtros.nodo_de_pasos(texto), "24.22.1")
        self.assertIsNotNone(filtros.nodo_de_pasos(filtros.CARPETA.joinpath("plantillas/pasos/node.yml").read_text(encoding="utf-8")))


class AgenteD213(unittest.TestCase):
    """`revisar_agente`: el pool va una sola vez, arriba, y cada trabajo empieza con el espacio de trabajo limpio."""
    PIPELINE = "trigger: none\npool:\n  name: alcanzamos-local\njobs:\n  - template: plantillas/web.yml\n"
    PLANTILLA = "jobs:\n  - job: web\n    workspace:\n      clean: all\n    steps:\n      - script: echo\n"

    def revisar(self, pipeline=PIPELINE, plantilla=PLANTILLA):
        return filtros.revisar_agente({"web.yml": pipeline, "plantillas/web.yml": plantilla})

    def test_pasa(self):
        self.assertEqual(self.revisar(), [])
        # Volver al agente hospedado es cambiar esa línea: la revisión no exige un pool concreto.
        self.assertEqual(self.revisar(self.PIPELINE.replace("name: alcanzamos-local", "vmImage: ubuntu-24.04")), [])

    def test_trabajo_con_su_propio_pool(self):
        fallas = self.revisar(plantilla=self.PLANTILLA.replace("    workspace:", "    pool:\n      vmImage: ubuntu-24.04\n    workspace:"))
        self.assertEqual(len(fallas), 1)
        self.assertIn("fija su propio pool", fallas[0])

    def test_pipeline_sin_pool_de_primer_nivel(self):
        fallas = self.revisar(pipeline=self.PIPELINE.replace("pool:\n  name: alcanzamos-local\n", ""))
        self.assertEqual(len(fallas), 1)
        self.assertIn("pool:", fallas[0])

    def test_trabajo_sin_espacio_limpio(self):
        limpio = "    workspace:\n      clean: all\n"
        for nuevo in ("", "    workspace:\n      clean: outputs\n", "    workspace:\n      clean: true\n"):
            with self.subTest(nuevo=nuevo):
                fallas = self.revisar(plantilla=self.PLANTILLA.replace(limpio, nuevo))
                self.assertEqual(len(fallas), 1)
                self.assertIn("workspace: clean: all", fallas[0])

    def test_trabajos_en_un_pipeline_con_etapas(self):
        control = ("pool:\n  name: x\nstages:\n  - stage: a\n    jobs:\n      - job: uno\n        workspace:\n          clean: all\n"
                   "        steps:\n          - script: echo\n      - job: dos\n        steps:\n          - script: echo\n")
        fallas = filtros.revisar_agente({"control.yml": control})
        self.assertEqual(len(fallas), 1)
        self.assertIn("dos", fallas[0])


class LimpiezaDockerL8(unittest.TestCase):
    """`revisar_limpieza_docker`: al terminar se quita solo lo que crea la corrida; las imágenes fijadas por digest quedan."""

    WEB = """jobs:
  - job: web
    steps:
      - script: docker build --file web/Dockerfile --tag alcanzamos-web:$(Build.BuildId) .
      - script: |
          set -u
          imagen="alcanzamos-web:$(Build.BuildId)"
          if [ -n "$(docker image ls --quiet --filter "reference=$imagen")" ]; then
            docker rmi "$imagen"
          fi
        condition: always()
"""

    def revisar(self, web):
        return filtros.revisar_limpieza_docker({"plantillas/web.yml": web})

    def test_acepta_quitar_solo_lo_de_la_corrida(self):
        self.assertEqual(self.revisar(self.WEB), [])

    def test_rechaza_quitar_una_imagen_fijada(self):
        web = self.WEB.replace('            docker rmi "$imagen"\n',
                               '            docker rmi "$imagen"\n            docker rmi "$(PLAYWRIGHT_IMAGEN)"\n')
        fallas = self.revisar(web)
        self.assertEqual(len(fallas), 1)
        self.assertIn("fijada por digest", fallas[0])

    def test_rechaza_prune(self):
        fallas = self.revisar(self.WEB.replace("          set -u\n", "          set -u\n          docker image prune --force\n"))
        self.assertEqual(len(fallas), 1)
        self.assertIn("prune", fallas[0])

    def test_rechaza_limpieza_sin_always(self):
        fallas = self.revisar(self.WEB.replace("        condition: always()\n", ""))
        self.assertEqual(len(fallas), 1)
        self.assertIn("always()", fallas[0])


if __name__ == "__main__":
    unittest.main()
