# PostgreSQL flexible 18; en producción, B1ms y 32 GiB (ADR-006 §5.2). Acceso solo privado (D-205 (2)): el servidor vive en su subred delegada,
# se resuelve por la zona DNS privada y no tiene acceso público ni regla de firewall. Solo autenticación de Entra ID: nadie entra con contraseña.
resource "azurerm_postgresql_flexible_server" "datos" {
  name                          = "psql-${local.sufijo}"
  location                      = data.azurerm_resource_group.principal.location
  resource_group_name           = data.azurerm_resource_group.principal.name
  version                       = "18"
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_almacenamiento_mb
  backup_retention_days         = 7
  public_network_access_enabled = false
  delegated_subnet_id           = azurerm_subnet.postgres.id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  zone                          = "1"

  # Respaldo en la región pareada (Central US) solo en producción (D-208). Azure solo deja activarlo al crear el servidor: si
  # producción se crea sin él, no se puede encender después sin recrear el servidor.
  geo_redundant_backup_enabled = var.ambiente == "produccion"

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
    tenant_id                     = data.azurerm_client_config.actual.tenant_id
  }

  tags = local.etiquetas

  # El servidor se crea con la zona ya enlazada a la red; si no, no resuelve su nombre.
  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

# Administradores de Entra: el migrador (crea el esquema y el rol del API) y caj-psql (acceso manual con registro). Ni el dueño ni el API
# (E11-INF 2.3 bis). Son ServicePrincipal: las identidades administradas lo son.
resource "azurerm_postgresql_flexible_server_active_directory_administrator" "admin" {
  for_each = {
    migrador = data.azurerm_user_assigned_identity.migrador
    psql     = data.azurerm_user_assigned_identity.psql
  }

  server_name         = azurerm_postgresql_flexible_server.datos.name
  resource_group_name = data.azurerm_resource_group.principal.name
  tenant_id           = data.azurerm_client_config.actual.tenant_id
  object_id           = each.value.principal_id
  principal_name      = each.value.name
  principal_type      = "ServicePrincipal"
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
