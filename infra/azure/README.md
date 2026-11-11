# infra/azure/

UAT y producción en Azure con OpenTofu (D-112, D-119, D-200 (8)). **Se valida en cada PR y no se aplica hasta el primer despliegue de cada ambiente.**

Es el mismo código para los dos ambientes, sin copiar la carpeta: solo cambian los parámetros (la suscripción, los nombres, el dominio de correo y, si hace falta, los tamaños). Antes se llamaba `infra/produccion/` (renombrada en la US-79, S7).

| Ambiente | Suscripción | Datos | Variables |
|---|---|---|---|
| `uat` | Azure for Students | Financieros inventados; solo las cuentas y los buzones del dueño | [`uat.tfvars.example`](uat.tfvars.example) |
| `produccion` | Pago por uso (D-200 (7)) | Reales | [`produccion.tfvars.example`](produccion.tfvars.example) |

El desarrollo sigue en local ([`infra/local/`](../local/README.md)).

## Qué crea

| Recurso | Producción (O-14) | UAT | Notas |
|---|---|---|---|
| Log Analytics | `log-alcanzamos-prod-mxc` | `log-alcanzamos-uat-mxc` | Registros de Container Apps y eventos de seguridad; 90 días en producción (RNF-025) y 30 en UAT (S11) |
| Key Vault Standard | `kv-alcanzamos-prod-mxc` | `kv-alcanzamos-uat-mxc` | Permisos por RBAC; protección contra purga en los dos ambientes; se recupera 90 días después de eliminarlo en producción y 7 en UAT (S11). Nombre único en todo Azure, de 3 a 24 caracteres (21 y 20) |
| PostgreSQL flexible 18 | `psql-alcanzamos-prod-mxc` | `psql-alcanzamos-uat-mxc` | B1ms, 32 GiB (ADR-006 §5.2). Solo Entra ID, sin contraseñas; TLS obligatorio. Nombre único en todo Azure |
| Entorno de Container Apps | `cae-alcanzamos-prod-mxc` | `cae-alcanzamos-uat-mxc` | Consumo |
| App del API | `ca-api-alcanzamos-prod-mxc` | `ca-api-alcanzamos-uat-mxc` | 0,25 vCPU, 0,5 GiB, réplica mínima 1 en producción y 0 en UAT (S11). Hasta 32 caracteres (26 y 25) |
| Trabajo programado | `caj-tareas-alcanzamos-prod-mxc` | `caj-tareas-alcanzamos-uat-mxc` | Misma imagen, comando `tareas`, cada 15 minutos (UTC). Hasta 32 caracteres (30 y 29) |
| Servicio de correo | `ecs-alcanzamos-prod-mxc` | `ecs-alcanzamos-uat-mxc` | Datos en Francia (D-113) |
| Dominio de correo | `avisos.alcanzamos.co` | `avisos-uat.alcanzamos.co` | Administrado por el cliente; remitente `no-responder@<dominio>` (D-120). Un dominio pertenece a un solo servicio de correo: cada ambiente tiene el suyo (D-200 (8), S5) |
| Communication Services | `acs-alcanzamos-prod-mxc` | `acs-alcanzamos-uat-mxc` | Datos en Francia. Nombre único en todo Azure |
| Grupo de acciones y alerta | `ag-seguridad-alcanzamos-prod-mxc`, `alrt-seguridad-alcanzamos-prod-mxc` | `ag-seguridad-alcanzamos-uat-mxc`, `alrt-seguridad-alcanzamos-uat-mxc` | RNF-025: más de 10 eventos de un mismo tipo en 15 minutos, aviso a `andres@alcanzamos.co` (O-5, D-120), el mismo correo en los dos ambientes (S11) |

El grupo (`rg-alcanzamos-<prod|uat>-mxc`), la identidad del API (`id-alcanzamos-<prod|uat>-mxc`) y sus roles los crea [`infra/bootstrap/`](../bootstrap/README.md), una vez por ambiente.

Los nombres siguen las abreviaturas de Microsoft Cloud Adoption Framework: tipo, proyecto, ambiente (`prod` o `uat`) y región (`mxc`, México Central). Los de producción están **aprobados por el dueño (O-14, D-120)** y no cambian. Los de UAT siguen la misma regla. Nunca se reutilizan los de la prueba R-9. Todos los recursos llevan las etiquetas `proyecto`, `ambiente` (`uat` o `produccion`) y `origen`.

## Parámetros

Se declaran en `ambiente.tf` (más `subscription_id` e `imagen_api` en `variables.tf`).

| Variable | Producción | UAT | Notas |
|---|---|---|---|
| `ambiente` | `produccion` | `uat` | Solo esos dos valores. Forma los nombres y la etiqueta `ambiente` |
| `subscription_id` | Pago por uso | Azure for Students | Sin valor por defecto |
| `dominio_de_correo` | `avisos.alcanzamos.co` | `avisos-uat.alcanzamos.co` | Se rechaza el de producción en UAT y otro en producción |
| `imagen_api` | El digest probado en UAT | El digest que construye el pipeline | La pasa el pipeline de despliegue; `latest` se rechaza |
| `postgres_sku`, `postgres_almacenamiento_mb` | `B_Standard_B1ms`, `32768` | Igual | Por defecto, los de producción (ADR-006 §5.2) |
| `contenedor_cpu`, `contenedor_memoria` | `0.25`, `0.5Gi` | Igual | API y trabajo programado |
| `api_replicas_minimas` | `1` | `0` | Con `0` el API se apaga sin tráfico y el primer pedido espera el arranque |
| `registros_dias_de_retencion` | `90` | `30` | RNF-025 en producción. 30 es el mínimo de Log Analytics con `PerGB2018` |
| `secretos_dias_de_retencion` | `90` | `7` | Días para recuperar el Key Vault eliminado; de 7 a 90 (el rango de Azure). La protección contra purga sigue activa en los dos |

UAT usa los mismos tamaños que producción para que el paso a producción sea transparente; se cambian solo si hace falta (D-200 (8)). Las tres diferencias de la tabla (réplicas, registros y Key Vault) las decidió el dueño (S11) y están en `uat.tfvars.example`. Las alertas van al mismo correo en los dos ambientes.

### PostgreSQL de UAT se puede detener cuando no se usa

Para cuidar el crédito de Azure for Students, el servidor de UAT se detiene a mano cuando no se usa y se arranca antes de probar (S11). OpenTofu no lo detiene ni lo arranca:

```sh
az postgres flexible-server stop --resource-group rg-alcanzamos-uat-mxc --name psql-alcanzamos-uat-mxc
az postgres flexible-server start --resource-group rg-alcanzamos-uat-mxc --name psql-alcanzamos-uat-mxc
```

Azure arranca solo un servidor detenido a los 7 días (Microsoft Learn, «Limits in Azure Database for PostgreSQL flexible server», consultado el 2026-11-10): si UAT sigue sin usarse, hay que detenerlo de nuevo.

## Estado de cada ambiente

Cada ambiente tiene su propio estado remoto, en su propia suscripción: el bootstrap de cada ambiente crea una cuenta de almacenamiento con el contenedor `tfstate`, y la clave del estado es `<ambiente>.tfstate`. El bloque `backend "azurerm" {}` de `versiones.tf` queda vacío y los valores se pasan con `-backend-config` al iniciar. No son secretos (nombres y el ID de la suscripción), pero no se guardan en archivos del repositorio. La salida `backend` del bootstrap da los nombres y la clave.

| Ambiente | `resource_group_name` | `storage_account_name` | `container_name` | `key` |
|---|---|---|---|---|
| `produccion` | `rg-alcanzamos-prod-mxc` | `stalcanzamostfmxc` | `tfstate` | `produccion.tfstate` |
| `uat` | `rg-alcanzamos-uat-mxc` | `stalcanzamostfuatmxc` | `tfstate` | `uat.tfstate` |

Plan de un ambiente (ejemplo de UAT; para producción, cambian los valores de la tabla y el archivo de variables). Lo correrá el pipeline de despliegue de la US-79, con la conexión de servicio federada de cada ambiente:

```sh
cd infra/azure
cp uat.tfvars.example uat.tfvars          # y completar; nunca se sube
export TF_DATA_DIR=.terraform/uat         # una carpeta de trabajo por ambiente: los dos backends no se mezclan
tofu init -reconfigure \
  -backend-config="resource_group_name=rg-alcanzamos-uat-mxc" \
  -backend-config="storage_account_name=stalcanzamostfuatmxc" \
  -backend-config="container_name=tfstate" \
  -backend-config="key=uat.tfstate" \
  -backend-config="use_azuread_auth=true" \
  -backend-config="subscription_id=<suscripción de UAT>"
tofu plan -var-file=uat.tfvars -var="imagen_api=ghcr.io/alcanzamos/alcanzamos-api@sha256:<digest>"
```

Con `-reconfigure`, OpenTofu toma el backend nuevo sin copiar el estado del anterior. Las variables (`-var-file`) y el backend (`-backend-config`) tienen que ser del mismo ambiente.

## Decisiones de seguridad

- Sin secretos en el repositorio. El estado de OpenTofu va en Azure Storage, con Entra ID y sin claves compartidas.
- El API entra a PostgreSQL, Key Vault y el correo con su identidad administrada, sin contraseñas ni claves.
- PostgreSQL admite conexiones solo desde servicios de Azure (regla `0.0.0.0`), porque Container Apps de consumo no tiene una IP de salida fija. Esa regla deja pasar servicios de otros clientes de Azure. Lo compensan la autenticación solo con Entra ID y TLS obligatorio. Si el riesgo no se acepta, la alternativa es una red virtual, que cuesta más (ADR-006).
- El API escucha en el puerto 8080 (`ENV PUERTO=8080` y `EXPOSE 8080` en `api/Dockerfile`).
- OpenTofu no administra el DNS. La salida `registros_dns_de_avisos` lista los registros que el dueño carga en Cloudflare para el dominio del ambiente (E17-CCO §10.6).
- La alerta cuenta por tipo de evento (E11-DAR §7): la consulta agrupa por la dimensión `tipo`, y el umbral vale para cada tipo por separado.
- La imagen del API no tiene valor por defecto. La pasa el pipeline de despliegue, con versión o digest; `latest` se rechaza.
- Cada correo dice dónde escribir: `privacidad@alcanzamos.co` (RF-060). Es la condición del remitente (D-120) y los correos del API ya lo cumplen (ver «Correo» en [`api/README.md`](../../api/README.md)).

## Antes del primer despliegue (D-120)

No bloquean la US-44.

1. **Red de PostgreSQL.** Llevar el riesgo de la regla `0.0.0.0` a E11-EIP y calcular, con fuente, el costo de la red virtual. Lo decide el dueño antes de crear el servidor: esa elección no se cambia después en el mismo servidor.
2. **Rol mínimo para enviar correo** en lugar de «Communication and Email Service Owner» sobre todo el grupo. Se define en la US-45.
3. **Comprobar con `list-skus`** que PostgreSQL 18 y la zona 1 existen en México Central, en cada suscripción: las cuotas y los servicios de la región se comparan al desplegar UAT (D-200 (8)). La zona de PostgreSQL y el tenant de Entra ID de la suscripción de UAT se comprueban al desplegar (S11; US-79 T5 y T6).
4. **Costos en ADR-006:** Communication Services, la regla de alerta y la retención de 90 días.
5. **Probar que el aviso de la alerta llega** a `andres@alcanzamos.co` (O-5).
6. **Variables de la base (D-123).** La configuración pasa `PGHOST`, `PGDATABASE`, `PGUSER` y `PGSSLMODE`, pero el API lee `BASE_DE_DATOS_URL`. Se resuelve en I05, con la conexión por Entra ID.

## Registro de eventos de seguridad

- El campo con el tipo de evento se llama `evento_seguridad`; la alerta depende de ese nombre. El API ya lo escribe así (`api/README.md`, «Eventos de seguridad»).
- E11-DAR §7 habla de un «contador por origen», pero el registro del API **no incluye origen ni IP** (D-123; `api/README.md`): sigue sin ser un dato personal (NM-03).

## Versiones

Consultadas el 2026-10-22:

- OpenTofu 1.13.2 (publicada el 2026-10-21): `https://github.com/opentofu/opentofu/releases`.
- Proveedor `hashicorp/azurerm` 5.11.0 (2026-10-23): `https://github.com/hashicorp/terraform-provider-azurerm/releases`. Desde la versión 5 no registra proveedores de recursos por su cuenta.
- Proveedor `hashicorp/azuread` 3.10.0 (2026-09-24), solo en `bootstrap`.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con el proveedor simulado (`tests/ambientes.tftest.hcl`): comprueba los nombres, las etiquetas, los tamaños y el dominio de correo de cada ambiente, los valores de UAT (S11), que producción conserve sus nombres y que se rechacen un ambiente desconocido, un dominio de otro ambiente y una retención del Key Vault fuera de 7 a 90 días.

```sh
cd infra/azure
tofu init -backend=false
tofu validate
tofu test
tofu fmt -check -recursive ..
```
