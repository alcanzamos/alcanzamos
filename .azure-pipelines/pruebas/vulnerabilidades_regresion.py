"""Pruebas de regresión independientes de la barrera de vulnerabilidades (D-201).

Las escribió un verificador independiente, aparte de la autoprueba (`vulnerabilidades.py probar`): alcance y límite de
los 7 días (para Go, desde el final del día de publicación), JSON no estricto (NaN, Infinity, claves repetidas),
comandos del agente en texto de afuera, la pista del índice con el momento exacto y los bordes de la página de
versiones de Go. Sin red ni dependencias.

Uso, desde la raíz del repositorio:

    python3 -I -B .azure-pipelines/pruebas/vulnerabilidades_regresion.py
"""
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location(
    'v', '.azure-pipelines/pruebas/vulnerabilidades.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
NOW = dt.datetime(2026, 11, 11, 15, tzinfo=dt.timezone.utc)
PAGE = '<p>go1.27.4 (released 2026-11-10)</p>'


def finding(module='stdlib', fix='v1.27.4', called=True):
    frame = {'module': module, 'package': 'net/http'}
    if called:
        frame['function'] = 'Read'
    return {'osv': 'GO-2026-6859', 'fixed_version': fix, 'trace': [frame]}


def flow(*findings):
    messages = [
        {'config': {'protocol_version': 'v1.0.0', 'scanner_name': 'govulncheck',
                    'scan_level': 'symbol', 'scan_mode': 'source'}},
        {'SBOM': {'go_version': 'go1.27.3', 'roots': ['example.com/api']}},
        {'progress': {'message': 'Checking the code against the vulnerabilities...'}},
    ]
    messages += [{'osv': {'id': f['osv']}} for f in findings]
    messages += [{'finding': f} for f in findings]
    return '\n'.join(json.dumps(m) for m in messages)


class D201Regression(unittest.TestCase):
    def check(self, text, now=NOW, fetch=lambda *a, **k: PAGE):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'scan.json'
            path.write_text(text)
            before = hashlib.sha256(path.read_bytes()).digest()
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = v.comando_revisar(str(path), ahora=now, traer=fetch)
            self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), before)
            self.assertEqual(err.getvalue(), '')
            return code, out.getvalue()

    def test_reachability_and_boundary(self):
        # go1.27.4 (released 2026-11-10) se cuenta desde el final de ese día: cumple 7 días el 2026-11-18 00:00 UTC.
        utc = dt.timezone.utc
        self.assertEqual(self.check(flow(finding(called=False, fix='')))[0], 0)
        for now in (dt.datetime(2026, 11, 10, 16, 48, tzinfo=utc),  # el mismo día: no es una fecha futura
                    dt.datetime(2026, 11, 17, tzinfo=utc),  # 7 días desde el comienzo del día: todavía no
                    dt.datetime(2026, 11, 17, 23, 59, 59, 999999, tzinfo=utc)):
            with self.subTest(now=now):
                code, output = self.check(flow(finding()), now)
                self.assertEqual(code, 0)
                self.assertIn('##vso[task.logissue type=warning]', output)
                self.assertIn('cumple 7 días el 2026-11-18 a las 00:00:00 UTC', output)
        code, output = self.check(flow(finding()), dt.datetime(2026, 11, 18, tzinfo=utc))
        self.assertEqual(code, 1)
        self.assertIn('cumplió 7 días el 2026-11-18 a las 00:00:00 UTC', output)
        code, output = self.check(flow(finding()), dt.datetime(2026, 11, 9, 23, 59, 59, 999999, tzinfo=utc))
        self.assertEqual(code, 1)
        self.assertIn('posterior a ahora', output)
        for fix in ('', 'v1.2.4-0.20261010123456-abcdef123456'):
            self.assertEqual(self.check(flow(finding(fix=fix)))[0], 1)
        self.assertEqual(self.check(flow(finding(), finding('example.com/m', '')))[0], 1)

    def test_non_json_constants_are_rejected(self):
        for token in ('NaN', 'Infinity', '-Infinity'):
            with self.subTest(token=token):
                text = flow() + '\n{"progress":{"message":' + token + '}}'
                self.assertEqual(self.check(text)[0], 1)

    def test_duplicate_key_cannot_erase_reachable_finding(self):
        text = flow() + '\n{"osv":{"id":"GO-2026-6859"}}\n'
        text += ('{"finding":' + json.dumps(finding(fix='')) +
                 ',"finding":' + json.dumps(finding(called=False, fix='')) + '}')
        self.assertEqual(self.check(text)[0], 1)

    def test_untrusted_text_has_no_agent_command(self):
        for count in range(2, 8):
            with self.subTest(count=count):
                self.assertNotIn('##vso[', v.visible('#'*count + 'vso[task.complete result=Succeeded;]'))

    def test_index_hint_and_exact_deadline(self):
        publication = '2026-11-06T09:00:00.123456Z'
        for hint in ('Thu, 01 Oct 2026 00:00:00 GMT',
                     'Tue, 10 Nov 2026 00:00:00 GMT',
                     'Mon, 01 Jan 2029 00:00:00 GMT'):
            def fetch(url, cabecera=None):
                if cabecera:
                    return hint
                if url.endswith('.info'):
                    return json.dumps({'Version': 'v1.2.3', 'Time': '2026-11-01T00:00:00Z'})
                since = parse_qs(urlsplit(url).query)['since'][0]
                if v.leer_instante(since) > v.leer_instante(publication):
                    return ''
                return json.dumps({'Path': 'example.com/m', 'Version': 'v1.2.3', 'Timestamp': publication})
            with self.subTest(hint=hint):
                self.assertEqual(v.fecha_en_el_indice('example.com/m', 'v1.2.3', fetch, NOW),
                                 v.leer_instante(publication))
                code, output = self.check(flow(finding('example.com/m', 'v1.2.3')), fetch=fetch)
                self.assertEqual(code, 0)
                self.assertIn('2026-11-13 a las 09:00:00.123456 UTC', output)

    def test_go_date_and_version_boundaries(self):
        # La página da solo el día; la regla cuenta desde su final, 00:00 UTC del día siguiente (D-201).
        self.assertEqual(v.fecha_en_la_pagina_de_go(PAGE, 'go1.27.4'), dt.date(2026, 11, 10))
        self.assertEqual(v.publicacion('stdlib', 'v1.27.4', lambda *a, **k: PAGE, NOW)[0],
                         dt.datetime(2026, 11, 11, tzinfo=dt.timezone.utc))
        for page in ('xgo1.27.4 (released 2026-11-10)',
                     'go1.27.41 (released 2026-11-10)',
                     PAGE + '<p>go1.27.4 (released 2026-11-01)</p>',
                     PAGE + PAGE):  # la misma entrada dos veces, con la misma fecha: también falla
            with self.assertRaises(v.SinFecha):
                v.fecha_en_la_pagina_de_go(page, 'go1.27.4')


unittest.main(verbosity=2)
