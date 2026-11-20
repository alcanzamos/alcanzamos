# infra/bootstrap/

Lo que se crea **una sola vez por ambiente, con la cuenta del dueño**, antes del primer despliegue de ese ambiente (D-119, opción A; D-205 (11)). Los dos ambientes viven en **la misma suscripción de pago por uso**, cada uno con su grupo de recursos, su estado y su identidad de pipeline (E11-INF 2.17). El mismo código, con la variable `ambiente` (`uat` o `produccion`). Región East US 2 (`eastus2`, sufijo `-eus2`, D-208).

## Qué crea

| Recurso | Producción (O-14) | UAT |
|---|---|---|
| Grupo de recursos, en East US 2 | `rg-alcanzamos-prod-eus2` | `rg-alcanzamos-uat-eus2` |
| Cuenta del estado remoto (contenedor `tfstate`) | `stalcanzamostfeus2` | `stalcanzamostfuateus2` |
| Identidad administrada del pipeline | `id-alcanzamos-pipeline-prod-eus2` | `id-alcanzamos-pipeline-uat-eus2` |
| Conexión de servicio de Azure DevOps (sujeto de la credencial federada) | `sc-alcanzamos-prod-eus2` | `sc-alcanzamos-uat-eus2` |
| Identidades de carga | `id-alcanzamos-<rol>-prod-eus2` | `id-alcanzamos-<rol>-uat-eus2` |
| Clave del estado de `infra/azure` (salida `backend`) | `produccion.tfstate` | `uat.tfstate` |

`<rol>` es `api`, `web`, `tareas`, `migrador` o `psql`.

La cuenta de almacenamiento admite solo de 3 a 24 letras minúsculas y números, y su nombre es único en todo Azure: UAT agrega `uat`.

1. **Sin registro de proveedores de recursos.** Los dos bootstraps comparten la suscripción, y un recurso de registro en cada estado sería un dueño doble: el segundo `apply` choca, y destruir un bootstrap desregistraría los del otro. Los registra [`infra/suscripcion`](../suscripcion/README.md), una sola vez, con la configuración del proveedor (`resource_providers_to_register`). Aquí el proveedor lleva `resource_provider_registrations = "none"` y no hay recursos `azurerm_resource_provider_registration`. Nunca se registran a mano con `az provider register`.
2. **Grupo de recursos** del ambiente, en East US 2.
3. **Estado remoto:** la cuenta de almacenamiento del ambiente, con el contenedor `tfstate`, sin claves compartidas.
4. **Identidad del pipeline:** una identidad administrada asignada por el usuario, con una credencial federada para Azure DevOps (*workload identity federation*). **Sin secretos y sin proveedor `azuread`:** no pide permisos de directorio en Entra (D-049, D-205 (1)).
   - Emisor: `https://vstoken.dev.azure.com/<ID de la organización>`, o el de la variable `credencial_federada_emisor`.
   - Sujeto: `sc://alcanzamos/alcanzamos/sc-alcanzamos-<prod|uat>-eus2`, o el de la variable `credencial_federada_sujeto`. Si la conexión de servicio tiene otro nombre, `conexion_de_servicio`.
   - Permisos: solo dos. «Contributor» **solo sobre el grupo de su ambiente** y «Storage Blob Data Contributor» solo sobre la cuenta de su estado. **No puede asignar roles** (ni Owner, ni User Access Administrator, ni Role Based Access Control Administrator). La de UAT no tiene permiso alguno sobre el grupo de producción.
5. **Cinco identidades de carga,** una por pieza: API, web (D-206 (7)), tareas (E11-INF 2.4), migrador (2.3) y `caj-psql` (2.3 bis). Se crean aquí para que el pipeline no pueda asignar roles. La salida `identidades_de_carga` da de cada una el nombre, el ID, el `client_id` y el `principal_id`, para `infra/azure`.
   - Hoy solo el API tiene un rol: «Key Vault Secrets User» sobre el grupo, provisional. El segundo paso (T6) lo cambia por «Key Vault Secrets User» sobre cada secreto, para cada identidad que lo necesita.

## Primer despliegue de cada ambiente (orden)

1. **Antes de cualquier bootstrap,** el dueño aplica `infra/suscripcion` una sola vez (proveedores, política P1 y presupuestos de la suscripción). Sin eso, Azure rechaza crear la cuenta de almacenamiento y las identidades.
2. El dueño corre `tofu apply -var="ambiente=<uat|produccion>"` en `infra/bootstrap/` con su cuenta, en la suscripción de pago por uso (ver «Dónde queda su estado»). Necesita el ID de la organización de Azure DevOps.
3. En Azure DevOps crea la conexión de servicio `sc-alcanzamos-<prod|uat>-eus2`: tipo Azure Resource Manager, identidad federada, con el `client_id` y el `tenant_id` de las salidas.
4. Con la salida `backend`, el pipeline de despliegue aplica `infra/azure/` (ver «Estado de cada ambiente» en su [README](../azure/README.md)). La primera vez, primero solo el Key Vault; el dueño carga ahí el token `read:packages` de ghcr.io y después se aplica todo («Acceso a la imagen privada» en ese README).
5. En PostgreSQL, el administrador de Entra ID crea el rol de la identidad del API, con los permisos mínimos.
6. En la suscripción de Azure for Students, que ya no se usa, se borran los recursos de la prueba R-9 (`rg-alcanzamos-prueba-r9` y `sc-alcanzamos-prueba-r9`).

## Dónde queda su estado y cómo se respalda

- **El estado del bootstrap es local, un archivo por ambiente.** El bloque `backend "local" {}` recibe la ruta al iniciar, así los dos ambientes no comparten estado:

  ```sh
  cd infra/bootstrap
  tofu init -reconfigure -backend-config="path=uat.tfstate"     # o produccion.tfstate
  tofu apply -var="ambiente=uat" -var="subscription_id=<suscripción de pago por uso>" -var="azure_devops_organizacion_id=<ID>"
  ```

  Los archivos `uat.tfstate` y `produccion.tfstate` quedan en el equipo del dueño. Están en `.gitignore` y nunca se suben. No tienen contraseñas, porque nada aquí usa secretos, pero sí identificadores de la suscripción y de Entra ID.
- **Respaldo.** Después del primer `apply` de cada ambiente, el dueño sube una copia al contenedor `tfstate` de ese ambiente como `bootstrap.tfstate`, con su cuenta. En UAT: `az storage blob upload --auth-mode login --account-name stalcanzamostfuateus2 --container-name tfstate --name bootstrap.tfstate --file uat.tfstate`; en producción, con `stalcanzamostfeus2` y `produccion.tfstate`. Repite la copia después de cada `apply` del bootstrap.
- **Protección del contenedor.** Cada cuenta tiene versionado de blobs y borrado suave de 30 días para blobs y contenedores. Así se recupera una versión anterior del estado del bootstrap o de `infra/azure`.
- **Si se pierde el estado local,** se baja la copia del contenedor del ambiente. Sin estado, OpenTofu no sabe que los recursos existen y habría que importarlos.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con los proveedores simulados. Comprueba los nombres de cada ambiente, la región `eastus2`, que el pipeline tenga solo «Contributor» sobre su grupo y «Storage Blob Data Contributor» sobre su estado, la credencial federada, las cinco identidades de carga con sus salidas, que no haya `azuread`, ni `Microsoft.Communication`, ni el rol «Communication and Email Service Owner» (ningún `.tf` nombra Communication, y los únicos roles del plan son los tres conocidos), que no haya recursos de registro de proveedores y el proveedor lleve `resource_provider_registrations = "none"`, que el pipeline no tenga más roles que esos dos y que se rechace un ambiente desconocido (`tests/*.tftest.hcl`).

```sh
cd infra/bootstrap
tofu init -backend=false
tofu validate
tofu test
```
