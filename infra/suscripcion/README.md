# infra/suscripcion/

Lo que es **de la suscripción de pago por uso y no de un ambiente** (D-205 (11), E11-INF 2.17). Los dos ambientes (UAT y producción) comparten esa suscripción, así que esto existe **una sola vez**: lo aplica el dueño, **una sola vez**, con su cuenta, **antes** de los bootstraps y de `infra/azure`. Ningún bootstrap ni el pipeline lo toca.

Nada de esto se aplica mientras siga la pausa de D-204.

## Qué lleva

1. **Registro de los proveedores de recursos** (O-14, D-076), con la configuración del proveedor `azurerm`, **no como recursos**: `Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.Insights`, `Microsoft.KeyVault`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights` y `Microsoft.Storage`. No se registra `Microsoft.Communication`: el correo sale por Zoho CPaaS (D-205). Nunca se registran a mano con `az provider register`.
2. **Política P1** (Azure Policy, definiciones integradas, asignadas a la suscripción). Las **regiones** siguen con efecto `Deny`; las **etiquetas** `proyecto` y `ambiente` ya **no se exigen**: se **agregan o se heredan** con efecto `Modify` y nunca se rechaza un recurso por no llevarlas (decisión del dueño, 2026-11-18):

   | Asignación | Definición integrada | ID | Efecto | Parámetros |
   |---|---|---|---|---|
   | `alcanzamos-regiones-recursos` | Allowed locations | `e56962a6-4747-49cd-b67b-bf8b01975c4c` | `Deny` | `listOfAllowedLocations` = `eastus2`, `centralus`, `global` |
   | `alcanzamos-regiones-grupos` | Allowed locations for resource groups | `e765b5de-1225-4ba3-bd56-1ac6695af988` | `Deny` | `listOfAllowedLocations` = `eastus2`, `centralus`, `global` |
   | `alcanzamos-etiqueta-proyecto-recursos` y `alcanzamos-etiqueta-ambiente-recursos` | Inherit a tag from the resource group if missing | `ea3f2387-9b95-492a-a190-fcdc54f7b070` | `Modify` (fijo en la definición) | `tagName` = `proyecto` / `ambiente` |
   | `alcanzamos-etiqueta-proyecto-grupos` | Add a tag to resource groups | `726aca4c-86e9-4b04-b0c5-073027359532` | `Modify` (fijo en la definición) | `tagName` = `proyecto`, `tagValue` = `alcanzamos` |
   | `alcanzamos-etiqueta-ambiente-grupos` | Add a tag to resource groups | `726aca4c-86e9-4b04-b0c5-073027359532` | `Modify` (fijo en la definición) | `tagName` = `ambiente`, `tagValue` = `compartido` |

   `eastus2` es la región (D-208); `centralus` solo sirve para restaurar el respaldo georredundante de PostgreSQL (la política no puede distinguir ese uso: nada se crea allí antes del desastre, P12). Las definiciones se tomaron de `Azure/azure-policy` (`built-in-policies/policyDefinitions`; las de etiquetas, de `Tags/`, ver abajo). Las dos de etiquetas de la versión anterior (`Require a tag on resources`, `871b6d14-…`, y `Require a tag on resource groups`, `96670d01-…`, ambas `Deny`) ya no se asignan.
3. **Presupuestos de la suscripción** (T9, D-206), mensuales, con aviso por correo (no detienen nada):

   | Presupuesto | Monto | Avisos (operador «mayor que») |
   |---|---|---|
   | `alcanzamos-gratuitos` | 2 USD | 50 y 100 % del gasto real. Cualquier gasto comprueba que un servicio gratuito dejó de serlo |
   | `alcanzamos-tope` | 24 USD (tope del dueño) | 50, 75, 90 y 100 % del gasto real y 100 % del gasto previsto (cinco avisos, el máximo de Azure) |

   El correo es la variable `correos_de_alerta`. Los presupuestos por grupo de recursos van en `infra/azure` (T9).

4. **Identidades y rol de las asignaciones Modify** (cuatro `azurerm_role_assignment`, una por asignación de etiquetas): ver «Etiquetas: se agregan o se heredan».

Todos los recursos llevan `prevent_destroy = true`: mientras el bloque permanezca en la configuración, OpenTofu rechaza planes que lo destruyan. Eliminar el bloque también elimina esa protección; cualquier retirada de recursos exige revisión explícita.

## Etiquetas: se agregan o se heredan

**Por qué `Modify` y no `Deny`.** Con `Deny`, Azure rechazaba los grupos que crea por su cuenta y sin etiquetas: `ME_…` (grupo administrado de Container Apps con perfiles de carga de trabajo), `NetworkWatcherRG` (al crear la primera red virtual) y otros (`DefaultResourceGroup-…`). Con `Modify`, la etiqueta se agrega en la misma solicitud y nada se rechaza. No hace falta ninguna exclusión (`not_scopes`). No se puede comprobar sin Azure: se mira en el primer despliegue de UAT que `ME_…` y `NetworkWatcherRG` salen con las dos etiquetas.

### Definiciones usadas (citadas de `Azure/azure-policy`, rama `master`, `built-in-policies/policyDefinitions/Tags/`)

**`InheritTag_Add_Modify.json`**, para recursos:

- `id`: `/providers/Microsoft.Authorization/policyDefinitions/ea3f2387-9b95-492a-a190-fcdc54f7b070`
- `displayName`: «Inherit a tag from the resource group if missing»; `mode`: `Indexed` (solo recursos, no grupos).
- `description`: «Adds the specified tag with its value from the parent resource group when any resource missing this tag is created or updated. Existing resources can be remediated by triggering a remediation task. If the tag exists with a different value it will not be changed.»
- Parámetros: solo `tagName` (`String`). No tiene parámetro `effect`.
- Regla: si el recurso no tiene `tags[tagName]` **y** `resourceGroup().tags[tagName]` no está vacío, `effect: modify`, operación `add` de `tags[tagName]` con el valor de la etiqueta del grupo.
- `roleDefinitionIds`: `/providers/microsoft.authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c` (Contributor).

**`AddTag_ResourceGroup_Modify.json`**, para grupos de recursos:

- `id`: `/providers/Microsoft.Authorization/policyDefinitions/726aca4c-86e9-4b04-b0c5-073027359532`
- `displayName`: «Add a tag to resource groups»; `mode`: `All`.
- `description`: «Adds the specified tag and value when any resource group missing this tag is created or updated. Existing resource groups can be remediated by triggering a remediation task. If the tag exists with a different value it will not be changed.»
- Parámetros: `tagName` y `tagValue` (`String`). No tiene parámetro `effect`.
- Regla: si `type` es `Microsoft.Resources/subscriptions/resourceGroups` y no tiene `tags[tagName]`, `effect: modify`, operación `add` de `tags[tagName]` con `tagValue`.
- `roleDefinitionIds`: `/providers/microsoft.authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c` (Contributor).

Como el efecto está fijo en la definición, la asignación **no pasa `effect`** (la prueba lo exige).

**Por qué no «Inherit a tag from the subscription if missing»** (`InheritTag_Add_FromSubscription.json`, `40df99da-1232-49b1-a39a-6da8d878f469`): su `mode` es `Indexed`, que no evalúa grupos de recursos. Sirve para recursos, no para dar la etiqueta a un grupo. Los recursos heredan del grupo (la definición de arriba); y el grupo, de «Add a tag to resource groups».

### Valor de las etiquetas en los grupos: decisión y límite

> **El dueño no dio estos valores: son una propuesta del equipo (2026-11-18). Hay que confirmarlos.**

- `proyecto` = `alcanzamos`. Es el único proyecto de la suscripción; no hay ambigüedad.
- `ambiente` = `compartido`. Un grupo que Azure crea solo no dice a qué ambiente sirve. `NetworkWatcherRG` es de toda la suscripción: `compartido` es correcto. `ME_…` pertenece al entorno de Container Apps de **un** ambiente (UAT o producción) y `compartido` es **impreciso** para él. Ninguna definición integrada deduce el ambiente (la herencia desde la suscripción no toca grupos, y no hay una relación entre `ME_…` y su grupo de origen). Se descartó poner `uat` o `produccion` por defecto: sería falso la mitad de las veces y escondería el error.
- Los grupos propios (`rg-alcanzamos-<ambiente>-eus2`) llevan `proyecto`, `ambiente` y `origen` desde el bootstrap, con su valor real. `Modify` solo agrega si falta: nunca cambia una etiqueta existente.
- Los recursos heredan del grupo donde nacen. Los de un `ME_…` quedan con `ambiente = compartido`.
- Si el dueño quiere la etiqueta exacta en `ME_…`: (a) corregirla a mano después de crearse (`Modify` no la revierte), o (b) una definición **propia** que deduzca el ambiente del nombre del grupo (`ME_<entorno>_…`, donde el nombre del entorno lleva `uat` o `prod`). La (b) no es una definición integrada; no se hizo sin pedirlo.
- La política no valida el valor de las etiquetas, solo las agrega.

### Existentes: hace falta una tarea de reparación

`Modify` actúa **al crear o actualizar** un recurso o grupo. Lo que ya existía sin etiqueta **no cambia solo**: requiere una tarea de reparación (`remediation task`) por asignación. No se crea en `apply`: dependería de que la asignación de rol ya se haya propagado (puede tardar varios minutos) y la suscripción es nueva. Si al aplicar ya existe algo, el dueño la lanza después con su cuenta, por ejemplo:

```sh
az policy remediation create --name reparar-etiqueta-proyecto-grupos --policy-assignment alcanzamos-etiqueta-proyecto-grupos
```

Una por cada una de las cuatro asignaciones. Es opcional y se puede repetir; `az policy remediation list` muestra el resultado. Primero los grupos y después los recursos, porque los recursos heredan del grupo.

### Qué puede modificar esta identidad (es un privilegio)

Cada asignación `Modify` tiene una **identidad administrada asignada por el sistema** (cuatro, `location = eastus2`), y cada una tiene el rol **Contributor** (`b24988ac-6180-42a0-ab88-20f7382dd24c`, el de `roleDefinitionIds` de las dos definiciones) con alcance **toda la suscripción** (`azurerm_role_assignment.etiquetas`, `prevent_destroy`).

- **Quién:** solo Azure Policy la usa, al aplicar `Modify` y en una tarea de reparación. Nadie tiene su credencial: no hay secreto, ni un pipeline ni un trabajo la usa.
- **Qué podría hacer, en teoría:** Contributor puede crear, cambiar y borrar **cualquier recurso** de la suscripción (los dos ambientes). No puede asignar roles ni cambiar políticas. Es más de lo que hace falta.
- **Qué hace en la práctica:** solo lo que dice la definición integrada (de Microsoft, no editable aquí): `add` de la etiqueta `proyecto` o `ambiente` si falta. Nunca cambia una etiqueta existente ni toca otra propiedad.
- **Por qué Contributor y no «Tag Contributor»:** las dos definiciones declaran Contributor en `roleDefinitionIds`: es el rol que Azure Policy espera que tenga la identidad. Se sigue la definición. Reducirlo a «Tag Contributor» sería menos privilegio, pero no se pudo comprobar sin Azure (pausa de D-204) si basta; se puede probar en UAT.
- **Quién puede abusar de ella:** quien tenga permiso de escribir asignaciones de política en la suscripción (el dueño) podría cambiar la definición asignada y usar la identidad. Quien aplique esta raíz es solo el dueño; el pipeline no tiene permiso en la suscripción.
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
- **Si se pierde,** no se pierde Azure: las asignaciones y los presupuestos siguen vigentes. Se recupera con `tofu import` de cada recurso (cuatro asignaciones de etiquetas, cuatro asignaciones de rol de sus identidades, dos de regiones y dos presupuestos) y se revisa que `tofu plan` no proponga cambios; sin eso no se aplica nada.

## Orden de aplicación

1. **`infra/suscripcion`, una sola vez, el dueño** (esta carpeta). Quien aplica necesita poder asignar roles en la suscripción (Owner o User Access Administrator): crea las cuatro asignaciones de rol de las identidades de `Modify`. Primero, porque registra los proveedores que necesitan los bootstraps y pone la política (las etiquetas se agregan solas, así que los bootstraps no tienen que cumplir nada).
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

- **Etiquetas y grupos que crea Azure.** Con `Modify`, `ME_…` y `NetworkWatcherRG` no se rechazan, pero nacen con `ambiente = compartido` (ver «Valor de las etiquetas en los grupos»). Se comprueba en el primer despliegue de UAT (T5, T7). Una identidad con Contributor en la suscripción es el costo de `Modify`.
- **Cambiar la definición de una asignación ya aplicada la reemplaza,** y `prevent_destroy` lo rechaza. Esta versión no afecta nada porque nada se ha aplicado (pausa de D-204); si algún día una asignación ya aplicada cambia de definición, hay que quitar la protección en un cambio revisado.
- La política no valida el valor de las etiquetas, solo que existan.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con el proveedor simulado:

- `tests/suscripcion.tftest.hcl`: las asignaciones de regiones (siguen con `Deny`) y de etiquetas (definiciones `Modify`, parámetros exactos, identidad `SystemAssigned` con `location = eastus2`, rol Contributor en la suscripción, ninguna con `effect` ni `Deny`), los dos presupuestos (montos y avisos), la lista de proveedores y que se rechacen valores inválidos.
- `tests/estatico.tftest.hcl`: lo que el plan no expone, leído de los archivos: sin recursos de registro de proveedores, `resource_provider_registrations = "none"` con `resource_providers_to_register`, `prevent_destroy` en cada recurso (cuatro), el rol asignado al `principal_id` de la identidad de la asignación, las definiciones `Require a tag` (`Deny`) ausentes y sin `azuread`.

```sh
cd infra/suscripcion
tofu init -backend=false
tofu validate
tofu test
```
