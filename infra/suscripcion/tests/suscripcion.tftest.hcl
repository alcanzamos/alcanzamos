# T3/P1/T9 (D-205 (11), D-207, D-208; E11-INF 2.17): lo que es de la suscripción y se aplica una sola vez, con la cuenta del dueño.
# Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
#   tofu init -backend=false && tofu test
mock_provider "azurerm" {}

# Con el proveedor simulado el ID de una definición propia sería una cadena al azar, y la asignación lo rechaza (exige un ID de definición).
# Se fija el ID que Azure le daría: /subscriptions/<id>/providers/Microsoft.Authorization/policyDefinitions/<nombre>.
override_resource {
  target = azurerm_policy_definition.etiquetas["recursos"]
  values = {
    id = "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/policyDefinitions/alcanzamos-copia-heredar-etiqueta-del-grupo"
  }
}

override_resource {
  target = azurerm_policy_definition.etiquetas["grupos"]
  values = {
    id = "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/policyDefinitions/alcanzamos-copia-agregar-etiqueta-a-grupos"
  }
}

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
# Recursos: copia de «Inherit a tag from the resource group if missing». Grupos: copia de «Add a tag to resource groups», con el valor por defecto.
# Una asignación por etiqueta y por definición (copias propias, ver «definiciones_copiadas»). Cada una lleva identidad administrada y ubicación (Modify las exige).
run "politica_de_etiquetas" {
  command = plan

  assert {
    condition = alltrue([
      toset(keys(azurerm_subscription_policy_assignment.etiquetas)) == toset(["recursos-proyecto", "recursos-ambiente", "grupos-proyecto", "grupos-ambiente"]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : a.subscription_id == "/subscriptions/00000000-0000-0000-0000-000000000000"]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : a.enforce == true]),
    ])
    error_message = "Cuatro asignaciones de etiquetas (proyecto y ambiente, en recursos y en grupos), en la suscripción y con enforce."
  }

  # Parámetros exactos de cada definición. Las copias Modify no tienen parámetro «effect»: pasarlo haría fallar la asignación.
  # El ambiente de un grupo que Azure crea solo es «sin-asignar» (aprobado por el dueño, 2026-11-18).
  assert {
    condition = alltrue([
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["recursos-proyecto"].parameters) == { tagName = { value = "proyecto" } },
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["recursos-ambiente"].parameters) == { tagName = { value = "ambiente" } },
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["grupos-proyecto"].parameters) == { tagName = { value = "proyecto" }, tagValue = { value = "alcanzamos" } },
      jsondecode(azurerm_subscription_policy_assignment.etiquetas["grupos-ambiente"].parameters) == { tagName = { value = "ambiente" }, tagValue = { value = "sin-asignar" } },
    ])
    error_message = "Parámetros: tagName en recursos; tagName y tagValue en grupos (proyecto=alcanzamos, ambiente=sin-asignar para los grupos que crea Azure)."
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

  # Cada identidad recibe Tag Contributor (4a9ae827…), el rol de roleDefinitionIds de las copias, en el alcance de la suscripción. Contributor no.
  assert {
    condition = alltrue([
      toset(keys(azurerm_role_assignment.etiquetas)) == toset(["recursos-proyecto", "recursos-ambiente", "grupos-proyecto", "grupos-ambiente"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.scope == "/subscriptions/00000000-0000-0000-0000-000000000000"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.role_definition_id == "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/roleDefinitions/4a9ae827-6dc8-4573-8ac7-8239d42aa03f"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : !strcontains(lower(r.role_definition_id), "b24988ac-6180-42a0-ab88-20f7382dd24c")]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.principal_type == "ServicePrincipal"]),
      alltrue([for r in values(azurerm_role_assignment.etiquetas) : r.skip_service_principal_aad_check == true]),
    ])
    error_message = "Cada identidad de una asignación Modify tiene Tag Contributor (4a9ae827…) en el alcance de la suscripción, y solo ese rol: nunca Contributor."
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

# Decisión del dueño (2026-11-18): las identidades de Modify no reciben Contributor. Las dos definiciones Modify son COPIAS PROPIAS de las
# integradas (ea3f2387… y 726aca4c…): mismo mode, mismos parámetros y misma regla; solo cambia roleDefinitionIds, que pasa a Tag Contributor.
# Los originales, tal como están en Azure/azure-policy, están en originales/ (ver README).
run "definiciones_copiadas" {
  command = plan

  assert {
    condition = alltrue([
      toset(keys(azurerm_policy_definition.etiquetas)) == toset(["recursos", "grupos"]),
      alltrue([for d in values(azurerm_policy_definition.etiquetas) : d.policy_type == "Custom"]),
      # En la suscripción (sin grupo de administración).
      alltrue([for d in values(azurerm_policy_definition.etiquetas) : d.management_group_id == null]),
      # Dicen que son copias y por qué.
      alltrue([for d in values(azurerm_policy_definition.etiquetas) : strcontains(lower(d.name), "copia")]),
      alltrue([for d in values(azurerm_policy_definition.etiquetas) : startswith(d.display_name, "Copia de «")]),
      alltrue([for d in values(azurerm_policy_definition.etiquetas) : strcontains(d.display_name, "Tag Contributor")]),
      alltrue([for d in values(azurerm_policy_definition.etiquetas) : strcontains(d.description, "Tag Contributor") && strcontains(d.description, "copia")]),
      alltrue([for d in values(azurerm_policy_definition.etiquetas) : length(d.name) <= 64]),
      length(toset([for d in values(azurerm_policy_definition.etiquetas) : d.name])) == 2,
    ])
    error_message = "Las dos definiciones son propias (Custom), de la suscripción, y su nombre y descripción dicen que son copias de las integradas y por qué."
  }

  # Los originales no se tocan: se fija su contenido (copia literal de Azure/azure-policy, ver README).
  assert {
    condition = alltrue([
      filesha256("${path.module}/originales/InheritTag_Add_Modify.json") == "596cd52a5ceffc8832240f486e6f3fd753045cc99a4fd04a58abcbce75a37fec",
      filesha256("${path.module}/originales/AddTag_ResourceGroup_Modify.json") == "57533fda3aa62ecba1b043842d1dff8627e34c274612b08e0f20f40de3250329",
    ])
    error_message = "Los JSON de originales/ son la copia literal de las definiciones integradas; no se editan."
  }

  # Idénticas a las integradas en mode, parámetros y regla; solo cambia roleDefinitionIds.
  assert {
    condition = alltrue([
      azurerm_policy_definition.etiquetas["recursos"].mode == "Indexed",
      azurerm_policy_definition.etiquetas["grupos"].mode == "All",
      jsondecode(azurerm_policy_definition.etiquetas["recursos"].parameters) == jsondecode(file("${path.module}/originales/InheritTag_Add_Modify.json")).properties.parameters,
      jsondecode(azurerm_policy_definition.etiquetas["grupos"].parameters) == jsondecode(file("${path.module}/originales/AddTag_ResourceGroup_Modify.json")).properties.parameters,
      toset(keys(jsondecode(azurerm_policy_definition.etiquetas["recursos"].policy_rule))) == toset(["if", "then"]),
      toset(keys(jsondecode(azurerm_policy_definition.etiquetas["recursos"].policy_rule).then)) == toset(["effect", "details"]),
      toset(keys(jsondecode(azurerm_policy_definition.etiquetas["recursos"].policy_rule).then.details)) == toset(["roleDefinitionIds", "operations"]),
      jsondecode(azurerm_policy_definition.etiquetas["recursos"].policy_rule).if == jsondecode(file("${path.module}/originales/InheritTag_Add_Modify.json")).properties.policyRule.if,
      jsondecode(azurerm_policy_definition.etiquetas["recursos"].policy_rule).then.effect == jsondecode(file("${path.module}/originales/InheritTag_Add_Modify.json")).properties.policyRule.then.effect,
      jsondecode(azurerm_policy_definition.etiquetas["recursos"].policy_rule).then.details.operations == jsondecode(file("${path.module}/originales/InheritTag_Add_Modify.json")).properties.policyRule.then.details.operations,
      toset(keys(jsondecode(azurerm_policy_definition.etiquetas["grupos"].policy_rule))) == toset(["if", "then"]),
      toset(keys(jsondecode(azurerm_policy_definition.etiquetas["grupos"].policy_rule).then)) == toset(["effect", "details"]),
      toset(keys(jsondecode(azurerm_policy_definition.etiquetas["grupos"].policy_rule).then.details)) == toset(["roleDefinitionIds", "operations"]),
      jsondecode(azurerm_policy_definition.etiquetas["grupos"].policy_rule).if == jsondecode(file("${path.module}/originales/AddTag_ResourceGroup_Modify.json")).properties.policyRule.if,
      jsondecode(azurerm_policy_definition.etiquetas["grupos"].policy_rule).then.effect == jsondecode(file("${path.module}/originales/AddTag_ResourceGroup_Modify.json")).properties.policyRule.then.effect,
      jsondecode(azurerm_policy_definition.etiquetas["grupos"].policy_rule).then.details.operations == jsondecode(file("${path.module}/originales/AddTag_ResourceGroup_Modify.json")).properties.policyRule.then.details.operations,
    ])
    error_message = "Las copias deben ser idénticas a las integradas (mode, parámetros, «if», efecto y operaciones); solo cambia roleDefinitionIds."
  }

  # roleDefinitionIds: exactamente Tag Contributor, en las dos, y ningún Contributor.
  assert {
    condition = alltrue([
      jsondecode(azurerm_policy_definition.etiquetas["recursos"].policy_rule).then.details.roleDefinitionIds == ["/providers/Microsoft.Authorization/roleDefinitions/4a9ae827-6dc8-4573-8ac7-8239d42aa03f"],
      jsondecode(azurerm_policy_definition.etiquetas["grupos"].policy_rule).then.details.roleDefinitionIds == ["/providers/Microsoft.Authorization/roleDefinitions/4a9ae827-6dc8-4573-8ac7-8239d42aa03f"],
      !anytrue([for d in values(azurerm_policy_definition.etiquetas) : strcontains(lower(d.policy_rule), "b24988ac")]),
    ])
    error_message = "roleDefinitionIds es exactamente Tag Contributor (4a9ae827-6dc8-4573-8ac7-8239d42aa03f), nunca Contributor."
  }
}

# Una corrección a mano no se revierte (decisión del dueño, 2026-11-18). La prueba: la regla solo actúa si la etiqueta NO existe
# («exists: false» sobre la misma etiqueta que escribe) y la operación es «add», no «addOrReplace». Si la etiqueta existe, con cualquier
# valor, el recurso o grupo ya cumple y Modify no hace nada.
run "correccion_a_mano_no_se_revierte" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for k, d in azurerm_policy_definition.etiquetas : [
        jsondecode(d.policy_rule).then.effect == "modify",
        # Una sola operación, y es «add».
        length(jsondecode(d.policy_rule).then.details.operations) == 1,
        alltrue([for o in jsondecode(d.policy_rule).then.details.operations : o.operation == "add"]),
        !strcontains(lower(d.policy_rule), "addorreplace"),
        # El «if» exige que la etiqueta no exista…
        length([for c in jsondecode(d.policy_rule).if.allOf : c if try(tostring(c.exists), "") == "false"]) == 1,
        # … y es la misma etiqueta que escribe la operación.
        [for c in jsondecode(d.policy_rule).if.allOf : c.field if try(tostring(c.exists), "") == "false"][0] == jsondecode(d.policy_rule).then.details.operations[0].field,
      ]
    ]))
    error_message = "Modify solo agrega la etiqueta si falta (add + exists: false). Una etiqueta corregida a mano no se revierte."
  }
}

# Las asignaciones usan las copias propias, no las integradas: cada una apunta a la definición de su objeto (recursos o grupos).
run "asignaciones_usan_las_copias" {
  command = plan

  assert {
    condition = alltrue([
      azurerm_subscription_policy_assignment.etiquetas["recursos-proyecto"].policy_definition_id == azurerm_policy_definition.etiquetas["recursos"].id,
      azurerm_subscription_policy_assignment.etiquetas["recursos-ambiente"].policy_definition_id == azurerm_policy_definition.etiquetas["recursos"].id,
      azurerm_subscription_policy_assignment.etiquetas["grupos-proyecto"].policy_definition_id == azurerm_policy_definition.etiquetas["grupos"].id,
      azurerm_subscription_policy_assignment.etiquetas["grupos-ambiente"].policy_definition_id == azurerm_policy_definition.etiquetas["grupos"].id,
      alltrue([for a in values(azurerm_subscription_policy_assignment.etiquetas) : !strcontains(a.policy_definition_id, "ea3f2387-9b95-492a-a190-fcdc54f7b070") && !strcontains(a.policy_definition_id, "726aca4c-86e9-4b04-b0c5-073027359532")]),
    ])
    error_message = "Las cuatro asignaciones de etiquetas usan las copias propias (recursos y grupos), no las integradas."
  }
}

# Las regiones siguen con Deny, sin identidad ni ubicación propia (Deny no las necesita).
run "regiones_siguen_con_deny" {
  command = plan

  assert {
    condition = alltrue([
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : jsondecode(a.parameters).effect.value == "Deny"]),
      alltrue([for a in values(azurerm_subscription_policy_assignment.regiones) : length(a.identity) == 0]),
      # Siguen con las definiciones integradas (Allowed locations), no con copias.
      azurerm_subscription_policy_assignment.regiones["recursos"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c",
      azurerm_subscription_policy_assignment.regiones["grupos"].policy_definition_id == "/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988",
    ])
    error_message = "Las políticas de regiones siguen con efecto Deny, sin identidad y con las definiciones integradas."
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

  # El de 2 USD: cualquier gasto comprueba que los servicios gratuitos dejaron de serlo. Avisa al 50 y al 100 % del gasto real y,
  # como el tope, al 100 % del gasto previsto (aviso antes de que el gasto ocurra), a los mismos correos y con el mismo operador.
  assert {
    condition = alltrue([
      length(azurerm_consumption_budget_subscription.suscripcion["gratuitos"].notification) == 3,
      toset([for n in azurerm_consumption_budget_subscription.suscripcion["gratuitos"].notification : "${n.threshold_type}-${n.threshold}"]) == toset(["Actual-50", "Actual-100", "Forecasted-100"]),
      alltrue([for n in azurerm_consumption_budget_subscription.suscripcion["gratuitos"].notification : n.enabled == true]),
      alltrue([for n in azurerm_consumption_budget_subscription.suscripcion["gratuitos"].notification : n.operator == "GreaterThan"]),
      alltrue([for n in azurerm_consumption_budget_subscription.suscripcion["gratuitos"].notification : n.contact_emails == tolist(["dueno@example.com"])]),
    ])
    error_message = "El presupuesto de 2 USD avisa al 50 y al 100 % del gasto real y al 100 % del previsto (Forecasted), a los mismos correos que el tope."
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
        "Microsoft.Network",
        "Microsoft.PolicyInsights",
        "Microsoft.Consumption",
      ]),
      length(output.proveedores_registrados) == 10,
      !contains(output.proveedores_registrados, "Microsoft.Communication"),
    ])
    error_message = "Se registran diez proveedores (siete de O-14 y D-076, más Network, PolicyInsights y Consumption de D-205) y ya no Microsoft.Communication."
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
