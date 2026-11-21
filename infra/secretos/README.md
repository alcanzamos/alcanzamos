# infra/secretos/

El **segundo paso del bootstrap** (E11-INF 2.5 y 2.14; D-205 (5)): a cada identidad de carga le asigna el rol «Key Vault Secrets User» **sobre cada secreto que lee, y solo sobre ese**. No sobre el Key Vault ni sobre el grupo. Lo aplica **el dueño, con su cuenta, una vez por ambiente**, después de que `infra/azure` cree el Key Vault y de que él cargue los secretos. El pipeline no asigna roles: su identidad no puede (ver [`infra/bootstrap/`](../bootstrap/README.md)).

Nada de esto se aplica mientras siga la pausa de D-204.

## Por qué es una raíz aparte

Un rol con alcance en un secreto necesita que el secreto exista, y el secreto vive en un Key Vault que crea `infra/azure`. El bootstrap se aplica **antes** de `infra/azure`: en ese momento no hay Key Vault ni secretos, así que no puede asignar estos roles. Tampoco puede hacerlo `infra/azure`: su identidad (el pipeline) no tiene permiso para asignar roles, y así debe seguir. Por eso esta raíz es la que el dueño aplica después (E11-INF 2.14, «segundo paso del bootstrap»).

Esta raíz **solo lee** el Key Vault y las identidades (con `data`, por nombre, los mismos que usan `infra/azure` y el bootstrap) y crea **un solo recurso**, `azurerm_role_assignment.lectura`. No crea el Key Vault, las identidades ni los secretos, y no lee ningún valor de secreto: el valor no puede quedar en el estado.

## Qué crea

Seis asignaciones de «Key Vault Secrets User», por ambiente. Alcance: `<id del Key Vault>/secrets/<nombre del secreto>`.

| Secreto (nombre por defecto) | Qué es | Lo leen |
|---|---|---|
| `ghcr-lectura` | Token `read:packages` de ghcr.io, para bajar la imagen privada | API, web, tareas y migrador |
| `correo-contrasena` | Contraseña de SMTP de Zoho CPaaS (token de envío del agente del ambiente) | API y tareas |

- **`caj-psql` no lee ninguno:** usa la imagen pública de PostgreSQL (Docker Hub), así que no necesita el token de ghcr.io.
- **La web y el migrador no mandan correo:** no leen la contraseña de CPaaS.
- **Ninguna otra identidad** (ni la del pipeline) recibe un rol aquí. «Key Vault Secrets User» deja leer el valor de un secreto; no deja escribirlo, listarlo ni administrar el Key Vault. Cargar los secretos lo hace el dueño con «Key Vault Secrets Officer» sobre el Key Vault (ver [`infra/azure/`](../azure/README.md)).
- Nombres que se leen, para el ambiente `uat` (en producción, `prod`): Key Vault `kv-alcanzamos-uat-eus2` y grupo `rg-alcanzamos-uat-eus2`; identidades `id-alcanzamos-<api|web|tareas|migrador>-uat-eus2`.
- Los nombres de los secretos son las variables `ghcr_nombre_del_secreto` y `correo_nombre_del_secreto`, con los mismos valores por defecto y las mismas reglas que en `infra/azure`. Si allá cambian, se pasan iguales aquí.

La salida `lecturas` muestra, por secreto, qué identidades lo leen.

## Orden (cada ambiente)

Container Apps lee el secreto al crear la app y el trabajo, y lo lee con la identidad de la app: el rol tiene que existir antes de aplicar todo `infra/azure`. Por eso este paso va entre la carga de los secretos y el `apply` completo.

1. `infra/suscripcion`, una sola vez, y el bootstrap del ambiente ([`infra/bootstrap/`](../bootstrap/README.md)).
2. `infra/azure`: crear solo el Key Vault (`-target=azurerm_key_vault.secretos`).
3. El dueño carga los dos secretos con `az keyvault secret set`, por la entrada estándar (ver «Acceso a la imagen privada» y «Correo por Zoho CPaaS» en el [README de `infra/azure`](../azure/README.md)).
4. **Esta raíz:**

   ```sh
   cd infra/secretos
   tofu init -reconfigure -backend-config="path=uat.tfstate"     # o produccion.tfstate
   tofu apply -var="ambiente=uat" -var="subscription_id=<suscripción de pago por uso>"
   ```

5. `infra/azure`: aplicar todo (`tofu apply` sin `-target`).

Si el `apply` de esta raíz dice que un secreto no existe, falta el paso 3. Azure puede tardar unos minutos en propagar un rol nuevo: si el `apply` completo de `infra/azure` no puede leer un secreto justo después, se repite.

## Dónde queda su estado y cómo se respalda

- **El estado es local, un archivo por ambiente,** igual que el bootstrap: `uat.tfstate` y `produccion.tfstate`, en el equipo del dueño. Están en `.gitignore` y nunca se suben. Tienen identificadores de la suscripción y de las identidades, y ningún valor de secreto, porque esta raíz no los lee.
- **Respaldo.** Después de cada `apply`, el dueño sube una copia al contenedor `tfstate` del ambiente como `secretos.tfstate`, con su cuenta, igual que `bootstrap.tfstate` (ver el README del bootstrap).
- **Si se pierde el estado,** se baja esa copia. Sin estado, OpenTofu no sabe que las asignaciones existen y habría que importarlas.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con el proveedor simulado. Comprueba, en los dos ambientes, las seis asignaciones con su identidad y su alcance en el secreto (no en el Key Vault ni en el grupo), que el único rol sea «Key Vault Secrets User», que `caj-psql` y el pipeline no lean nada, los nombres del Key Vault y de las identidades que se leen, los nombres de secreto de las variables, la salida `lecturas`, que no se creen el Key Vault, las identidades ni los secretos ni se lea ningún valor, que no haya registro de proveedores ni `azuread`, y que se rechacen un ambiente desconocido y nombres de secreto inválidos o iguales (`tests/*.tftest.hcl`).

```sh
cd infra/secretos
tofu init -backend=false
tofu validate
tofu test
```
