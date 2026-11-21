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
run "produccion_conserva_nombres_y_tamanos" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      data.azurerm_resource_group.principal.name == "rg-alcanzamos-prod-eus2",
      data.azurerm_user_assigned_identity.api.name == "id-alcanzamos-api-prod-eus2",
      azurerm_log_analytics_workspace.registros.name == "log-alcanzamos-prod-eus2",
      "kv-alcanzamos-prod-eus2" == azurerm_key_vault.secretos.name,
      azurerm_postgresql_flexible_server.datos.name == "psql-alcanzamos-prod-eus2",
      azurerm_container_app_environment.entorno.name == "cae-alcanzamos-prod-eus2",
      azurerm_container_app.api.name == "ca-api-alcanzamos-prod-eus2",
      azurerm_container_app_job.tareas.name == "caj-tareas-alcanzamos-prod-eus2",
      azurerm_monitor_action_group.seguridad.name == "ag-seguridad-alcanzamos-prod-eus2",
      azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.name == "alrt-seguridad-alcanzamos-prod-eus2",
    ])
    error_message = "Los nombres de producción deben seguir siendo los aprobados (O-14, D-120)."
  }

  assert {
    condition     = [for e in azurerm_container_app.api.template[0].container[0].env : e.value if e.name == "CORREO_REMITENTE"] == ["no-responder@avisos.alcanzamos.co"]
    error_message = "El remitente de producción es no-responder@avisos.alcanzamos.co (D-113, D-120)."
  }

  assert {
    condition = alltrue([
      azurerm_key_vault.secretos.tags == tomap({ proyecto = "alcanzamos", ambiente = "produccion", origen = "opentofu" }),
      azurerm_postgresql_flexible_server.datos.tags["ambiente"] == "produccion",
    ])
    error_message = "Las etiquetas de producción deben ser las de siempre, con ambiente = produccion."
  }

  assert {
    condition = alltrue([
      azurerm_postgresql_flexible_server.datos.sku_name == "B_Standard_B1ms",
      azurerm_postgresql_flexible_server.datos.storage_mb == 32768,
      azurerm_log_analytics_workspace.registros.retention_in_days == 90,
      azurerm_key_vault.secretos.soft_delete_retention_days == 90,
      azurerm_key_vault.secretos.purge_protection_enabled == true,
      azurerm_container_app.api.template[0].min_replicas == 1,
      azurerm_container_app.api.template[0].max_replicas == 1,
      azurerm_container_app.api.template[0].container[0].cpu == 0.25,
      azurerm_container_app.api.template[0].container[0].memory == "0.5Gi",
      azurerm_container_app_job.tareas.template[0].container[0].cpu == 0.25,
      azurerm_container_app_job.tareas.template[0].container[0].memory == "0.5Gi",
    ])
    error_message = "Los tamaños por defecto deben ser los de producción (ADR-006 §5.2, RNF-025)."
  }
}

run "uat_usa_nombres_propios" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      data.azurerm_resource_group.principal.name == "rg-alcanzamos-uat-eus2",
      data.azurerm_user_assigned_identity.api.name == "id-alcanzamos-api-uat-eus2",
      azurerm_log_analytics_workspace.registros.name == "log-alcanzamos-uat-eus2",
      "kv-alcanzamos-uat-eus2" == azurerm_key_vault.secretos.name,
      azurerm_postgresql_flexible_server.datos.name == "psql-alcanzamos-uat-eus2",
      azurerm_container_app_environment.entorno.name == "cae-alcanzamos-uat-eus2",
      azurerm_container_app.api.name == "ca-api-alcanzamos-uat-eus2",
      azurerm_container_app_job.tareas.name == "caj-tareas-alcanzamos-uat-eus2",
      azurerm_monitor_action_group.seguridad.name == "ag-seguridad-alcanzamos-uat-eus2",
      azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.name == "alrt-seguridad-alcanzamos-uat-eus2",
    ])
    error_message = "UAT debe usar sus propios nombres, con «uat» en el sufijo."
  }

  assert {
    condition     = [for e in azurerm_container_app.api.template[0].container[0].env : e.value if e.name == "CORREO_REMITENTE"] == ["no-responder@avisos-uat.alcanzamos.co"]
    error_message = "El remitente de UAT es no-responder@avisos-uat.alcanzamos.co (S5, D-120)."
  }

  assert {
    condition     = azurerm_key_vault.secretos.tags["ambiente"] == "uat" && azurerm_container_app.api.tags["ambiente"] == "uat"
    error_message = "Las etiquetas de UAT deben decir ambiente = uat."
  }
}

# Límites de Azure: Key Vault de 3 a 24 caracteres; trabajo de Container Apps de 2 a 32.
run "nombres_dentro_de_los_limites_de_azure" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      length(azurerm_key_vault.secretos.name) <= 24,
      length(azurerm_container_app.api.name) <= 32,
      length(azurerm_container_app_job.tareas.name) <= 32,
    ])
    error_message = "Un nombre supera el límite de Azure."
  }
}

run "uat_dentro_de_los_limites_de_azure" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      length(azurerm_key_vault.secretos.name) <= 24,
      length(azurerm_container_app.api.name) <= 32,
      length(azurerm_container_app_job.tareas.name) <= 32,
    ])
    error_message = "Un nombre supera el límite de Azure."
  }
}

run "los_tamanos_se_cambian_por_variable" {
  command = plan

  variables {
    ambiente                    = "uat"
    dominio_de_correo           = "avisos-uat.alcanzamos.co"
    postgres_sku                = "B_Standard_B2s"
    postgres_almacenamiento_mb  = 65536
    registros_dias_de_retencion = 30
    api_replicas_minimas        = 0
    contenedor_cpu              = 0.5
    contenedor_memoria          = "1Gi"
  }

  assert {
    condition = alltrue([
      azurerm_postgresql_flexible_server.datos.sku_name == "B_Standard_B2s",
      azurerm_postgresql_flexible_server.datos.storage_mb == 65536,
      azurerm_log_analytics_workspace.registros.retention_in_days == 30,
      azurerm_container_app.api.template[0].min_replicas == 0,
      azurerm_container_app.api.template[0].container[0].cpu == 0.5,
      azurerm_container_app.api.template[0].container[0].memory == "1Gi",
      azurerm_container_app_job.tareas.template[0].container[0].cpu == 0.5,
      azurerm_container_app_job.tareas.template[0].container[0].memory == "1Gi",
    ])
    error_message = "Los tamaños deben salir de las variables."
  }
}

# Valores de UAT que decidió el dueño (S11, D-200 (8)), los mismos de uat.tfvars.example: API apagado sin tráfico,
# registros por 30 días y Key Vault con protección contra el borrado, como producción, con la retención mínima de 7 días.
run "uat_usa_los_valores_del_dueno" {
  command = plan

  variables {
    ambiente                    = "uat"
    dominio_de_correo           = "avisos-uat.alcanzamos.co"
    api_replicas_minimas        = 0
    registros_dias_de_retencion = 30
    secretos_dias_de_retencion  = 7
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.template[0].min_replicas == 0,
      azurerm_log_analytics_workspace.registros.retention_in_days == 30,
      azurerm_key_vault.secretos.soft_delete_retention_days == 7,
      azurerm_key_vault.secretos.purge_protection_enabled == true,
    ])
    error_message = "UAT debe usar réplicas mínimas 0, registros por 30 días y Key Vault con 7 días de retención y protección contra el borrado (S11)."
  }
}

# Azure acepta de 7 a 90 días de retención en un Key Vault eliminado.
run "secretos_con_menos_de_7_dias_se_rechaza" {
  command = plan

  variables {
    ambiente                   = "uat"
    dominio_de_correo          = "avisos-uat.alcanzamos.co"
    secretos_dias_de_retencion = 6
  }

  expect_failures = [var.secretos_dias_de_retencion]
}

run "secretos_con_mas_de_90_dias_se_rechaza" {
  command = plan

  variables {
    ambiente                   = "produccion"
    dominio_de_correo          = "avisos.alcanzamos.co"
    secretos_dias_de_retencion = 91
  }

  expect_failures = [var.secretos_dias_de_retencion]
}

run "ambiente_desconocido_se_rechaza" {
  command = plan

  variables {
    ambiente          = "desarrollo"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  expect_failures = [var.ambiente]
}

# El dominio de producción no se usa en UAT (ni al revés): cada ambiente tiene su dominio de remitente y su agente de CPaaS (D-200 (8), D-205 (6)).
run "uat_no_usa_el_dominio_de_produccion" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  expect_failures = [var.dominio_de_correo]
}

run "produccion_no_usa_otro_dominio" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  expect_failures = [var.dominio_de_correo]
}
