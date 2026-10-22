# Identidad del pipeline: service principal con identidad federada de
# Azure DevOps (workload identity federation). Sin secretos.
data "azurerm_client_config" "actual" {}

resource "azuread_application" "pipeline" {
  display_name = "app-pipeline-${local.sufijo}"
}

resource "azuread_service_principal" "pipeline" {
  client_id = azuread_application.pipeline.client_id
}

resource "azuread_application_federated_identity_credential" "azure_devops" {
  application_id = azuread_application.pipeline.id
  display_name   = "azure-devops-${var.conexion_de_servicio}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://vstoken.dev.azure.com/${var.azure_devops_organizacion_id}"
  subject        = "sc://alcanzamos/alcanzamos/${var.conexion_de_servicio}"
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

# Rol que indica Microsoft para enviar correo con Entra ID
# (learn.microsoft.com/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication).
resource "azurerm_role_assignment" "api_envia_correo" {
  scope                = azurerm_resource_group.principal.id
  role_definition_name = "Communication and Email Service Owner"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}
