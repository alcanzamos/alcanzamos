# ADR-005 · Dónde viven las reglas de la opción D (P-10)

> **Copia pública del ADR; el original vive en el repositorio privado del proyecto.** Los identificadores `D-nnn` (decisiones), `E11-xxx`, `E14-xxx`, `ERS`, `RF/RNF/RN/RE/RT-nnn`, `O-n`, `P-nn`, `NM-nn` y `US-nn` remiten al registro de decisiones y a documentos de ese repositorio; se conservan como trazabilidad y no tienen enlace.

| Campo | Valor |
|---|---|
| Documento | Registro de decisión arquitectónica 005 · Código: E11-ADR-005 |
| Proyecto | Alcanzamos |
| Estado | **Decidido por el dueño (D-076): B, un solo motor en el API, ahora en Go** |
| Versión | 0.2 |
| Autor | Andrés Jiménez |
| Responsable de decidir | Dueño del proyecto |
| Uso de IA | El asistente redactó la propuesta, puntuó con los criterios de E11-CYR y consultó las fuentes; el dueño revisa y decide (D-051). |

## Control de versiones

| Versión | Fecha | Descripción del cambio | Autor |
|---|---|---|---|
| 0.1 | 2026-10-19 | Borrador: tres alternativas, propuesta, contrato del motor y condiciones si las reglas viven en más de un lugar | Andrés Jiménez |
| 0.2 | 2026-10-19 | El dueño decide B con el motor en Go (D-076). El motor se porta a Go; RE2 elimina el riesgo de ReDoS; consistencia mensaje por mensaje con el prototipo; nota de «varios movimientos» (D-077, (4)). Los totales suben 0,20 por el costo de D-076 (AC-1); el orden no cambia | Andrés Jiménez |

## 1. Contexto

**Decisión del dueño (D-076, 2026-10-19 15:50): B, un motor en el API, ahora escrito en Go** (el API pasó de Java a Go, ADR-002). Este ADR conserva la comparación y actualiza lo que cambia con Go.

**P-10:** ¿dónde vive la interpretación del lenguaje natural? D-062 (acta 12.8) dijo que, si ganaba A, B o D, la interpretación viviría **en la app de Android** y no en el trabajador de IA del API, y que dónde viviera se decidía en E11 y E12, respetando RNF-008 [P]. D-075: **gana D** (solo reglas); las reglas no son IA. La web también tiene lenguaje natural (acta 12.8, S6, D-075) [P].

**Qué es D.** Un archivo `reglas.json` (versión `D-1.0`, 540 líneas, 22.286 bytes) y un motor delgado (del prototipo en Python, 274 líneas, solo biblioteca estándar) con la función `interpretar(texto, fecha_referencia, reglas)`. Devuelve `monto`, `tipo`, `fecha`, `categoria` e `intencion`. Todo el vocabulario del dominio está en el JSON [M, `wc` sobre `opcion-d/`]. Las expresiones regulares siguen un subconjunto portable que da el mismo resultado en Python, JavaScript, Java y Go, que usa RE2 (la prueba de portabilidad ejecuta los cuatro; Go se agregó con D-076, en una tarea paralela) [P, E11-PDC-D §3].

**Resultados de D con las reglas `D-1.0`** (D-075) [P]:

| Conjunto | Monto, tipo y fecha | Categoría |
|---|---|---|
| Congelado (201 registros) | 93,5 % (meta 90 %) | 88,6 % (meta 80 %) |
| Confirmación (93 registros) | 91,4 % | 80,6 % |

**Restricción del dueño.** Si las reglas viven en la app **y** en el API, **el archivo de reglas es el único punto común**: cada lado tiene su propio motor delgado, el subconjunto portable de expresiones regulares lo hace posible, y la consistencia se prueba midiendo ambos motores con los mismos conjuntos congelados. La regresión de E18 debe alcanzar la exactitud del prototipo (D-075) [P].

**Requisitos que pesan:**

- RNF-006 (exactitud de la interpretación), RNF-008 (proveedor reemplazable: cambiar la forma de interpretar no cambia el comportamiento de ninguna función), RN-001 (nada se guarda sin la confirmación de la persona) [P].
- RNF-001 (10 segundos por registro) [P].
- **Uso sin conexión: la ERS no lo exige.** El formulario (RF-002) es el núcleo y no depende del lenguaje natural [P]. El dueño pidió considerarlo; aquí cuenta como un beneficio, no como requisito.
- RNF-007 y RE-003 **no aplican** (D-075): ningún dato sale a un proveedor de IA.

## 2. Alternativas

| # | Alternativa | Dónde corre el motor | Aspecto positivo | Razón de descarte o de elección |
|---|---|---|---|---|
| A | **En los clientes** | En la app Android y en el navegador, cada uno con su motor; el API no tiene motor | El texto no sale del dispositivo antes de confirmar; sin red | Dos motores nuevos (el de la app, según ADR-003 (en revisión), y uno en TypeScript para la web) que mantener iguales. Cambiar las reglas exige publicar la app y la web |
| B | **En el API** | Un motor en el API (Go); los clientes llaman a un endpoint | Una sola copia; cambiar reglas es un despliegue; sin motor en la app ni en la web | **Decidida por el dueño (D-076).** El texto viaja al API; sin lenguaje natural sin conexión |
| C | **En la app Android y en el API** | La app interpreta en el teléfono; la web llama al API | Android sin red; la web sin motor propio | Dos motores (uno en el lenguaje de la app y uno en Go) y dos versiones de reglas que pueden diferir entre teléfono y web |

**Filtros.** AF-1 a AF-5: las tres pasan. Ninguna cambia el costo en Azure de forma relevante: 100.000 solicitudes al mes están muy por debajo de los 2 millones gratuitos de Container Apps [F, `learn.microsoft.com/en-us/azure/container-apps/billing`]; el supuesto de 100.000 está en ADR-006. AF-3 se cumple: en B la web y Android llaman al mismo API.

## 3. Criterios aplicados

| Criterio | Peso | A Clientes | B API | C Android + API |
|---|---|---|---|---|
| AC-1 Costo | 20 % | 4 | 4 | 4 |
| AC-2 Privacidad | 20 % | 5 | 4 | 4 |
| AC-3 Seguridad | 15 % | 4 | 4 | 4 |
| AC-4 Portabilidad | 15 % | 3 | 5 | 3 |
| AC-5 Capacidad de una persona | 15 % | 3 | 4 | 2 |
| AC-6 Exactitud | 5 % | 3 | 5 | 3 |
| AC-7 Capacidad de prueba | 5 % | 4 | 5 | 4 |
| AC-8 Uso en el celular | 5 % | 5 | 4 | 5 |
| **Total ponderado** | 100 % | **3,90** | **4,25** | **3,55** |

**Evidencia por criterio.**

- **AC-1 (4, 4, 4).** El costo de CPU de interpretar un mensaje es despreciable; el escenario base (USD 70,6 en 3 meses, ADR-006 §5; era USD 82,8 y 3 en la versión 0.1) no cambia. No discrimina.
- **AC-2 (5, 4, 4).**
  - A: nada viaja antes de confirmar. Se comprueba inspeccionando el tráfico: no hay solicitud al API al interpretar (E18). Cumple por diseño.
  - B: el texto de un mensaje, incluso uno que la persona nunca guarda, llega al API. Es **nuestro** sistema, no un tercero: RNF-007 no aplica. La medida es no guardarlo ni registrarlo en los registros técnicos antes de la confirmación (RN-001); se comprueba revisando los registros (E18). Medida declarada y comprobable: 4.
  - C: igual que A en Android y que B en la web.
  - E11-EIP v1.2 riesgo 11: el texto libre puede contener datos sensibles deducibles; la medida es el aviso junto al cuadro (NM-12), no el lugar del motor [P].
- **AC-3 (4, 4, 4).**
  - **Con Go desaparece el riesgo de ReDoS en el servidor.** El subconjunto portable prohíbe retroceso, referencias y anticipaciones, pero **permite cuantificadores anidados** [P, E11-PDC-D §3]. En la versión 0.1, con Java (`java.util.regex`, de retroceso), un patrón así podía tardar mucho con un texto adverso y lo pagaba el servidor. El paquete `regexp` de Go usa la sintaxis de RE2 y **garantiza tiempo lineal en el tamaño de la entrada** [F, `pkg.go.dev/regexp`, consultada el 2026-10-19]. Por eso B sube de 3 a 4.
  - Queda el costo lineal: un texto muy largo sigue gastando CPU. **El límite de longitud se mantiene como buena práctica**, junto con `http.MaxBytesReader` y un tiempo límite por solicitud [S].
  - En A solo lo paga el dispositivo de quien lo causa, con motores de retroceso (JS, Dart) [S]. En C, la parte del API ya no sufre; la de la app, sí.
  - Las reglas no son secretas: el código es público (AGPLv3, D-021).
- **AC-4 (3, 5, 3).** RNF-008. En B hay un solo lugar donde cambiar o reemplazar la forma de interpretar (por ejemplo, sumar un modelo en el futuro), sin publicar la app. En A y C hay copias en clientes que solo se actualizan con una versión nueva, y la versión de las reglas puede diferir entre teléfono, navegador y API.
- **AC-5 (3, 4, 2).** El motor delgado tiene 274 líneas en Python [M]. Portarlo es acotado, pero hay que hacerlo en cada lenguaje. **Go es nuevo para el dueño** (L4), así que B baja de 5 a 4: una sola portación, en un lenguaje que está aprendiendo. A: dos portaciones, una en TypeScript (nuevo) y otra en el lenguaje de la app (ADR-003 (en revisión)); se queda en 3 por el JS que ya conoce. C: una portación en el lenguaje de la app y otra en Go, ambos nuevos: 2.
- **AC-6 (3, 5, 3).** B tiene un solo motor y una sola regresión (E18). A y C necesitan que dos motores den lo mismo; se declara la medida (sección 5) y por eso es 3.
- **AC-7 (4, 5, 4).** B prueba el motor y los conjuntos congelados en un pipeline de Go (`testing`). A y C suman la prueba de consistencia y ampliar la de portabilidad a Dart (o a Hermes), que hoy no está [P].
- **AC-8 (5, 4, 5).** RNF-001 mide 10 segundos por registro. Interpretar en el dispositivo es inmediato. B suma una ida y vuelta al API: el piso físico hasta Querétaro es de 33 ms de ida y vuelta desde Bogotá (cálculo propio de E11-CYR, no medido) [S]. No amenaza RNF-001, pero se mide con las 20 personas de prueba (E18).

## 4. Decisión (del dueño, D-076)

**Un solo motor, en el API (B), escrito en Go.** Decisión del dueño (D-076). Los clientes no llevan motor: el cuadro de lenguaje natural de Android y de la web llama al API, y la persona confirma antes de guardar (RF-004, RN-001).

1. **B 4,25; A 3,90.** Frente a la versión 0.1 (4,05 y 3,70), los tres suben 0,20 por AC-1 (el costo del escenario base bajó a USD 70,6 con D-076). Por Go, B gana un punto en AC-3 (RE2) y pierde uno en AC-5 (Go nuevo): se compensan. La diferencia es de 0,35, mayor que los 0,25 de la regla de desempate: decide la tabla.
2. **El acta 12.8 no cerró el lugar.** Dijo que vivía en la app y que se decidía en E11 y E12. Esa frase se escribió cuando A y B ponían un modelo en el teléfono; con D no hay modelo. **El dueño decidió B (D-076)** y con ello se aparta de la inclinación del acta.
3. **RNF-008 se cumple con un puerto.** El API define una interfaz `Interpretador` con un contrato estable (sección 5). Hoy tiene una sola implementación (reglas, en Go). Cambiar la forma de interpretar es cambiar la implementación, sin tocar ninguna función.
4. **C es la peor.** Suma las desventajas de A y de B: dos motores y dos copias de las reglas.

## 5. Contrato, consistencia con el prototipo y condiciones para A o C

### 5.1 Contrato del `Interpretador` (el detalle va a E12)

| | |
|---|---|
| Entrada | `texto`, `fechaReferencia` (la fecha de hoy de la persona; es dato de entrada, no está en las reglas) |
| Salida | `monto` (pesos enteros), `tipo`, `fecha`, `categoria`, `intencion`, `reglasVersion` (`D-1.0`) |
| Efectos | Ninguno: no guarda nada, no registra el texto (RN-001) |
| Límites | Longitud máxima del texto y tiempo límite (valores por definir en E12 [S]) |

### 5.2 Condiciones si las reglas viven en más de un lugar (restricción del dueño)

El dueño eligió B (un solo motor), así que estas condiciones **no rigen hoy**. Quedan como registro por si se reabre la decisión hacia A o C:

1. **Un solo punto común: `reglas/reglas.json`** (ADR-001). Ninguna regla se copia a mano al código. Cada lado tiene **su propio motor delgado** que lee el archivo.
2. **Subconjunto portable.** Los patrones pasan la lista blanca de sintaxis y producen el mismo resultado en cada motor. La prueba de portabilidad (del prototipo) cubre Python, Node y Java, y con D-076 también Go (RE2); la ampliación a Go la hace una tarea paralela [P, E11-PDC-D §3]. Hay que ampliarla al tiempo de ejecución real de cada cliente: la máquina virtual de Dart, o Hermes si fuera React Native. Dart usa expresiones regulares con la sintaxis y la semántica de JavaScript [F, `api.dart.dev/stable/dart-core/RegExp-class.html`], pero la prueba debe correr allí, no inferirse.
3. **Prueba de consistencia.** Cada motor se ejecuta sobre **los mismos conjuntos congelados**: el de prueba v1.0 (201 registros, SHA-256 `297c6fbd…2150`) y el de confirmación (93 registros, SHA-256 `6c379773…8fbc`) [P]. Debe dar **la misma salida, mensaje por mensaje**, que el prototipo de Python. Es más fuerte que igualar el porcentaje.
4. **Regresión de E18 (D-075).** Cada motor de producción debe alcanzar la exactitud del prototipo: 93,5 % y 88,6 % en el conjunto congelado; 91,4 % y 80,6 % en el de confirmación.
5. **Qué miden esos conjuntos.** Sirven para comprobar que una **versión portada** es equivalente. **No sirven para medir una versión nueva de las reglas** (`D-1.1` o posterior): ya se vieron sus fallos; una mejora se mide con un conjunto nuevo, nunca visto, y la cifra de `D-1.0` no se reemplaza (D-075 (4)) [P].
6. **Versión de las reglas.** El motor informa `reglasVersion`. Si un cliente y el API difieren, gana la del API para guardar; el cliente muestra lo que interpretó su propio motor y la persona confirma (RN-001).
7. **Dónde viven los conjuntos congelados:** en el monorepo público, sin modificar, con el SHA-256 verificado por el pipeline antes de medir (D-083).

Con B (la decisión del dueño) rigen las condiciones 3, 4 y 5, con el motor en Go contra los dos conjuntos (sección 5.3).

### 5.3 El motor en Go: consistencia y regresión (D-076, D-075)

1. **Lee `reglas/reglas.json`**, el mismo archivo del prototipo. Ninguna regla se copia a mano al código de Go (ADR-001).
2. **Misma salida, mensaje por mensaje.** El motor en Go debe dar la misma salida que el prototipo de Python en los dos conjuntos congelados: el de prueba v1.0 (201 registros) y el de confirmación (93). Es más fuerte que igualar el porcentaje. La prueba compara campo por campo: `monto`, `tipo`, `fecha`, `categoria` e `intencion`. Cómo se obtiene la salida de referencia del prototipo (correrlo en el pipeline o guardar un archivo generado con él) se decide en E12; **hoy no existe** una salida por mensaje guardada: los resultados de `resultado-medicion-d*.json` solo traen métricas [M, claves del JSON].
3. **Regresión de E18.** El motor en Go debe alcanzar la exactitud del prototipo (D-075): 93,5 % y 88,6 % en el conjunto congelado; 91,4 % y 80,6 % en el de confirmación.
4. **Subconjunto portable en RE2.** Todo patrón de `reglas.json` debe dar el mismo resultado en Go (`regexp`, RE2). La prueba de portabilidad lo comprueba con Go [P, E11-PDC-D §3, tarea paralela]. RE2 rechaza referencias hacia atrás y anticipaciones, que el subconjunto portable ya prohíbe.
5. **Fechas y desplazamientos.** Go cuenta posiciones de texto en **bytes**, no en caracteres; la prueba de portabilidad ya convierte los desplazamientos [P, README de E11-PDC-D §3]. El motor debe manejar el texto en UTF-8 y comparar de forma coherente con el prototipo (por ejemplo, las tildes) [S].

## 6. Consecuencias

**Lo que se gana**

- Un motor y una regresión. La app y la web no necesitan motor ni la prueba de portabilidad en Dart o JS.
- Cambiar las reglas es un despliegue del API, sin pasar por Google Play.
- RNF-008 cumplido con un puerto.

**Lo que se pierde o queda condicionado**

- **El texto de los mensajes viaja al API** antes de confirmar. Medida: no registrarlo ni guardarlo (RN-001, NM-12). Se verifica en E18.
- **Sin lenguaje natural sin conexión.** El formulario (RF-002) sigue funcionando; la ERS no pide más.
- **Portar el motor del prototipo a Go** (unas 300 líneas [S]) más las pruebas, en un lenguaje nuevo para el dueño (ADR-002). La salida debe coincidir mensaje por mensaje con el prototipo (sección 5.3).
- **ReDoS: el riesgo desaparece con RE2.** El paquete `regexp` de Go garantiza tiempo lineal [F, `pkg.go.dev/regexp`]. Se mantiene el límite de longitud del texto como buena práctica y para acotar la CPU, no como defensa contra ReDoS. La auditoría de patrones deja de ser una medida de seguridad y queda como control de calidad.
- **Aviso de varios movimientos (S6, US-29).** El prototipo devuelve solo el primer movimiento y **no informa cuántos detectó** [M, prototipo en Python]. La app debe avisar que registró solo el primero. Hace falta una señal nueva. **El dueño decidió (D-077, (4)): una heurística aparte que cuenta los montos, sin tocar `reglas.json`**, que se diseña en E12. Con eso no hay versión nueva de las reglas (`D-1.1`) ni conjunto nuevo (D-075). El aviso es: «Tomamos solo el primer movimiento. Registra los otros por separado.» (L4, decisión 5).
- **El resultado de D está cerca del umbral** (91,4 % y 80,6 %): un acierto menos en el conjunto de confirmación incumpliría la meta de categoría [P, E11-PDC-D §10]. La regresión de E18 lo vigila.

## 7. Sensibilidad (E11-CYR 2.3)

| Caso | Puntaje de B | Segundo (A) | ¿Cambia el orden? |
|---|---|---|---|
| Base | 4,25 | 3,90 | — |
| AC-1 del ganador baja un punto | 4,05 | 3,90 | No |
| AC-2 del ganador baja un punto | 4,05 | 3,90 | No |
| Ambos bajan un punto | 3,85 | 3,90 | **Sí** (A pasa a primero, a 0,05) |

**Robusto frente a cada criterio por separado; no frente a los dos a la vez.** La ventaja de B nace de AC-4, AC-5, AC-6 y AC-7; la de A, de AC-2 y AC-8. Si el dueño pesa la privacidad por encima de lo que pesa la capacidad, A es la alternativa.

## 8. Requisitos que sostiene y puntos que el dueño ya decidió

- **Sostiene:** RNF-006, RNF-008, RN-001, RF-001, RF-004 (en Android y en la web), RNF-001.
- **Pregunta 1 (resuelta por D-076).** Confirmó B y se apartó de la inclinación del acta 12.8.
- **Pregunta 2 (resuelta).** Prefirió un solo motor, con el texto pasando por el API.
- **Pregunta 3 (abierta, sin cambios).** ¿Quiere uso sin conexión para el lenguaje natural? Hoy la ERS no lo pide.

## Fuentes

D-062 (acta 12.8), D-071, D-075, D-076, D-077; E11-PDC-D §2, §3, §9, §10 y §11; E11-CYR v1.1 §2; ERS v1.9 (RNF-001, RNF-006, RNF-008, RN-001, RF-001, RF-004); E11-EIP v1.2 (riesgos 6 y 11, NM-12); ADR-001 y ADR-006; documentación de Container Apps, de Dart y `pkg.go.dev/regexp` consultadas el 2026-10-19; ADR-002 y ADR-003 (en revisión); medición de líneas sobre el prototipo de la opción D.
