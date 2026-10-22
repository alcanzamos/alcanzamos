locals {
  sufijo = "alcanzamos-prod-mxc"
  etiquetas = {
    proyecto = "alcanzamos"
    ambiente = "produccion"
    origen   = "opentofu"
  }
  # Proveedores aprobados por el dueño (O-14, D-076).
  proveedores = [
    "Microsoft.App",
    "Microsoft.Communication",
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
  name                            = "stalcanzamostfmxc"
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
