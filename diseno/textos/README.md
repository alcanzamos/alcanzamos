# diseno/textos/

Fuente única de los textos de interfaz de la web y de Android (US-59, D-160, regla 4.13 de E17-ECO). Un texto sale de E14 y entra aquí; nunca se escribe a mano en una pantalla. Un cambio de texto va primero a E14 y después a [`es.json`](es.json).

## Archivos

| Archivo | Qué es |
|---|---|
| [`es.json`](es.json) | Los textos, en tres secciones: `comun` (web y Android), `solo_web` y `solo_android` |
| [`ayudas.plantilla.ts`](ayudas.plantilla.ts) | El código de `formatear` y `plural`, una sola copia |
| [`usos.mjs`](usos.mjs) | El análisis de qué claves usa el código de una app (lo comparten las pruebas de claves de web y móvil; recibe el `typescript` de la app) |
| [`../generar-textos.mjs`](../generar-textos.mjs) | El generador: de `es.json` y las ayudas saca un módulo de TypeScript por plataforma |

Desde `web/`: `npm run textos` escribe `src/textos/es.generated.ts` (`comun` + `solo_web`). El archivo se versiona y no se edita a mano: el pipeline lo regenera y falla si cambia algo. Desde `movil/`, `npm run textos` escribe `src/textos/es.generated.ts` (`comun` + `solo_android`) con el mismo generador: `node ../diseno/generar-textos.mjs android src/textos/es.generated.ts`. Los dos pipelines regeneran y fallan si algo cambia.

## Forma de cada texto (hoja)

Una hoja es un objeto con el texto y su referencia en E14. Los grupos son objetos sin `texto` y se anidan sin límite.

```json
"correo_vacio": {
  "texto": "Falta el correo electrónico.",
  "e14": "E14-PCP 4.1 (errores de campo de PN-58)"
}
```

- `texto`: una cadena, o un plural `{ "one": "…", "other": "…" }`.
- `e14`: dónde está el texto en E14 (obligatorio). Todo texto del código ya está aprobado en E14; si uno se propone antes, la referencia lo dice y el dueño lo aprueba antes de que el código lo use.
- `texto` y `e14` son palabras reservadas: no sirven de nombre de un grupo.
- Los nombres de las claves son identificadores (`[A-Za-z_][A-Za-z0-9_]*`).
- Una ruta no puede estar en `comun` y en `solo_<plataforma>` a la vez.

## Marcadores

Una sola sintaxis: `{nombre}`, con nombre de identificador (`Te enviamos un enlace a {correo}.`). El generador falla con una llave sin cerrar o un nombre inválido.

```ts
formatear(textos.revisaTuCorreo.enviadoA, { correo })
```

El módulo generado deja los textos como tipos literales, así que `formatear` pide **exactamente** los marcadores de ese texto: un dato que falta o que sobra es un error de TypeScript, y además `formatear` lanza un error al ejecutarse si no coinciden. Un texto sin marcadores se usa sin datos.

**Montos y fechas nunca se formatean dentro de un texto.** El marcador recibe la cadena ya formateada por las funciones comunes de la app: `formatearPesos` (`web/src/dinero.ts`, E17-ECO 4.8) y `fechaEnPalabras` (`web/src/fechas.ts`, E17-ECO 4.9). Ejemplo: `formatear(textos.seguridadDeLaCuenta.ingresoAnterior, { fecha: fechaEnPalabras(ingreso) })`.

## Plurales

En el JSON, `{ "one": "{n} ingreso", "other": "{n} ingresos" }`; `plural(formas, n)` elige la forma y pone `n` en `{n}`. Las dos formas llevan los mismos marcadores (menos `n`, que una forma puede no llevar: «Un ingreso»); los demás se pasan como en `formatear`.

- Solo hay `one` y `other`, con **una regla manual del español**: `n === 1` es `one` y todo lo demás (0, 2, 13, los millones) es `other`.
- **No se usa `Intl.PluralRules`** (D-163). Hermes (Android) no la implementa (su `doc/IntlAPIs.md` no la lista y facebook/hermes#1462 sigue abierta, consultado el 2026-10-24); así web y Android siguen un mismo camino, sin ramas por plataforma, y las pruebas (que corren en Node) prueban el mismo código que corre en el teléfono.
- `n` va tal cual (`String(n)`), sin separador de miles: son recuentos pequeños.
- Un texto que cambia según el tipo, como el recuento de PN-72, tiene un plural por cada forma (`porConfirmar.ingresos`, `soloIngresos`…) y la función que elige cuál usar vive en `textos.ts` de cada app (`resumenPorConfirmar`).

## Qué sección va cada texto

- `comun`: un texto que las **dos** apps usan, con las mismas palabras (los de la web y los de Android que son idénticos). Una clave de `comun` que una de las apps no usa hace fallar la prueba de claves de esa app.
- `solo_web` y `solo_android`: un texto que solo usa esa app; la prueba de claves de esa app exige que lo use.
- Un texto que pasa de solo-una-app a las dos se mueve a `comun` sin cambiar una letra (la ruta no cambia: el módulo generado junta `comun` y la sección de la app en un solo árbol `textos`).

## Cómo se comprueba

- Web (Vitest, `web/tests/textos/`): tipos y ejecución de `formatear` y `plural` (regla manual: 0, 1, 2, 13 y 1000000); el escaneo de `es.json` (cada `{…}` es un marcador válido, sin llaves sueltas, hojas bien formadas); que `es.generated.ts` es lo que genera el generador; y que toda clave usada existe y toda clave de `comun` o `solo_web` la usa alguien.
- ESLint de web y de móvil: `no-restricted-syntax` impide textos sueltos en JSX (D-162); `web/tests/eslint/texto-suelto.test.ts` y `movil/tests/eslint/texto-suelto.test.ts` lo prueban.
- Móvil (Jest, `movil/tests/textos/`): el equivalente de la web para `comun` + `solo_android` (claves usadas y sobrantes, marcadores exactos en tipo y ejecución, plurales con la regla manual, `es.generated.ts` igual a lo generado) y que ningún texto de `es.json` esté copiado en `movil/src` fuera del módulo generado. Reemplaza a la prueba de paridad del paso 51.
- Pipelines: un cambio en `diseno/` corre los de `web` y `movil` (y el de `api`); los dos regeneran los textos y fallan si el archivo generado cambia.
