# infra/suscripcion/

Lo que es **de la suscripción de pago por uso y no de un ambiente** (D-205 (11), E11-INF 2.17). Los dos ambientes (UAT y producción) comparten esa suscripción, así que esto existe **una sola vez**: lo aplica el dueño, **una sola vez**, con su cuenta, **antes** de los bootstraps y de `infra/azure`. Ningún bootstrap ni el pipeline lo toca.

Nada de esto se aplica mientras siga la pausa de D-204.

## Qué lleva

1. **Registro de los proveedores de recursos** (O-14, D-076), con la configuración del proveedor `azurerm`, **no como recursos**: `Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.Insights`, `Microsoft.KeyVault`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights` y `Microsoft.Storage`. No se registra `Microsoft.Communication`: el correo sale por Zoho CPaaS (D-205). Nunca se registran a mano con `az provider register`.
2. **Política P1** (Azure Policy, asignada a la suscripción). Las **regiones** siguen con efecto `Deny` y con las definiciones integradas; las **etiquetas** `proyecto` y `ambiente` ya **no se exigen**: se **agregan o se heredan** con efecto `Modify`, con **dos definiciones propias copiadas de las integradas** (solo cambia `roleDefinitionIds`, a Tag Contributor) y nunca se rechaza un recurso por no llevarlas (decisión del dueño, 2026-11-18):

   | Asignación | Definición | ID | Efecto | Parámetros |
   |---|---|---|---|---|
   | `alcanzamos-regiones-recursos` | Allowed locations | `e56962a6-4747-49cd-b67b-bf8b01975c4c` | `Deny` | `listOfAllowedLocations` = `eastus2`, `centralus`, `global` |
   | `alcanzamos-regiones-grupos` | Allowed locations for resource groups | `e765b5de-1225-4ba3-bd56-1ac6695af988` | `Deny` | `listOfAllowedLocations` = `eastus2`, `centralus`, `global` |
   | `alcanzamos-etiqueta-proyecto-recursos` y `alcanzamos-etiqueta-ambiente-recursos` | Propia: `alcanzamos-copia-heredar-etiqueta-del-grupo`, copia de «Inherit a tag from the resource group if missing» | ID de Azure al crearla (la integrada era `ea3f2387-…`) | `Modify` (fijo en la definición) | `tagName` = `proyecto` / `ambiente` |
   | `alcanzamos-etiqueta-proyecto-grupos` | Propia: `alcanzamos-copia-agregar-etiqueta-a-grupos`, copia de «Add a tag to resource groups» | ID de Azure al crearla (la integrada era `726aca4c-…`) | `Modify` (fijo en la definición) | `tagName` = `proyecto`, `tagValue` = `alcanzamos` |
   | `alcanzamos-etiqueta-ambiente-grupos` | Propia: `alcanzamos-copia-agregar-etiqueta-a-grupos` | ID de Azure al crearla | `Modify` (fijo en la definición) | `tagName` = `ambiente`, `tagValue` = `sin-asignar` |

   `eastus2` es la región (D-208); `centralus` solo sirve para restaurar el respaldo georredundante de PostgreSQL (la política no puede distinguir ese uso: nada se crea allí antes del desastre, P12). Las definiciones integradas de regiones se tomaron de `Azure/azure-policy` (`built-in-policies/policyDefinitions`); las copias de etiquetas, de `Tags/` (ver abajo). Las dos de etiquetas de la versión anterior (`Require a tag on resources`, `871b6d14-…`, y `Require a tag on resource groups`, `96670d01-…`, ambas `Deny`) ya no se asignan.
3. **Presupuestos de la suscripción** (T9, D-206), mensuales, con aviso por correo (no detienen nada):

   | Presupuesto | Monto | Avisos (operador «mayor que») |
   |---|---|---|
   | `alcanzamos-gratuitos` | 2 USD | 50 y 100 % del gasto real. Cualquier gasto comprueba que un servicio gratuito dejó de serlo |
   | `alcanzamos-tope` | 24 USD (tope del dueño) | 50, 75, 90 y 100 % del gasto real y 100 % del gasto previsto (cinco avisos, el máximo de Azure) |

   El correo es la variable `correos_de_alerta`. Los presupuestos por grupo de recursos van en `infra/azure` (T9).

4. **Identidades y rol de las asignaciones Modify** (cuatro `azurerm_role_assignment` de **Tag Contributor** en la suscripción, una por asignación de etiquetas; ninguna de Contributor): ver «Etiquetas: se agregan o se heredan».

Todos los recursos (incluidas las dos definiciones propias) llevan `prevent_destroy = true`: mientras el bloque permanezca en la configuración, OpenTofu rechaza planes que lo destruyan. Eliminar el bloque también elimina esa protección; cualquier retirada de recursos exige revisión explícita.

## Etiquetas: se agregan o se heredan

**Por qué `Modify` y no `Deny`.** Con `Deny`, Azure podía rechazar los grupos que crea por su cuenta y sin etiquetas: `ME_…` (grupo administrado de Container Apps con perfiles de carga de trabajo), `NetworkWatcherRG` (al crear la primera red virtual) y otros (`DefaultResourceGroup-…`). Con `Modify`, la etiqueta se agrega en la misma solicitud y ningún grupo se rechaza por no tener estas etiquetas. No hace falta ninguna exclusión (`not_scopes`). No se puede comprobar sin Azure: se mira en el primer despliegue de UAT que `ME_…` y `NetworkWatcherRG` salen con las dos etiquetas.

### Copias de las definiciones integradas (decisión del dueño, 2026-11-18)

Las dos definiciones integradas de Modify declaran **Contributor** en `roleDefinitionIds`, y la identidad de la asignación recibe ese rol. El dueño no aceptó Contributor para esas identidades. Por eso hay **dos definiciones propias** (`azurerm_policy_definition.etiquetas`, tipo `Custom`, en la suscripción, `prevent_destroy`), **copiadas de las integradas y con un solo cambio: `roleDefinitionIds` es Tag Contributor** (`/providers/Microsoft.Authorization/roleDefinitions/4a9ae827-6dc8-4573-8ac7-8239d42aa03f`).

| Definición propia (nombre) | Copia de | ID de la integrada | `mode` |
|---|---|---|---|
| `alcanzamos-copia-heredar-etiqueta-del-grupo` | «Inherit a tag from the resource group if missing» (`Tags/InheritTag_Add_Modify.json`) | `ea3f2387-9b95-492a-a190-fcdc54f7b070` | `Indexed` |
| `alcanzamos-copia-agregar-etiqueta-a-grupos` | «Add a tag to resource groups» (`Tags/AddTag_ResourceGroup_Modify.json`) | `726aca4c-86e9-4b04-b0c5-073027359532` | `All` |

Su `displayName` empieza por «Copia de «…» con Tag Contributor» y su `description` dice que es una copia, de cuál y por qué.

**Cómo se hizo la copia.** Los dos JSON, **literales**, están en `originales/` (no se aplican ni se editan; la prueba fija su SHA-256). `mode`, `parameters`, el `if`, el efecto y las operaciones se leen de esos archivos en `principal.tf`; solo `roleDefinitionIds` se reemplaza. Tomados de `https://raw.githubusercontent.com/Azure/azure-policy/master/built-in-policies/policyDefinitions/Tags/` el **2026-11-18** (solo lectura):

| Archivo | Último commit que lo cambió | SHA-256 |
|---|---|---|
| `InheritTag_Add_Modify.json` | `f7319d6eb87769be8ba87d4d6f7b37eafd992cb0` (2024-03-13, «Built-in Policy Release 090250c3 (#1287)») | `596cd52a5ceffc8832240f486e6f3fd753045cc99a4fd04a58abcbce75a37fec` |
| `AddTag_ResourceGroup_Modify.json` | el mismo, `f7319d6e…` | `57533fda3aa62ecba1b043842d1dff8627e34c274612b08e0f20f40de3250329` |

`master` de `Azure/azure-policy` estaba en `f096d8de10fb25e71dd7f82b78ded110ec711d73` (2026-10-28) al tomarlas; ambas definiciones están en la versión `1.0.0`, sin cambios desde 2024-03-13. Qué dicen (citado de esos archivos):

- **Recursos (`Indexed`):** parámetro `tagName`. Regla: `if` = `allOf` de [`tags[tagName]` con `"exists": "false"`, y `resourceGroup().tags[tagName]` con `notEquals ""`]; `then.effect` = `modify`, una operación `add` de `tags[tagName]` con el valor de la etiqueta del grupo. `description` original: «Adds the specified tag with its value from the parent resource group when any resource missing this tag is created or updated. Existing resources can be remediated by triggering a remediation task. If the tag exists with a different value it will not be changed.»
- **Grupos (`All`):** parámetros `tagName` y `tagValue`. Regla: `if` = `allOf` de [`type` = `Microsoft.Resources/subscriptions/resourceGroups`, y `tags[tagName]` con `"exists": "false"`]; `then.effect` = `modify`, una operación `add` de `tags[tagName]` con `tagValue`. `description` original: «Adds the specified tag and value when any resource group missing this tag is created or updated. Existing resource groups can be remediated by triggering a remediation task. If the tag exists with a different value it will not be changed.»
- Las dos tenían `"roleDefinitionIds": ["/providers/microsoft.authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c"]` (Contributor). Es lo único que cambia.
- Ninguna tiene parámetro `effect`: la asignación **no pasa `effect`** (la prueba lo exige).

**Una corrección a mano no se revierte (decisión del dueño, 2026-11-18).** Las dos reglas usan la operación **`add`**, no `addOrReplace`, y su `if` exige **`exists: false`** sobre la misma etiqueta que escribe. Si la etiqueta existe, con cualquier valor, el recurso o grupo ya cumple y `Modify` no hace nada. La documentación define las dos operaciones así (<https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-modify>): «`addOrReplace` — Adds the defined property or tag and value to the resource, even if the property or tag already exists with a different value.» y «`add` — Adds the defined property or tag and value to the resource.» La prueba `correccion_a_mano_no_se_revierte` lo demuestra: toda operación es `add`, ninguna es `addOrReplace`, y el `if` pide `exists: false` sobre la etiqueta de la operación; la prueba estática exige que ningún `.tf` diga `addOrReplace`.

**Qué se pierde con la copia.** Una definición propia **no recibe las actualizaciones de la integrada**. Si Microsoft cambia la regla (otro `if`, otro `mode`, una operación nueva), la copia sigue con la regla de 2024. **Hay que revisarla en cada cambio de Azure Policy** (por ejemplo, al subir la versión de `azurerm` o al revisar las novedades de Azure Policy): comparar `originales/` con el archivo actual de `Azure/azure-policy` (`curl -sSf <URL> | diff - originales/<archivo>`); si difiere, decidir en un cambio revisado si se actualiza la copia (se reemplaza el JSON de `originales/`, se actualiza el SHA-256 de la prueba y se anota aquí el commit y la fecha). Además, la documentación avisa de que cambiar una definición no actualiza sola a la asignación ni a su identidad (<https://learn.microsoft.com/en-us/azure/governance/policy/how-to/remediate-resources>: «Changing a policy definition does not automatically update the assignment or the associated managed identity.»): si `roleDefinitionIds` cambia, el rol de las cuatro identidades hay que cambiarlo igual en `azurerm_role_assignment.etiquetas`.

**Por qué no «Inherit a tag from the subscription if missing»** (`InheritTag_Add_FromSubscription.json`, `40df99da-1232-49b1-a39a-6da8d878f469`): su `mode` es `Indexed`, que no evalúa grupos de recursos. Los recursos heredan del grupo (la copia de arriba); y el grupo, de la copia de «Add a tag to resource groups».

### Fuente: Tag Contributor basta para `Modify` en etiquetas (documentación oficial de Microsoft, leída el 2026-11-18)

1. **Efecto `modify`**, <https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-modify>:
   - «Policy assignments with effect set as Modify require a managed identity to do remediation.»
   - Sobre `roleDefinitionIds`: «This property must include an array of strings that match role-based access control role ID accessible by the subscription.» y **«The role defined must include all operations granted to the Contributor/Tag Contributor role.»** Es la frase que nombra a Tag Contributor como el rol de referencia para las operaciones de etiquetas.
   - Sobre las operaciones: «Add, replace, or remove resource tags. […] For tags, a Modify policy should have mode set to indexed unless the target resource is a resource group.» (por eso la copia de grupos es `All`).
2. **Remediación**, <https://learn.microsoft.com/en-us/azure/governance/policy/how-to/remediate-resources>:
   - «When Azure Policy starts a template deployment when evaluating deployIfNotExists policies or modifies a resource when evaluating modify policies, it does so using a managed identity associated with the policy assignment.»
   - «The managed identity needs to be assigned the minimum Azure role-based access control (Azure RBAC) role required to remediate resources.»
   - «Permissions should be restricted to the smallest possible set when defining roleDefinitionIds within a policy definition or assigning permissions to a managed identity manually.»
   - Para una definición propia: «For a custom policy definition, under the details property, add a roleDefinitionIds property.» y, con un SDK o con Terraform (no el portal): «the assignment's managed identity must be manually granted access through the addition of roles, or else the remediation deployment will fail.» (por eso `azurerm_role_assignment.etiquetas`).
3. **Rol Tag Contributor**, <https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/management-and-governance> (ID `4a9ae827-6dc8-4573-8ac7-8239d42aa03f`):
   - «Lets you manage tags on entities, without providing access to the entities themselves.»
   - Acciones: `Microsoft.Authorization/*/read`, `Microsoft.Resources/subscriptions/resourceGroups/read`, `Microsoft.Resources/subscriptions/resourceGroups/resources/read`, `Microsoft.Resources/subscriptions/resources/read`, `Microsoft.Resources/deployments/*`, `Microsoft.Insights/alertRules/*`, `Microsoft.Support/*` y **`Microsoft.Resources/tags/*`**. `NotActions`, `DataActions` y `NotDataActions`: ninguna.

**Conclusión de la lectura, con su límite dicho.** Las tres páginas dicen que el rol de `roleDefinitionIds` debe cubrir lo que hacen Contributor o **Tag Contributor** (la frase nombra los dos), que debe ser el mínimo, y que Tag Contributor puede escribir etiquetas (`Microsoft.Resources/tags/*`) y leer grupos de recursos y recursos. **Ninguna página dice con esas palabras «Tag Contributor basta para esta definición integrada».** Tampoco dicen cómo escribe `Modify` en una remediación sobre un grupo de recursos (si por la API de etiquetas, que Tag Contributor cubre, o por una escritura del grupo, que no cubre: Tag Contributor **no** tiene `Microsoft.Resources/subscriptions/resourceGroups/write`). No hay evidencia en contra; sí hay una parte que solo se comprueba con Azure (pausa de D-204): en el primer despliegue de UAT, (a) que `ME_…` y `NetworkWatcherRG` salgan con las dos etiquetas y (b) que una tarea de reparación sobre un grupo y sobre un recurso existentes termine en `Succeeded` (ver «Existentes»). Si (b) falla por falta de permiso, el dueño decide; no se vuelve a Contributor sin su decisión.

### Valor de las etiquetas en los grupos

- `proyecto` = `alcanzamos`. Es el único proyecto de la suscripción.
- `ambiente` = **`sin-asignar`** (aprobado por el dueño, 2026-11-18). Un grupo que Azure crea solo no dice a qué ambiente sirve: `NetworkWatcherRG` es de toda la suscripción, y `ME_…` es del entorno de Container Apps de **un** ambiente, pero ninguna definición integrada lo deduce. Un valor falso como `uat` o `produccion` escondería el error; `sin-asignar` dice la verdad.
- Los grupos propios (`rg-alcanzamos-<ambiente>-eus2`) llevan `proyecto`, `ambiente` y `origen` desde el bootstrap, con su valor real. `Modify` solo agrega si falta: nunca cambia una etiqueta existente.
- Los recursos heredan del grupo donde nacen. Los de un `ME_…` quedan con `ambiente = sin-asignar`.
- Si hace falta la etiqueta exacta en `ME_…`, se corrige a mano después de crearse: **la regla no la revierte** (`add` + `exists: false`, ver arriba).
- La política no valida el valor de las etiquetas, solo las agrega.

### Existentes: hace falta una tarea de reparación

`Modify` actúa **al crear o actualizar** un recurso o grupo. Lo que ya existía sin etiqueta **no cambia solo**: requiere una tarea de reparación (`remediation task`) por asignación. No se crea en `apply`: dependería de que la asignación de rol ya se haya propagado (puede tardar varios minutos) y la suscripción es nueva. Si al aplicar ya existe algo, el dueño la lanza después con su cuenta, por ejemplo:

```sh
az policy remediation create --name reparar-etiqueta-proyecto-grupos --policy-assignment alcanzamos-etiqueta-proyecto-grupos
```

Una por cada una de las cuatro asignaciones. Es opcional y se puede repetir; `az policy remediation list` muestra el resultado. Primero los grupos y después los recursos, porque los recursos heredan del grupo.

### Qué puede modificar esta identidad (es un privilegio)

Cada asignación `Modify` tiene una **identidad administrada asignada por el sistema** (cuatro, `location = eastus2`), y cada una tiene el rol **Tag Contributor** (`4a9ae827-6dc8-4573-8ac7-8239d42aa03f`, el de `roleDefinitionIds` de las dos copias) con alcance **toda la suscripción** (`azurerm_role_assignment.etiquetas`, `prevent_destroy`). Ya no hay ninguna asignación de **Contributor** en esta raíz (decisión del dueño, 2026-11-18; la prueba estática lo exige).

- **Quién:** solo Azure Policy la usa, al aplicar `Modify` y en una tarea de reparación. Nadie tiene su credencial: no hay secreto, ni un pipeline ni un trabajo la usa.
- **Qué puede hacer** (acciones de Tag Contributor, arriba), en los dos ambientes, porque el alcance es toda la suscripción:
  - **Puede:** crear, cambiar y borrar etiquetas de cualquier recurso y grupo (`Microsoft.Resources/tags/*`; incluye **borrar** etiquetas, también la de `ambiente`); leer grupos de recursos y recursos; leer roles y asignaciones de roles; crear y gestionar despliegues de plantillas (`Microsoft.Resources/deployments/*`); crear y gestionar alertas clásicas de métricas (`Microsoft.Insights/alertRules/*`); crear y actualizar tickets de soporte (`Microsoft.Support/*`).
  - **No puede:** crear, cambiar ni borrar los recursos o los grupos del proyecto (no tiene `…/write` ni `…/delete` sobre ellos; las únicas escrituras que tiene son las de la lista de arriba: etiquetas, despliegues de plantillas, alertas clásicas y tickets de soporte); leer secretos ni datos (`DataActions` vacío: no entra a Key Vault, a la base ni a los blobs); asignar roles ni cambiar políticas (solo lee). Un despliegue de plantilla creado por esta identidad no podría crear recursos, porque no tiene permiso para escribirlos.
  - **Matiz:** cambiar etiquetas no es inocuo si algo decide por ellas (un presupuesto o una política por etiqueta). Hoy nada en el repositorio decide por etiquetas: la política solo las agrega.
- **Qué hace en la práctica:** solo lo que dice la copia de la definición: `add` de la etiqueta `proyecto` o `ambiente` si falta. Nunca cambia una etiqueta existente ni toca otra propiedad.
- **Quién puede abusar de ella:** quien tenga permiso de escribir asignaciones o definiciones de política en la suscripción (el dueño) podría cambiar la regla de la copia y usar la identidad. Quien aplica esta raíz es solo el dueño; el pipeline no tiene permiso en la suscripción.
- Las cuatro identidades se crean con las asignaciones y desaparecen con ellas; `prevent_destroy` evita quitarlas por descuido.

## Proveedores: cómo se registran, y confirmado en la documentación

El proveedor `azurerm` 5.11.0 (el del archivo de bloqueo) registra proveedores de recursos con su configuración. `versiones.tf` fija `resource_provider_registrations = "none"` y `resource_providers_to_register = local.proveedores` (la lista de arriba, también en la salida `proveedores_registrados`). Documentación de esa versión, <https://registry.terraform.io/providers/hashicorp/azurerm/5.11.0/docs> (fuente: `website/docs/index.html.markdown` de la etiqueta `v5.11.0`):

> `resource_provider_registrations` - (Optional) Specifies a pre-determined set of Azure Resource Providers to automatically register when initializing the AzureRM Provider. Allowed values for this property are `core`, `extended`, `all`, `legacy`, or `none`. […] Defaults to `none`.
>
> `resource_providers_to_register` - (Optional) A list of arbitrary Azure Resource Providers to automatically register when initializing the AzureRM Provider. Can be used in combination with the `resource_provider_registrations` property.
>
> **Note:** In version 5.0 and later, the default value for `resource_provider_registrations` is `none`, meaning no Resource Providers will be automatically registered. […] If you're running in an environment with restricted permissions, or wish to manage Resource Provider Registration outside of Terraform, `none` is the recommended setting.

El esquema del proveedor 5.11.0 (`tofu providers schema`) tiene los dos argumentos. Consecuencias:

- **No hay recursos de registro** (`azurerm_resource_provider_registration`) en ningún estado: ni aquí, ni en los bootstraps, ni en `infra/azure`. Así no hay dueño doble, y destruir un bootstrap no desregistra nada.
- El registro ocurre al planear o aplicar esta raíz, y es idempotente: registrar un proveedor ya registrado no falla.
- Los bootstraps y `infra/azure` llevan `resource_provider_registrations = "none"` y no registran nada. La identidad del pipeline no tiene permiso para registrar.
- Si hace falta otro proveedor (por ejemplo `Microsoft.Network` para la red de T5), se suma a `local.proveedores` en un cambio revisado y el dueño vuelve a aplicar esta raíz. No se registra a mano.

## Dónde queda su estado y quién lo guarda

- **Estado local, un archivo, en el equipo del dueño:** `infra/suscripcion/suscripcion.tfstate` (`backend "local"` con ruta fija). **Solo el dueño lo guarda.** Está en `.gitignore` y nunca se sube. Tiene los IDs de la suscripción, de las asignaciones de política y **el correo de los avisos** (dato personal del dueño).
- **Por qué local y no en la cuenta de almacenamiento de un ambiente:** el estado de la suscripción no puede depender de nada que un bootstrap cree, porque cada bootstrap se puede destruir y recrear sin afectar a la suscripción. Una cuenta de almacenamiento propia pediría crear primero otra cosa a mano, y se aplica una sola vez. Un archivo pequeño en el equipo del dueño basta.
- **Respaldo:** después del `apply`, y de cada cambio, el dueño guarda una copia cifrada en su propio respaldo personal. **No la sube a la cuenta de ningún ambiente** (el estado no puede depender de ellas).
- **Si se pierde,** no se pierde Azure: las asignaciones y los presupuestos siguen vigentes. Se recupera con `tofu import` de cada recurso (dos definiciones propias de etiquetas, cuatro asignaciones de etiquetas, cuatro asignaciones de rol de sus identidades —Tag Contributor—, dos de regiones y dos presupuestos) y se revisa que `tofu plan` no proponga cambios; sin eso no se aplica nada.

## Orden de aplicación

1. **`infra/suscripcion`, una sola vez, el dueño** (esta carpeta). Quien aplica necesita poder asignar roles en la suscripción (Owner o User Access Administrator): crea las dos definiciones propias y las cuatro asignaciones de rol (Tag Contributor) de las identidades de `Modify`. Primero, porque registra los proveedores que necesitan los bootstraps y pone la política (las etiquetas se agregan solas, así que los bootstraps no tienen que cumplir nada).
2. **`infra/bootstrap`, una vez por ambiente** (`uat` y `produccion`), el dueño.
3. **`infra/azure`,** una vez por ambiente, desde el pipeline.

```sh
cd infra/suscripcion
tofu init
tofu plan  -var="subscription_id=<suscripción de pago por uso>" -var='correos_de_alerta=["<correo del dueño>"]' -var="presupuesto_inicio=<AAAA-MM>-01T00:00:00Z"
tofu apply -var="subscription_id=<suscripción de pago por uso>" -var='correos_de_alerta=["<correo del dueño>"]' -var="presupuesto_inicio=<AAAA-MM>-01T00:00:00Z"
```

`presupuesto_inicio` es el primer día del mes en que se aplica: Azure no admite un mes ya pasado (después no se vuelve a evaluar, `ignore_changes`).

## Riesgos conocidos al aplicar

- **Etiquetas y grupos que crea Azure.** Con `Modify`, `ME_…` y `NetworkWatcherRG` no deberían rechazarse, y se espera que nazcan con `ambiente = sin-asignar` (ver «Valor de las etiquetas en los grupos»). Se comprueba en el primer despliegue de UAT (T5, T7), junto con una tarea de reparación sobre un grupo y un recurso existentes (ver «Fuente: Tag Contributor basta…», el límite de la lectura). El costo de `Modify` es una identidad con Tag Contributor en la suscripción, no Contributor.
- **Cambiar el nombre de una definición propia la reemplaza** (y con ella el ID que usan las asignaciones), y `prevent_destroy` lo rechaza. Cambiar su regla la actualiza en sitio. Esta versión no afecta nada porque nada se ha aplicado (pausa de D-204); si algún día hay que reemplazar una definición ya aplicada, hay que quitar la protección en un cambio revisado.
- **Las copias no siguen a las integradas** (ver «Copias de las definiciones integradas»): revisarlas en cada cambio de Azure Policy.
- La política no valida el valor de las etiquetas, solo que existan.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con el proveedor simulado:

- `tests/suscripcion.tftest.hcl`: las asignaciones de regiones (siguen con `Deny` y con las definiciones integradas); las dos definiciones propias (copia exacta de `originales/` salvo `roleDefinitionIds` = Tag Contributor, nombre y descripción que dicen que son copias, SHA-256 de los originales); que la regla usa `add` y `exists: false` (una corrección a mano no se revierte); las asignaciones de etiquetas (usan las copias, parámetros exactos con `ambiente` = `sin-asignar`, identidad `SystemAssigned` con `location = eastus2`, ninguna con `effect` ni `Deny`); el rol de las cuatro identidades (Tag Contributor en la suscripción, nunca Contributor), los dos presupuestos (montos y avisos), la lista de proveedores y que se rechacen valores inválidos.
- `tests/estatico.tftest.hcl`: lo que el plan no expone, leído de los archivos: sin recursos de registro de proveedores, `resource_provider_registrations = "none"` con `resource_providers_to_register`, `prevent_destroy` en cada recurso (cinco: regiones, definiciones propias, asignaciones de etiquetas, su rol y presupuestos), ninguna asignación ni `roleDefinitionIds` con Contributor en los `.tf`, ningún `addOrReplace`, `sin-asignar` y ni rastro del valor anterior de `ambiente`, el rol asignado al `principal_id` de la identidad de la asignación, las definiciones `Require a tag` (`Deny`) ausentes y sin `azuread`.

```sh
cd infra/suscripcion
tofu init -backend=false
tofu validate
tofu test
```
