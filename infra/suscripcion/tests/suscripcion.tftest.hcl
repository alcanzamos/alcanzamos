# T3/P1/T9 (D-205 (11), D-207, D-208; E11-INF 2.17): lo que es de la suscripción y se aplica una sola vez, con la cuenta del dueño.
# Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
#   tofu init -backend=false && tofu test
mock_provider "azurerm" {}

variables {
  subscription_id    = "00000000-0000-0000-0000-000000000000"
  correos_de_alerta  = ["dueno@example.com"]
  presupuesto_inicio = "2026-12-01T00:00:00Z"
}

# P1: solo eastus2, centralus (para restaurar el respaldo georredundante) y global, en recursos y en grupos.
run "politica_de_regiones" {
  command = plan

  assert {
    condition = alltrue([
      toset(keys(azurerm_subscription_policy_assignment.regiones)) == toset(["recursos", "grupos"]),
      azurerm_subscription_policy_assignment.regiones["recursos"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c",
      azurerm_subscription_policy_assignment.regiones["grupos"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988",
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : a.subscription_id == "/subscriptions/00000000-0000-0000-0000-000000000000"]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : a.enforce == true]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : jsondecode(a.parameters).listOfAllowedLocations.value == ["eastus2", "centralus", "global"]]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : jsondecode(a.parameters).effect.value == "Deny"]),
    ])
    error_message = "La política de regiones debe negar todo lo que no sea eastus2, centralus o global, en recursos y en grupos (P1, D-208)."
  }
}

# P1 (decisión del dueño, 2026-11-18): las etiquetas proyecto y ambiente se agregan o se heredan (Modify), nunca se rechazan.
# Recursos: «Inherit a tag from the resource group if missing». Grupos: «Add a tag to resource groups», con el valor por defecto.
# Una asignación por etiqueta y por definición. Cada una lleva identidad administrada y ubicación (Modify las exige).
run "politica_de_etiquetas" {
  command = plan

  assert {
    condition = alltrue([
      toset(keys(azurerm_subscription_policy_assignment.etiquetas)) == toset(["recursos-proyecto", "recursos-ambiente", "grupos-proyecto", "grupos-ambiente"]),
      azurerm_subscription_policy_assignment.etiquetas["recursos-proyecto"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/ea3f2387-9b95-492a-a190-fcdc54f7b070",
      azurerm_subscription_policy_assignment.etiquetas["recursos-ambiente"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/ea3f2387-9b95-492a-a190-fcdc54f7b070",
      azurerm_subscription_policy_assignment.etiquetas["grupos-proyecto"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/726aca4c-86e9-4b04-b0c5-073027359532",
      azurerm_subscription_policy_assignment.etiquetas["grupos-ambiente"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/726aca4c-86e9-4b04-b0c5-073027359532",
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : a.subscription_id == "/subscriptions/00000000-0000-0000-0000-000000000000"]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : a.enforce == true]),
    ])
    error_message = "Las etiquetas proyecto y ambiente se agregan con las definiciones Modify integradas: herencia desde el grupo en recursos y «Add a tag to resource groups» en grupos."
  }

  # Parámetros exactos de cada definición. Las integradas Modify no tienen parámetro «effect»: pasarlo haría fallar la asignación.
  assert {
    condition = alltrue([
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["recursos-proyecto"].parameters) == { tagName = { value = "proyecto" } },
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["recursos-ambiente"].parameters) == { tagName = { value = "ambiente" } },
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["grupos-proyecto"].parameters) == { tagName = { value = "proyecto" }, tagValue = { value = "alcanzamos" } },
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["grupos-ambiente"].parameters) == { tagName = { value = "ambiente" }, tagValue = { value = "compartido" } },
    ])
    error_message = "Parámetros: tagName en recursos; tagName y tagValue en grupos (proyecto=alcanzamos, ambiente=compartido para los grupos que crea Azure)."
  }

  # Modify exige identidad administrada en la asignación y su ubicación (eastus2).
  assert {
    condition = alltrue([
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : length(a.identity) == 1]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : a.identity[0].type == "SystemAssigned"]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : a.location == "eastus2"]),
    ])
    error_message = "Cada asignación de etiquetas (Modify) lleva identidad SystemAssigned y location = eastus2."
  }

  # Ninguna asignación de etiquetas puede ser Deny: ni el efecto en los parámetros ni las definiciones Require a tag.
  assert {
    condition = alltrue([
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : !contains(keys(jsondecode(a.parameters)), "effect")]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : !contains(["871b6d14-10aa-478d-b590-94f262ecfa99", "96670d01-0a4d-4649-9c89-2d3abc0a5025"], element(split("/", a.policy_definition_id), 4))]),
    ])
    error_message = "No debe quedar ninguna política de etiquetas con Deny (Require a tag on resources / on resource groups)."
  }

  # Cada identidad recibe el rol de roleDefinitionIds de la definición (Contributor), en el alcance de la suscripción.
  assert {
    condition = alltrue([
      toset(keys(azurerm_role_assignment.etiquetas)) == toset(["recursos-proyecto", "recursos-ambiente", "grupos-proyecto", "grupos-ambiente"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.scope == "/subscriptions/00000000-0000-0000-0000-000000000000"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.role_definition_id == "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.principal_type == "ServicePrincipal"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.skip_service_principal_aad_check == true]),
    ])
    error_message = "Cada identidad de una asignación Modify tiene Contributor (b24988ac…) en el alcance de la suscripción, y solo esa."
  }

  # Los nombres de asignación: únicos y de hasta 64 caracteres (límite de Azure).
  assert {
    condition = alltrue(concat(
      [for a in values(azurerm_subscription_policy_assignment.etiquetas) : length(a.name) <= 64],
      [for a in values(azurerm_subscription_policy_assignment.regiones) : length(a.name) <= 64],
    ))
    error_message = "El nombre de una asignación de política no puede pasar de 64 caracteres."
  }

  assert {
    condition     = length(toset(concat([for a in values(azurerm_subscription_policy_assignment.etiquetas) : a.name], [for a in values(azurerm_subscription_policy_assignment.regiones) : a.name]))) == 6
    error_message = "Las seis asignaciones de política deben tener nombres distintos."
  }
}

# Las regiones siguen con Deny, sin identidad ni ubicación propia (Deny no las necesita).
run "regiones_siguen_con_deny" {
  command = plan

  assert {
    condition = alltrue([
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : jsondecode(a.parameters).effect.value == "Deny"]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : length(a.identity) == 0]),
    ])
    error_message = "Las políticas de regiones siguen con efecto Deny y sin identidad."
  }
}

# T9: dos presupuestos en la suscripción: 2 USD para comprobar los servicios gratuitos y el tope del dueño (24 USD).
run "presupuestos_de_la_suscripcion" {
  command = plan

  assert {
    condition = alltrue([
      toset(keys(azurerm_consumption_budget_subscription.suscripcion)) == toset(["gratuitos", "tope"]),
      azurerm_consumption_budget_subscription.suscripcion["gratuitos"].amount == 2,
      azurerm_consumption_budget_subscription.suscripcion["tope"].amount == 24,
      alltrue([for b in values(azurerm_consumption_budget_subscription.suscripcion) : b.subscription_id == "/subscriptions/00000000-0000-0000-0000-000000000000"]),
      alltrue([for b in values(azurerm_consumption_budget_subscription.suscripcion) : b.time_grain == "Monthly"]),
      alltrue([for b in values(azurerm_consumption_budget_subscription.suscripcion) : b.time_period[0].start_date == "2026-12-01T00:00:00Z"]),
    ])
    error_message = "Debe haber un presupuesto mensual de 2 USD y otro de 24 USD en la suscripción (T9)."
  }

  # El tope: 50, 75, 90 y 100 % del gasto real y 100 % del previsto. Azure admite hasta cinco avisos por presupuesto.
  assert {
    condition = alltrue([
      length(azurerm_consumption_budget_subscription.suscripcion["tope"].notification) == 5,
      toset([for n in azurerm_consumption_budget_subscription.suscripcion["tope"].notification : "${n.threshold_type}-${n.threshold}"]) == toset(["Actual-50", "Actual-75", "Actual-90", "Actual-100", "Forecasted-100"]),
      alltrue([for n in azurerm_consumption_budget_subscription.suscripcion["tope"].notification : n.enabled == true]),
      alltrue([for n in azurerm_consumption_budget_subscription.suscripcion["tope"].notification : n.operator == "GreaterThan"]),
      alltrue([for n in azurerm_consumption_budget_subscription.suscripcion["tope"].notification : n.contact_emails == tolist(["dueno@example.com"])]),
    ])
    error_message = "El tope de 24 USD avisa al 50, 75, 90 y 100 % del gasto real y al 100 % del previsto, al correo de la variable."
  }

  # El de 2 USD: cualquier gasto comprueba que los servicios gratuitos dejaron de serlo.
  assert {
    condition = alltrue([
      toset([for n in azurerm_consumption_budget_subscription.suscripcion["gratuitos"].notification : "${n.threshold_type}-${n.threshold}"]) == toset(["Actual-50", "Actual-100"]),
      alltrue([for n in azurerm_consumption_budget_subscription.suscripcion["gratuitos"].notification : n.contact_emails == tolist(["dueno@example.com"])]),
    ])
    error_message = "El presupuesto de 2 USD avisa al 50 y al 100 % del gasto real."
  }
}

# Proveedores: no son recursos; se registran con la configuración del proveedor azurerm (salida = lista de la configuración).
run "proveedores_registrados" {
  command = plan

  assert {
    condition = alltrue([
      toset(output.proveedores_registrados) == toset([
        "Microsoft.App",
        "Microsoft.DBforPostgreSQL",
        "Microsoft.Insights",
        "Microsoft.KeyVault",
        "Microsoft.ManagedIdentity",
        "Microsoft.OperationalInsights",
        "Microsoft.Storage",
      ]),
      length(output.proveedores_registrados) == 7,
      !contains(output.proveedores_registrados, "Microsoft.Communication"),
    ])
    error_message = "Se registran siete proveedores (O-14, D-076) y ya no Microsoft.Communication (D-205)."
  }
}

run "sin_correo_se_rechaza" {
  command = plan
  variables {
    correos_de_alerta = []
  }
  expect_failures = [var.correos_de_alerta]
}

run "correo_invalido_se_rechaza" {
  command = plan
  variables {
    correos_de_alerta = ["no-es-un-correo"]
  }
  expect_failures = [var.correos_de_alerta]
}

# Azure pide que el presupuesto empiece el primer día de un mes.
run "inicio_fuera_de_primer_dia_se_rechaza" {
  command = plan
  variables {
    presupuesto_inicio = "2026-12-15T00:00:00Z"
  }
  expect_failures = [var.presupuesto_inicio]
}

run "subscription_id_invalido_se_rechaza" {
  command = plan
  variables {
    subscription_id = "mi-suscripcion"
  }
  expect_failures = [var.subscription_id]
}
