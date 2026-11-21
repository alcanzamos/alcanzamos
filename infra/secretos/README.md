# infra/secretos/

El **segundo paso del bootstrap** (E11-INF 2.5 y 2.14; D-205 (5)): a cada identidad de carga le asigna el rol «Key Vault Secrets User» **sobre cada secreto que lee, y solo sobre ese**. No sobre el Key Vault ni sobre el grupo. Además le da **al dueño** el rol «Key Vault Secrets Officer» sobre el Key Vault del ambiente, para cargar y rotar los secretos (ver «Cargar y rotar secretos»). Lo aplica **el dueño, con su cuenta, una vez por ambiente**, después de que `infra/azure` cree el Key Vault. El pipeline no asigna roles: su identidad no puede (ver [`infra/bootstrap/`](../bootstrap/README.md)).

Nada de esto se aplica mientras siga la pausa de D-204.

## Por qué es una raíz aparte

Un rol con alcance en un secreto necesita que el secreto exista, y el secreto vive en un Key Vault que crea `infra/azure`. El bootstrap se aplica **antes** de `infra/azure`: en ese momento no hay Key Vault ni secretos, así que no puede asignar estos roles. Tampoco puede hacerlo `infra/azure`: su identidad (el pipeline) no tiene permiso para asignar roles, y así debe seguir. Por eso esta raíz es la que el dueño aplica después (E11-INF 2.14, «segundo paso del bootstrap»).

Esta raíz **solo lee** el Key Vault y las identidades (con `data`, por nombre, los mismos que usan `infra/azure` y el bootstrap) y crea **dos recursos** de asignación de rol: `azurerm_role_assignment.lectura` (la lectura de cada secreto) y `azurerm_role_assignment.carga_del_dueno` (la carga del dueño). No crea el Key Vault, las identidades ni los secretos, y no lee ningún valor de secreto: el valor no puede quedar en el estado.

## Qué crea

Por ambiente, siete asignaciones de «Key Vault Secrets User», con alcance `<id del Key Vault>/secrets/<nombre del secreto>`, y una de «Key Vault Secrets Officer» para el dueño, con alcance en el Key Vault.

| Secreto (nombre por defecto) | Qué es | Lo leen |
|---|---|---|
| `ghcr-lectura` | Token `read:packages` de ghcr.io, para bajar las imágenes privadas | API, web, tareas, migrador y `caj-psql` |
| `correo-contrasena` | Contraseña de SMTP de Zoho CPaaS (token de envío del agente del ambiente) | API y tareas |

- **`caj-psql` lee `ghcr-lectura`:** la imagen de PostgreSQL 18 se copia por digest a ghcr.io como paquete privado `alcanzamos-psql`, para no depender del límite de descargas anónimas de Docker Hub. No lee la contraseña de CPaaS.
- **La web y el migrador no mandan correo:** no leen la contraseña de CPaaS.
- **La asignación del dueño** (`carga_del_dueno`) es la **única con alcance en el Key Vault completo**: «Key Vault Secrets Officer», con el object id de la variable `dueno_object_id` (obligatoria, sin valor por defecto, un GUID). Deja crear y rotar secretos con `az keyvault secret set`. Su object id: `az ad signed-in-user show --query id -o tsv`.
- **Ninguna otra identidad** (ni la del pipeline) recibe un rol aquí. «Key Vault Secrets User» deja leer el valor de un secreto; no deja escribirlo, listarlo ni administrar el Key Vault. No hay «Key Vault Administrator», ni Owner, ni Contributor, ni roles que asignen roles.
- Nombres que se leen, para el ambiente `uat` (en producción, `prod`): Key Vault `kv-alcanzamos-uat-eus2` y grupo `rg-alcanzamos-uat-eus2`; identidades `id-alcanzamos-<api|web|tareas|migrador|psql>-uat-eus2`.
- Los nombres de los secretos son las variables `ghcr_nombre_del_secreto` y `correo_nombre_del_secreto`, con los mismos valores por defecto y las mismas reglas que en `infra/azure`. Si allá cambian, se pasan iguales aquí.

La salida `lecturas` muestra, por secreto, qué identidades lo leen.

## Orden (cada ambiente)

Container Apps lee el secreto al crear la app y el trabajo, y lo lee con la identidad de la app: el rol tiene que existir antes de aplicar todo `infra/azure`. Por eso este paso va entre la carga de los secretos y el `apply` completo.

**Quién corre qué.** La primera vez de cada ambiente, **los pasos 2 y 5 (`infra/azure`) los corre el dueño a mano, desde su equipo y con su cuenta**, con el estado remoto del ambiente (ver el [README de `infra/azure`](../azure/README.md)). **No es el despliegue por etiqueta:** el pipeline no crea el Key Vault ni asigna roles. Los pasos 1, 3 y 4 también son del dueño. Después del primer despliegue, `infra/azure` lo aplica el despliegue por etiqueta.

1. `infra/suscripcion`, una sola vez, y el bootstrap del ambiente ([`infra/bootstrap/`](../bootstrap/README.md)).
2. `infra/azure`, el dueño a mano: crear solo el Key Vault (`-target=azurerm_key_vault.secretos`).
3. **Esta raíz, solo el rol del dueño; después, la carga de los secretos.** El rol de lectura de un secreto necesita que el secreto exista, y el dueño necesita su propio rol para crearlo. Por eso, en este orden:

   ```sh
   cd infra/secretos
   tofu init -reconfigure -backend-config="path=uat.tfstate"     # o produccion.tfstate
   tofu apply -target=azurerm_role_assignment.carga_del_dueno \
     -var="ambiente=uat" -var="subscription_id=<suscripción de pago por uso>" \
     -var="dueno_object_id=$(az ad signed-in-user show --query id -o tsv)"
   ```

   Después, el dueño carga el token de ghcr.io (`ghcr-lectura`) y la contraseña de CPaaS (`correo-contrasena`) como dice «Cargar y rotar secretos».
4. **Esta raíz, completa** (los mismos `-var`, sin `-target`):

   ```sh
   tofu apply -var="ambiente=uat" -var="subscription_id=<suscripción de pago por uso>" \
     -var="dueno_object_id=$(az ad signed-in-user show --query id -o tsv)"
   ```

5. `infra/azure`, el dueño a mano: aplicar todo (`tofu apply` sin `-target`).

Si el `apply` del paso 4 dice que un secreto no existe, falta cargarlo (paso 3). Azure puede tardar unos minutos en propagar un rol nuevo: si el `apply` completo de `infra/azure` no puede leer un secreto justo después, se repite.

## Cargar y rotar secretos

Lo hace **solo el dueño, con su cuenta y su rol «Key Vault Secrets Officer»**. **Ningún comando de esta sección lo corre el pipeline.** El Key Vault está cerrado a la red pública (P9): la acción por defecto es «Deny» y solo entra la subred del entorno de Container Apps. Por eso, desde el equipo del dueño, su IP pública se habilita **solo mientras carga** y se quita al terminar.

```sh
KV=kv-alcanzamos-uat-eus2          # producción: kv-alcanzamos-prod-eus2
IP=<mi IP pública>

# 1. Habilitar mi IP.
az keyvault network-rule add --name "$KV" --ip-address "$IP/32"

# 2. Cargar o rotar. El valor entra por la entrada estándar: no queda en la línea de comandos ni en el historial.
read -rs VALOR                     # pega el valor y presiona Enter; no se muestra
printf '%s' "$VALOR" | az keyvault secret set --vault-name "$KV" --name ghcr-lectura \
  --file /dev/stdin --encoding utf-8 --expires "<AAAA-MM-DD>T00:00:00Z" --output none
unset VALOR                        # para la contraseña de CPaaS, el nombre es correo-contrasena

# 3. Quitar mi IP y comprobar que ya no está.
az keyvault network-rule remove --name "$KV" --ip-address "$IP/32"
az keyvault network-rule list --name "$KV"
```

- **Rotar es cargar una versión nueva con el mismo nombre.** Las apps toman la última versión; no se vuelve a aplicar nada.
- **Quitar la IP no es opcional.** Si el paso 3 falla, se repite hasta que `network-rule list` no muestre la IP.
- **Pendiente del PR de `infra/azure`:** el Key Vault de `infra/azure` todavía no lleva `network_acls` (acción por defecto «Deny» y regla de la subred). Mientras no los tenga, el Key Vault acepta tráfico público y el paso de la IP no tiene efecto; el procedimiento queda igual para cuando ese PR lo cierre.

## Dónde queda su estado y cómo se respalda

- **El estado es local, un archivo por ambiente,** igual que el bootstrap: `uat.tfstate` y `produccion.tfstate`, en el equipo del dueño. Están en `.gitignore` y nunca se suben. Tienen identificadores de la suscripción y de las identidades, y ningún valor de secreto, porque esta raíz no los lee.
- **Respaldo.** Después de cada `apply`, el dueño sube una copia al contenedor `tfstate` del ambiente como `secretos.tfstate`, con su cuenta, igual que `bootstrap.tfstate` (ver el README del bootstrap).
- **Si se pierde el estado,** se baja esa copia. Sin estado, OpenTofu no sabe que las asignaciones existen y habría que importarlas.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con el proveedor simulado. Comprueba, en los dos ambientes, las siete asignaciones de lectura con su identidad y su alcance en el secreto (no en el Key Vault ni en el grupo), que `caj-psql` lea `ghcr-lectura` y que el pipeline no tenga ninguna asignación; que la asignación del dueño sea «Key Vault Secrets Officer» con alcance exacto en el id del Key Vault y su object id, que sea la **única** con ese alcance y que `dueno_object_id` sea obligatoria y un GUID; que los únicos roles sean «Key Vault Secrets User» y ese «Key Vault Secrets Officer» (ni Administrator, Owner, Contributor ni roles que asignan roles); los nombres del Key Vault y de las identidades que se leen, los nombres de secreto de las variables y que sean iguales a los de `infra/azure` (los valores por defecto de las dos `variables.tf`), la salida `lecturas`, que no se creen el Key Vault, las identidades ni los secretos ni se lea ningún valor, que no haya registro de proveedores ni `azuread`, y que se rechacen un ambiente desconocido y nombres de secreto inválidos o iguales (`tests/*.tftest.hcl`).

```sh
cd infra/secretos
tofu init -backend=false
tofu validate
tofu test
```
