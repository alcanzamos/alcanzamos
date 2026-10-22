# infra/

Infraestructura como código con OpenTofu (MPL 2.0), sin secretos (ADR-001, ADR-006). Región México Central.

- Nunca van aquí: secretos, `.env`, estado de OpenTofu, volcados de base de datos ni datos de personas reales.
- Reglas: estándar de codificación (E17-ECO) y revisión con `gitleaks`.

| Carpeta | Qué es | Se aplica |
|---|---|---|
| [`local/`](local/README.md) | Ambiente de desarrollo en Docker: PostgreSQL 18 y Mailpit | En el equipo del dueño |
| [`bootstrap/`](bootstrap/README.md) | Grupo, proveedores, estado remoto e identidades | Una vez, con la cuenta del dueño, en el primer despliegue |
| [`produccion/`](produccion/README.md) | Recursos de producción | En el primer despliegue, desde el pipeline |

Hasta el primer despliegue a producción, nada de esto se aplica en Azure (D-119). El pipeline `infra` solo valida.
