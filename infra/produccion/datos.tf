# PostgreSQL flexible 18, B1ms y 32 GiB (ADR-006 §5.2). Solo autenticación de Entra ID:
# el API entra con su identidad administrada, sin contraseñas.
resource "azurerm_postgresql_flexible_server" "datos" {
  name                          = "psql-${local.sufijo}"
  location                      = data.azurerm_resource_group.principal.location
  resource_group_name           = data.azurerm_resource_group.principal.name
  version                       = "18"
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  backup_retention_days         = 7
  public_network_access_enabled = true
  zone                          = "1"

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
    tenant_id                     = data.azurerm_client_config.actual.tenant_id
  }

  tags = local.etiquetas
}

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "admin" {
  server_name         = azurerm_postgresql_flexible_server.datos.name
  resource_group_name = data.azurerm_resource_group.principal.name
  tenant_id           = data.azurerm_client_config.actual.tenant_id
  object_id           = var.admin_postgres_object_id
  principal_name      = var.admin_postgres_nombre
  principal_type      = "User"
}

# TLS obligatorio (1.2 o superior).
resource "azurerm_postgresql_flexible_server_configuration" "tls" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.datos.id
  value     = "on"
}

resource "azurerm_postgresql_flexible_server_database" "alcanzamos" {
  name      = "alcanzamos"
  server_id = azurerm_postgresql_flexible_server.datos.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Solo servicios de Azure (Container Apps de consumo no tiene IP fija).
resource "azurerm_postgresql_flexible_server_firewall_rule" "servicios_azure" {
  name             = "servicios-de-azure"
  server_id        = azurerm_postgresql_flexible_server.datos.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}
