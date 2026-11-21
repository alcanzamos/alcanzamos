# Container Apps de consumo: el API y el trabajo programado (E11-DAR §6.1, ADR-006 §5).
resource "azurerm_container_app_environment" "entorno" {
  name                       = "cae-${local.sufijo}"
  location                   = data.azurerm_resource_group.principal.location
  resource_group_name        = data.azurerm_resource_group.principal.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.registros.id
  infrastructure_subnet_id   = azurerm_subnet.entorno.id
  tags                       = local.etiquetas

  # Solo consumo (D-205 (2)): ningún perfil dedicado, así que no se paga capacidad reservada.
  workload_profile {
    name                  = local.perfil_de_consumo
    workload_profile_type = "Consumption"
  }
}

locals {
  perfil_de_consumo = "Consumption"

  # La base se conecta solo con la identidad administrada: ni una URL de conexión ni una contraseña, y siempre con verify-full.
  # El API se niega a arrancar en Azure si recibe la URL (src/bd); una prueba de infra/azure prohíbe que vuelva a estar aquí.
  variables_api = {
    PGHOST           = azurerm_postgresql_flexible_server.datos.fqdn
    PGDATABASE       = azurerm_postgresql_flexible_server_database.alcanzamos.name
    PGUSER           = data.azurerm_user_assigned_identity.api.name
    PGSSLMODE        = "verify-full"
    AZURE_CLIENT_ID  = data.azurerm_user_assigned_identity.api.client_id
    CORREO_SMTP      = "smtp.zeptomail.com:587"
    CORREO_USUARIO   = var.correo_usuario
    CORREO_REMITENTE = local.correo_remitente
  }

  # El trabajo de tareas se conecta con su propia identidad: cambian PGUSER y AZURE_CLIENT_ID; el resto es igual al del API.
  variables_tareas = merge(local.variables_api, {
    PGUSER          = data.azurerm_user_assigned_identity.tareas.name
    AZURE_CLIENT_ID = data.azurerm_user_assigned_identity.tareas.client_id
  })

  # Remitente aprobado (D-120): no-responder@<dominio de correo del ambiente>, salvo que se pase otro del mismo dominio.
  correo_remitente = coalesce(var.correo_remitente, "no-responder@${var.dominio_de_correo}")

  # Token read:packages de ghcr.io en el Key Vault del ambiente (D-200 (9)(a)). Sin versión: Container Apps toma la
  # última, así renovar el token es solo cargar una versión nueva. El dueño carga el valor; OpenTofu no lo conoce.
  ghcr_secreto_en_key_vault = "${azurerm_key_vault.secretos.vault_uri}secrets/${var.ghcr_nombre_del_secreto}"

  # Contraseña de SMTP de Zoho CPaaS (US-80), también en el Key Vault del ambiente y sin versión. El dueño carga el valor
  # (README); OpenTofu no lo conoce, y el API la recibe en CORREO_CONTRASENA como referencia al secreto, nunca por valor.
  correo_secreto_en_key_vault = "${azurerm_key_vault.secretos.vault_uri}secrets/${var.correo_nombre_del_secreto}"
}

resource "azurerm_container_app" "api" {
  name                         = "ca-api-${local.sufijo}"
  container_app_environment_id = azurerm_container_app_environment.entorno.id
  resource_group_name          = data.azurerm_resource_group.principal.name
  revision_mode                = "Single"
  workload_profile_name        = local.perfil_de_consumo
  tags                         = local.etiquetas

  identity {
    type         = "UserAssigned"
    identity_ids = [data.azurerm_user_assigned_identity.api.id]
  }

  # Paquete privado: la identidad del API lee el token del Key Vault (su rol sobre el secreto lo asigna el dueño con infra/secretos).
  secret {
    name                = var.ghcr_nombre_del_secreto
    key_vault_secret_id = local.ghcr_secreto_en_key_vault
    identity            = data.azurerm_user_assigned_identity.api.id
  }

  secret {
    name                = var.correo_nombre_del_secreto
    key_vault_secret_id = local.correo_secreto_en_key_vault
    identity            = data.azurerm_user_assigned_identity.api.id
  }

  registry {
    server               = "ghcr.io"
    username             = var.ghcr_usuario
    password_secret_name = var.ghcr_nombre_del_secreto
  }

  template {
    min_replicas = var.api_replicas_minimas
    max_replicas = 1

    container {
      name   = "api"
      image  = var.imagen_api
      cpu    = var.contenedor_cpu
      memory = var.contenedor_memoria

      dynamic "env" {
        for_each = local.variables_api
        content {
          name  = env.key
          value = env.value
        }
      }

      # La contraseña va solo como referencia al secreto de arriba, nunca con valor.
      env {
        name        = "CORREO_CONTRASENA"
        secret_name = var.correo_nombre_del_secreto
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
  workload_profile_name        = local.perfil_de_consumo
  tags                         = local.etiquetas

  identity {
    type         = "UserAssigned"
    identity_ids = [data.azurerm_user_assigned_identity.tareas.id]
  }

  secret {
    name                = var.ghcr_nombre_del_secreto
    key_vault_secret_id = local.ghcr_secreto_en_key_vault
    identity            = data.azurerm_user_assigned_identity.tareas.id
  }

  secret {
    name                = var.correo_nombre_del_secreto
    key_vault_secret_id = local.correo_secreto_en_key_vault
    identity            = data.azurerm_user_assigned_identity.tareas.id
  }

  registry {
    server               = "ghcr.io"
    username             = var.ghcr_usuario
    password_secret_name = var.ghcr_nombre_del_secreto
  }

  schedule_trigger_config {
    cron_expression = "*/15 * * * *"
  }

  template {
    container {
      name    = "tareas"
      image   = var.imagen_api
      command = ["/alcanzamos", "tareas"]
      cpu     = var.contenedor_cpu
      memory  = var.contenedor_memoria

      dynamic "env" {
        for_each = local.variables_tareas
        content {
          name  = env.key
          value = env.value
        }
      }

      # La contraseña va solo como referencia al secreto de arriba, nunca con valor.
      env {
        name        = "CORREO_CONTRASENA"
        secret_name = var.correo_nombre_del_secreto
      }
    }
  }
}
