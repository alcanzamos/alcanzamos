output "client_id_del_pipeline" {
  description = "Va en la conexión de servicio de Azure DevOps (identidad federada)."
  value       = azuread_application.pipeline.client_id
}

output "tenant_id" {
  value = data.azurerm_client_config.actual.tenant_id
}

output "backend_de_produccion" {
  description = "Valores de -backend-config para infra/produccion."
  value = {
    resource_group_name  = azurerm_resource_group.principal.name
    storage_account_name = azurerm_storage_account.estado.name
    container_name       = azurerm_storage_container.estado.name
    key                  = "produccion.tfstate"
    use_azuread_auth     = true
  }
}
