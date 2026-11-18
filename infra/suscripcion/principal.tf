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
    etiqueta_recursos = "/providers/Microsoft.Authorization/policyDefinitions/871b6d14-10aa-478d-b590-94f262ecfa99" # Require a tag on resources
    etiqueta_grupos   = "/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025" # Require a tag on resource groups
  }

  etiquetas_obligatorias = ["proyecto", "ambiente"]

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

# P1: las etiquetas proyecto y ambiente son obligatorias, en recursos y en grupos. Una definición por etiqueta.
resource "azurerm_subscription_policy_assignment" "etiquetas" {
  for_each = {
    for par in setproduct(["recursos", "grupos"], local.etiquetas_obligatorias) :
    "${par[0]}-${par[1]}" => { definicion = local.definiciones["etiqueta_${par[0]}"], etiqueta = par[1], objeto = par[0] }
  }

  name                 = "alcanzamos-etiqueta-${each.value.etiqueta}-${each.value.objeto}"
  display_name         = "Etiqueta ${each.value.etiqueta} obligatoria en ${each.value.objeto}"
  description          = "Todo recurso y todo grupo de la suscripción lleva la etiqueta ${each.value.etiqueta} (P1)."
  subscription_id      = local.alcance
  policy_definition_id = each.value.definicion
  enforce              = true
  parameters           = jsonencode({ tagName = { value = each.value.etiqueta } })

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
