# Listas de contraseñas comunes

`PoliticaDeContrasena` rechaza una contraseña que esté en alguna de estas dos listas (RF-035, D-089, D-142). Las dos van embebidas en el binario con `//go:embed` y se comparan sin distinguir mayúsculas ni tildes («contraseña» es lo mismo que «CONTRASENA»). Las dos solo tienen entradas de 15 caracteres o más: las más cortas ya las frena el largo mínimo.

## 1. `contrasenas_comunes.txt` · SecLists (MIT)

- **Origen:** SecLists, de Daniel Miessler (licencia MIT, texto en `LICENCIA-SecLists.txt`).
- **Archivo de origen:** `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`
- **URL exacta:** <https://raw.githubusercontent.com/danielmiessler/SecLists/4c0fd59432ab8508edc23b3c880127edb12e34d5/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt>
- **Commit de SecLists:** `4c0fd59432ab8508edc23b3c880127edb12e34d5` (HEAD de `master` el 2026-10-22). Último commit que cambió el archivo: `c205c36a445bff37f8e58a9ec829105cd4975c58` (2025-05-08).
- **SHA-256 del archivo de origen:** `424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51` (1.000.000 de líneas).
- **Descargada:** 2026-10-22.
- **Filtro:** solo las líneas de 15 o más caracteres Unicode (las más cortas ya las rechaza la longitud mínima). Queda 10.908 líneas, sin otro cambio: mismo orden, mismas mayúsculas. SHA-256 del resultado: `977ebd3a68e793459a1f83c6766ccf75152f9268098d624d8dac7c28326d3c37`.

Para repetirlo:

```python
# python3 -I filtrar.py ENTRADA SALIDA
import sys
with open(sys.argv[1], encoding="utf-8", newline="") as f, open(sys.argv[2], "w", encoding="utf-8", newline="\n") as g:
    for linea in f:
        s = linea.rstrip("\r\n")
        if len(s) >= 15:
            g.write(s + "\n")
```

## 2. `contrasenas_comunes_es.txt` · lista propia en español (AGPL-3.0-only)

Frases y patrones comunes en español y de Colombia, que la lista de SecLists casi no tiene (D-142 (1)).

- **Licencia:** AGPL-3.0-only, como el resto del repositorio. Lo dice la primera línea del archivo (`# SPDX-License-Identifier: AGPL-3.0-only`). Las líneas que empiezan con `#` son comentarios y el cargador las salta.
- **Origen:** escrita por el equipo. **No sale de ninguna filtración** ni de datos de personas: son palabras y frases comunes («contraseña», «teamo», «tequiero», ciudades de Colombia, equipos y figuras del fútbol, «alcanzamos») pegadas a números y años («123456789», «2026»).
- **Cómo se genera:** [`generar_es.go`](generar_es.go) (`//go:build ignore`, no entra al binario) combina esas palabras con los sufijos, deja solo las de 15 caracteres o más, sin repetir y en orden, y falla si salen menos de 200 o más de 600 entradas. Hoy son 502.

  ```sh
  cd api/src/seguridad/datos
  go run generar_es.go > contrasenas_comunes_es.txt
  ```

- **No se edita a mano:** para sumar o quitar una entrada se cambia el script y se vuelve a generar. SHA-256 del archivo generado: `29708d2f4cf26893243a6db5ced403442430f36587a7933b0b11badfa72291d1`.
- **Entradas con «alcanzamos»:** están en la lista por si la regla cambia, pero `PoliticaDeContrasena` las rechaza antes con `contrasena_personal`, que tiene su propio texto.
- **Pendiente del dueño:** revisar la lista antes de fusionar (D-142 (1)).
