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

# Producción conserva los nombres aprobados (O-14, D-120) y la clave de su estado.
run "produccion_conserva_nombres" {
  command = plan

  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      azurerm_resource_group.principal.name == "rg-alcanzamos-prod-mxc",
      azurerm_storage_account.estado.name == "stalcanzamostfmxc",
      azurerm_user_assigned_identity.api.name == "id-alcanzamos-prod-mxc",
      azuread_application.pipeline.display_name == "app-pipeline-alcanzamos-prod-mxc",
      azuread_application_federated_identity_credential.azure_devops.subject == "sc://alcanzamos/alcanzamos/sc-alcanzamos-prod-mxc",
      azurerm_resource_group.principal.tags == tomap({ proyecto = "alcanzamos", ambiente = "produccion", origen = "opentofu" }),
      output.backend.resource_group_name == "rg-alcanzamos-prod-mxc",
      output.backend.storage_account_name == "stalcanzamostfmxc",
      output.backend.key == "produccion.tfstate",
    ])
    error_message = "Los nombres de producción deben seguir siendo los aprobados (O-14, D-120)."
  }
}

run "uat_usa_nombres_propios" {
  command = plan

  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      azurerm_resource_group.principal.name == "rg-alcanzamos-uat-mxc",
      azurerm_storage_account.estado.name == "stalcanzamostfuatmxc",
      azurerm_user_assigned_identity.api.name == "id-alcanzamos-uat-mxc",
      azuread_application.pipeline.display_name == "app-pipeline-alcanzamos-uat-mxc",
      azuread_application_federated_identity_credential.azure_devops.subject == "sc://alcanzamos/alcanzamos/sc-alcanzamos-uat-mxc",
      azurerm_resource_group.principal.tags["ambiente"] == "uat",
      output.backend.resource_group_name == "rg-alcanzamos-uat-mxc",
      output.backend.storage_account_name == "stalcanzamostfuatmxc",
      output.backend.key == "uat.tfstate",
    ])
    error_message = "UAT debe usar sus propios nombres, con «uat» en el sufijo."
  }

  # Cuenta de almacenamiento: de 3 a 24 letras minúsculas y números, única en todo Azure.
  assert {
    condition     = can(regex("^[a-z0-9]{3,24}$", azurerm_storage_account.estado.name))
    error_message = "El nombre de la cuenta de almacenamiento no cumple el límite de Azure."
  }
}

run "ambiente_desconocido_se_rechaza" {
  command = plan

  variables {
    ambiente = "desarrollo"
  }

  expect_failures = [var.ambiente]
}
