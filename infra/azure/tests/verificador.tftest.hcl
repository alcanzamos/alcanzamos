# Nombres, tamaños y dominio de correo por ambiente (US-79, D-200 (8)): el mismo código para UAT y producción,
# solo cambian los parámetros. Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
#   tofu init -backend=false && tofu test
# El proveedor valida la forma de los ID que pasan de un recurso a otro: el simulacro los da con esa forma.
mock_provider "azurerm" {
  override_data {
    target = data.azurerm_client_config.actual
    values = {
      tenant_id = "00000000-0000-0000-0000-000000000000"
    }
  }

  mock_data "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id"
      principal_id = "00000000-0000-0000-0000-000000000000"
      client_id    = "00000000-0000-0000-0000-000000000000"
    }
  }

  # El ID del secreto del registro se arma con la URI del Key Vault, y el proveedor valida su forma.
  mock_resource "azurerm_key_vault" {
    defaults = {
      id        = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv"
      vault_uri = "https://kv.vault.azure.net/"
    }
  }

  mock_resource "azurerm_log_analytics_workspace" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/log"
    }
  }

  mock_resource "azurerm_postgresql_flexible_server" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.DBforPostgreSQL/flexibleServers/psql"
    }
  }

  mock_resource "azurerm_container_app_environment" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/cae"
    }
  }

  # La red y la zona DNS privada: el proveedor valida la forma de sus ID cuando pasan a PostgreSQL y al entorno.
  mock_resource "azurerm_virtual_network" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet"
    }
  }

  mock_resource "azurerm_subnet" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet"
    }
  }

  mock_resource "azurerm_private_dns_zone" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/privateDnsZones/zona.postgres.database.azure.com"
    }
  }

  mock_resource "azurerm_monitor_action_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Insights/actionGroups/ag"
    }
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000000"
  imagen_api      = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  ghcr_usuario    = "usuario-de-prueba"
}

# Producción conserva los nombres aprobados (O-14, D-120) y los tamaños de ADR-006 §5.2.

# Pruebas del verificador independiente (US-79 T1): producción conserva su seguridad y sus valores fijos, UAT
# etiqueta todos sus recursos y no relaja nada, y se rechazan valores de ambiente parecidos a los válidos.

run "produccion_conserva_seguridad_y_valores_fijos" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_key_vault.secretos.purge_protection_enabled == true,
      azurerm_key_vault.secretos.soft_delete_retention_days == 90,
      azurerm_key_vault.secretos.rbac_authorization_enabled == true,
      azurerm_postgresql_flexible_server.datos.authentication[0].password_auth_enabled == false,
      azurerm_postgresql_flexible_server.datos.authentication[0].active_directory_auth_enabled == true,
      azurerm_postgresql_flexible_server.datos.backup_retention_days == 7,
      azurerm_postgresql_flexible_server_configuration.tls.value == "on",
      azurerm_postgresql_flexible_server.datos.public_network_access_enabled == false,
      azurerm_log_analytics_workspace.registros.sku == "PerGB2018",
      [for r in azurerm_monitor_action_group.seguridad.email_receiver : r.email_address] == ["andres@alcanzamos.co"],
      azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.criteria[0].threshold == 10,
      azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.window_duration == "PT15M",
      azurerm_container_app.api.ingress[0].target_port == 8080,
      azurerm_container_app_job.tareas.schedule_trigger_config[0].cron_expression == "*/15 * * * *",
      azurerm_container_app_job.tareas.template[0].container[0].command == tolist(["/alcanzamos", "tareas"]),
      toset([for e in azurerm_container_app.api.template[0].container[0].env : e.name]) == toset(["PGHOST", "PGDATABASE", "PGUSER", "PGSSLMODE", "AZURE_CLIENT_ID", "CORREO_SMTP", "CORREO_USUARIO", "CORREO_CONTRASENA", "CORREO_REMITENTE"]),
      [for e in azurerm_container_app.api.template[0].container[0].env : e.value if e.name == "PGSSLMODE"] == ["verify-full"],
    ])
    error_message = "Producción cambió algo que no es un parámetro de ambiente."
  }
  assert {
    condition = alltrue([for t in [
      azurerm_log_analytics_workspace.registros.tags, azurerm_key_vault.secretos.tags, azurerm_postgresql_flexible_server.datos.tags,
      azurerm_container_app_environment.entorno.tags, azurerm_container_app.api.tags, azurerm_container_app_job.tareas.tags,
      azurerm_monitor_action_group.seguridad.tags, azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.tags,
    ] : t == tomap({ proyecto = "alcanzamos", ambiente = "produccion", origen = "opentofu" })])
    error_message = "Alguna etiqueta de producción cambió."
  }
}

run "uat_etiqueta_todos_los_recursos_y_cumple_formatos" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue([for t in [
      azurerm_log_analytics_workspace.registros.tags, azurerm_key_vault.secretos.tags, azurerm_postgresql_flexible_server.datos.tags,
      azurerm_container_app_environment.entorno.tags, azurerm_container_app.api.tags, azurerm_container_app_job.tareas.tags,
      azurerm_monitor_action_group.seguridad.tags, azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.tags,
    ] : t == tomap({ proyecto = "alcanzamos", ambiente = "uat", origen = "opentofu" })])
    error_message = "Alguna etiqueta de UAT no dice uat."
  }
  assert {
    condition = alltrue([
      azurerm_key_vault.secretos.purge_protection_enabled == true,
      azurerm_postgresql_flexible_server.datos.authentication[0].password_auth_enabled == false,
      can(regex("^[a-z][a-z0-9-]{1,22}[a-z0-9]$", azurerm_key_vault.secretos.name)),
      can(regex("^[a-z][a-z0-9-]{0,30}[a-z0-9]$", azurerm_container_app.api.name)),
      can(regex("^[a-z][a-z0-9-]{0,30}[a-z0-9]$", azurerm_container_app_job.tareas.name)),
      length(azurerm_monitor_action_group.seguridad.short_name) <= 12,
    ])
    error_message = "UAT relaja la seguridad o un nombre no cumple el formato de Azure."
  }
}

run "rechaza_ambiente_en_mayusculas" {
  command = plan
  variables {
    ambiente          = "UAT"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }
  expect_failures = [var.ambiente]
}

run "rechaza_abreviatura_prod" {
  command = plan
  variables {
    ambiente          = "prod"
    dominio_de_correo = "avisos.alcanzamos.co"
  }
  expect_failures = [var.ambiente]
}

run "rechaza_replicas_fuera_de_rango" {
  command = plan
  variables {
    ambiente             = "uat"
    dominio_de_correo    = "avisos-uat.alcanzamos.co"
    api_replicas_minimas = 2
  }
  expect_failures = [var.api_replicas_minimas]
}

run "rechaza_dominio_con_sufijo_ajeno" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co.example.com"
  }
  expect_failures = [var.dominio_de_correo]
}

run "rechaza_dominio_de_produccion_en_mayusculas" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "Avisos.alcanzamos.co"
  }
  expect_failures = [var.dominio_de_correo]
}
