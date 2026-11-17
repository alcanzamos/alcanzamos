# Rol propio de mínimo privilegio para enviar correo con Microsoft Entra ID (US-79 L9, L10 y L12; D-204).
# La identidad del API recibe solo Read y Write de CommunicationServices, no «Communication and Email Service Owner»
# (que suma ListKeys, RegenerateKey y escrituras en EmailServices y Domains). Se confirma con un envío real en UAT.
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

  mock_resource "azurerm_role_definition" {
    defaults = {
      role_definition_id          = "11111111-1111-1111-1111-111111111111"
      role_definition_resource_id = "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/roleDefinitions/11111111-1111-1111-1111-111111111111"
    }
  }
}

variables {
  subscription_id              = "00000000-0000-0000-0000-000000000000"
  azure_devops_organizacion_id = "00000000-0000-0000-0000-000000000000"
}

run "uat_rol_propio_de_correo" {
  command = plan

  variables {
    ambiente = "uat"
  }

  # El rol tiene exactamente las dos acciones del ejemplo oficial de Microsoft, sin acciones de datos, sin exclusiones
  # y limitado al grupo de recursos del ambiente.
  assert {
    condition = alltrue([
      azurerm_role_definition.envia_correo.name == "rol-envia-correo-alcanzamos-uat-mxc",
      azurerm_role_definition.envia_correo.scope == azurerm_resource_group.principal.id,
      azurerm_role_definition.envia_correo.assignable_scopes == tolist([azurerm_resource_group.principal.id]),
      length(azurerm_role_definition.envia_correo.permissions) == 1,
      azurerm_role_definition.envia_correo.permissions[0].actions == tolist([
        "Microsoft.Communication/CommunicationServices/Read",
        "Microsoft.Communication/CommunicationServices/Write",
      ]),
      length(coalesce(azurerm_role_definition.envia_correo.permissions[0].data_actions, tolist([]))) == 0,
      length(coalesce(azurerm_role_definition.envia_correo.permissions[0].not_actions, tolist([]))) == 0,
      length(coalesce(azurerm_role_definition.envia_correo.permissions[0].not_data_actions, tolist([]))) == 0,
    ])
    error_message = "El rol de correo de UAT debe tener solo CommunicationServices/Read y /Write, sobre el grupo del ambiente."
  }

  # Sin acceso a las claves ni a los recursos de correo que el API no debe tocar.
  assert {
    condition = alltrue([
      !contains(azurerm_role_definition.envia_correo.permissions[0].actions, "Microsoft.Communication/CommunicationServices/ListKeys/action"),
      !contains(azurerm_role_definition.envia_correo.permissions[0].actions, "Microsoft.Communication/CommunicationServices/RegenerateKey/action"),
      !anytrue([for a in azurerm_role_definition.envia_correo.permissions[0].actions : can(regex("EmailServices|Domains|\\*", a))]),
    ])
    error_message = "El rol de correo no debe dar claves (ListKeys, RegenerateKey), EmailServices, Domains ni comodines."
  }

  # La identidad del API recibe el rol propio, no el integrado.
  assert {
    condition = alltrue([
      azurerm_role_assignment.api_envia_correo.principal_id == azurerm_user_assigned_identity.api.principal_id,
      azurerm_role_assignment.api_envia_correo.scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.api_envia_correo.role_definition_id == azurerm_role_definition.envia_correo.role_definition_resource_id,
      azurerm_role_assignment.api_envia_correo.role_definition_name != "Communication and Email Service Owner",
    ])
    error_message = "El API debe recibir el rol propio de correo y no «Communication and Email Service Owner»."
  }
}

run "produccion_rol_propio_de_correo" {
  command = plan

  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      azurerm_role_definition.envia_correo.name == "rol-envia-correo-alcanzamos-prod-mxc",
      azurerm_role_definition.envia_correo.scope == azurerm_resource_group.principal.id,
      azurerm_role_definition.envia_correo.assignable_scopes == tolist([azurerm_resource_group.principal.id]),
      azurerm_role_definition.envia_correo.permissions[0].actions == tolist([
        "Microsoft.Communication/CommunicationServices/Read",
        "Microsoft.Communication/CommunicationServices/Write",
      ]),
      length(coalesce(azurerm_role_definition.envia_correo.permissions[0].data_actions, tolist([]))) == 0,
      azurerm_role_assignment.api_envia_correo.principal_id == azurerm_user_assigned_identity.api.principal_id,
      azurerm_role_assignment.api_envia_correo.scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.api_envia_correo.role_definition_id == azurerm_role_definition.envia_correo.role_definition_resource_id,
      azurerm_role_assignment.api_envia_correo.role_definition_name != "Communication and Email Service Owner",
    ])
    error_message = "El rol de correo de producción debe ser el mismo rol mínimo, con el nombre del ambiente."
  }
}

# Lo demás no cambia: las otras asignaciones siguen con sus roles integrados y sus alcances.
run "las_demas_asignaciones_no_cambian" {
  command = plan

  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      azurerm_role_assignment.pipeline_contribuye.role_definition_name == "Contributor",
      azurerm_role_assignment.pipeline_contribuye.scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.pipeline_estado.role_definition_name == "Storage Blob Data Contributor",
      azurerm_role_assignment.pipeline_estado.scope == azurerm_storage_account.estado.id,
      azurerm_role_assignment.api_lee_secretos.role_definition_name == "Key Vault Secrets User",
      azurerm_role_assignment.api_lee_secretos.scope == azurerm_resource_group.principal.id,
      azurerm_role_assignment.api_lee_secretos.principal_id == azurerm_user_assigned_identity.api.principal_id,
    ])
    error_message = "Las asignaciones del pipeline y de lectura de secretos no deben cambiar."
  }
}
