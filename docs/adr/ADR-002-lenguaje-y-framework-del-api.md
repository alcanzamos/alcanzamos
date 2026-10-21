# ADR-002 · Lenguaje y framework del API

> **Copia pública del ADR; el original vive en el repositorio privado del proyecto.** Los identificadores `D-nnn` (decisiones), `E11-xxx`, `E14-xxx`, `ERS`, `RF/RNF/RN/RE/RT-nnn`, `O-n`, `P-nn`, `NM-nn` y `US-nn` remiten al registro de decisiones y a documentos de ese repositorio; se conservan como trazabilidad y no tienen enlace.

| Campo | Valor |
|---|---|
| Documento | Registro de decisión arquitectónica 002 · Código: E11-ADR-002 |
| Proyecto | Alcanzamos |
| Estado | **Decidido por el dueño (D-076, D-081):** el API se escribe en Go con la biblioteca estándar; contraseñas con Argon2id sobre `x/crypto` y sesiones opacas en tabla propia. Pendiente de confirmar por el dueño: los vectores de prueba de Argon2 (sección 5.1) |
| Versión | 1.1 |
| Autor | Andrés Jiménez |
| Responsable de decidir | Dueño del proyecto |
| Uso de IA | El asistente redactó la propuesta, puntuó con los criterios de E11-CYR y consultó las fuentes; el dueño revisa y decide (D-051). |

## Control de versiones

| Versión | Fecha | Descripción del cambio | Autor |
|---|---|---|---|
| 0.1 | 2026-10-19 | Borrador: cuatro alternativas (Java, Kotlin, TypeScript, Python), AC-5 según las respuestas del dueño, propuesta de Java con Spring Boot | Andrés Jiménez |
| 0.2 | 2026-10-19 | El dueño decide Go (D-076). Se reescribe: biblioteca estándar frente a chi, AC-5 con Go nuevo para el dueño, librerías verificadas, monolito modular (D-076 modifica D-026) y costo de memoria con Go | Andrés Jiménez |
| 1.0 | 2026-10-19 | D-081: el dueño decide biblioteca estándar, Argon2id con formato de hash propio sobre `x/crypto` y sesiones opacas en tabla propia (sin scs ni JWT). Se corrige la nota de madurez de `alexedwards/*`. Se aclaran los vectores de prueba (RFC 9106 frente a la implementación de referencia). D-082: montos en centavos | Andrés Jiménez |
| 1.1 | 2026-10-19 | D-083: el dueño confirma los vectores de la implementación de referencia (P-H-C, `src/test.c`), que prueban también la codificación y decodificación del formato PHC | Andrés Jiménez |

## 1. Contexto

El API es el centro del sistema: la web y la app Android hablan solo con él (D-019, RE-005). Concentra el motor de reglas (ADR-005), los cálculos (RNF-002, RN-005), la autenticación propia (D-029), el control de acceso (RNF-003, RNF-012) y el envío de avisos.

E02 estimó el API en 120 h de producción sin asistente, la pieza más grande de la construcción [P, E02-EDC §2]. D-029 exige «una librería madura del framework» para la autenticación, «nunca criptografía propia» [P].

**Decisión del dueño (D-076, 2026-10-19 15:50).** «El API va en Go.» La versión 0.1 comparó Java, Kotlin, TypeScript y Python y propuso Java; esa comparación **queda reemplazada**. El dueño pidió evaluar Go con la biblioteca estándar (`net/http`, rutas de Go 1.22) frente a un router liviano (chi).

**AC-5 depende del dueño y no se supuso.** Respuesta del 2026-10-19 (L4): Go **«es nuevo para mí»**. Su backend conocido es Java (L2). Eso baja AC-5 en las dos alternativas y es el riesgo principal de esta decisión (sección 6).

D-076 también cambia el estilo: **monolito modular** en un solo contenedor, sin Service Bus ni trabajadores aparte. Esto modifica D-026 (documento de arquitectura, sección 4).

## 2. Alternativas

Las dos usan Go. Lo que las separa es el enrutamiento.

| # | Alternativa | Aspecto positivo | Razón de descarte o de elección |
|---|---|---|---|
| A | **Go con la biblioteca estándar**: `net/http` con `http.ServeMux` y patrones de método y ruta (`"GET /v1/movimientos/{id}"`), `log/slog`, `net/http/httptest` | Cero dependencias para enrutar. Es lo que enseña la documentación oficial. El router lo mantiene el equipo de Go | **Decidida (D-081).** El middleware y los grupos de rutas se arman a mano; ver sección 6 |
| B | **Go con chi** (`github.com/go-chi/chi/v5`) | Grupos de rutas con middleware (`r.Group`, `r.Route`), parecido a los filtros de Spring que el dueño conoce. Es 100 % compatible con `net/http` | Una dependencia más. El beneficio es comodidad, no capacidad nueva desde Go 1.22 |

**Qué trae el `ServeMux` de Go 1.22.** Método en el patrón, comodines (`{id}`) y `Request.PathValue` [F, `go.dev/blog/routing-enhancements`, «Routing Enhancements for Go 1.22», 2024-02-13]. El propio equipo de Go dice que «los marcos de terceros siguen siendo una buena opción» para quien ya los usa o necesita enrutamiento avanzado [F, mismo texto]. `Request.SetPathValue` permite probar un manejador sin el router [F, `api/go1.22.txt` de `golang/go`].

**Filtros.**

| Filtro | A Biblioteca estándar | B chi |
|---|---|---|
| AF-1 Licencia compatible con AGPLv3 | Sí: Go usa licencia BSD de tres cláusulas [F, `LICENSE` de `golang/go`] | Sí: MIT [F, `LICENSE` de `go-chi/chi`; API de GitHub, `spdx_id` MIT] |
| AF-2 Cabe en el crédito | Sí (sección 7) | Sí (igual) |
| AF-3 Web y Android sobre el mismo API | Sí | Sí |
| AF-4 Una persona lo opera | Sí | Sí |
| AF-5 Región | No cambia | No cambia |

La Fundación para el Software Libre dice que la licencia Expat (MIT) y la BSD modificada son compatibles con la GPL, y que Apache 2.0 lo es con la GPL versión 3 [F, `gnu.org/licenses/license-list.html`, consultada el 2026-10-19].

## 3. Criterios aplicados

| Criterio | Peso | A Biblioteca estándar | B chi |
|---|---|---|---|
| AC-1 Costo | 20 % | 4 | 4 |
| AC-2 Privacidad | 20 % | 3 | 3 |
| AC-3 Seguridad | 15 % | 4 | 4 |
| AC-4 Portabilidad | 15 % | 5 | 4 |
| AC-5 Capacidad de una persona | 15 % | 3 | 3 |
| AC-6 Exactitud | 5 % | 4 | 4 |
| AC-7 Capacidad de prueba | 5 % | 5 | 5 |
| AC-8 Uso en el celular | 5 % | 4 | 4 |
| **Total ponderado** | 100 % | **3,85** | **3,70** |

**Evidencia por criterio.**

- **AC-1 (4, 4).** Ninguna cambia el gasto. El escenario base del API en Go es USD 70,6 en 3 meses [M, ADR-006 §5]. Con la lectura de AC-1 del README de los ADR (hasta USD 75 es 4) da 4 en las dos. No discrimina.
- **AC-2 (3, 3).** El lenguaje no cambia qué datos se tratan. La medida es la misma: no registrar el texto de los mensajes ni la fecha de nacimiento en los registros técnicos (E11-EIP NM-03) [P]. Con `log/slog` los campos se eligen uno por uno, lo que ayuda a cumplirla. No discrimina.
- **AC-3 (4, 4).**
  - La autenticación usa `golang.org/x/crypto` y la biblioteca estándar en las dos (sección 5), conforme a D-029: sin criptografía nueva.
  - El estándar trae `http.MaxBytesReader` y `http.TimeoutHandler`, y `regexp` de tiempo lineal (sección 6.3).
  - A: el control de acceso negado por defecto se logra envolviendo **todo** el `ServeMux` con un middleware que solo deja pasar una lista blanca de rutas públicas. B: `r.Group` aplica el middleware a un grupo; olvidarlo en un grupo nuevo es posible. Se compensan.
  - Menos dependencias es menos cadena de suministro que revisar (RE-007) [S].
- **AC-4 (5, 4).** Los manejadores de las dos son `http.Handler`, así que pasar de A a B (o al revés) es mecánico. A no ata el API a ningún paquete de terceros para enrutar; B ata el enrutamiento a uno. Las dos corren en un contenedor estándar y no atan el API a Azure [P, D-014].
- **AC-5 (3, 3).** Fuente: respuesta del dueño, Go es nuevo [P, L4].
  - Las dos exigen aprender Go (tipos, errores como valores, goroutines, interfaces), nuevo para él. Por eso no llegan a 4.
  - A: menos cosas que aprender (solo el estándar) y una sola documentación. El middleware se escribe a mano (unas decenas de líneas).
  - B: una API más que aprender, pero se parece a la estructura por grupos y filtros que ya conoce de Java.
  - Se compensan. E02 no midió horas por lenguaje; el factor k se mide en las primeras semanas de construcción (E02 §5) [P].
- **AC-6 (4, 4).** RNF-002 pide pesos enteros y redondeo solo al final. Go separa `int64` de `float64` y no los mezcla sin conversión explícita [S]. Los decimales exactos (tasas) no tienen tipo estándar: se usa entero escalado o una librería, pendiente para E12. Las tasas efectivas anuales salen en doble precisión en cualquier lenguaje: se prueban con casos borde (E15, E18).
- **AC-7 (5, 5).** `testing` y `net/http/httptest` están en el estándar. En A se prueba un manejador con `SetPathValue`; en B hay que pasar por el router para tener los parámetros de ruta [F, `api/go1.22.txt`; documentación de chi, no verificada línea por línea]. PostgreSQL real con `testcontainers-go` y Docker local (RT-004, D-031) [P].
- **AC-8 (4, 4).** RNF-001 mide 10 segundos por registro. Un binario de Go arranca rápido, pero **el arranque en frío del contenedor no se midió** [S]. Con una réplica mínima de 1 (escenario base) no aplica.

**Sensibilidad (E11-CYR 2.3).**

| Caso | A | B | ¿Cambia el orden? |
|---|---|---|---|
| Base | 3,85 | 3,70 | — |
| AC-1 de A baja un punto | 3,65 | 3,70 | **Sí** |
| AC-2 de A baja un punto | 3,65 | 3,70 | **Sí** |
| Ambos bajan un punto | 3,45 | 3,70 | **Sí** |
| AC-5 de B sube a 4 | 3,85 | 3,85 | Empate |

**No es robusto.** La diferencia es de 0,15 y la regla de desempate no decide (menos de 0,25 y AC-1 empata). Como los dos puntajes de AC-1 y AC-2 son iguales, el orden depende de AC-4 (A) y de cuánto valga AC-5 para el dueño. **Es una decisión de bajo riesgo y reversible**: cambiar de A a B toca el archivo de rutas y el middleware, no los módulos de negocio.

## 4. Decisión

**Decidido por el dueño (D-081, 2026-10-19): Go con la biblioteca estándar (A)**, `net/http` con el `ServeMux` de Go 1.22 o posterior.

1. A puntúa 3,85 y B 3,70. La regla de desempate no decide; el dueño elige A.
2. **Cuándo pasar a chi (opción futura, no vigente).** Si en E12 o E17 el middleware por grupo se repite a mano en más de unas pocas rutas, o si el dueño prefiere los grupos de rutas, se puede pasar a B. Es un cambio mecánico (sección 3, AC-4).
3. **Versión de Go.** Se fija la versión en `go.mod` al empezar E17. Hoy `go.dev/dl` lista go1.27.2 y go1.26.9 [F, `go.dev/dl/?mode=json`, 2026-10-19]; el equipo local usa go1.26.9. Fecha de lanzamiento de cada una: no verificada.

## 5. Librerías verificadas (D-029, RE-007)

Consultadas el **2026-10-19**. «Último lanzamiento» es la etiqueta más reciente de la versión mayor indicada, con la fecha que informa `proxy.golang.org/<módulo>/@latest`. La licencia sale del archivo `LICENSE` del repositorio y de la API de GitHub. Todas permiten usarse con AGPLv3 [F, lista de la FSF, sección 2].

| Función | Librería (repositorio) | Licencia | Último lanzamiento verificado | Estado de mantenimiento |
|---|---|---|---|---|
| Enrutamiento, JSON, registros, pruebas HTTP | Biblioteca estándar: `net/http`, `encoding/json`, `log/slog`, `net/http/httptest` (`go.dev/pkg`) | BSD de tres cláusulas | go1.26.9 instalado; `log/slog` existe desde Go 1.21 [F, `api/go1.21.txt`] | Mantenida por el equipo de Go |
| Router (solo alternativa B) | `github.com/go-chi/chi/v5` | MIT | v5.5.0, 2026-10-14 | Último cambio 2026-10-18; no archivado. Su `go.mod` exige Go 1.24 y apoya las cuatro versiones mayores recientes de Go |
| Hash de contraseñas | `golang.org/x/crypto` (`argon2`, `bcrypt`) | BSD de tres cláusulas | v0.58.0, 2026-10-09 | Mantenida por el equipo de Go |
| Formato del hash Argon2id (descartada, D-081) | `github.com/alexedwards/argon2id` (envoltorio de `x/crypto/argon2`) | MIT | v1.0.0, 2023-10-21 | Último cambio 2025-10-28; 713 estrellas. Mismo autor y mismo perfil de mantenimiento que `scs`. **No se usa**: el formato lo escribimos nosotros (sección 5.1) |
| Controlador de PostgreSQL y pool | `github.com/jackc/pgx/v5` (`pgxpool`) | MIT | v5.11.0, 2026-09-07 | Último cambio 2026-10-17. Su matriz de pruebas cubre PostgreSQL 14 a 18 [F, README] |
| Migraciones | `github.com/pressly/goose/v3` | MIT | v3.29.0, 2026-10-11 | Último cambio 2026-10-17. Admite migraciones SQL embebidas con `embed` [F, README] |
| Migraciones (alternativa) | `github.com/golang-migrate/migrate/v4` | MIT | v4.20.1, 2026-09-09 | Último cambio 2026-09-09. Tiene controlador `pgx/v5` y fuente `io/fs` [F, README] |
| Sesiones (descartada, D-081) | `github.com/alexedwards/scs/v2` con `pgxstore` | MIT | v2.9.0, 2025-04-17 (proxy) | Último cambio en `master` 2025-10-02; 2.632 estrellas. Mismo autor y mismo perfil de mantenimiento que `alexedwards/argon2id`. **No se usa**: sesiones en tabla propia (sección 5.2) |
| Tokens JWT (descartada, D-081) | `github.com/golang-jwt/jwt/v5` | MIT | v5.3.1, 2026-01-28 | Último cambio 2026-10-16. **No se usa** (sección 5.2) |
| Validación de entrada | `github.com/go-playground/validator/v10` | MIT | v10.30.5, 2026-09-20 | Último cambio 2026-10-19 |
| Pruebas con PostgreSQL real | `github.com/testcontainers/testcontainers-go` | MIT | v0.44.0, 2026-08-07 | Último cambio 2026-10-19 |
| Aserciones (opcional) | `github.com/stretchr/testify` | MIT | v1.12.1, 2026-08-17 | Último cambio 2026-10-19 |
| CORS (solo si la web va en otro dominio) | `github.com/rs/cors` | MIT | v1.11.1, 2024-08-29 | Último cambio 2026-10-08 |
| Tareas programadas dentro del proceso (solo alternativa, sección 5.4) | `github.com/go-co-op/gocron/v2` | MIT | v2.22.0, 2026-07-09 | Último cambio 2026-10-19 |

**Descartadas (D-081):** `alexedwards/argon2id`, `alexedwards/scs/v2` y `golang-jwt/jwt/v5`. Las dos primeras son del mismo autor y tienen el mismo perfil de mantenimiento; ninguna se usa.

**Fuentes (consultadas el 2026-10-19):** `https://proxy.golang.org/<módulo>/@latest`; `https://api.github.com/repos/<propietario>/<repositorio>` y `/license`; archivo `LICENSE` de cada repositorio; README de cada repositorio en `raw.githubusercontent.com`. La API de GitHub devolvió `NOASSERTION` para `golang-migrate/migrate` y `pressly/goose`; se leyó el `LICENSE` y ambos son MIT.

**Configuración desde variables de entorno (patrón de D-026).** `os.Getenv` del estándar con una estructura de configuración que se valida al arrancar. **No se propone ninguna librería.** Los secretos llegan de Key Vault como variables del contenedor. No se verificó ninguna librería de configuración.

### 5.1 Contraseñas: Argon2id con los parámetros de OWASP (D-081)

**Decidido: Argon2id** con `golang.org/x/crypto/argon2` (`argon2.IDKey`).

- **Parámetros.** `m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1`, sal de 16 bytes de `crypto/rand`, clave de 32 bytes. Es la configuración mínima que pide la hoja de OWASP: «Argon2id con un mínimo de 19 MiB de memoria, 2 iteraciones y 1 de paralelismo» [F, OWASP *Password Storage Cheat Sheet*, `cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html`, consultada el 2026-10-19]. La misma hoja da equivalentes (`m = 46 MiB, t = 1, p = 1`; `m = 12 MiB, t = 3, p = 1`) y pide que verificar una contraseña tarde menos de un segundo.
- **Por qué no `bcrypt`.** La hoja de OWASP lo deja para «sistemas heredados», con factor de trabajo de 10 o más y límite de 72 bytes [F, misma hoja]. `x/crypto/bcrypt` devuelve `ErrPasswordTooLong` sobre 72 bytes [F, `bcrypt.go` de `golang/crypto`]. Es el plan B si Argon2id diera problemas de memoria.
- **El estándar de `x/crypto`.** Su documentación dice que, si no se sabe cuál usar, se use Argon2id (`IDKey`) con las recomendaciones del escenario [F, `argon2.go` de `golang/crypto`]. La recomendación de la RFC 9106 (2 GiB) no cabe en un contenedor de 0,5 GiB; por eso se usan los parámetros de OWASP.
- **Formato del hash: código propio sobre `x/crypto`.** Se escribe un paquete pequeño (unas 50 líneas, sin criptografía nueva) que guarda una cadena de estilo PHC con los parámetros y la sal (`$argon2id$v=19$m=19456,t=2,p=1$<sal>$<clave>`), para poder subir los parámetros después. La comparación es en tiempo constante con `crypto/subtle`. **No se usa `alexedwards/argon2id`.**
- **Nota de madurez corregida.** La versión 0.2 llamaba «poca madurez» a `alexedwards/argon2id` y aceptaba `scs`. Era inconsistente: los dos son **del mismo autor** y tienen **el mismo perfil de mantenimiento** (ritmo lento de lanzamientos, pocos colaboradores; datos en la tabla de la sección 5). Ninguno se usa ahora; el motivo de no usarlos es la decisión del dueño, no una diferencia de madurez entre ellos.
- **Pruebas con vectores.** El dueño pidió probar contra los vectores oficiales de Argon2 (RFC 9106). **Confirmado por el dueño (D-083):** los vectores de la RFC 9106 (sección 5) usan un secreto K y datos asociados X [F, `rfc-editor.org/rfc/rfc9106.html`, sección 5.3, consultada el 2026-10-19], y `argon2.IDKey` no acepta ninguno de los dos [F, `pkg.go.dev/golang.org/x/crypto/argon2`, 2026-10-19]. Por eso **no se pueden reproducir con `IDKey`**. Las pruebas usan los **vectores de la implementación de referencia** (`P-H-C/phc-winner-argon2`, `src/test.c`): Argon2id sin secreto ni datos asociados, en formato PHC, por ejemplo `$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc` (contraseña «password», sal «somesalt») [F, `github.com/P-H-C/phc-winner-argon2/blob/master/src/test.c`, 2026-10-19]. Son los mismos que usa `x/crypto` en sus pruebas. Los mismos vectores, en formato PHC, prueban también el código propio que **codifica y decodifica** el hash (D-083). Además se prueba el ciclo completo: crear, verificar, rechazar una contraseña errónea y detectar parámetros viejos.
- **Memoria.** Cada verificación usa 19 MiB. Con 0,5 GiB, se limita a **4 verificaciones a la vez** (un canal con capacidad 4) para que 4 × 19 MiB = 76 MiB sea el máximo de este uso [S]. Un ataque de inicios de sesión se frena además con límite de intentos (RNF-014, E18).
- **Mejora de hashes.** Al iniciar sesión, si los parámetros guardados son menores que los vigentes, se vuelve a calcular (OWASP, «Upgrading the Work Factor»).

### 5.2 Sesiones: tokens opacos en tabla propia, sin scs ni JWT (D-081)

**Decidido: sesiones opacas en una tabla propia de PostgreSQL.** Razón del dueño, textual: «scs está pensado para cookies y guarda el token tal cual, así que una filtración de la base expondría las sesiones abiertas.»

**Mecanismo.**

1. Al iniciar sesión se genera un token aleatorio de **32 bytes** con `crypto/rand` y se codifica para el transporte (por ejemplo, base64url).
2. La base guarda **solo el SHA-256 del token**, nunca el token. Columnas mínimas (propuesta del asistente, se fija en E13): hash del token (clave primaria), id de la persona, creación, último uso y vencimiento.
3. **Revocar es borrar la fila** (NM-14: cierre a los 18, cierre de sesión, borrado de cuenta). No hay lista de revocación aparte.
4. **El mismo mecanismo para web y Android.** La web lleva el token en una cookie `HttpOnly`, `Secure` y `SameSite=Strict`; Android lo manda en `Authorization: Bearer`. El API acepta cualquiera de los dos y los trata igual. **No se probó en el proyecto**: la prueba con Android queda para E17.
5. **Renovar el token al iniciar sesión** (nuevo token y se descarta el anterior) para evitar la fijación de sesión [F, OWASP *Session Management Cheat Sheet*, sección «Renew the Session ID After Any Privilege Level Change», consultada el 2026-10-19].
6. En cada solicitud, el API calcula el SHA-256 del token presentado y busca la fila por ese valor (índice de la clave primaria); comprueba vencimiento y actualiza el último uso.

**Por qué basta SHA-256 sin sal ni hash lento.** La hoja de OWASP dice que guardar tokens aleatorios tal cual puede ser aceptable en un almacén muy controlado, pero que quien lea la base puede reutilizar los no vencidos; propone guardar un verificador de una vía, y que «un hash rápido es suficiente para estos verificadores aleatorios; los algoritmos de hash de contraseñas son innecesarios» [F, misma hoja, sección «Server-Side Session Token Storage»; traducción del asistente]. Con un token de 256 bits el atacante no puede adivinar ni probar candidatos contra el hash, así que sal y lentitud no agregan nada [S, razonamiento del asistente]. La hoja describe además un diseño con identificador público y verificador separados, comparados en tiempo constante. Aquí se busca por el hash completo; que la búsqueda por índice no sea de tiempo constante no ayuda al atacante, porque no controla los bytes del hash que se busca [S, razonamiento del asistente; el dueño puede pedir el diseño dividido].

**Entropía.** 256 bits, muy por encima del mínimo de 64 bits de OWASP [F, misma hoja, sección «Session ID Entropy»].

**Lo que se descartó.**

- **`scs/v2` con `pgxstore`**: pensado para cookies y guarda el token tal cual (razón del dueño). La nota de madurez no es el motivo (sección 5.1).
- **`golang-jwt/jwt/v5`**: un JWT firmado vale hasta vencer; revocar exige una lista en la base y se pierde lo «sin estado» [S]. Además hay que fijar el algoritmo, validar `exp`, `aud` e `iss` y rotar claves.

**Pendientes para E12, E13 y E18:** duración y vencimiento deslizante de la sesión, límite de sesiones por persona y limpieza de filas vencidas (puede correr en el trabajo programado, sección 5.4). El token de dispositivo para avisos (NM-17) no depende de esto.

### 5.3 Otras piezas

- **Controlador de PostgreSQL.** `pgx/v5` con `pgxpool`; el pool se limita a 10 conexiones [S] y TLS con `sslmode=verify-full` en la URL de conexión [F, README de pgx]. El número máximo de conexiones de B1ms **no se verificó**.
- **Migraciones.** **goose**: migraciones SQL embebidas con `embed`, que dejan un solo binario, y lanzamiento más reciente (2026-10-11). `golang-migrate` es equivalente y sirve igual; no hay una diferencia que la regla de AC decida. Las migraciones se corren desde un comando del mismo binario (`alcanzamos migrar`), no desde el contenedor del API al arrancar [S].
- **Validación de entrada.** `go-playground/validator/v10` para forma y rango (etiquetas en las estructuras). Las reglas del dominio (por ejemplo, edad y visibilidad) van en el código del módulo, no en etiquetas.
- **Registros.** `log/slog` con formato JSON. Los campos se agregan uno por uno: ni el texto de los mensajes ni la fecha de nacimiento (NM-03).
- **Pruebas.** `testing` y `httptest` del estándar; `testcontainers-go` para pruebas con PostgreSQL. `testify` queda **opcional**: no se propone para no sumar dependencias.

### 5.4 Tareas programadas: trabajo de Container Apps

Dos formas de correr las tareas (faltantes, transiciones de edad, borrados a 30 y 60 días, vencimientos de 7 días):

| Opción | A favor | En contra |
|---|---|---|
| **Trabajo programado de Container Apps** (`Schedule`, expresión cron) con **la misma imagen** y otro comando (`alcanzamos tareas`) | No depende de que la réplica del API esté encendida ni se duplica si el API tiene dos réplicas. El trabajo paga solo mientras corre [F, `learn.microsoft.com/en-us/azure/container-apps/billing`, sección Jobs]. Falla sin tumbar el API | Es un recurso más (mismo proveedor `Microsoft.App`). Las expresiones cron se evalúan en UTC [F, `.../container-apps/jobs`] |
| Planificador dentro del proceso (`gocron`) | Una sola pieza | Con la réplica en cero no corre. Con dos réplicas corre dos veces, salvo un candado en la base |

**Propuesta: el trabajo programado de Container Apps.** Las tareas deben ser idempotentes de todos modos (D-026). En el ambiente local corre con `docker compose run` o `cron`. Una ejecución cada 15 minutos de unos 20 segundos entra en el cálculo de costo (ADR-006). **Duración y frecuencia son supuestos [S].**

## 6. Consecuencias

**Lo que se gana**

- Un binario, un contenedor pequeño y sin una máquina virtual que dimensionar. La memoria se acota con `GOMEMLIMIT` [F, `go.dev/doc/gc-guide`: límite de memoria desde Go 1.19].
- Autenticación sobre `x/crypto` y la biblioteca estándar, sin criptografía nueva (D-029), y revocación de sesiones simple (borrar la fila).
- Menos dependencias de ejecución que revisar contra AGPLv3 (RE-007).

**Lo que se pierde o queda condicionado**

### 6.1 Go es nuevo para el dueño

- Es el **riesgo principal de capacidad**: AC-5 pasa de 4 (Java) a 3. El plan de 120 h del API [P, E02] **no está recalculado** para un lenguaje nuevo; el factor k se mide en las primeras semanas (E02 §5).
- Qué mitiga: el estándar es pequeño y estable; `net/http` y `testing` son lo que enseña la documentación oficial; el asistente escribe el código y el dueño lo lee y lo prueba, como en el resto del proyecto (D-051) [P].
- Qué no se hizo: ninguna medición de horas con Go. Se anota en E17 como primera tarea medida.

### 6.2 Memoria y CPU con Go (0,25 vCPU y 0,5 GiB)

**Propuesta: 0,25 vCPU y 0,5 GiB para el contenedor del API. Se acepta como punto de partida.** Presupuesto de memoria **estimado, sin medir** [S]:

| Concepto | MiB |
|---|---|
| Binario y entorno de ejecución de Go en reposo | 20 a 40 |
| Pool de 10 conexiones de `pgx` y búferes | 10 a 30 |
| Reglas de `reglas.json` y expresiones compiladas (ADR-005) | menos de 5 |
| Hasta 4 verificaciones de Argon2id simultáneas (19 MiB cada una) | hasta 76 |
| Solicitudes en curso con 20 personas de prueba (JSON, búferes) | 20 a 50 |
| **Total estimado en el peor caso** | **≈ 190 de 512** |

- Con `GOMEMLIMIT = 400MiB` (unas 80 % de 512 MiB) el recolector de basura aprieta antes de que el contenedor muera por falta de memoria [F, `go.dev/doc/gc-guide`; el 80 % es criterio del asistente, no de la fuente].
- **CPU.** Argon2id con `m = 19 MiB` y `t = 2` tarda decenas de milisegundos en un núcleo completo [S]; con 0,25 vCPU puede tardar varias veces más. Debe quedar bajo un segundo (OWASP). **No medido.**
- **Qué falta.** Medir un API mínimo en un contenedor con 0,25 vCPU y 0,5 GiB: memoria en reposo, memoria con 20 personas, tiempo de una verificación de Argon2id y arranque en frío. **No se hizo aquí:** no hay API y las carpetas permitidas son de documentación. Va como pendiente O-10 de E11-DAR y se corre en E17 base.

| Resultado de la medición | Qué hacer |
|---|---|
| Cabe con holgura | Mantener 0,25 vCPU y 0,5 GiB (escenario base de ADR-006) |
| La verificación de Argon2id pasa de 1 s con 0,25 vCPU | Subir a 0,5 vCPU (escenario alto de ADR-006) o bajar a `m = 12 MiB, t = 3` |
| La memoria supera 400 MiB | Subir a 1 GiB y reducir el pool; ver ADR-006 §5.3 |

### 6.3 Expresiones regulares: RE2 y ReDoS

El paquete `regexp` de Go usa la sintaxis de RE2 y **garantiza tiempo lineal en el tamaño de la entrada** [F, `pkg.go.dev/regexp`, consultada el 2026-10-19]. No retrocede, así que **el riesgo de ReDoS que ADR-005 anotó para el motor de reglas en el servidor desaparece** (ADR-005 §3 y §6). RE2 rechaza referencias hacia atrás y anticipaciones, que la lista blanca del subconjunto portable ya prohíbe [P, E11-PDC-D §3]. El límite de longitud del texto se mantiene como buena práctica, no como defensa contra ReDoS.

La prueba de portabilidad de reglas debe ejecutar cada patrón también con Go: tarea paralela en curso (README de E11-PDC-D §3).

### 6.4 Otras consecuencias

- **Montos en centavos (D-082, 2026-10-19).** Todo monto se guarda como **`int64` en centavos** (`bigint` en E13), nunca en punto flotante. El formulario acepta decimales opcionales con coma («123.456,78»); sin decimales funciona igual que antes. Se muestra sin centavos si no los tiene («$80.000») y con centavos si los tiene («$123.456,78»). Las sumas de movimientos registrados son exactas. Los cálculos estimados (simulación, proyección, horas de vida, costo de la compra a cuotas) se redondean **al peso solo al final**. La opción D no cambia: entrega pesos enteros y la persona corrige al confirmar. E15 define dónde se redondea cada cálculo. Las tasas en `float64` deben dar resultados exactos al peso (RNF-002): el costo de la compra a cuotas se prueba con casos borde (E15, E18) o se calcula con `math/big`. Razón del dueño: los intereses, cargos e IVA del extracto (RF-051) y las compras en otra moneda traen centavos.
- **Motor de reglas.** Hay que portar el motor del prototipo en Python (274 líneas) a Go, con el mismo `reglas.json` (ADR-005).
- **Código propio de autenticación.** El formato del hash (sección 5.1) y la tabla de sesiones (sección 5.2) son código propio, pequeño y sin primitivas nuevas. Se prueba con los vectores de referencia y con casos de revocación y vencimiento (E18).
- **Sin un framework de seguridad completo.** En Java, Spring Security traía autorización por método. En Go se escribe el middleware de autorización y la matriz de roles (E18). Es más código propio y se prueba con la matriz de roles de E11-EIP.
- **Dependencias.** Cada una se revisa contra AGPLv3 (RE-007) en el pipeline. Las de la sección 5 ya se revisaron hoy.

## 7. Costo con Go

El detalle está en ADR-006 §5. Resumen del gasto de 3 meses en México Central, monolito con una imagen en GitHub (sin Service Bus ni registro de pago):

| Escenario | USD en 3 meses | AC-1 (lectura del README de los ADR) |
|---|---|---|
| Bajo | 61,1 | 4 |
| **Base (0,25 vCPU y 0,5 GiB)** | **70,6** | 4 |
| Alto (0,5 vCPU y 1 GiB) | 99,7 | 2 |

El puntaje de AC-1 de la sección 3 (4 en las dos) usa el escenario base. La lectura de la escala la confirma el dueño (E11-DAR, O-18). Si el escenario alto fuera el real, AC-1 sería 2 en las dos y el orden entre A y B no cambia.

## 8. Requisitos que sostiene

RNF-002, RNF-003, RNF-004, RNF-012, RNF-013, RNF-014 (seguridad y exactitud en el API); RNF-006 y RNF-008 (el motor y su puerto, ADR-005); RNF-021 (costo); RE-005 y RE-007.

## 9. Preguntas para el dueño

1. **Decidido (D-081):** biblioteca estándar para enrutar. chi queda como opción futura.
2. **Decidido (D-081):** Argon2id con los parámetros de OWASP (19 MiB, 2 iteraciones, 1 de paralelismo), máximo de 4 verificaciones a la vez, formato del hash propio sobre `x/crypto`. **Por confirmar:** que las pruebas usen los vectores de la implementación de referencia y no los de la RFC 9106 (sección 5.1).
3. **Decidido (D-081):** sesiones opacas en tabla propia, sin scs ni JWT.
4. ¿Acepta que **el trabajo programado de Container Apps** corra las tareas? **Aplazada (D-080).**
5. La medición de la sección 6.2 como primera tarea de E17 base: **cubierta por D-080.**

## Fuentes

D-002, D-014, D-019 Fuentes de la sección 5.1 y 5.2, consultadas el 2026-10-19: `https://www.rfc-editor.org/rfc/rfc9106.html` (sección 5.3); `https://pkg.go.dev/golang.org/x/crypto/argon2`; `https://github.com/P-H-C/phc-winner-argon2/blob/master/src/test.c`; OWASP *Session Management Cheat Sheet*.
