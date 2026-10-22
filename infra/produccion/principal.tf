# Nombres definitivos (O-14), con las abreviaturas de Microsoft Cloud Adoption Framework.
# Propuesta: la aprueba el dueño. Nunca se reutilizan los de la prueba R-9.
locals {
  sufijo = "alcanzamos-prod-mxc"
  etiquetas = {
    proyecto = "alcanzamos"
    ambiente = "produccion"
    origen   = "opentofu"
  }
}

# El grupo lo crea el módulo bootstrap con la cuenta del dueño (D-119, opción A):
# la identidad del pipeline solo tiene permisos dentro de este grupo.
data "azurerm_resource_group" "principal" {
  name = "rg-${local.sufijo}"
}

data "azurerm_client_config" "actual" {}

# Registros de Container Apps y eventos de seguridad (RNF-025): 90 días.
resource "azurerm_log_analytics_workspace" "registros" {
  name                = "log-${local.sufijo}"
  location            = data.azurerm_resource_group.principal.location
  resource_group_name = data.azurerm_resource_group.principal.name
  sku                 = "PerGB2018"
  retention_in_days   = 90
  tags                = local.etiquetas
}

# La identidad del API y sus roles los crea el módulo bootstrap.
data "azurerm_user_assigned_identity" "api" {
  name                = "id-${local.sufijo}"
  resource_group_name = data.azurerm_resource_group.principal.name
}

# Secretos con identidad administrada (D-026), con permisos por RBAC.
resource "azurerm_key_vault" "secretos" {
  name                       = "kv-${local.sufijo}"
  location                   = data.azurerm_resource_group.principal.location
  resource_group_name        = data.azurerm_resource_group.principal.name
  tenant_id                  = data.azurerm_client_config.actual.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  tags                       = local.etiquetas
}
