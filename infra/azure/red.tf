# Red privada del ambiente (D-205 (2), E11-INF 2.2): una red virtual por ambiente, sin emparejar con la del otro. Tiene dos subredes:
# la /27 del entorno de Container Apps (perfiles de carga de trabajo, solo consumo) y la delegada a PostgreSQL, con su zona DNS privada.
# El rango se parte a partir de var.red_espacio_de_direcciones, una /24: la /27 es la primera (.0 a .31) y la /28 de PostgreSQL empieza en .32.
resource "azurerm_virtual_network" "red" {
  name                = "vnet-${local.sufijo}"
  location            = data.azurerm_resource_group.principal.location
  resource_group_name = data.azurerm_resource_group.principal.name
  address_space       = [var.red_espacio_de_direcciones]
  tags                = local.etiquetas
}

# Container Apps con perfiles de carga de trabajo pide una /27 como mínimo y la subred delegada a Microsoft.App/environments, sin más recursos.
resource "azurerm_subnet" "entorno" {
  name                 = "snet-entorno-${local.sufijo}"
  resource_group_name  = data.azurerm_resource_group.principal.name
  virtual_network_name = azurerm_virtual_network.red.name
  address_prefixes     = [cidrsubnet(var.red_espacio_de_direcciones, 3, 0)]

  # Punto de conexión de servicio hacia el Key Vault: su firewall deja pasar solo esta subred (principal.tf).
  service_endpoint {
    service = "Microsoft.KeyVault"
  }

  delegation {
    name = "entorno-de-container-apps"

    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# PostgreSQL flexible con acceso privado vive en una subred propia, delegada al servicio (mínimo /28).
resource "azurerm_subnet" "postgres" {
  name                 = "snet-postgres-${local.sufijo}"
  resource_group_name  = data.azurerm_resource_group.principal.name
  virtual_network_name = azurerm_virtual_network.red.name
  address_prefixes     = [cidrsubnet(var.red_espacio_de_direcciones, 4, 2)]

  delegation {
    name = "postgres-flexible"

    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# La zona tiene que terminar en .postgres.database.azure.com. Es privada: solo se resuelve desde la red del ambiente.
resource "azurerm_private_dns_zone" "postgres" {
  name                = "${local.sufijo}.private.postgres.database.azure.com"
  resource_group_name = data.azurerm_resource_group.principal.name
  tags                = local.etiquetas
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                 = "vnl-${local.sufijo}"
  private_dns_zone_id  = azurerm_private_dns_zone.postgres.id
  virtual_network_id   = azurerm_virtual_network.red.id
  registration_enabled = false
  tags                 = local.etiquetas
}
