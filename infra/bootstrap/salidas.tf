output "client_id_del_pipeline" {
  description = "Va en la conexión de servicio de Azure DevOps (identidad federada)."
  value       = azurerm_user_assigned_identity.pipeline.client_id
}

output "identidades_de_carga" {
  description = "Identidades del API, la web, las tareas, el migrador y caj-psql (clave: api, web, tareas, migrador, psql). infra/azure las usa por ID, client_id y principal_id."
  value = {
    for rol, i in azurerm_user_assigned_identity.carga : rol => {
      nombre       = i.name
      id           = i.id
      client_id    = i.client_id
      principal_id = i.principal_id
    }
  }
}

output "tenant_id" {
  value = data.azurerm_client_config.actual.tenant_id
}

output "backend" {
  description = "Valores de -backend-config para infra/azure en este ambiente; la clave del estado es <ambiente>.tfstate."
  value = {
    resource_group_name  = azurerm_resource_group.principal.name
    storage_account_name = azurerm_storage_account.estado.name
    container_name       = azurerm_storage_container.estado.name
    key                  = "${var.ambiente}.tfstate"
    use_azuread_auth     = true
  }
}
