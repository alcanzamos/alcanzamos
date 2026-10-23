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

## Seguridad (`internal/seguridad`, US-49)

Lo que no depende de ningún módulo de negocio (E12 §5.9). Los límites de intentos y la política de contraseñas llegan en el PR 2.

### Eventos de seguridad (RNF-025, E17-VTE 2.1)

Una línea JSON de `slog` por evento (`seguridad.Registro`), nivel `WARN`, `msg` «evento de seguridad», con estos campos y ninguno más: `time` (siempre en UTC: `nuevoRegistro` de `cmd/api`), `level`, `msg`, `evento_seguridad` (`inicio_sesion_fallido`, `acceso_denegado` o `error_autorizacion`), `cuenta` (uuid o `desconocida`), `ruta` (el patrón de `Request.Pattern`, sin valores), `codigo` (HTTP) y `peticion`. **No hay origen ni IP** (D-123), ni contraseñas, tokens, correos o cuerpos. El `peticion` es de 16 bytes aleatorios en hexadecimal; nunca se acepta el que mande el cliente.

### Tokens opacos (D-081)

`NuevoTokenOpaco` da 32 bytes de `crypto/rand` en base64 de URL sin relleno y su SHA-256, que es lo único que llega a la base. `HuellaDeToken` rechaza, sin tocar la base, lo que no decodifica a 32 bytes.

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

- Paquete `internal/argon2id`, sobre `golang.org/x/crypto/argon2`. Aún nadie lo usa: los endpoints de dominio son de I05.
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
