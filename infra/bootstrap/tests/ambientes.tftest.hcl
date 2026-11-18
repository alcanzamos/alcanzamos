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

# Producción conserva los nombres aprobados (O-14, D-120) y la clave de su estado. La región pasa a East US 2 (D-208): sufijo -eus2.
run "produccion_conserva_nombres" {
  command = plan

  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      azurerm_resource_group.principal.name == "rg-alcanzamos-prod-eus2",
      azurerm_storage_account.estado.name == "stalcanzamostfeus2",
      azurerm_user_assigned_identity.carga["api"].name == "id-alcanzamos-api-prod-eus2",
      azurerm_user_assigned_identity.pipeline.name == "id-alcanzamos-pipeline-prod-eus2",
      azurerm_federated_identity_credential.azure_devops.subject == "sc://alcanzamos/alcanzamos/sc-alcanzamos-prod-eus2",
      azurerm_resource_group.principal.tags == tomap({ proyecto = "alcanzamos", ambiente = "produccion", origen = "opentofu" }),
      output.backend.resource_group_name == "rg-alcanzamos-prod-eus2",
      output.backend.storage_account_name == "stalcanzamostfeus2",
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
      azurerm_resource_group.principal.name == "rg-alcanzamos-uat-eus2",
      azurerm_storage_account.estado.name == "stalcanzamostfuateus2",
      azurerm_user_assigned_identity.carga["api"].name == "id-alcanzamos-api-uat-eus2",
      azurerm_user_assigned_identity.pipeline.name == "id-alcanzamos-pipeline-uat-eus2",
      azurerm_federated_identity_credential.azure_devops.subject == "sc://alcanzamos/alcanzamos/sc-alcanzamos-uat-eus2",
      azurerm_resource_group.principal.tags["ambiente"] == "uat",
      output.backend.resource_group_name == "rg-alcanzamos-uat-eus2",
      output.backend.storage_account_name == "stalcanzamostfuateus2",
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
