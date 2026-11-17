# Identidad del pipeline: service principal con identidad federada de
# Azure DevOps (workload identity federation). Sin secretos.
data "azurerm_client_config" "actual" {}

locals {
  conexion_de_servicio = coalesce(var.conexion_de_servicio, "sc-${local.sufijo}")
}

resource "azuread_application" "pipeline" {
  display_name = "app-pipeline-${local.sufijo}"
}

resource "azuread_service_principal" "pipeline" {
  client_id = azuread_application.pipeline.client_id
}

resource "azuread_application_federated_identity_credential" "azure_devops" {
  application_id = azuread_application.pipeline.id
  display_name   = "azure-devops-${local.conexion_de_servicio}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://vstoken.dev.azure.com/${var.azure_devops_organizacion_id}"
  subject        = "sc://alcanzamos/alcanzamos/${local.conexion_de_servicio}"
}

# Permisos solo sobre el grupo de recursos del proyecto (D-119, opción A).
resource "azurerm_role_assignment" "pipeline_contribuye" {
  scope                = azurerm_resource_group.principal.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.pipeline.object_id
}

# Estado remoto: la identidad escribe solo en su cuenta de almacenamiento.
resource "azurerm_role_assignment" "pipeline_estado" {
  scope                = azurerm_storage_account.estado.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_service_principal.pipeline.object_id
}

# Identidad administrada del API y sus roles, en el grupo del proyecto.
# Se crean aquí para que el pipeline no necesite permisos para asignar roles.
resource "azurerm_user_assigned_identity" "api" {
  name                = "id-${local.sufijo}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  tags                = local.etiquetas
}

resource "azurerm_role_assignment" "api_lee_secretos" {
  scope                = azurerm_resource_group.principal.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

# Rol propio de mínimo privilegio para enviar correo con Microsoft Entra ID (D-204, US-79 L9 y L10).
# El ejemplo oficial con identidad administrada pide Contributor o un rol propio con
# Microsoft.Communication/CommunicationServices/Read y /Write
# (learn.microsoft.com/en-us/samples/azure-samples/communication-services-dotnet-quickstarts/email-sample-send-email-with-managed-identity/).
# Se evita «Communication and Email Service Owner»: suma ListKeys y RegenerateKey (acceso a las claves) y escrituras en
# EmailServices y Domains, que el API no debe tener. Sin acciones de datos: el ejemplo oficial solo pide Read y Write; si el
# envío real en UAT demuestra que hacen falta, se agregan citando la fuente. Se confirma solo con ese envío real en UAT.
# Alcance: el grupo del ambiente. El recurso de Communication Services lo crea infra/azure después de este bootstrap, así que
# su ID aún no existe aquí; y la asignación se queda en el bootstrap para que el pipeline no necesite asignar roles.
resource "azurerm_role_definition" "envia_correo" {
  name        = "rol-envia-correo-${local.sufijo}"
  scope       = azurerm_resource_group.principal.id
  description = "Enviar correo con Communication Services y Entra ID, sin acceso a claves ni a EmailServices o Domains (D-204)."

  permissions {
    actions = [
      "Microsoft.Communication/CommunicationServices/Read",
      "Microsoft.Communication/CommunicationServices/Write",
    ]
  }

  assignable_scopes = [azurerm_resource_group.principal.id]
}

resource "azurerm_role_assignment" "api_envia_correo" {
  scope              = azurerm_resource_group.principal.id
  role_definition_id = azurerm_role_definition.envia_correo.role_definition_resource_id
  principal_id       = azurerm_user_assigned_identity.api.principal_id
}
