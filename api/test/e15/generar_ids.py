"""Genera test/e15/ids.json desde E15-DAL (repositorio de documentos), con la lógica de e18-ids-e15.py (E18-PPR 2.4).

Uso, desde la raíz de este monorepo (la ruta de E15 es el único argumento; solo lee, no escribe en el otro repositorio):
    python3 -I -B api/test/e15/generar_ids.py <ruta a 01-diseno-algoritmico.md> > api/test/e15/ids.json

Conserva la lista de prefijos «construidos» del ids.json actual: se edita a mano en la historia que construye el algoritmo.
"""
import json
import pathlib
import re
import sys

BLOQUE = re.compile(r"<!-- E15:BLOQUE escritorio-([A-Z]{2}) -->\n(.*?)<!-- E15:FIN escritorio-\1 -->", re.S)
E15 = pathlib.Path(sys.argv[1])
texto = E15.read_text(encoding="utf-8")
version = re.search(r"^\| Versión \| ([\d.]+) \|", texto, re.M).group(1)
ids = {m.group(1): re.findall(r"^\| ([A-Z]{2}-[^ |]+) \|", m.group(2), re.M) for m in BLOQUE.finditer(texto)}
actual = pathlib.Path(__file__).with_name("ids.json")
construidos = json.loads(actual.read_text(encoding="utf-8"))["construidos"] if actual.exists() else ["FP"]
print(json.dumps({
    "fuente": "docs/adso/proyecto/03-diseno/E15-diseno-algoritmico/01-diseno-algoritmico.md (repositorio de documentos)",
    "version_e15": version,
    "construidos": construidos,
    "ids": ids,
}, ensure_ascii=False, indent=2))
