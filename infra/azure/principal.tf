# Nombres definitivos (O-14), con las abreviaturas de Microsoft Cloud Adoption Framework:
# tipo, proyecto, ambiente y región. Aprobados por el dueño (D-120). Nunca se reutilizan los de la prueba R-9.
# El mismo código sirve a UAT y a producción (D-200 (8)): solo cambian los parámetros de cada ambiente.
locals {
  abreviatura = {
    uat        = "uat"
    produccion = "prod"
  }
  # East US 2 (D-208): sufijo -eus2.
  region = "eus2"
  sufijo = "alcanzamos-${local.abreviatura[var.ambiente]}-${local.region}"
  etiquetas = {
    proyecto = "alcanzamos"
    ambiente = var.ambiente
    origen   = "opentofu"
  }
}

# El grupo lo crea el módulo bootstrap con la cuenta del dueño (D-119, opción A):
# la identidad del pipeline solo tiene permisos dentro de este grupo.
data "azurerm_resource_group" "principal" {
  name = "rg-${local.sufijo}"
}

data "azurerm_client_config" "actual" {}

# Registros de Container Apps y eventos de seguridad (RNF-025): 90 días en producción.
resource "azurerm_log_analytics_workspace" "registros" {
  name                = "log-${local.sufijo}"
  location            = data.azurerm_resource_group.principal.location
  resource_group_name = data.azurerm_resource_group.principal.name
  sku                 = "PerGB2018"
  retention_in_days   = var.registros_dias_de_retencion
  tags                = local.etiquetas
}

# Las identidades de carga y sus roles los crea el módulo bootstrap (id-alcanzamos-<rol>-<ambiente>-<región>). Aquí solo se leen.
# El API se conecta a PostgreSQL con su identidad, con un rol sin administración que le crea el migrador. Los administradores de Entra
# del servidor son el migrador y caj-psql (datos.tf), nunca el API.
data "azurerm_user_assigned_identity" "api" {
  name                = "id-alcanzamos-api-${local.abreviatura[var.ambiente]}-${local.region}"
  resource_group_name = data.azurerm_resource_group.principal.name
}

data "azurerm_user_assigned_identity" "migrador" {
  name                = "id-alcanzamos-migrador-${local.abreviatura[var.ambiente]}-${local.region}"
  resource_group_name = data.azurerm_resource_group.principal.name
}

data "azurerm_user_assigned_identity" "psql" {
  name                = "id-alcanzamos-psql-${local.abreviatura[var.ambiente]}-${local.region}"
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
  soft_delete_retention_days = var.secretos_dias_de_retencion
  tags                       = local.etiquetas
}
