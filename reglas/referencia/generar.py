#!/usr/bin/env python3
"""Genera la referencia congelada de IAR-004: la salida del prototipo (motor.py, reglas D-1.0) para cada mensaje de
los dos conjuntos congelados.

Uso (desde la raíz del monorepo; PROTOTIPO es la carpeta `opcion-d/` del repositorio de documentos en origin/main):

    python3 -I reglas/referencia/generar.py PROTOTIPO reglas/conjuntos reglas/referencia

Verifica el SHA-256 de cada conjunto antes de leer un mensaje (sale con código 2 si difiere) y usa la misma fecha de
referencia que medir.py (2026-11-02) para todos los mensajes. La salida no lleva el texto de los mensajes, solo su id.
"""
import hashlib
import importlib.util
import json
import sys
from datetime import date
from pathlib import Path

FECHA_REFERENCIA = date(2026, 11, 2)  # medir.py: FECHA_REFERENCIA
CONJUNTOS = {
    "prueba": ("conjunto-de-prueba.jsonl", "297c6fbde186ab19ec82079ed1e90225aa51f156689a2da355aefe1defe72150"),
    "confirmacion": ("conjunto-de-confirmacion.jsonl", "6c37977380200f2512055d09fc41126991672fb99aa114dfbdc07fcaf2a78fbc"),
}


def cargar_motor(prototipo):
    spec = importlib.util.spec_from_file_location("motor_d", prototipo / "motor.py")
    motor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(motor)
    return motor, motor.cargar_reglas(prototipo / "reglas.json")


def main(argv):
    prototipo, conjuntos, salida = (Path(a) for a in argv[1:4])
    motor, reglas = cargar_motor(prototipo)
    for nombre, (archivo, esperado) in CONJUNTOS.items():
        ruta = conjuntos / archivo
        calculado = hashlib.sha256(ruta.read_bytes()).hexdigest()
        if calculado != esperado:
            print(f"ERROR: el SHA-256 de {archivo} no coincide ({calculado}). No se generó nada.", file=sys.stderr)
            return 2
    for nombre, (archivo, _) in CONJUNTOS.items():
        lineas = []
        with (conjuntos / archivo).open(encoding="utf-8") as f:
            for linea in f:
                if not linea.strip():
                    continue
                fila = json.loads(linea)
                res = motor.interpretar(fila["texto"], FECHA_REFERENCIA, reglas)
                lineas.append(json.dumps({
                    "id": fila["id"],
                    "fecha_referencia": FECHA_REFERENCIA.isoformat(),
                    "version_reglas": reglas["version"],
                    "monto": res["monto"],
                    "tipo": res["tipo"],
                    "fecha": res["fecha"],
                    "categoria": res["categoria"],
                    "intencion": res["intencion"],
                }, ensure_ascii=False))
        (salida / f"referencia-{nombre}.jsonl").write_text("\n".join(lineas) + "\n", encoding="utf-8")
        print(f"referencia-{nombre}.jsonl: {len(lineas)} mensajes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
