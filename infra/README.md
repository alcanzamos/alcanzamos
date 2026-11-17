# infra/

Infraestructura como código con OpenTofu (MPL 2.0), sin secretos (ADR-001, ADR-006). Región México Central.

- Nunca van aquí: secretos, `.env`, estado de OpenTofu, volcados de base de datos ni datos de personas reales.
- Reglas: estándar de codificación (E17-ECO) y revisión con `gitleaks`.

| Carpeta | Qué es | Se aplica |
|---|---|---|
| [`local/`](local/README.md) | Ambiente de desarrollo en Docker: PostgreSQL 18 y Mailpit | En el equipo del dueño |
| [`bootstrap/`](bootstrap/README.md) | Grupo, proveedores, estado remoto e identidades, por ambiente | Una vez por ambiente, con la cuenta del dueño, antes de su primer despliegue |
| [`azure/`](azure/README.md) | Recursos de UAT y de producción: el mismo código con los parámetros de cada ambiente | En el primer despliegue de cada ambiente, desde el pipeline |

## Ambientes (D-200 (8))

| Ambiente | Dónde | Datos | Código | Variables y estado |
|---|---|---|---|---|
| Desarrollo | Local, en Docker | Sintéticos; ningún correo sale del equipo | `local/` | `local/.env` |
| UAT | Suscripción de Azure for Students | Financieros inventados; solo las cuentas y los buzones del dueño | `bootstrap/` y `azure/` con `ambiente = "uat"` | `azure/uat.tfvars`; estado `uat.tfstate` en `stalcanzamostfuatmxc` |
| Producción | Suscripción de pago por uso (D-200 (7)) | Reales | `bootstrap/` y `azure/` con `ambiente = "produccion"` | `azure/produccion.tfvars`; estado `produccion.tfstate` en `stalcanzamostfmxc` |

UAT y producción usan el mismo código de `azure/`, sin copiar la carpeta: solo cambian la suscripción, los nombres, el dominio de correo y, si hace falta, los tamaños. Los nombres de cada ambiente, el plan y el backend están en [`azure/README.md`](azure/README.md).

| Recurso | Producción | UAT |
|---|---|---|
| Grupo | `rg-alcanzamos-prod-mxc` | `rg-alcanzamos-uat-mxc` |
| Estado remoto | `stalcanzamostfmxc` | `stalcanzamostfuatmxc` |
| Identidad del API | `id-alcanzamos-prod-mxc` | `id-alcanzamos-uat-mxc` |
| Conexión de servicio | `sc-alcanzamos-prod-mxc` | `sc-alcanzamos-uat-mxc` |
| Resto de los recursos | `<tipo>-alcanzamos-prod-mxc` | `<tipo>-alcanzamos-uat-mxc` |
| Dominio de correo | `avisos.alcanzamos.co` | `avisos-uat.alcanzamos.co` |

Hasta el primer despliegue de cada ambiente, nada de esto se aplica en Azure (D-119). El pipeline `infra` solo valida.
