# S4: el rol debe apuntar a la identidad y al grupo correctos.
# Nombres del bootstrap por ambiente (US-79, D-200 (8)): cada suscripción tiene su grupo, su estado y sus identidades.
# Corre sin credenciales ni Azure: los proveedores son simulacros y solo se hace plan.
#   tofu init -backend=false && tofu test
mock_provider "azuread" {
  mock_resource "azuread_application" {
    defaults = {
      id        = "/applications/00000000-0000-0000-0000-000000000000"
      client_id = "00000000-0000-0000-0000-000000000000"
    }
  }

  mock_resource "azuread_service_principal" {
    defaults = {
      object_id = "00000000-0000-0000-0000-000000000000"
    }
  }
}

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
      principal_id = "00000000-0000-0000-0000-000000000000"
    }
  }
}

variables {
  subscription_id              = "00000000-0000-0000-0000-000000000000"
  azure_devops_organizacion_id = "00000000-0000-0000-0000-000000000000"
}


run "uat_rbac" {
  command = plan
  variables {
    ambiente = "uat"
  }
  assert {
    condition = alltrue([
      azurerm_role_assignment.api_lee_secretos.principal_id == azurerm_user_assigned_identity.api.principal_id,
      azurerm_role_assignment.api_lee_secretos.scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.api_lee_secretos.role_definition_name == "Key Vault Secrets User",
    ])
    error_message = "S4: el API necesita leer secretos del grupo que contiene el Key Vault."
  }
}

run "produccion_rbac" {
  command = plan
  variables {
    ambiente = "produccion"
  }
  assert {
    condition = alltrue([
      azurerm_role_assignment.api_lee_secretos.principal_id == azurerm_user_assigned_identity.api.principal_id,
      azurerm_role_assignment.api_lee_secretos.scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.api_lee_secretos.role_definition_name == "Key Vault Secrets User",
    ])
    error_message = "S4: el API necesita leer secretos del grupo que contiene el Key Vault."
  }
}
