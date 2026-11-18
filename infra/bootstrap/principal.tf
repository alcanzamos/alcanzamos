# Un bootstrap por ambiente, los dos en la misma suscripción de pago por uso, cada uno con su grupo, su estado
# y su identidad de pipeline (D-205 (11), E11-INF 2.17): mismos nombres que infra/azure.
locals {
  abreviatura = {
    uat        = "uat"
    produccion = "prod"
  }
  # East US 2 (D-208): sufijo -eus2.
  region = "eus2"
  sufijo = "alcanzamos-${local.abreviatura[var.ambiente]}-${local.region}"
  # Cuenta del estado: única en todo Azure, de 3 a 24 letras minúsculas y números.
  cuenta_de_estado = {
    uat        = "stalcanzamostfuateus2"
    produccion = "stalcanzamostfeus2"
  }
  etiquetas = {
    proyecto = "alcanzamos"
    ambiente = var.ambiente
    origen   = "opentofu"
  }
  # Proveedores aprobados por el dueño (O-14, D-076).
  proveedores = [
    "Microsoft.App",
    "Microsoft.DBforPostgreSQL",
    "Microsoft.Insights",
    "Microsoft.KeyVault",
    "Microsoft.ManagedIdentity",
    "Microsoft.OperationalInsights",
    "Microsoft.Storage",
  ]
}

resource "azurerm_resource_provider_registration" "proveedores" {
  for_each = toset(local.proveedores)
  name     = each.value
}

resource "azurerm_resource_group" "principal" {
  name     = "rg-${local.sufijo}"
  location = var.ubicacion
  tags     = local.etiquetas
}

# Estado remoto de OpenTofu, sin acceso por clave compartida.
resource "azurerm_storage_account" "estado" {
  name                            = local.cuenta_de_estado[var.ambiente]
  resource_group_name             = azurerm_resource_group.principal.name
  location                        = azurerm_resource_group.principal.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  tags                            = local.etiquetas

  # Respaldo del estado: cada escritura deja una versión y lo borrado se
  # recupera durante 30 días.
  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }
}

resource "azurerm_storage_container" "estado" {
  name               = "tfstate"
  storage_account_id = azurerm_storage_account.estado.id
}
