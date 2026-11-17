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

# Pruebas del verificador independiente (US-79 T1): producción conserva su credencial federada, la seguridad del estado
# y sus roles; UAT etiqueta y nombra lo suyo; se rechazan valores de ambiente parecidos a los válidos.

run "produccion_con_conexion_explicita_antigua" {
  command = plan
  variables {
    ambiente             = "produccion"
    conexion_de_servicio = "sc-alcanzamos-prod-mxc"
  }

  assert {
    condition = alltrue([
      azuread_application_federated_identity_credential.azure_devops.subject == "sc://alcanzamos/alcanzamos/sc-alcanzamos-prod-mxc",
      azuread_application_federated_identity_credential.azure_devops.display_name == "azure-devops-sc-alcanzamos-prod-mxc",
      azuread_application_federated_identity_credential.azure_devops.issuer == "https://vstoken.dev.azure.com/00000000-0000-0000-0000-000000000000",
      azuread_application_federated_identity_credential.azure_devops.audiences == tolist(["api://AzureADTokenExchange"]),
    ])
    error_message = "La credencial federada de producción cambió."
  }
}

run "produccion_conserva_seguridad_estado_y_roles" {
  command = plan
  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      azurerm_storage_account.estado.shared_access_key_enabled == false,
      azurerm_storage_account.estado.min_tls_version == "TLS1_2",
      azurerm_storage_account.estado.allow_nested_items_to_be_public == false,
      azurerm_storage_account.estado.account_replication_type == "LRS",
      azurerm_storage_account.estado.blob_properties[0].versioning_enabled == true,
      azurerm_storage_account.estado.blob_properties[0].delete_retention_policy[0].days == 30,
      azurerm_storage_account.estado.blob_properties[0].container_delete_retention_policy[0].days == 30,
      azurerm_storage_container.estado.name == "tfstate",
      azurerm_resource_group.principal.location == "mexicocentral",
      length(azurerm_resource_provider_registration.proveedores) == 8,
      azurerm_role_assignment.pipeline_contribuye.role_definition_name == "Contributor",
      azurerm_role_assignment.pipeline_estado.role_definition_name == "Storage Blob Data Contributor",
      azurerm_role_assignment.api_lee_secretos.role_definition_name == "Key Vault Secrets User",
      azurerm_role_assignment.api_envia_correo.role_definition_name == "Communication and Email Service Owner",
      azurerm_user_assigned_identity.api.tags == tomap({ proyecto = "alcanzamos", ambiente = "produccion", origen = "opentofu" }),
      azurerm_storage_account.estado.tags == tomap({ proyecto = "alcanzamos", ambiente = "produccion", origen = "opentofu" }),
      output.backend.container_name == "tfstate",
      output.backend.use_azuread_auth == true,
    ])
    error_message = "El bootstrap de producción cambió."
  }
}

run "uat_etiquetas_y_credencial" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      azuread_application_federated_identity_credential.azure_devops.display_name == "azure-devops-sc-alcanzamos-uat-mxc",
      azurerm_user_assigned_identity.api.tags == tomap({ proyecto = "alcanzamos", ambiente = "uat", origen = "opentofu" }),
      azurerm_storage_account.estado.tags["ambiente"] == "uat",
      azurerm_storage_account.estado.shared_access_key_enabled == false,
      azurerm_storage_account.estado.name != "stalcanzamostfmxc",
    ])
    error_message = "El bootstrap de UAT: etiquetas, credencial o cuenta."
  }
}

run "rechaza_abreviatura_prod" {
  command = plan
  variables {
    ambiente = "prod"
  }
  expect_failures = [var.ambiente]
}

run "rechaza_ambiente_en_mayusculas" {
  command = plan
  variables {
    ambiente = "UAT"
  }
  expect_failures = [var.ambiente]
}
