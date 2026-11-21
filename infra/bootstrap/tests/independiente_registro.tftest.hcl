# E11-INF 2.14: el bootstrap ya no da a las identidades de carga ningún rol (los de secretos están en infra/secretos).
# Nombres del bootstrap por ambiente (US-79, D-200 (8)): cada suscripción tiene su grupo, su estado y sus identidades.
# Corre sin credenciales ni Azure: los proveedores son simulacros y solo se hace plan.
#   tofu init -backend=false && tofu test
# El proveedor valida la forma de los ID que pasan de un recurso a otro: el simulacro los da con esa forma.
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

variables {
  subscription_id              = "00000000-0000-0000-0000-000000000000"
  azure_devops_organizacion_id = "00000000-0000-0000-0000-000000000000"
}


run "uat_sin_rol_de_secretos_en_el_grupo" {
  command = plan
  variables {
    ambiente = "uat"
  }
  assert {
    condition = alltrue([
      toset([for a in values(azurerm_role_assignment.pipeline) : a.role_definition_name]) == toset(["Contributor", "Storage Blob Data Contributor"]),
      alltrue([for i in values(azurerm_user_assigned_identity.carga) : i.principal_id != azurerm_role_assignment.pipeline["grupo"].principal_id]),
    ])
    error_message = "El API ya no lee secretos con un rol sobre el grupo; el único rol sobre el grupo es Contributor del pipeline."
  }
}

run "produccion_sin_rol_de_secretos_en_el_grupo" {
  command = plan
  variables {
    ambiente = "produccion"
  }
  assert {
    condition = alltrue([
      toset([for a in values(azurerm_role_assignment.pipeline) : a.role_definition_name]) == toset(["Contributor", "Storage Blob Data Contributor"]),
      alltrue([for i in values(azurerm_user_assigned_identity.carga) : i.principal_id != azurerm_role_assignment.pipeline["grupo"].principal_id]),
    ])
    error_message = "El API ya no lee secretos con un rol sobre el grupo; el único rol sobre el grupo es Contributor del pipeline."
  }
}
