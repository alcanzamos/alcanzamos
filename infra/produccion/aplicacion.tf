# Container Apps de consumo: el API y el trabajo programado (E11-DAR §6.1, ADR-006 §5).
resource "azurerm_container_app_environment" "entorno" {
  name                       = "cae-${local.sufijo}"
  location                   = data.azurerm_resource_group.principal.location
  resource_group_name        = data.azurerm_resource_group.principal.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.registros.id
  tags                       = local.etiquetas
}

locals {
  variables_api = {
    PGHOST           = azurerm_postgresql_flexible_server.datos.fqdn
    PGDATABASE       = azurerm_postgresql_flexible_server_database.alcanzamos.name
    PGUSER           = data.azurerm_user_assigned_identity.api.name
    PGSSLMODE        = "verify-full"
    AZURE_CLIENT_ID  = data.azurerm_user_assigned_identity.api.client_id
    CORREO_ENDPOINT  = "https://${azurerm_communication_service.correo.hostname}"
    CORREO_REMITENTE = "${azurerm_email_communication_service_domain_sender_username.avisos.name}@${azurerm_email_communication_service_domain.avisos.from_sender_domain}"
  }
}

resource "azurerm_container_app" "api" {
  name                         = "ca-api-${local.sufijo}"
  container_app_environment_id = azurerm_container_app_environment.entorno.id
  resource_group_name          = data.azurerm_resource_group.principal.name
  revision_mode                = "Single"
  tags                         = local.etiquetas

  identity {
    type         = "UserAssigned"
    identity_ids = [data.azurerm_user_assigned_identity.api.id]
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "api"
      image  = var.imagen_api
      cpu    = 0.25
      memory = "0.5Gi"

      dynamic "env" {
        for_each = local.variables_api
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

# Tareas programadas: la misma imagen con el comando «tareas», cada 15 minutos (UTC).
resource "azurerm_container_app_job" "tareas" {
  name                         = "caj-tareas-${local.sufijo}"
  location                     = data.azurerm_resource_group.principal.location
  resource_group_name          = data.azurerm_resource_group.principal.name
  container_app_environment_id = azurerm_container_app_environment.entorno.id
  replica_timeout_in_seconds   = 300
  replica_retry_limit          = 1
  tags                         = local.etiquetas

  identity {
    type         = "UserAssigned"
    identity_ids = [data.azurerm_user_assigned_identity.api.id]
  }

  schedule_trigger_config {
    cron_expression = "*/15 * * * *"
  }

  template {
    container {
      name    = "tareas"
      image   = var.imagen_api
      command = ["/api", "tareas"]
      cpu     = 0.25
      memory  = "0.5Gi"

      dynamic "env" {
        for_each = local.variables_api
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }
}
