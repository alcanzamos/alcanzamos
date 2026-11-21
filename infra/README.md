# infra/

Infraestructura como código con OpenTofu (MPL 2.0), sin secretos (ADR-001, ADR-006). Región East US 2 (D-208).

- Nunca van aquí: secretos, `.env`, estado de OpenTofu, volcados de base de datos ni datos de personas reales.
- Reglas: estándar de codificación (E17-ECO) y revisión con `gitleaks`.

| Carpeta | Qué es | Se aplica |
|---|---|---|
| [`local/`](local/README.md) | Ambiente de desarrollo en Docker: PostgreSQL 18 y Mailpit | En el equipo del dueño |
| [`suscripcion/`](suscripcion/README.md) | Lo de toda la suscripción: registro de proveedores, política P1 (regiones y etiquetas) y presupuestos | **Una sola vez, el dueño, primero** (D-205 (11)); estado local del dueño |
| [`bootstrap/`](bootstrap/README.md) | Grupo, estado remoto, identidades del pipeline y de carga, por ambiente (sin registrar proveedores) | Una vez por ambiente, con la cuenta del dueño, después de `suscripcion/` y antes de su primer despliegue |
| [`secretos/`](secretos/README.md) | «Key Vault Secrets User» sobre cada secreto, para cada identidad que lo lee, y «Key Vault Secrets Officer» del dueño sobre el Key Vault para cargar y rotar los secretos (E11-INF 2.14, segundo paso del bootstrap). No lee valores | Una vez por ambiente, el dueño, después de crear el Key Vault con `azure/` y antes del `apply` completo de `azure/` |
| [`azure/`](azure/README.md) | Recursos de UAT y de producción: el mismo código con los parámetros de cada ambiente | La primera vez de cada ambiente, **el dueño a mano** (primero solo el Key Vault, después completo); después, el despliegue por etiqueta |

## Ambientes (D-200 (8))

| Ambiente | Dónde | Datos | Código | Variables y estado |
|---|---|---|---|---|
| Desarrollo | Local, en Docker | Sintéticos; ningún correo sale del equipo | `local/` | `local/.env` |
| UAT | Suscripción de pago por uso, la misma que producción (D-205 (11)) | Financieros inventados; solo las cuentas y los buzones del dueño | `bootstrap/` y `azure/` con `ambiente = "uat"` | `azure/uat.tfvars`; estado `uat.tfstate` en `stalcanzamostfuateus2` |
| Producción | Suscripción de pago por uso | Reales | `bootstrap/` y `azure/` con `ambiente = "produccion"` | `azure/produccion.tfvars`; estado `produccion.tfstate` en `stalcanzamostfeus2` |

UAT y producción usan el mismo código de `azure/`, sin copiar la carpeta: solo cambian la suscripción, los nombres, el dominio de correo y, si hace falta, los tamaños. Los nombres de cada ambiente, el plan y el backend están en [`azure/README.md`](azure/README.md).

| Recurso | Producción | UAT |
|---|---|---|
| Grupo | `rg-alcanzamos-prod-eus2` | `rg-alcanzamos-uat-eus2` |
| Estado remoto | `stalcanzamostfeus2` | `stalcanzamostfuateus2` |
| Identidad del pipeline | `id-alcanzamos-pipeline-prod-eus2` | `id-alcanzamos-pipeline-uat-eus2` |
| Conexión de servicio | `sc-alcanzamos-prod-eus2` | `sc-alcanzamos-uat-eus2` |
| Resto de los recursos | `<tipo>-alcanzamos-prod-eus2` | `<tipo>-alcanzamos-uat-eus2` |
| Dominio de correo | `avisos.alcanzamos.co` | `avisos-uat.alcanzamos.co` |

## Orden de aplicación

1. [`suscripcion/`](suscripcion/README.md): una sola vez, el dueño. Registra los proveedores (con la configuración del proveedor `azurerm`, no como recursos y nunca a mano), pone la política P1 y los presupuestos de la suscripción.
2. [`bootstrap/`](bootstrap/README.md): una vez por ambiente (`uat`, `produccion`), el dueño. Lleva `resource_provider_registrations = "none"`.
3. [`azure/`](azure/README.md) con `-target`, solo el Key Vault de cada ambiente: **la primera vez lo corre el dueño a mano**, con su cuenta, no el despliegue por etiqueta. Después, [`secretos/`](secretos/README.md) con `-target`, solo su rol de «Key Vault Secrets Officer», y el dueño carga los secretos. Con el firewall del Key Vault cerrado a la subred (P9), habilita su IP solo mientras carga y la quita al terminar (ver «Cargar y rotar secretos» en `secretos/`).
4. [`secretos/`](secretos/README.md) completo: una vez por ambiente, el dueño. Asigna «Key Vault Secrets User» sobre cada secreto. Container Apps resuelve las referencias al Key Vault al crear la app y el trabajo, así que este paso va antes del `apply` completo.
5. [`azure/`](azure/README.md) completo: **la primera vez de cada ambiente lo corre el dueño a mano**, con su cuenta; no es el despliegue por etiqueta. También con `resource_provider_registrations = "none"`. Los despliegues siguientes, por etiqueta, desde el pipeline.

Hasta el primer despliegue de cada ambiente, nada de esto se aplica en Azure (D-119, pausa de D-204). El pipeline `infra` solo valida.
