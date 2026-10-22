# Alerta de eventos de seguridad (RNF-025, E11-DAR §7).
# O-5 (D-120): más de 10 eventos de un mismo tipo en 15 minutos; aviso por
# correo a andres@alcanzamos.co. La prueba de que el aviso llega se hace en el
# primer despliegue.
resource "azurerm_monitor_action_group" "seguridad" {
  name                = "ag-seguridad-${local.sufijo}"
  resource_group_name = data.azurerm_resource_group.principal.name
  short_name          = "seguridad"
  tags                = local.etiquetas

  email_receiver {
    name          = "responsable"
    email_address = var.alerta_correo
  }
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "eventos_de_seguridad" {
  name                 = "alrt-seguridad-${local.sufijo}"
  location             = data.azurerm_resource_group.principal.location
  resource_group_name  = data.azurerm_resource_group.principal.name
  scopes               = [azurerm_log_analytics_workspace.registros.id]
  severity             = 2
  evaluation_frequency = var.alerta_ventana
  window_duration      = var.alerta_ventana
  description          = "RNF-025: un tipo de evento de seguridad supera el umbral (O-5, D-120)."
  tags                 = local.etiquetas

  # El API escribe una línea JSON por evento (E11-DAR §7). El nombre del campo
  # con el tipo de evento, «evento_seguridad», se fija con el registro en la US-45.
  # La dimensión «tipo» hace que el umbral se evalúe por cada tipo de evento.
  criteria {
    query                   = <<-KQL
      ContainerAppConsoleLogs_CL
      | extend evento = parse_json(Log_s)
      | where isnotempty(tostring(evento.evento_seguridad))
      | project TimeGenerated, tipo = tostring(evento.evento_seguridad)
    KQL
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = var.alerta_umbral

    dimension {
      name     = "tipo"
      operator = "Include"
      values   = ["*"]
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.seguridad.id]
  }
}
