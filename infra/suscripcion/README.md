# infra/suscripcion/

Lo que es **de la suscripción de pago por uso y no de un ambiente** (D-205 (11), E11-INF 2.17). Los dos ambientes (UAT y producción) comparten esa suscripción, así que esto existe **una sola vez**: lo aplica el dueño, **una sola vez**, con su cuenta, **antes** de los bootstraps y de `infra/azure`. Ningún bootstrap ni el pipeline lo toca.

Nada de esto se aplica mientras siga la pausa de D-204.

## Qué lleva

1. **Registro de los proveedores de recursos** (O-14, D-076), con la configuración del proveedor `azurerm`, **no como recursos**: `Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.Insights`, `Microsoft.KeyVault`, `Microsoft.ManagedIdentity`, `Microsoft.OperationalInsights` y `Microsoft.Storage`. No se registra `Microsoft.Communication`: el correo sale por Zoho CPaaS (D-205). Nunca se registran a mano con `az provider register`.
2. **Política P1** (Azure Policy, definiciones integradas, asignadas a la suscripción, efecto `Deny`):

   | Asignación | Definición integrada | ID | Parámetro |
   |---|---|---|---|
   | `alcanzamos-regiones-recursos` | Allowed locations | `e56962a6-4747-49cd-b67b-bf8b01975c4c` | `eastus2`, `centralus`, `global` |
   | `alcanzamos-regiones-grupos` | Allowed locations for resource groups | `e765b5de-1225-4ba3-bd56-1ac6695af988` | `eastus2`, `centralus`, `global` |
   | `alcanzamos-etiqueta-proyecto-recursos` y `alcanzamos-etiqueta-ambiente-recursos` | Require a tag on resources | `871b6d14-10aa-478d-b590-94f262ecfa99` | `tagName` = `proyecto` / `ambiente` |
   | `alcanzamos-etiqueta-proyecto-grupos` y `alcanzamos-etiqueta-ambiente-grupos` | Require a tag on resource groups | `96670d01-0a4d-4649-9c89-2d3abc0a5025` | `tagName` = `proyecto` / `ambiente` |

   `eastus2` es la región (D-208); `centralus` solo sirve para restaurar el respaldo georredundante de PostgreSQL (la política no puede distinguir ese uso: nada se crea allí antes del desastre, P12). Las definiciones se tomaron de `Azure/azure-policy` (`built-in-policies/policyDefinitions`).
3. **Presupuestos de la suscripción** (T9, D-206), mensuales, con aviso por correo (no detienen nada):

   | Presupuesto | Monto | Avisos (operador «mayor que») |
   |---|---|---|
   | `alcanzamos-gratuitos` | 2 USD | 50 y 100 % del gasto real. Cualquier gasto comprueba que un servicio gratuito dejó de serlo |
   | `alcanzamos-tope` | 24 USD (tope del dueño) | 50, 75, 90 y 100 % del gasto real y 100 % del gasto previsto (cinco avisos, el máximo de Azure) |

   El correo es la variable `correos_de_alerta`. Los presupuestos por grupo de recursos van en `infra/azure` (T9).

Todos los recursos llevan `prevent_destroy = true`: mientras el bloque permanezca en la configuración, OpenTofu rechaza planes que lo destruyan. Eliminar el bloque también elimina esa protección; cualquier retirada de recursos exige revisión explícita.

**Grupos administrados y la política de etiquetas.** La política de etiquetas no tiene exclusiones. Un grupo que Azure crea por su cuenta y sin etiquetas puede ser rechazado: `ME_…` (Container Apps con perfiles de carga de trabajo), `NetworkWatcherRG` o `DefaultResourceGroup-…`. No se puede comprobar sin Azure. Se mira en el primer despliegue de UAT. Si pasa, se suman exclusiones exactas con `not_scopes`, con el ID de cada grupo y una revisión. Nunca una exclusión amplia de los grupos del proyecto.

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
- **Si se pierde,** no se pierde Azure: las asignaciones y los presupuestos siguen vigentes. Se recupera con `tofu import` de cada recurso (cuatro asignaciones de etiquetas, dos de regiones y dos presupuestos) y se revisa que `tofu plan` no proponga cambios; sin eso no se aplica nada.

## Orden de aplicación

1. **`infra/suscripcion`, una sola vez, el dueño** (esta carpeta). Primero, porque registra los proveedores que necesitan los bootstraps y pone la política que ellos ya cumplen.
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

- **Etiquetas obligatorias y grupos que crea Azure.** Container Apps con perfiles de carga de trabajo crea un grupo administrado (`ME_…`); si Azure lo crea sin las etiquetas, la política `Deny` lo rechazaría. Se comprueba en el primer despliegue de UAT (T5, T7). Si falla, se ajusta con un cambio revisado de esta raíz (por ejemplo `not_scopes`), no a mano.
- La política no valida el valor de las etiquetas, solo que existan.

## Validación

Sin credenciales y sin aplicar. `tofu test` hace solo plan, con el proveedor simulado:

- `tests/suscripcion.tftest.hcl`: las asignaciones de regiones y de etiquetas (definiciones, parámetros, regiones), los dos presupuestos (montos y avisos), la lista de proveedores y que se rechacen valores inválidos.
- `tests/estatico.tftest.hcl`: lo que el plan no expone, leído de los archivos: sin recursos de registro de proveedores, `resource_provider_registrations = "none"` con `resource_providers_to_register`, `prevent_destroy` en cada recurso y sin `azuread`.

```sh
cd infra/suscripcion
tofu init -backend=false
tofu validate
tofu test
```
