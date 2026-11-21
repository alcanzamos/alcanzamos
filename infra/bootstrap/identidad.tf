# Identidad del pipeline: identidad administrada asignada por el usuario, con una
# credencial federada de Azure DevOps (workload identity federation). Sin claves
# y sin permisos de directorio en Entra: no hay proveedor azuread (D-049, D-205 (1)).
data "azurerm_client_config" "actual" {}

locals {
  conexion_de_servicio = coalesce(var.conexion_de_servicio, "sc-${local.sufijo}")
  emisor_federado      = coalesce(var.credencial_federada_emisor, "https://vstoken.dev.azure.com/${var.azure_devops_organizacion_id}")
  sujeto_federado      = coalesce(var.credencial_federada_sujeto, "sc://alcanzamos/alcanzamos/${local.conexion_de_servicio}")
  # Una identidad por pieza que corre en el ambiente (E11-INF 2.3, 2.3 bis, 2.4; D-206 (7)).
  identidades_de_carga = toset(["api", "web", "tareas", "migrador", "psql"])
}

resource "azurerm_user_assigned_identity" "pipeline" {
  name                = "id-alcanzamos-pipeline-${local.abreviatura[var.ambiente]}-${local.region}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  tags                = local.etiquetas
}

resource "azurerm_federated_identity_credential" "azure_devops" {
  name                      = "azure-devops-${local.conexion_de_servicio}"
  user_assigned_identity_id = azurerm_user_assigned_identity.pipeline.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = local.emisor_federado
  subject                   = local.sujeto_federado
}

# El pipeline tiene solo estos dos roles. Ninguno puede asignar roles (ni Owner,
# ni User Access Administrator, ni Role Based Access Control Administrator): los
# roles de las demás identidades los asigna el dueño con infra/secretos.
resource "azurerm_role_assignment" "pipeline" {
  for_each = {
    # Permisos solo sobre el grupo de recursos de su ambiente (D-119, opción A; E11-INF 2.17).
    grupo = { scope = azurerm_resource_group.principal.id, rol = "Contributor" }
    # Estado remoto: la identidad escribe solo en la cuenta de almacenamiento de su ambiente.
    estado = { scope = azurerm_storage_account.estado.id, rol = "Storage Blob Data Contributor" }
  }

  scope                = each.value.scope
  role_definition_name = each.value.rol
  principal_id         = azurerm_user_assigned_identity.pipeline.principal_id
  principal_type       = "ServicePrincipal"
}

# Identidades de carga, en el grupo del ambiente. Se crean aquí para que el
# pipeline no necesite permisos para asignar roles.
resource "azurerm_user_assigned_identity" "carga" {
  for_each = local.identidades_de_carga

  name                = "id-alcanzamos-${each.key}-${local.abreviatura[var.ambiente]}-${local.region}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  tags                = local.etiquetas
}

# Las identidades de carga no tienen ningún rol aquí. Cuando infra/azure crea el Key Vault y el dueño carga los secretos,
# infra/secretos asigna a cada una el rol de lectura de secretos sobre cada secreto que necesita, y solo sobre ese
# (E11-INF 2.5, 2.14; D-205 (5)). El rol provisional sobre el grupo, que tenía el API, se quitó.
