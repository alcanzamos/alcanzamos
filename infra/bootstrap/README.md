# infra/bootstrap/

Lo que se crea **una sola vez, con la cuenta del dueño**, en el primer despliegue a producción (D-119, opción A). No se aplica en la US-44.

## Qué crea

1. **Registro de los proveedores de recursos** aprobados (O-14, D-076): `Microsoft.App`, `Microsoft.Communication`, `Microsoft.DBforPostgreSQL`, `Microsoft.Insights`, `Microsoft.KeyVault`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights` y `Microsoft.Storage`.
2. **Grupo de recursos** `rg-alcanzamos-prod-mxc`, en México Central.
3. **Estado remoto:** la cuenta de almacenamiento `stalcanzamostfmxc`, con el contenedor `tfstate`, sin claves compartidas.
4. **Identidad del pipeline:** una aplicación de Entra ID con su service principal y una credencial federada para Azure DevOps (*workload identity federation*). **Sin secretos.**
   - Emisor: `https://vstoken.dev.azure.com/<ID de la organización>`.
   - Sujeto: `sc://alcanzamos/alcanzamos/sc-alcanzamos-prod-mxc`.
   - Permisos: «Contributor» **solo sobre el grupo** y «Storage Blob Data Contributor» solo sobre la cuenta del estado.
5. **Identidad del API** `id-alcanzamos-prod-mxc`, con «Key Vault Secrets User» y «Communication and Email Service Owner» sobre el grupo. Este último es el rol que indica Microsoft para enviar correo con Entra ID. Se crea aquí para que el pipeline no pueda asignar roles.

## Primer despliegue (orden)

1. El dueño corre `tofu apply` en `infra/bootstrap/` con su cuenta. Necesita el ID de la organización de Azure DevOps.
2. En Azure DevOps crea la conexión de servicio `sc-alcanzamos-prod-mxc`: tipo Azure Resource Manager, identidad federada, con el `client_id` y el `tenant_id` de las salidas.
3. Con la salida `backend_de_produccion`, el pipeline de despliegue aplica `infra/produccion/`.
4. El dueño carga en Cloudflare los registros de `registros_dns_de_avisos`. Cuando Azure verifica el dominio, se asocia a Communication Services.
5. En PostgreSQL, el administrador de Entra ID crea el rol de la identidad del API, con los permisos mínimos.
6. Se borran los recursos de la prueba R-9 (`rg-alcanzamos-prueba-r9` y `sc-alcanzamos-prueba-r9`).
7. Con la primera factura se confirma que el crédito de estudiante paga Communication Services (NV-15).

## Dónde queda su estado y cómo se respalda

- **El estado del bootstrap es local.** Al aplicar, OpenTofu escribe `infra/bootstrap/terraform.tfstate` en el equipo del dueño. Está en `.gitignore` y nunca se sube. No tiene contraseñas, porque nada aquí usa secretos, pero sí identificadores de la suscripción y de Entra ID.
- **Respaldo.** Después del primer `apply`, el dueño sube una copia al contenedor `tfstate` como `bootstrap.tfstate`, con su cuenta: `az storage blob upload --auth-mode login --account-name stalcanzamostfmxc --container-name tfstate --name bootstrap.tfstate --file terraform.tfstate`. Repite la copia después de cada `apply` del bootstrap.
- **Protección del contenedor.** La cuenta tiene versionado de blobs y borrado suave de 30 días para blobs y contenedores. Así se recupera una versión anterior del estado del bootstrap o de producción.
- **Si se pierde el estado local,** se baja la copia del contenedor. Sin estado, OpenTofu no sabe que los recursos existen y habría que importarlos.

## Validación

```sh
cd infra/bootstrap
tofu init -backend=false
tofu validate
```
