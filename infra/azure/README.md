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
| App del API | `ca-api-alcanzamos-prod-mxc` | `ca-api-alcanzamos-uat-mxc` | 0,25 vCPU, 0,5 GiB, réplica mínima 1 en producción y 0 en UAT (S11). Hasta 32 caracteres (26 y 25). Baja la imagen privada de ghcr.io con el token del Key Vault (ver «Acceso a la imagen privada») |
| Trabajo programado | `caj-tareas-alcanzamos-prod-mxc` | `caj-tareas-alcanzamos-uat-mxc` | Misma imagen, comando `tareas`, cada 15 minutos (UTC). Hasta 32 caracteres (30 y 29). Mismo acceso a ghcr.io que el API |
| Servicio de correo | `ecs-alcanzamos-prod-mxc` | `ecs-alcanzamos-uat-mxc` | Datos en Francia (D-113) |
| Dominio de correo | `avisos.alcanzamos.co` | `avisos-uat.alcanzamos.co` | Administrado por el cliente; remitente `no-responder@<dominio>` (D-120). Un dominio pertenece a un solo servicio de correo: cada ambiente tiene el suyo (D-200 (8), S5) |
| Communication Services | `acs-alcanzamos-prod-mxc` | `acs-alcanzamos-uat-mxc` | Datos en Francia. Nombre único en todo Azure |
| Grupo de acciones y alerta | `ag-seguridad-alcanzamos-prod-mxc`, `alrt-seguridad-alcanzamos-prod-mxc` | `ag-seguridad-alcanzamos-uat-mxc`, `alrt-seguridad-alcanzamos-uat-mxc` | RNF-025: más de 10 eventos de un mismo tipo en 15 minutos, aviso a `andres@alcanzamos.co` (O-5, D-120), el mismo correo en los dos ambientes (S11) |

El grupo (`rg-alcanzamos-<prod|uat>-mxc`), la identidad del API (`id-alcanzamos-<prod|uat>-mxc`) y sus roles los crea [`infra/bootstrap/`](../bootstrap/README.md), una vez por ambiente.

Los nombres siguen las abreviaturas de Microsoft Cloud Adoption Framework: tipo, proyecto, ambiente (`prod` o `uat`) y región (`mxc`, México Central). Los de producción están **aprobados por el dueño (O-14, D-120)** y no cambian. Los de UAT siguen la misma regla. Nunca se reutilizan los de la prueba R-9. Todos los recursos llevan las etiquetas `proyecto`, `ambiente` (`uat` o `produccion`) y `origen`.

## Parámetros

Se declaran en `ambiente.tf` (más `subscription_id`, `imagen_api` y las de ghcr.io en `variables.tf`).

| Variable | Producción | UAT | Notas |
|---|---|---|---|
| `ambiente` | `produccion` | `uat` | Solo esos dos valores. Forma los nombres y la etiqueta `ambiente` |
| `subscription_id` | Pago por uso | Azure for Students | Sin valor por defecto |
| `dominio_de_correo` | `avisos.alcanzamos.co` | `avisos-uat.alcanzamos.co` | Se rechaza el de producción en UAT y otro en producción |
| `imagen_api` | El digest probado en UAT | El digest que construye el pipeline | Solo por digest: `ghcr.io/alcanzamos/alcanzamos-api@sha256:<64 hex>` (D-200 (8)(b)). La pasa el pipeline de despliegue; una etiqueta (`:1.0.0`, `:latest`, o etiqueta y digest juntos) se rechaza |
| `ghcr_usuario` | Usuario de GitHub del token | Igual | Dueño del token `read:packages`. Sin valor por defecto; no puede ir vacío |
| `ghcr_nombre_del_secreto` | `ghcr-lectura` | Igual | Secreto del Key Vault del ambiente con el token; nombra también el secreto en Container Apps |
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
- La imagen del API no tiene valor por defecto. La pasa el pipeline de despliegue, solo por digest (D-200 (8)(b)): una etiqueta puede moverse a otra imagen, así que se rechaza en los dos ambientes.
- El paquete de ghcr.io es privado (D-200 (9)(a)). Container Apps lo baja con un token clásico `read:packages` que está en el Key Vault del ambiente y que lee con la identidad del API. El valor del token nunca pasa por OpenTofu ni por el estado.
- Cada correo dice dónde escribir: `privacidad@alcanzamos.co` (RF-060). Es la condición del remitente (D-120) y los correos del API ya lo cumplen (ver «Correo» en [`api/README.md`](../../api/README.md)).

## Acceso a la imagen privada (D-200 (9)(a))

El API y el trabajo programado tienen un bloque `registry` con `server = "ghcr.io"`, el usuario `ghcr_usuario` y la contraseña en el secreto `ghcr_nombre_del_secreto` de Container Apps. Ese secreto no tiene valor: apunta al secreto del mismo nombre en el Key Vault del ambiente (`<vault_uri>secrets/ghcr-lectura`, sin versión) y se lee con la identidad del API, que ya tiene «Key Vault Secrets User» sobre el grupo ([`infra/bootstrap/`](../bootstrap/README.md)). Sin versión, Container Apps toma la última: renovar el token es cargar una versión nueva con el mismo nombre.

El token lo crea el dueño (US-79 T3): un token clásico con **solo** `read:packages`, con vencimiento, uno por ambiente. La fecha de renovación se anota como la del token de D-167.

Primer despliegue de cada ambiente, en este orden. Container Apps necesita leer el token al crear la app y el trabajo, así que el token va en el Key Vault antes:

1. Crear solo el Key Vault: `tofu apply -var-file=uat.tfvars -var="imagen_api=…@sha256:<digest>" -target=azurerm_key_vault.secretos`.
2. El Key Vault usa RBAC: para cargar el secreto, el dueño se da «Key Vault Secrets Officer» solo sobre ese Key Vault, con su cuenta:

   ```sh
   az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
     --role "Key Vault Secrets Officer" \
     --scope "$(az keyvault show --name kv-alcanzamos-uat-mxc --query id -o tsv)"
   ```

3. Cargar el token. Se lee de la entrada estándar, para que no quede en la línea de comandos, en la lista de procesos ni en el historial. `--expires` lleva la fecha de vencimiento del token:

   ```sh
   read -rs GHCR_TOKEN    # pega el token read:packages y presiona Enter; no se muestra
   printf '%s' "$GHCR_TOKEN" | az keyvault secret set --vault-name kv-alcanzamos-uat-mxc --name ghcr-lectura \
     --file /dev/stdin --encoding utf-8 --content-type "token clásico read:packages de ghcr.io" \
     --expires "<AAAA-MM-DD>T00:00:00Z" --output none
   unset GHCR_TOKEN
   ```

4. Aplicar todo (`tofu apply` sin `-target`).

En producción, lo mismo con `kv-alcanzamos-prod-mxc`, `produccion.tfvars` y el token de producción. Para renovar, solo el paso 3; la app toma la versión nueva sin volver a aplicar.

## Región en Azure for Students (comprobado el 2026-11-11)

D-200 pide anotar las diferencias de la suscripción de estudiante. Consultas de solo lectura con `az` 2.90.0 sobre la suscripción de UAT (oferta `AzureForStudents_2018-01-01`, límite de gasto activo); no se creó ni se registró nada.

| Qué | Consulta | Resultado |
|---|---|---|
| Oferta | `az rest --method get --url https://management.azure.com/subscriptions/<id>?api-version=2022-12-01 --query subscriptionPolicies` | `quotaId` `AzureForStudents_2018-01-01`, `spendingLimit` `On` |
| Políticas | `az policy assignment list --subscription <id> --disable-scope-strict-match` | Una sola: `sys.regionrestriction`, «Allowed resource deployment regions» (definición integrada `b86dabb9-b578-4d7b-b842-3b45e95769a1`), efecto `deny`, sin exclusiones |
| Regiones permitidas | Parámetro `listOfAllowedLocations` de esa asignación | `francecentral`, `spaincentral`, `chilecentral`, `switzerlandnorth` y **`mexicocentral`**. La política deja pasar `global` (Communication Services y su servicio de correo) |
| Región | `az rest --method get --url https://management.azure.com/subscriptions/<id>/locations?api-version=2022-12-01` | `mexicocentral` existe para la suscripción, física, con zonas 1, 2 y 3 |
| PostgreSQL flexible | `az postgres flexible-server list-skus --location mexicocentral --subscription <id>` | Burstable con `Standard_B1ms` y `Standard_B2s`; versiones 11 a **18**; `OfferRestricted` desactivado. **Ningún SKU informa zonas** (`supportedZones` vacío) y no hay alta disponibilidad entre zonas ni respaldo geográfico |
| Container Apps | `az provider show -n Microsoft.App --subscription <id>` | `managedEnvironments`, `containerApps` y `jobs` se ofrecen en Mexico Central |
| Otros servicios | `az provider show` de `Microsoft.DBforPostgreSQL`, `Microsoft.KeyVault`, `Microsoft.OperationalInsights` y `Microsoft.Communication` | `flexibleServers`, `vaults` y `workspaces` en Mexico Central; `CommunicationServices` y `EmailServices` en `global` |
| Proveedores registrados | `az provider show -n <proveedor> --query registrationState` | Solo `Microsoft.ManagedIdentity`. Los demás los registra el bootstrap (paso 1) |
| Cuota de Container Apps | `az rest --method get --url https://management.azure.com/subscriptions/<id>/providers/Microsoft.App/locations/mexicocentral/usages?api-version=2024-03-01` | `ManagedEnvironmentCount` con límite 0. No es concluyente: la suscripción de pago por uso, también sin `Microsoft.App` registrado, da lo mismo. Se repite después del bootstrap |

Conclusión: la suscripción de estudiante permite `mexicocentral`, y ahí están PostgreSQL flexible `B_Standard_B1ms` (versión 18) y Container Apps. Los nombres siguen con `mxc`. Quedan dos cosas para el despliegue (T5 y T6): la zona `1` de PostgreSQL (`datos.tf`), porque `list-skus` no informa zonas para ningún SKU, y la cuota de entornos de Container Apps, cuando los proveedores estén registrados.

## Antes del primer despliegue (D-120)

No bloquean la US-44.

1. **Red de PostgreSQL.** Llevar el riesgo de la regla `0.0.0.0` a E11-EIP y calcular, con fuente, el costo de la red virtual. Lo decide el dueño antes de crear el servidor: esa elección no se cambia después en el mismo servidor.
2. **Rol mínimo para enviar correo** en lugar de «Communication and Email Service Owner» sobre todo el grupo. Se define en la US-45.
3. **Comprobar con `list-skus`** que PostgreSQL 18 y la zona 1 existen en México Central, en cada suscripción: las cuotas y los servicios de la región se comparan al desplegar UAT (D-200 (8)). En la de UAT ya se comprobó la región, PostgreSQL 18 y B1ms (ver «Región en Azure for Students»); falta la zona. La zona de PostgreSQL y el tenant de Entra ID de la suscripción de UAT se comprueban al desplegar (S11; US-79 T5 y T6).
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

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con el proveedor simulado (`tests/ambientes.tftest.hcl`): comprueba los nombres, las etiquetas, los tamaños y el dominio de correo de cada ambiente, los valores de UAT (S11), que producción conserve sus nombres y que se rechacen un ambiente desconocido, un dominio de otro ambiente y una retención del Key Vault fuera de 7 a 90 días. `tests/registro.tftest.hcl` comprueba, en los dos ambientes, que el API y el trabajo programado bajen la imagen de ghcr.io con el token del Key Vault leído con la identidad del API, que la imagen se acepte solo por digest (se rechazan `:1.0.0`, `:v0.1.0`, `:latest`, etiqueta con digest, un digest corto, en mayúsculas o de otro algoritmo y otra imagen) y que el usuario de ghcr.io y el nombre del secreto sean válidos.

```sh
cd infra/azure
tofu init -backend=false
tofu validate
tofu test
tofu fmt -check -recursive ..
```
