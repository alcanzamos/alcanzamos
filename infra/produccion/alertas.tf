# Alerta de eventos de seguridad (RNF-025, E11-DAR §7).
# Umbral, ventana y canal: pendiente O-5, lo decide el dueño.
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
  description          = "RNF-025: eventos de seguridad por encima del umbral (O-5)."
  tags                 = local.etiquetas

  # El API escribe registros JSON con el campo «evento_seguridad» (E11-DAR §7).
  criteria {
    query                   = <<-KQL
      ContainerAppConsoleLogs_CL
      | where Log_s has "evento_seguridad"
    KQL
    time_aggregation_method = "Count"
    operator                = "GreaterThan"
    threshold               = var.alerta_umbral
  }

  action {
    action_groups = [azurerm_monitor_action_group.seguridad.id]
  }
}
