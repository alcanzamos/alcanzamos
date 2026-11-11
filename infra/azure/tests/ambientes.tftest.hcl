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
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id"
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

  mock_resource "azurerm_email_communication_service" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Communication/emailServices/ecs"
    }
  }

  mock_resource "azurerm_email_communication_service_domain" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Communication/emailServices/ecs/domains/avisos"
    }
  }

  mock_resource "azurerm_communication_service" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Communication/communicationServices/acs"
    }
  }

  mock_resource "azurerm_monitor_action_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Insights/actionGroups/ag"
    }
  }
}

variables {
  subscription_id          = "00000000-0000-0000-0000-000000000000"
  admin_postgres_object_id = "00000000-0000-0000-0000-000000000000"
  admin_postgres_nombre    = "andres@alcanzamos.co"
  imagen_api               = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
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
      data.azurerm_resource_group.principal.name == "rg-alcanzamos-prod-mxc",
      data.azurerm_user_assigned_identity.api.name == "id-alcanzamos-prod-mxc",
      azurerm_log_analytics_workspace.registros.name == "log-alcanzamos-prod-mxc",
      azurerm_key_vault.secretos.name == "kv-alcanzamos-prod-mxc",
      azurerm_postgresql_flexible_server.datos.name == "psql-alcanzamos-prod-mxc",
      azurerm_container_app_environment.entorno.name == "cae-alcanzamos-prod-mxc",
      azurerm_container_app.api.name == "ca-api-alcanzamos-prod-mxc",
      azurerm_container_app_job.tareas.name == "caj-tareas-alcanzamos-prod-mxc",
      azurerm_email_communication_service.correo.name == "ecs-alcanzamos-prod-mxc",
      azurerm_communication_service.correo.name == "acs-alcanzamos-prod-mxc",
      azurerm_monitor_action_group.seguridad.name == "ag-seguridad-alcanzamos-prod-mxc",
      azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.name == "alrt-seguridad-alcanzamos-prod-mxc",
    ])
    error_message = "Los nombres de producción deben seguir siendo los aprobados (O-14, D-120)."
  }

  assert {
    condition     = azurerm_email_communication_service_domain.avisos.name == "avisos.alcanzamos.co"
    error_message = "El dominio de correo de producción es avisos.alcanzamos.co (D-113)."
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
      data.azurerm_resource_group.principal.name == "rg-alcanzamos-uat-mxc",
      data.azurerm_user_assigned_identity.api.name == "id-alcanzamos-uat-mxc",
      azurerm_log_analytics_workspace.registros.name == "log-alcanzamos-uat-mxc",
      azurerm_key_vault.secretos.name == "kv-alcanzamos-uat-mxc",
      azurerm_postgresql_flexible_server.datos.name == "psql-alcanzamos-uat-mxc",
      azurerm_container_app_environment.entorno.name == "cae-alcanzamos-uat-mxc",
      azurerm_container_app.api.name == "ca-api-alcanzamos-uat-mxc",
      azurerm_container_app_job.tareas.name == "caj-tareas-alcanzamos-uat-mxc",
      azurerm_email_communication_service.correo.name == "ecs-alcanzamos-uat-mxc",
      azurerm_communication_service.correo.name == "acs-alcanzamos-uat-mxc",
      azurerm_monitor_action_group.seguridad.name == "ag-seguridad-alcanzamos-uat-mxc",
      azurerm_monitor_scheduled_query_rules_alert_v2.eventos_de_seguridad.name == "alrt-seguridad-alcanzamos-uat-mxc",
    ])
    error_message = "UAT debe usar sus propios nombres, con «uat» en el sufijo."
  }

  assert {
    condition     = azurerm_email_communication_service_domain.avisos.name == "avisos-uat.alcanzamos.co"
    error_message = "El dominio de correo de UAT es avisos-uat.alcanzamos.co (S5)."
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

run "ambiente_desconocido_se_rechaza" {
  command = plan

  variables {
    ambiente          = "desarrollo"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  expect_failures = [var.ambiente]
}

# El dominio de producción no se crea en UAT (ni al revés): cada Email Communication Service tiene el suyo (D-200 (8)).
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
