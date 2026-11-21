# T3 (decisión del dueño, 2026-11-18): el bootstrap no registra proveedores de recursos (los registra infra/suscripcion,
# una sola vez, porque los dos ambientes comparten la suscripción), no usa azuread y el pipeline no gana roles.
# Lo que el plan no expone se comprueba en los archivos de esta raíz.
# Corre sin credenciales ni Azure: los proveedores son simulacros y solo se hace plan.
#   tofu init -backend=false && tofu test
mock_provider "azurerm" {
  mock_resource "azurerm_resource_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg"
    }
  }

  mock_resource "azurerm_storage_account" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/st"
    }
  }

  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id"
      client_id    = "00000000-0000-0000-0000-000000000000"
      principal_id = "00000000-0000-0000-0000-000000000000"
    }
  }
}

override_resource {
  target = azurerm_user_assigned_identity.pipeline
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/pipeline"
    client_id    = "11111111-1111-1111-1111-111111111111"
    principal_id = "22222222-2222-2222-2222-222222222222"
  }
}

variables {
  subscription_id              = "00000000-0000-0000-0000-000000000000"
  azure_devops_organizacion_id = "00000000-0000-0000-0000-000000000000"
}

# Con una sola suscripción, dos bootstraps que registran los mismos proveedores serían dueños dobles (verificador de T3).
run "sin_registro_de_proveedores" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : strcontains(file("${path.module}/${f}"), "azurerm_resource_provider_registration")])
    error_message = "El bootstrap no registra proveedores como recursos: lo hace infra/suscripcion."
  }

  assert {
    condition = alltrue([
      can(regex("resource_provider_registrations\\s*=\\s*\"none\"", file("${path.module}/versiones.tf"))),
      !can(regex("resource_providers_to_register", file("${path.module}/versiones.tf"))),
    ])
    error_message = "El proveedor azurerm del bootstrap lleva resource_provider_registrations = \"none\" y no registra nada."
  }
}

# Sin azuread, ni como proveedor, ni como recurso o dato, ni en el archivo de bloqueo (D-049, D-205 (1)).
run "sin_azuread" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("hashicorp/azuread", file("${path.module}/${f}")))]),
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("(?m)^\\s*provider\\s+\"azuread\"", file("${path.module}/${f}")))]),
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("(?m)^\\s*(resource|data)\\s+\"azuread_", file("${path.module}/${f}")))]),
      !can(regex("azuread", file("${path.module}/.terraform.lock.hcl"))),
    ])
    error_message = "El bootstrap no usa azuread."
  }
}

# El pipeline tiene solo dos roles. Otra asignación de rol (a cualquier identidad) obliga a cambiar esta prueba a propósito,
# y ninguna otra puede usar la identidad del pipeline.
run "pipeline_no_gana_mas_roles" {
  command = plan
  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      toset([for m in regexall("(?m)^resource\\s+\"azurerm_role_assignment\"\\s+\"([a-z_]+)\"", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")])) : m[0]]) == toset(["pipeline"]),
      length(regexall("azurerm_user_assigned_identity\\.pipeline\\.principal_id", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))) == 1,
    ])
    error_message = "Solo azurerm_role_assignment.pipeline (dos roles) puede usar la identidad del pipeline, y no hay más asignaciones que esa (los roles de secretos están en infra/secretos)."
  }

  assert {
    condition = alltrue([
      length(azurerm_role_assignment.pipeline) == 2,
      toset([for a in values(azurerm_role_assignment.pipeline) : a.role_definition_name]) == toset(["Contributor", "Storage Blob Data Contributor"]),
      alltrue([for i in values(azurerm_user_assigned_identity.carga) : i.principal_id != azurerm_user_assigned_identity.pipeline.principal_id]),
    ])
    error_message = "El pipeline tiene solo Contributor sobre su grupo y Storage Blob Data Contributor sobre su estado."
  }
}
