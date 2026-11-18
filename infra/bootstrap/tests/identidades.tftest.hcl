# T3 (D-205 (1), (3), (4), (5); E11-INF 2.1, 2.3, 2.3 bis, 2.4, 2.14, 2.17): identidades administradas, sin azuread, sin ACS.
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

# La identidad del pipeline lleva valores propios: así se comprueba que los roles son suyos y no de una identidad de carga.
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
  azure_devops_organizacion_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
}

# El pipeline solo tiene dos roles: Contributor sobre su grupo y Storage Blob Data Contributor sobre su estado.
# Ninguno puede asignar roles (ni Owner, ni User Access Administrator, ni Role Based Access Control Administrator).
run "pipeline_solo_contributor_y_estado" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      length(azurerm_role_assignment.pipeline) == 2,
      toset(keys(azurerm_role_assignment.pipeline)) == toset(["grupo", "estado"]),
      azurerm_role_assignment.pipeline["grupo"].role_definition_name == "Contributor",
      azurerm_role_assignment.pipeline["grupo"].scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.pipeline["estado"].role_definition_name == "Storage Blob Data Contributor",
      azurerm_role_assignment.pipeline["estado"].scope == azurerm_storage_account.estado.id,
      alltrue([for a in values(azurerm_role_assignment.pipeline) : a.principal_id == "22222222-2222-2222-2222-222222222222"]),
    ])
    error_message = "El pipeline debe tener solo Contributor sobre su grupo y Storage Blob Data Contributor sobre su estado."
  }

  assert {
    condition = alltrue([
      for a in values(azurerm_role_assignment.pipeline) :
      !contains(["Owner", "User Access Administrator", "Role Based Access Control Administrator"], a.role_definition_name)
    ])
    error_message = "El pipeline no puede tener permiso para asignar roles."
  }

  # El pipeline y el API son identidades distintas.
  assert {
    condition     = azurerm_role_assignment.api_lee_secretos.principal_id != azurerm_user_assigned_identity.pipeline.principal_id
    error_message = "El pipeline no debe compartir identidad con el API."
  }
}

run "pipeline_de_produccion_igual_que_el_de_uat" {
  command = plan
  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      length(azurerm_role_assignment.pipeline) == 2,
      azurerm_role_assignment.pipeline["grupo"].role_definition_name == "Contributor",
      azurerm_role_assignment.pipeline["estado"].role_definition_name == "Storage Blob Data Contributor",
      azurerm_role_assignment.pipeline["grupo"].scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.pipeline["estado"].scope == azurerm_storage_account.estado.id,
    ])
    error_message = "El código es el mismo en los dos ambientes."
  }
}

# Credencial federada de Azure DevOps sobre la identidad administrada del pipeline.
run "credencial_federada_por_defecto" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      azurerm_federated_identity_credential.azure_devops.name == "azure-devops-sc-alcanzamos-uat-eus2",
      azurerm_federated_identity_credential.azure_devops.user_assigned_identity_id == azurerm_user_assigned_identity.pipeline.id,
      azurerm_federated_identity_credential.azure_devops.audience == tolist(["api://AzureADTokenExchange"]),
      azurerm_federated_identity_credential.azure_devops.issuer == "https://vstoken.dev.azure.com/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      azurerm_federated_identity_credential.azure_devops.subject == "sc://alcanzamos/alcanzamos/sc-alcanzamos-uat-eus2",
    ])
    error_message = "La credencial federada debe confiar en la conexión de servicio de Azure DevOps del ambiente."
  }
}

run "credencial_federada_con_emisor_y_sujeto_propios" {
  command = plan
  variables {
    ambiente                   = "produccion"
    credencial_federada_emisor = "https://login.microsoftonline.com/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/v2.0"
    credencial_federada_sujeto = "/eid1/c/pub/t/ccc/a/ddd/eee"
  }

  assert {
    condition = alltrue([
      azurerm_federated_identity_credential.azure_devops.issuer == "https://login.microsoftonline.com/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/v2.0",
      azurerm_federated_identity_credential.azure_devops.subject == "/eid1/c/pub/t/ccc/a/ddd/eee",
    ])
    error_message = "El emisor y el sujeto de las variables reemplazan a los derivados."
  }
}

# Cinco identidades de carga: API, web, tareas, migrador y caj-psql (E11-INF 2.3, 2.3 bis, 2.4; D-206 (7)).
run "cinco_identidades_de_carga_en_uat" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      length(azurerm_user_assigned_identity.carga) == 5,
      azurerm_user_assigned_identity.carga["api"].name == "id-alcanzamos-api-uat-eus2",
      azurerm_user_assigned_identity.carga["web"].name == "id-alcanzamos-web-uat-eus2",
      azurerm_user_assigned_identity.carga["tareas"].name == "id-alcanzamos-tareas-uat-eus2",
      azurerm_user_assigned_identity.carga["migrador"].name == "id-alcanzamos-migrador-uat-eus2",
      azurerm_user_assigned_identity.carga["psql"].name == "id-alcanzamos-psql-uat-eus2",
      alltrue([for i in values(azurerm_user_assigned_identity.carga) : i.location == "eastus2"]),
      alltrue([for i in values(azurerm_user_assigned_identity.carga) : i.tags == tomap({ proyecto = "alcanzamos", ambiente = "uat", origen = "opentofu" })]),
      alltrue([for i in values(azurerm_user_assigned_identity.carga) : i.resource_group_name == "rg-alcanzamos-uat-eus2"]),
    ])
    error_message = "UAT debe tener las cinco identidades de carga, con sus nombres, en East US 2."
  }
}

run "cinco_identidades_de_carga_en_produccion" {
  command = plan
  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      length(azurerm_user_assigned_identity.carga) == 5,
      azurerm_user_assigned_identity.carga["api"].name == "id-alcanzamos-api-prod-eus2",
      azurerm_user_assigned_identity.carga["web"].name == "id-alcanzamos-web-prod-eus2",
      azurerm_user_assigned_identity.carga["tareas"].name == "id-alcanzamos-tareas-prod-eus2",
      azurerm_user_assigned_identity.carga["migrador"].name == "id-alcanzamos-migrador-prod-eus2",
      azurerm_user_assigned_identity.carga["psql"].name == "id-alcanzamos-psql-prod-eus2",
      alltrue([for i in values(azurerm_user_assigned_identity.carga) : i.resource_group_name == "rg-alcanzamos-prod-eus2"]),
    ])
    error_message = "Producción debe tener las cinco identidades de carga con el sufijo -prod-eus2."
  }
}

# Lo que infra/azure necesita de cada identidad: ID, client_id y principal_id (salida identidades_de_carga).
run "salidas_de_las_identidades" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      toset(keys(output.identidades_de_carga)) == toset(["api", "web", "tareas", "migrador", "psql"]),
      alltrue([for k, v in output.identidades_de_carga : toset(keys(v)) == toset(["nombre", "id", "client_id", "principal_id"])]),
      output.identidades_de_carga["web"].nombre == "id-alcanzamos-web-uat-eus2",
      output.identidades_de_carga["psql"].nombre == "id-alcanzamos-psql-uat-eus2",
      output.client_id_del_pipeline == "11111111-1111-1111-1111-111111111111",
    ])
    error_message = "Las salidas deben dar nombre, ID, client_id y principal_id de cada identidad, y el client_id del pipeline."
  }
}

# Sin azuread y sin Azure Communication Services (D-205 (5), E11-INF 2.14).
run "sin_communication_services" {
  command = plan
  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      length(azurerm_resource_provider_registration.proveedores) == 7,
      !contains(keys(azurerm_resource_provider_registration.proveedores), "Microsoft.Communication"),
      contains(keys(azurerm_resource_provider_registration.proveedores), "Microsoft.ManagedIdentity"),
    ])
    error_message = "Microsoft.Communication ya no se registra."
  }

  assert {
    condition     = azurerm_role_assignment.api_lee_secretos.role_definition_name == "Key Vault Secrets User"
    error_message = "El único rol del API en el bootstrap es Key Vault Secrets User: ya no hay rol de correo."
  }
}

# Región East US 2 (D-208).
run "region_por_defecto_es_eastus2" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      var.ubicacion == "eastus2",
      azurerm_resource_group.principal.location == "eastus2",
      azurerm_resource_group.principal.name == "rg-alcanzamos-uat-eus2",
    ])
    error_message = "La región por defecto es eastus2 y el sufijo, -eus2."
  }
}
