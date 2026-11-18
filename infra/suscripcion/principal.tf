locals {
  alcance = "/subscriptions/${var.subscription_id}"

  # Proveedores aprobados por el dueño (O-14, D-076). Ya no se registra Microsoft.Communication: el correo sale por Zoho CPaaS (D-205).
  proveedores = [
    "Microsoft.App",
    "Microsoft.DBforPostgreSQL",
    "Microsoft.Insights",
    "Microsoft.KeyVault",
    "Microsoft.ManagedIdentity",
    "Microsoft.OperationalInsights",
    "Microsoft.Storage",
  ]

  # P1 (D-208): East US 2, Central US solo para restaurar el respaldo georredundante de PostgreSQL, y global.
  regiones_permitidas = ["eastus2", "centralus", "global"]

  # Definiciones integradas de Azure Policy, por su ID fijo (Azure/azure-policy, built-in-policies).
  definiciones = {
    regiones_recursos = "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c" # Allowed locations
    regiones_grupos   = "/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988" # Allowed locations for resource groups
    etiqueta_recursos = "/providers/Microsoft.Authorization/policyDefinitions/ea3f2387-9b95-492a-a190-fcdc54f7b070" # Inherit a tag from the resource group if missing (Modify)
    etiqueta_grupos   = "/providers/Microsoft.Authorization/policyDefinitions/726aca4c-86e9-4b04-b0c5-073027359532" # Add a tag to resource groups (Modify)
  }

  # Decisión del dueño (2026-11-18): las etiquetas se agregan o se heredan, no se exigen (Modify, no Deny). Así Azure no rechaza los
  # grupos que crea por su cuenta (ME_… de Container Apps, NetworkWatcherRG, DefaultResourceGroup-…).
  # Valor de cada etiqueta en un grupo que nace sin ella. PROPUESTA del equipo, no dada por el dueño (ver README):
  #  - proyecto: el único proyecto de la suscripción.
  #  - ambiente: «compartido». Un grupo que Azure crea solo no dice a qué ambiente sirve (NetworkWatcherRG es de toda la suscripción;
  #    ME_… es de un entorno de UAT o de producción, pero ninguna definición integrada lo deduce). Los grupos propios llevan su valor real
  #    desde el bootstrap (uat / produccion) y Modify nunca cambia una etiqueta que ya existe.
  etiquetas_de_grupos = {
    proyecto = "alcanzamos"
    ambiente = "compartido"
  }

  # roleDefinitionIds de las dos definiciones Modify (idénticos): Contributor. Azure Policy usa ese rol para escribir la etiqueta.
  rol_de_modify = "${local.alcance}/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c"

  # T9 (D-206): 2 USD para comprobar los servicios gratuitos; 24 USD, el tope del dueño. Azure admite hasta cinco avisos por presupuesto.
  presupuestos = {
    gratuitos = {
      monto  = 2
      avisos = [["Actual", 50], ["Actual", 100]]
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

# P1: las etiquetas proyecto y ambiente se agregan o se heredan (Modify), nunca se rechazan. Una asignación por etiqueta y por definición:
#  - recursos: «Inherit a tag from the resource group if missing» (hereda del grupo si el recurso no la tiene);
#  - grupos: «Add a tag to resource groups» (agrega el valor por defecto si el grupo no la tiene).
# Modify necesita identidad administrada en la asignación, con su ubicación, y el rol de la definición (azurerm_role_assignment.etiquetas).
resource "azurerm_subscription_policy_assignment" "etiquetas" {
  for_each = {
    for par in setproduct(["recursos", "grupos"], keys(local.etiquetas_de_grupos)) :
    "${par[0]}-${par[1]}" => { definicion = local.definiciones["etiqueta_${par[0]}"], etiqueta = par[1], objeto = par[0] }
  }

  name                 = "alcanzamos-etiqueta-${each.value.etiqueta}-${each.value.objeto}"
  display_name         = "Etiqueta ${each.value.etiqueta}: agregar o heredar en ${each.value.objeto}"
  description          = each.value.objeto == "recursos" ? "Un recurso sin la etiqueta ${each.value.etiqueta} la hereda de su grupo de recursos (P1). No rechaza nada." : "Un grupo de recursos sin la etiqueta ${each.value.etiqueta} recibe ${local.etiquetas_de_grupos[each.value.etiqueta]} (P1). No rechaza nada."
  subscription_id      = local.alcance
  policy_definition_id = each.value.definicion
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

# El rol de cada identidad de las asignaciones Modify, en la suscripción: el de roleDefinitionIds de la definición (Contributor).
# Es un privilegio: ver el README, «Qué puede modificar esta identidad».
resource "azurerm_role_assignment" "etiquetas" {
  for_each = azurerm_subscription_policy_assignment.etiquetas

  scope              = local.alcance
  role_definition_id = local.rol_de_modify
  principal_id       = azurerm_subscription_policy_assignment.etiquetas[each.key].identity[0].principal_id
  # Una identidad recién creada tarda en replicarse en Entra: con el tipo declarado y sin la consulta a Entra, la asignación no falla por eso.
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
  description                      = "Rol de la identidad de la política ${each.value.name} (Modify, P1). Solo la usa Azure Policy."

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
