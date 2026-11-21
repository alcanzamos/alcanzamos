# Los proveedores de recursos no se registran aquí (decisión del dueño, 2026-11-18): los registra infra/suscripcion, una sola vez.
# Esta raíz no tiene recursos de registro y su proveedor lleva resource_provider_registrations = "none".
# Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
#   tofu init -backend=false && tofu test
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

run "sin_registro_de_proveedores" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : strcontains(file("${path.module}/${f}"), "azurerm_resource_provider_registration")])
    error_message = "infra/azure no registra proveedores como recursos."
  }

  assert {
    condition = alltrue([
      can(regex("resource_provider_registrations\\s*=\\s*\"none\"", file("${path.module}/versiones.tf"))),
      !can(regex("resource_providers_to_register", file("${path.module}/versiones.tf"))),
    ])
    error_message = "El proveedor azurerm de infra/azure lleva resource_provider_registrations = \"none\" y no registra nada."
  }
}
