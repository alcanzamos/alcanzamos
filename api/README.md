# api/

API de Alcanzamos: monolito modular en Go con la biblioteca estándar (ADR-002). Incluye el motor de reglas en Go (ADR-005), las migraciones en `api/migraciones/` y la web embebida en la imagen (ADR-004).

- Archivo de construcción: `go.mod` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), pruebas con `go test -race`; las de integración usan `//go:build integration`.
- Estructura del monorepo: ADR-001 en [`docs/adr/`](../docs/adr/ADR-001-estructura-de-repositorios.md).

## Uso

- Un solo binario con subcomandos. Sin subcomando corre el servidor (`api`).
- `GET /salud` responde 200 con `{"estado":"ok"}` (queda en la raíz).
- El puerto sale de `PUERTO` (por defecto 8080). El registro es JSON por la salida estándar.
- Con `SIGTERM` o `Ctrl+C` el servidor termina las peticiones en curso (plazo de 10 s).

```sh
cd api
go test -race ./...
go run ./cmd/api
cd ..    # la imagen se construye desde la raíz del monorepo
docker build -f api/Dockerfile -t alcanzamos-api:dev .
docker run --rm -p 127.0.0.1:8080:8080 alcanzamos-api:dev
```

## Rutas y web embebida (ADR-004)

Un solo origen: la web y el API comparten dominio, sin CORS. No hay dominio fijo en el código (D-129).

| Ruta | Respuesta |
|---|---|
| `GET /salud` | `{"estado":"ok"}` |
| `/api/...` | Todo endpoint nuevo del API va aquí. Una ruta desconocida da 404 con `{"error":"no_encontrado"}` en JSON, nunca `index.html` |
| `GET`/`HEAD` de un archivo de la web (`/assets/...`, `/fuentes/...`) | El archivo. `/assets/` lleva `Cache-Control: public, max-age=31536000, immutable` (los nombres llevan hash) |
| Cualquier otro `GET`/`HEAD` | `index.html` con 200 y `Cache-Control: no-cache` (aplicación de una página) |
| Otro método fuera de `/salud` y `/api/` | 405 con `Allow: GET, HEAD` |

- Paquete `internal/web`: `//go:embed` de `internal/web/estatico/`. En el repositorio esa carpeta solo tiene un `index.html` de relleno ("la web no está compilada"), para que `go build` y `go test` pasen sin compilar la web. El `Dockerfile` lo sobrescribe con el `web/dist` real. Un `npm run build` local no toca esa carpeta, así que no deja cambios en git (`web/dist` está ignorado).
- Las respuestas de la web llevan `X-Content-Type-Options: nosniff`.
- **Content-Security-Policy** en todas las respuestas (web, `/api/`, `/salud`, errores 404 y 405), puesta por un envoltorio del manejador en `internal/servidor` con una sola constante (`politicaCSP`):

  ```
  default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
  ```

  | Directiva | Para qué |
  |---|---|
  | `default-src 'self'` | Scripts, estilos, fuentes, imágenes y conexiones solo del mismo origen; sin scripts ni estilos en línea ni terceros (la web ya cumple: fuentes propias, bundle externo) |
  | `object-src 'none'` | Sin `<object>`, `<embed>` ni applets |
  | `base-uri 'none'` | Una etiqueta `<base>` inyectada no puede redirigir las rutas relativas |
  | `frame-ancestors 'none'` | Nadie puede incrustar la web en un `<iframe>` (clickjacking); reemplaza a `X-Frame-Options` |
  | `form-action 'self'` | Los formularios solo envían al mismo origen |

  La prueba `TestContentSecurityPolicyEnTodasLasRespuestas` verifica el valor exacto. `vite preview` (que usa Playwright) repite el mismo texto en `web/vite.config.ts` y `web/e2e/csp.spec.ts` lo compara y falla ante cualquier violación; no hay un origen único posible porque Go no puede embeber archivos fuera de su módulo, así que son dos literales que hay que mantener iguales.
- Cuando lleguen las cookies de sesión (US-49) serán `SameSite=Strict` (D-083).
- Para ver la web real sin Docker: `cp -r web/dist/. api/internal/web/estatico/` y `go run ./cmd/api` (no confirmar ese cambio).

## Configuración

Ningún dominio ni dirección va fija en el código (D-129). `config.Cargar` lee estas variables y, si falta alguna o no es válida, devuelve un error que las nombra todas. Hoy nadie la llama todavía: el comando `api` empieza a exigirla cuando monta la cuenta (PR 5 de la US-49). `migrar` y `tareas` no la necesitan.

| Variable | Qué es | Ejemplo local (Mailpit de `infra/local`) |
|---|---|---|
| `BASE_DE_DATOS_URL` | Cadena de conexión de PostgreSQL | `postgres://alcanzamos:solo-local@127.0.0.1:5432/alcanzamos` |
| `CORREO_SMTP` | `host:puerto` del servidor SMTP. Usa STARTTLS si el servidor lo ofrece; todavía no autentica (el proveedor de producción está por definir, O-4) | `127.0.0.1:1025` |
| `CORREO_REMITENTE` | Dirección que envía; no recibe respuestas (D-120). El valor sale de la configuración, no del código | `no-responder@avisos.ejemplo.test` |
| `CORREO_PRIVACIDAD` | Dirección del pie de cada correo, donde escribir sobre los datos (D-120, RF-060) | `privacidad@ejemplo.test` |
| `URL_PUBLICA` | Base de los enlaces de los correos, sin parámetros; la barra final se quita. El enlace de verificación es `URL_PUBLICA/verificar?t=<token>` | `http://127.0.0.1:8080` |
| `SESION_SENUELO_CLAVE` | Clave que firma las sesiones de mentira (D-141, D-143 (2)). Base64 estándar o de URL; decodificada debe tener **32 bytes o más**. Obligatoria para `api`; nunca se registra ni sale en un error (`config.Clave` se imprime como `[oculta]`). Todas las réplicas deben tener la misma. Genera una con `openssl rand -base64 32` | `Zm9vLWJhci1iYXotcXV4LXF1dXgtY29ycmUtbG9jYWw=` (solo local) |
| `PUERTO` | Puerto del servidor (opcional, 8080) | `8080` |

`infra/local/` queda fuera de esta carpeta: para una variable nueva allí, copia la tabla a su `.env.example`. Las pruebas inyectan los valores (`config.Cargar` recibe la función de lectura del entorno).

## Acceso negado por defecto (RNF-012, D-138)

Toda ruta de `/api/` se registra con `Enrutador.Registrar(nivel, patron, manejador)` y **declara su nivel de acceso**. No existe un registro sin nivel: el valor cero, una ruta fuera de `/api/`, un patrón repetido (con el mismo nivel o con otro) o en conflicto hacen que `Construir` devuelva un error y el servidor no arranque. `Registrar` nunca hace `panic`. El nivel que se declara para «todo lo demás» es `requiere_autorizacion`: ante la duda, el más estricto.

| Nivel | Qué exige | Rutas |
|---|---|---|
| `publica` | nada | crear la cuenta, verificar el correo con el enlace; en la US-49 parte 2, iniciar sesión y recuperar el acceso |
| `sin_verificar` | una sesión, aunque sea la **limitada** de una cuenta con el correo sin verificar (o la sesión de mentira de D-141) | PN-59: revisar el estado, reenviar, cambiar el correo; cerrar sesión |
| `sin_autorizacion` | cuenta con el correo **verificado**, aunque no haya autorizado lo necesario | cerrar sesión y las acciones de PN-63 y PN-64 (US-50) |
| `requiere_autorizacion` | cuenta verificada y con las finalidades necesarias de su etapa **autorizadas** (`ReglaDeFinalidades`) | todo lo demás |

| Sujeto → | sin sesión | limitada o de mentira | verificada sin autorizar | autorizada |
|---|---|---|---|---|
| `publica` | 200 | 200 | 200 | 200 |
| `sin_verificar` | 401 `sin_sesion` | 200 | 200 | 200 |
| `sin_autorizacion` | 401 `sin_sesion` | 403 `verificacion_pendiente` | 200 | 200 |
| `requiere_autorizacion` | 401 `sin_sesion` | 403 `verificacion_pendiente` | 403 `autorizacion_pendiente` | 200 |

- **Un nivel más bajo no hereda las rutas de uno más alto.** Lo contrario sí: una cuenta ya verificada sigue pudiendo *revisar el estado* en PN-59 (si abrió el enlace en otro dispositivo, «Ya lo confirmé» debe poder contestar «verificado» con la misma sesión).
- Sin sesión: `401 {"error":"sin_sesion"}` y evento `error_autorizacion`. Con sesión que no alcanza el nivel: `403` con `verificacion_pendiente` o `autorizacion_pendiente` y evento `acceso_denegado` con la cuenta (la sesión de mentira queda como `desconocida`). Si falla la resolución de la sesión, `500`: ante la duda no pasa.
- **`seguridad.Sujeto`** (`Persona`, `Verificada`, `Autorizada`, `Senuelo`) lo arma quien implementa `servidor.Sesiones` (la interfaz `SujetoDe(r)` que resuelve la sesión; el almacén llega en el PR 1c) y el `Enrutador` lo deja en el contexto (`servidor.SujetoDe`). La sesión de mentira de D-141 se trata como la limitada real en todas las rutas, diga lo que diga el resto de sus campos.
- **Prueba por ruta** (`internal/servidor/accesotest`): `ProbarRutas` recorre las rutas registradas y, para cada una y cada clase de Sujeto, comprueba el estado, el código de error y el evento de seguridad de la tabla de arriba. Una ruta nueva entra sola. `TestTodaRutaDeAPITieneSuNivelDeclarado` (`cmd/api`) es además el inventario de rutas: una ruta nueva obliga a añadirla con su nivel.

### Finalidades necesarias por etapa del titular (`cuenta.ReglaDeFinalidades`, D-139)

`0002_catalogo.sql` tiene tres finalidades necesarias y activas, pero a cada persona solo le tocan algunas. La regla está en un solo lugar (`internal/cuenta/finalidades.go`) y según la etapa del **titular** (de quién son los datos; `autorizacion` separa `titular_id` de `otorgante_id`):

| Etapa del titular | Finalidades necesarias | Quién las otorga |
|---|---|---|
| adulta | `cuenta_y_acceso`, `funciones_financieras` | el titular mismo (`otorgante_id = titular_id`, PN-64) |
| menor | `cuenta_del_menor` | su tutor (PN-36) |
| a los 18 años (pasa a `adulta`) | la lista de adulto | la persona (PN-54), sin `cuenta_del_menor` |

Las accesorias (`avisos`, `horas_de_vida`, `correo_del_menor`) y `transferencia` (inactiva) no entran. `Cumple(etapa, titular, vigentes, tutores)` dice si se cumple; una etapa desconocida no cumple. **Prueba guardiana** (`TestElCatalogoNoTieneNecesariasSinClasificar`): lee las finalidades del INSERT de `0002_catalogo.sql` (la migración embebida, la misma que se aplica a la base) y falla si hay una necesaria y activa que la regla no clasifica; la prueba inversa falla si la regla exige un código que el catálogo no tiene como necesario y activo.

## Seguridad (`internal/seguridad`, US-49)

Lo que no depende de ningún módulo de negocio (E12 §5.9).

### Eventos de seguridad (RNF-025, E17-VTE 2.1)

Una línea JSON de `slog` por evento (`seguridad.Registro`), nivel `WARN`, `msg` «evento de seguridad», con estos campos y ninguno más: `time` (siempre en UTC: `nuevoRegistro` de `cmd/api`), `level`, `msg`, `evento_seguridad` (`inicio_sesion_fallido`, `acceso_denegado` o `error_autorizacion`), `cuenta` (uuid o `desconocida`), `ruta` (el patrón de `Request.Pattern`, sin valores), `codigo` (HTTP) y `peticion`. **No hay origen ni IP** (D-123), ni contraseñas, tokens, correos o cuerpos. El `peticion` es de 16 bytes aleatorios en hexadecimal; nunca se acepta el que mande el cliente.

### Tokens opacos (D-081)

`NuevoTokenOpaco` da 32 bytes de `crypto/rand` en base64 de URL sin relleno y su SHA-256, que es lo único que llega a la base. `HuellaDeToken` rechaza, sin tocar la base, lo que no decodifica a 32 bytes.

### Límites de intentos (`LimitadorDeIntentos`, RNF-014)

Es una **espera, no un bloqueo**: cada intento cuenta durante su ventana (deslizante) y deja de contar al cumplirla. Los contadores viven **solo en la memoria del API** (D-123): se reinician con él y no se comparten entre réplicas. La hora sale del `Reloj` inyectado (`internal/reloj`), así que las pruebas la adelantan sin esperar. Lo vencido se borra al tocar la clave y en un barrido cada minuto, y cada clave guarda a lo sumo tantos instantes como su límite, así que la memoria está acotada. Las cuentas, los correos y los orígenes se guardan como SHA-256, no en claro.

| Qué | Por cuenta o dirección | Por origen | Ventana | Decisión |
|---|---|---|---|---|
| Inicio de sesión (cuenta los **fallos**) | 5 | 20 | 15 minutos | D-136 |
| Pedido del enlace de recuperación | 3 | 20 | 1 hora | D-136 (4) |
| Reenvío del correo de verificación y cambio de correo (contador propio) | 3 | 20 | 1 hora | D-138 (2) |
| Crear una cuenta (cuenta **todos** los intentos) | — | 20 | 1 hora | D-140 (1) |
| Correos a una misma dirección (verificación, reenvíos y aviso de D-141), desde cualquier origen | 3 | — | 1 hora | D-140 (2) |

- `PermitirIngreso` no cuenta: lo que cuenta es cada fallo (`RegistrarFalloDeIngreso`). Mientras dura la espera responde que no aunque la contraseña sea la correcta.
- Un pedido frenado no cuenta: la espera termina a la hora del primero, por mucho que se insista.
- El límite de la cuenta y el del origen se aplican juntos y solo cuenta si pasan los dos.
- **Origen:** lo decide quien llama; hoy es la dirección de la conexión. Detrás de Azure Container Apps todos llegarían con la dirección de su entrada y el límite por origen sería de todos juntos: se confiará solo en la dirección que agregue esa entrada (fila 17 del primer despliegue, D-143 (4)). No se lee `X-Forwarded-For` mientras tanto.
- Quien llama responde igual al cliente cuando no envía un correo por el límite de la dirección: el cliente no debe poder saberlo.

### Política de contraseñas (`PoliticaDeContrasena`, RF-035, D-089, D-142)

15 caracteres o más (se cuentan caracteres Unicode, no bytes), **sin reglas de composición** y sin recortar espacios. No consulta ningún servicio externo de contraseñas filtradas (E11-EIP). Todo se compara sin distinguir mayúsculas ni tildes («Contraseña» es «contrasena»). `Validar(contrasena, correo, usuario)` devuelve el primer error de esta lista:

| Código para el cliente | Error | Cuándo | Texto de E14-PCP (lo pone el cliente) |
|---|---|---|---|
| `contrasena_vacia` | `ErrContrasenaVacia` | no hay nada | «Falta la contraseña.» |
| `contrasena_corta` | `ErrContrasenaCorta` | menos de 15 caracteres | «Falta que la contraseña tenga al menos 15 caracteres.» |
| `contrasena_personal` | `ErrContrasenaPersonal` | contiene la parte local del correo (si tiene 4 caracteres o más), el nombre de usuario (ídem) o «alcanzamos» | «Falta una contraseña que no incluya tu correo ni el nombre de la app.» (propuesto, lo revisa el dueño) |
| `contrasena_comun` | `ErrContrasenaComun` | está en la lista de SecLists o en la propia; son todos los caracteres iguales o un bloque de hasta 4 repetido de punta a punta (`aaaaaaaaaaaaaaa`, `abababababababab`); es una secuencia de punta a punta, ascendente o descendente (`123456789012345`, `abcdefghijklmno`); o es un tramo seguido de las filas de un teclado en español, en cualquier sentido (`qwertyuiopasdfg`, `asdfghjklñzxcvb`) | «Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.» |

Una prueba por regla en `contrasena_test.go`. Las reglas miran la contraseña entera: una secuencia o una repetición dentro de una frase más larga no se rechaza.

- **Lista de SecLists** (`datos/contrasenas_comunes.txt`): [SecLists](https://github.com/danielmiessler/SecLists) (MIT), `xato-net-10-million-passwords-1000000.txt` en el commit `4c0fd59432ab8508edc23b3c880127edb12e34d5` (2026-10-22), filtrada a las 10.908 entradas de 15 o más caracteres. URL exacta, hashes, filtro y licencia están en `internal/seguridad/datos/` (`README.md` y `LICENCIA-SecLists.txt`). Licencia MIT, compatible con la AGPLv3.
- **Lista propia en español** (`datos/contrasenas_comunes_es.txt`, AGPL-3.0-only): 502 entradas de 15 o más caracteres con frases y patrones de Colombia («contraseña», «teamo», «tequiero», ciudades, equipos) pegados a números y años. Sin datos filtrados. La genera [`datos/generar_es.go`](internal/seguridad/datos/generar_es.go) (`go run generar_es.go > contrasenas_comunes_es.txt`); **el dueño la revisa antes de fusionar**. Detalle en `datos/README.md`.

### Correo (`internal/correo`)

SMTP de la biblioteca estándar; texto plano en español. Los dos correos (el de verificación y el aviso de D-141, E14-PCP 4.2 bis) terminan **exactamente** con «Si tienes dudas sobre tus datos, escribe a <CORREO_PRIVACIDAD>.» (D-143); una prueba compara el texto en los dos. El puerto `Correo` tiene un `Falso` para las pruebas. Nunca se registra el token, la dirección ni el cuerpo.

## Imagen

- Tres etapas: `node:24.22.1-alpine3.24` (digest `sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53`, índice multiarquitectura, resuelto el 2026-10-22; mismo Node que `.azure-pipelines/web.yml`) hace `npm ci` y `npm run build` en `web/` (necesita `diseno/`); `golang:1.27.3-alpine3.24` (digest `sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c`, índice multiarquitectura, resuelto el 2026-10-22) copia ese `web/dist` a `internal/web/estatico/` y compila un binario estático con la web embebida; `gcr.io/distroless/static-debian13:nonroot` lo ejecuta, fijada por digest `sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88` (índice multiarquitectura, resuelto el 2026-10-22).
- El contexto es la raíz del monorepo; el `.dockerignore` de la raíz deja pasar solo `api/`, `web/` y `diseno/`.
- Distroless no trae shell, así que no hay `HEALTHCHECK` ni comandos en forma de shell; la salud se consulta por `/salud` desde fuera.
- Corre como usuario 65532 (nonroot), sin root. El `ENTRYPOINT` es el binario.
- Go 1.27.3 (go.dev, 2026-10-22; SHA-256 del tarball `65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40`, fijado en `.azure-pipelines/api.yml`).

## Base de datos y migraciones

- `pgx` v5 (`pgxpool`) conecta con PostgreSQL. La URL sale de `BASE_DE_DATOS_URL`.
- `goose` v3 se usa como biblioteca. Las migraciones van embebidas en el binario (`embed`).
- `api migrar` aplica las migraciones pendientes y termina.
- `0001_esquema_inicial.sql` y `0002_catalogo.sql` son copia idéntica de las de E13 (D-122). No se editan aquí. Si hay que cambiar algo, el cambio vuelve primero a E13, con nota fechada y versión nueva.

| Archivo | SHA-256 (igual en E13 y aquí) |
|---|---|
| `migraciones/0001_esquema_inicial.sql` | `1244bc98f8218c202851a2a7cc18ae212b0c5a316d9238220e55ff48f351ab30` |
| `migraciones/0002_catalogo.sql` | `f95c1a03e3a956cec11b448d913ebb79df5c96c72f1e475b446a35566c36de3b` |

Prueba de integración (PostgreSQL 18 del compose local; deja la base sin tablas):

```sh
POSTGRES_PORT=55432 docker compose -f infra/local/compose.yaml --env-file infra/local/.env.example up -d --wait postgres
cd api
BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@127.0.0.1:55432/alcanzamos go test -race -tags integration ./...
docker compose -f ../infra/local/compose.yaml --env-file ../infra/local/.env.example down -v
```

## Dependencias

Últimas versiones estables, verificadas en `proxy.golang.org` el 2026-10-22.

| Módulo | Versión | Licencia |
|---|---|---|
| `github.com/jackc/pgx/v5` | v5.11.0 (2026-09-07) | MIT |
| `github.com/pressly/goose/v3` | v3.29.0 (2026-10-11) | MIT |
| `golang.org/x/crypto` | v0.58.0 (2026-10-09) | BSD de 3 cláusulas |

Indirectas: `pgpassfile`, `pgservicefile`, `puddle/v2`, `mfridman/interpolate`, `multierr` (MIT), `go-retry` (Apache-2.0), `x/sync` y `x/text` (BSD de 3 cláusulas). Todas son compatibles con la AGPLv3.

## Contraseñas (Argon2id)

- Paquete `internal/argon2id`, sobre `golang.org/x/crypto/argon2`. Aún nadie lo usa: lo usa la creación de la cuenta (PR 5 de la US-49). La política de contraseñas está en [Seguridad](#política-de-contraseñas-politicadecontrasena-rf-035-d-089-d-142).
- Parámetros OWASP: 19 MiB, 2 iteraciones, paralelismo 1. Sal de 16 bytes, clave de 32.
- Formato PHC: `$argon2id$v=19$m=19456,t=2,p=1$<sal>$<clave>`, base64 sin relleno.
- `Verificar` lee los parámetros del hash y compara en tiempo constante. Rechaza hashes con parámetros fuera de tope (memoria máxima 256 MiB).
- Un semáforo limita a 4 las operaciones simultáneas.
- Pruebas con los vectores Argon2id de la implementación de referencia (D-083): `src/test.c` de `P-H-C/phc-winner-argon2`, commit `92cd2e19b50b9a58d177e61e1d8ce925315d3d91` (último cambio del archivo; HEAD de `master` `f57e61e19229e23c4445b85494dbf7c07de721cb`, 2021-06-25). Los 8 vectores del bloque Argon2id no usan secreto ni datos asociados, así que aplican todos.
- Benchmark de una verificación: `go test -bench Verificar -run '^$' ./internal/argon2id`.

## Tareas programadas

- `api tareas` es el punto de entrada del trabajo programado. No tiene tareas reales: las tareas son de I05.
- Se conecta con PostgreSQL, registra `tareas: inicio` y `tareas: fin`, y termina con código 0. Sin base alcanzable, termina con código 1.
- Se prueba con la misma imagen del API:

```sh
docker run --rm --network alcanzamos-local_default \
  -e BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@postgres:5432/alcanzamos \
  alcanzamos-api:dev tareas
```

La imagen es la misma, con la web incluida.

## Medición de O-10

Método y cifras en [`MEDICION-O10.md`](MEDICION-O10.md).
