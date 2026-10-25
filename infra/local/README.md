# infra/local/

Ambiente de desarrollo en el equipo del dueño, con Docker (D-080, D-119). En Azure solo vive producción.

Solo se usan datos sintéticos. Ningún correo sale del equipo.

## Qué trae

| Servicio | Imagen | Para qué | Puerto (solo `127.0.0.1`) |
|---|---|---|---|
| `postgres` | `postgres:18.6-alpine` | Base de datos, la misma versión mayor que producción (18) | 5432 |
| `mailpit` | `axllent/mailpit:v1.31.6` | Correo de prueba: verificación de cuenta, recuperación y avisos al tutor | SMTP 1025, web 8025 |

Mailpit recibe todo y no reenvía nada: no tiene configurado ningún servidor de salida.

## Uso

1. Copia `.env.example` como `.env`. Los valores son locales, no secretos.
2. Arranca: `docker compose -f infra/local/compose.yaml --env-file infra/local/.env up -d --wait`.
3. Mira los correos en `http://127.0.0.1:8025`.
4. Detén: `docker compose -f infra/local/compose.yaml --env-file infra/local/.env down`.
5. Para empezar de cero, borra también los datos: agrega `-v` al comando anterior.

## Cómo se conecta el API

- Base de datos: `postgres://alcanzamos:solo-local@127.0.0.1:5432/alcanzamos?sslmode=disable`. En local no hay TLS; en producción es obligatorio.
- Correo: SMTP en `127.0.0.1:1025`, sin autenticación ni TLS. En producción el correo sale por Azure Communication Services (D-113).

El API lee estos valores de variables de entorno (`BASE_DE_DATOS_URL`, `CORREO_SMTP` y las demás de la tabla «Configuración» de [`api/README.md`](../../api/README.md)); los ejemplos locales de esa tabla coinciden con este ambiente.

## Versiones

Consultadas el 2026-10-22:

- PostgreSQL 18.6: etiquetas de la imagen oficial en `https://hub.docker.com/_/postgres`.
- Mailpit v1.31.6 (publicada el 2026-10-15): `https://github.com/axllent/mailpit/releases`.

## Verificación hecha (2026-10-22)

- `select version()` devolvió `PostgreSQL 18.6 on x86_64-pc-linux-musl`.
- Un correo enviado por SMTP a `127.0.0.1:1025` apareció en `GET /api/v1/messages` de Mailpit.
