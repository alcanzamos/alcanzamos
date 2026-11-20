locals {
  alcance = "/subscriptions/${var.subscription_id}"

  # Proveedores aprobados por el dueño (O-14, D-076) más los que pide D-205: Microsoft.Network (red virtual, subredes, zona DNS privada,
  # punto de conexión de servicio), Microsoft.PolicyInsights (la remediación de las políticas Modify de P1) y Microsoft.Consumption (los presupuestos).
  # Ya no se registra Microsoft.Communication: el correo sale por Zoho CPaaS (D-205).
  proveedores = [
    "Microsoft.App",
    "Microsoft.Consumption",
    "Microsoft.DBforPostgreSQL",
    "Microsoft.Insights",
    "Microsoft.KeyVault",
    "Microsoft.ManagedIdentity",
    "Microsoft.Network",
    "Microsoft.OperationalInsights",
    "Microsoft.PolicyInsights",
    "Microsoft.Storage",
  ]

  # P1 (D-208): East US 2, Central US solo para restaurar el respaldo georredundante de PostgreSQL, y global.
  regiones_permitidas = ["eastus2", "centralus", "global"]

  # Definiciones integradas de Azure Policy de regiones, por su ID fijo (Azure/azure-policy, built-in-policies). Siguen con efecto Deny.
  definiciones = {
    regiones_recursos = "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c" # Allowed locations
    regiones_grupos   = "/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988" # Allowed locations for resource groups
  }

  # Decisión del dueño (2026-11-18): las etiquetas se agregan o se heredan, no se exigen (Modify, no Deny). Así Azure no rechaza los
  # grupos que crea por su cuenta (ME_… de Container Apps, NetworkWatcherRG, DefaultResourceGroup-…).
  # Valor de cada etiqueta en un grupo que nace sin ella (aprobado por el dueño, 2026-11-18):
  #  - proyecto: el único proyecto de la suscripción.
  #  - ambiente: «sin-asignar». Un grupo que Azure crea solo no dice a qué ambiente sirve y ninguna definición lo deduce. Los grupos propios
  #    llevan su valor real desde el bootstrap (uat / produccion). La regla usa «add» y solo actúa si la etiqueta no existe, así que corregirla
  #    a mano no se revierte (prueba «correccion_a_mano_no_se_revierte»).
  etiquetas_de_grupos = {
    proyecto = "alcanzamos"
    ambiente = "sin-asignar"
  }

  # Decisión del dueño (2026-11-18): las identidades de Modify no reciben Contributor. Las dos definiciones Modify integradas declaran
  # Contributor en roleDefinitionIds; aquí hay COPIAS PROPIAS que cambian solo eso, a Tag Contributor (ver el README: fuente y límites).
  # Los originales, literales, están en originales/ (mode, parámetros y regla salen de ahí: no se reescriben a mano).
  rol_tag_contributor = "4a9ae827-6dc8-4573-8ac7-8239d42aa03f"
  copias_de_etiquetas = {
    recursos = {
      archivo     = "InheritTag_Add_Modify.json"
      nombre      = "alcanzamos-copia-heredar-etiqueta-del-grupo"
      original    = "Inherit a tag from the resource group if missing"
      original_id = "ea3f2387-9b95-492a-a190-fcdc54f7b070"
    }
    grupos = {
      archivo     = "AddTag_ResourceGroup_Modify.json"
      nombre      = "alcanzamos-copia-agregar-etiqueta-a-grupos"
      original    = "Add a tag to resource groups"
      original_id = "726aca4c-86e9-4b04-b0c5-073027359532"
    }
  }
  originales = { for k, c in local.copias_de_etiquetas : k => jsondecode(file("${path.module}/originales/${c.archivo}")).properties }

  # roleDefinitionIds de las dos copias: Tag Contributor (ID integrado, sin la suscripción, como en las definiciones integradas).
  rol_de_las_copias = "/providers/Microsoft.Authorization/roleDefinitions/${local.rol_tag_contributor}"
  # Rol de cada identidad de las asignaciones, en la suscripción: el mismo Tag Contributor.
  rol_de_modify = "${local.alcance}/providers/Microsoft.Authorization/roleDefinitions/${local.rol_tag_contributor}"

  # T9 (D-206): 2 USD para comprobar los servicios gratuitos; 24 USD, el tope del dueño. Azure admite hasta cinco avisos por presupuesto.
  presupuestos = {
    gratuitos = {
      monto  = 2
      avisos = [["Actual", 50], ["Actual", 100], ["Forecasted", 100]]
    }
    tope = {
      monto  = 24
      avisos = [["Actual", 50], ["Actual", 75], ["Actual", 90], ["Actual", 100], ["Forecasted", 100]]
    }
  }
}

# P1: solo las regiones permitidas, para los recursos y para los grupos de recursos. Niega (Deny) lo demás.
resource "azurerm_subscription_policy_assignment" "regiones" {
  for_each = {
    recursos = { definicion = local.definiciones.regiones_recursos, nombre = "alcanzamos-regiones-recursos", titulo = "Regiones permitidas para recursos" }
    grupos   = { definicion = local.definiciones.regiones_grupos, nombre = "alcanzamos-regiones-grupos", titulo = "Regiones permitidas para grupos de recursos" }
  }

  name                 = each.value.nombre
  display_name         = each.value.titulo
  description          = "Solo eastus2, centralus (para restaurar el respaldo georredundante) y global (P1, D-208)."
  subscription_id      = local.alcance
  policy_definition_id = each.value.definicion
  enforce              = true
  parameters = jsonencode({
    listOfAllowedLocations = { value = local.regiones_permitidas }
    effect                 = { value = "Deny" }
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Copias propias de las dos definiciones Modify integradas. Idénticas (mode, parámetros, «if», efecto y operaciones) salvo roleDefinitionIds:
# Tag Contributor en lugar de Contributor. Las actualiza Microsoft en la integrada y aquí NO se enteran: ver el README, «Copias de las definiciones».
# Se crean en la suscripción (sin management_group_id). Cambiar el nombre las reemplaza, y prevent_destroy lo rechaza.
resource "azurerm_policy_definition" "etiquetas" {
  for_each = local.copias_de_etiquetas

  name         = each.value.nombre
  policy_type  = "Custom"
  mode         = local.originales[each.key].mode
  display_name = "Copia de «${each.value.original}» con Tag Contributor"
  description  = "Esta definición es una copia, tomada de Azure/azure-policy el 2026-11-18, de la integrada «${each.value.original}» (${each.value.original_id}), idéntica salvo roleDefinitionIds: usa Tag Contributor en lugar de Contributor, para que la identidad de la asignación solo pueda escribir etiquetas (decisión del dueño, 2026-11-18). No recibe las actualizaciones de la integrada."
  parameters   = jsonencode(local.originales[each.key].parameters)
  metadata = jsonencode({
    category = "Tags"
    version  = "1.0.0"
    copiaDe  = each.value.original_id
  })

  policy_rule = jsonencode({
    if = local.originales[each.key].policyRule.if
    then = {
      effect = local.originales[each.key].policyRule.then.effect
      details = {
        roleDefinitionIds = [local.rol_de_las_copias]
        operations        = local.originales[each.key].policyRule.then.details.operations
      }
    }
  })

  lifecycle {
    prevent_destroy = true
  }
}

# P1: las etiquetas proyecto y ambiente se agregan o se heredan (Modify), nunca se rechazan. Una asignación por etiqueta y por definición:
#  - recursos: copia de «Inherit a tag from the resource group if missing» (hereda del grupo si el recurso no la tiene);
#  - grupos: copia de «Add a tag to resource groups» (agrega el valor por defecto si el grupo no la tiene).
# Modify necesita identidad administrada en la asignación, con su ubicación, y el rol de la definición (azurerm_role_assignment.etiquetas).
resource "azurerm_subscription_policy_assignment" "etiquetas" {
  for_each = {
    for par in setproduct(["recursos", "grupos"], keys(local.etiquetas_de_grupos)) :
    "${par[0]}-${par[1]}" => { etiqueta = par[1], objeto = par[0] }
  }

  name                 = "alcanzamos-etiqueta-${each.value.etiqueta}-${each.value.objeto}"
  display_name         = "Etiqueta ${each.value.etiqueta}: agregar o heredar en ${each.value.objeto}"
  description          = each.value.objeto == "recursos" ? "Un recurso sin la etiqueta ${each.value.etiqueta} la hereda de su grupo de recursos (P1). No rechaza nada." : "Un grupo de recursos sin la etiqueta ${each.value.etiqueta} recibe ${local.etiquetas_de_grupos[each.value.etiqueta]} (P1). No rechaza nada."
  subscription_id      = local.alcance
  policy_definition_id = azurerm_policy_definition.etiquetas[each.value.objeto].id
  enforce              = true
  location             = "eastus2"
  parameters = jsonencode(
    each.value.objeto == "recursos"
    ? { tagName = { value = each.value.etiqueta } }
    : { tagName = { value = each.value.etiqueta }, tagValue = { value = local.etiquetas_de_grupos[each.value.etiqueta] } }
  )

  identity {
    type = "SystemAssigned"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# El rol de cada identidad de las asignaciones Modify, en la suscripción: el de roleDefinitionIds de las copias (Tag Contributor, no Contributor).
# Es un privilegio: ver el README, «Qué puede modificar esta identidad».
resource "azurerm_role_assignment" "etiquetas" {
  for_each = azurerm_subscription_policy_assignment.etiquetas

  scope              = local.alcance
  role_definition_id = local.rol_de_modify
  principal_id       = azurerm_subscription_policy_assignment.etiquetas[each.key].identity[0].principal_id
  # Una identidad recién creada tarda en replicarse en Entra: con el tipo declarado y sin la consulta a Entra, la asignación no falla por eso.
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
  description                      = "Tag Contributor de la identidad de la política ${each.value.name} (Modify, P1). Solo la usa Azure Policy."

  lifecycle {
    prevent_destroy = true
  }
}

# T9: presupuestos de la suscripción. Avisan por correo; no detienen nada.
resource "azurerm_consumption_budget_subscription" "suscripcion" {
  for_each = local.presupuestos

  name            = "alcanzamos-${each.key}"
  subscription_id = local.alcance
  amount          = each.value.monto
  time_grain      = "Monthly"

  time_period {
    start_date = var.presupuesto_inicio
  }

  dynamic "notification" {
    for_each = each.value.avisos

    content {
      enabled        = true
      operator       = "GreaterThan"
      threshold      = notification.value[1]
      threshold_type = notification.value[0]
      contact_emails = var.correos_de_alerta
    }
  }

  lifecycle {
    prevent_destroy = true
    # Azure no admite una fecha de inicio de un mes ya pasado: cambiarla después no recrea el presupuesto.
    ignore_changes = [time_period]
  }
}
