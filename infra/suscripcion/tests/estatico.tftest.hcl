# T3/P1/T9: lo que el plan no expone se comprueba en los archivos de esta raíz (prevent_destroy, proveedores, sin azuread).
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

run "configuracion_estatica" {
  command = plan

  # Ningún recurso de registro de proveedores: la configuración del proveedor los registra y el estado no los posee.
  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : strcontains(file("${path.module}/${f}"), "azurerm_resource_provider_registration")])
    error_message = "Los proveedores no van como recursos en ningún estado (decisión del dueño, 2026-11-18)."
  }

  assert {
    condition = alltrue([
      can(regex("resource_provider_registrations\\s*=\\s*\"none\"", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))),
      can(regex("resource_providers_to_register\\s*=\\s*local\\.proveedores", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))),
    ])
    error_message = "El proveedor azurerm registra solo la lista de local.proveedores: resource_provider_registrations = \"none\" y resource_providers_to_register."
  }

  # Cada recurso de esta raíz lleva prevent_destroy: el plan no lo expone, se cuenta en el código.
  assert {
    condition = alltrue([
      length(regexall("(?m)^resource \"", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))) == 5,
      length(regexall("prevent_destroy\\s*=\\s*true", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))) == 5,
    ])
    error_message = "Los cinco recursos (regiones, definiciones propias de etiquetas, asignaciones de etiquetas, su rol y presupuestos) deben llevar prevent_destroy = true y no debe haber otros."
  }

  # La identidad de cada asignación Modify es la que recibe el rol (no un principal escrito a mano).
  assert {
    condition     = can(regex("principal_id\\s*=\\s*azurerm_subscription_policy_assignment\\.etiquetas\\[each\\.key\\]\\.identity\\[0\\]\\.principal_id", file("${path.module}/principal.tf")))
    error_message = "El rol se asigna al principal_id de la identidad de la asignación de etiquetas."
  }

  # Las asignaciones de etiquetas usan las copias propias (no un ID de definición integrada escrito en el código).
  assert {
    condition = alltrue([
      can(regex("policy_definition_id\\s*=\\s*azurerm_policy_definition\\.etiquetas\\[each\\.value\\.objeto\\]\\.id", file("${path.module}/principal.tf"))),
      !anytrue([for f in fileset(path.module, "*.tf") : anytrue([for id in ["ea3f2387-9b95-492a-a190-fcdc54f7b070", "726aca4c-86e9-4b04-b0c5-073027359532"] : can(regex("policyDefinitions/${id}", file("${path.module}/${f}")))])]),
    ])
    error_message = "Las asignaciones de etiquetas usan azurerm_policy_definition.etiquetas; las definiciones integradas Modify no se asignan."
  }

  # Ningún Contributor en el código de esta raíz (rol b24988ac…): ni en una asignación de rol ni en roleDefinitionIds. Los JSON de originales/ son la copia literal de Azure y no cuentan.
  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : strcontains(lower(file("${path.module}/${f}")), "b24988ac-6180-42a0-ab88-20f7382dd24c")])
    error_message = "Ninguna asignación de rol ni roleDefinitionIds usa Contributor: es Tag Contributor (4a9ae827-6dc8-4573-8ac7-8239d42aa03f)."
  }

  # Una corrección a mano no se revierte: ningún «addOrReplace» en el código.
  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : strcontains(lower(file("${path.module}/${f}")), "addorreplace")])
    error_message = "Las reglas Modify usan add, no addOrReplace."
  }

  # El ambiente de los grupos que crea Azure es «sin-asignar» (decisión del dueño, 2026-11-18); «compartido» ya no existe en el código ni en el README.
  assert {
    condition = alltrue([
      can(regex("ambiente\\s*=\\s*\"sin-asignar\"", file("${path.module}/principal.tf"))),
      !anytrue([for f in concat(tolist(fileset(path.module, "*.tf")), ["README.md"]) : strcontains(file("${path.module}/${f}"), "compartido")]),
    ])
    error_message = "ambiente = sin-asignar en los grupos que crea Azure; el valor «compartido» ya no se usa."
  }

  # Ya no queda ninguna política de etiquetas con Deny: ni «Require a tag on resources» ni «… on resource groups».
  assert {
    condition = !anytrue([
      for f in fileset(path.module, "*.tf") :
      anytrue([for id in ["871b6d14-10aa-478d-b590-94f262ecfa99", "96670d01-0a4d-4649-9c89-2d3abc0a5025"] : strcontains(file("${path.module}/${f}"), id)])
    ])
    error_message = "Las definiciones Require a tag (Deny) ya no se asignan: la etiqueta se agrega o se hereda con Modify."
  }

  # Sin azuread (D-049).
  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : can(regex("azuread", file("${path.module}/${f}")))])
    error_message = "Esta raíz no usa azuread."
  }
}
