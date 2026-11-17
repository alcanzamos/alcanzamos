# infra/bootstrap/

Lo que se crea **una sola vez por ambiente, con la cuenta del dueño**, antes del primer despliegue de ese ambiente (D-119, opción A; D-200 (8)): una vez en la suscripción de Azure for Students para UAT y otra en la de pago por uso para producción. El mismo código, con la variable `ambiente` (`uat` o `produccion`).

## Qué crea

| Recurso | Producción (O-14) | UAT |
|---|---|---|
| Grupo de recursos, en México Central | `rg-alcanzamos-prod-mxc` | `rg-alcanzamos-uat-mxc` |
| Cuenta del estado remoto (contenedor `tfstate`) | `stalcanzamostfmxc` | `stalcanzamostfuatmxc` |
| Aplicación del pipeline en Entra ID | `app-pipeline-alcanzamos-prod-mxc` | `app-pipeline-alcanzamos-uat-mxc` |
| Conexión de servicio de Azure DevOps (sujeto de la credencial federada) | `sc-alcanzamos-prod-mxc` | `sc-alcanzamos-uat-mxc` |
| Identidad del API | `id-alcanzamos-prod-mxc` | `id-alcanzamos-uat-mxc` |
| Clave del estado de `infra/azure` (salida `backend`) | `produccion.tfstate` | `uat.tfstate` |

La cuenta de almacenamiento admite solo de 3 a 24 letras minúsculas y números, y su nombre es único en todo Azure: producción conserva el aprobado y UAT agrega `uat`.

1. **Registro de los proveedores de recursos** aprobados (O-14, D-076): `Microsoft.App`, `Microsoft.Communication`, `Microsoft.DBforPostgreSQL`, `Microsoft.Insights`, `Microsoft.KeyVault`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights` y `Microsoft.Storage`.
2. **Grupo de recursos** del ambiente, en México Central.
3. **Estado remoto:** la cuenta de almacenamiento del ambiente, con el contenedor `tfstate`, sin claves compartidas.
4. **Identidad del pipeline:** una aplicación de Entra ID con su service principal y una credencial federada para Azure DevOps (*workload identity federation*). **Sin secretos.**
   - Emisor: `https://vstoken.dev.azure.com/<ID de la organización>`.
   - Sujeto: `sc://alcanzamos/alcanzamos/sc-alcanzamos-<prod|uat>-mxc` (o el de la variable `conexion_de_servicio`).
   - Permisos: «Contributor» **solo sobre el grupo** y «Storage Blob Data Contributor» solo sobre la cuenta del estado.
5. **Identidad del API**, con «Key Vault Secrets User» y «Communication and Email Service Owner» sobre el grupo. Este último es el rol que indica Microsoft para enviar correo con Entra ID. Con el primero, Container Apps lee del Key Vault el token `read:packages` para bajar la imagen privada de ghcr.io (D-200 (9)(a)). Se crea aquí para que el pipeline no pueda asignar roles.

## Primer despliegue de cada ambiente (orden)

1. El dueño corre `tofu apply -var="ambiente=<uat|produccion>"` en `infra/bootstrap/` con su cuenta, en la suscripción del ambiente (ver «Dónde queda su estado»). Necesita el ID de la organización de Azure DevOps.
2. En Azure DevOps crea la conexión de servicio `sc-alcanzamos-<prod|uat>-mxc`: tipo Azure Resource Manager, identidad federada, con el `client_id` y el `tenant_id` de las salidas.
3. Con la salida `backend`, el pipeline de despliegue aplica `infra/azure/` (ver «Estado de cada ambiente» en su [README](../azure/README.md)). La primera vez, primero solo el Key Vault; el dueño carga ahí el token `read:packages` de ghcr.io y después se aplica todo («Acceso a la imagen privada» en ese README).
4. El dueño carga en Cloudflare los registros de `registros_dns_de_avisos` del ambiente. Cuando Azure verifica el dominio, se asocia a Communication Services.
5. En PostgreSQL, el administrador de Entra ID crea el rol de la identidad del API, con los permisos mínimos.
6. En la suscripción de Azure for Students se borran los recursos de la prueba R-9 (`rg-alcanzamos-prueba-r9` y `sc-alcanzamos-prueba-r9`).
7. En UAT, con la primera factura se confirma que el crédito de estudiante paga Communication Services (NV-15).

## Dónde queda su estado y cómo se respalda

- **El estado del bootstrap es local, un archivo por ambiente.** El bloque `backend "local" {}` recibe la ruta al iniciar, así los dos ambientes no comparten estado:

  ```sh
  cd infra/bootstrap
  tofu init -reconfigure -backend-config="path=uat.tfstate"     # o produccion.tfstate
  tofu apply -var="ambiente=uat" -var="subscription_id=<suscripción de UAT>" -var="azure_devops_organizacion_id=<ID>"
  ```

  Los archivos `uat.tfstate` y `produccion.tfstate` quedan en el equipo del dueño. Están en `.gitignore` y nunca se suben. No tienen contraseñas, porque nada aquí usa secretos, pero sí identificadores de la suscripción y de Entra ID.
- **Respaldo.** Después del primer `apply` de cada ambiente, el dueño sube una copia al contenedor `tfstate` de ese ambiente como `bootstrap.tfstate`, con su cuenta. En UAT: `az storage blob upload --auth-mode login --account-name stalcanzamostfuatmxc --container-name tfstate --name bootstrap.tfstate --file uat.tfstate`; en producción, con `stalcanzamostfmxc` y `produccion.tfstate`. Repite la copia después de cada `apply` del bootstrap.
- **Protección del contenedor.** Cada cuenta tiene versionado de blobs y borrado suave de 30 días para blobs y contenedores. Así se recupera una versión anterior del estado del bootstrap o de `infra/azure`.
- **Si se pierde el estado local,** se baja la copia del contenedor del ambiente. Sin estado, OpenTofu no sabe que los recursos existen y habría que importarlos.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con los proveedores simulados (`tests/ambientes.tftest.hcl`): comprueba los nombres de cada ambiente, que producción conserve los suyos y que se rechace un ambiente desconocido.

```sh
cd infra/bootstrap
tofu init -backend=false
tofu validate
tofu test
```
