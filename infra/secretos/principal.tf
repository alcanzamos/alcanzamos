# Rol de lectura de cada secreto, con alcance en el secreto y no en el Key Vault ni en el grupo (E11-INF 2.5, 2.14;
# D-205 (5)). Un solo recurso: nada aquí crea el Key Vault, las identidades ni los secretos, y nada lee el valor de un secreto.
# Mismos nombres que infra/azure y el bootstrap: el Key Vault es kv-<sufijo> y las identidades, id-alcanzamos-<rol>-<ambiente>-eus2.
locals {
  abreviatura = {
    uat        = "uat"
    produccion = "prod"
  }
  # East US 2 (D-208): sufijo -eus2.
  region = "eus2"
  sufijo = "alcanzamos-${local.abreviatura[var.ambiente]}-${local.region}"

  # Quién lee qué (E11-INF 2.5): el token de ghcr.io lo necesita toda pieza que baja la imagen del paquete privado
  # (API, web, tareas y migrador); caj-psql usa la imagen pública de PostgreSQL y no lo necesita. La contraseña de CPaaS
  # solo la usan las piezas que mandan correo: el API y las tareas.
  lectores = {
    ghcr   = ["api", "web", "tareas", "migrador"]
    correo = ["api", "tareas"]
  }
  nombres_de_secreto = {
    ghcr   = var.ghcr_nombre_del_secreto
    correo = var.correo_nombre_del_secreto
  }
  identidades_que_leen = toset(flatten(values(local.lectores)))

  # Una asignación por identidad y secreto: «ghcr-api», «correo-tareas», etc.
  lecturas = merge([
    for secreto, identidades in local.lectores : {
      for identidad in identidades : "${secreto}-${identidad}" => { secreto = secreto, identidad = identidad }
    }
  ]...)
}

# El Key Vault lo crea infra/azure. Solo se lee (control del recurso, sin acceso a los secretos).
data "azurerm_key_vault" "boveda" {
  name                = "kv-${local.sufijo}"
  resource_group_name = "rg-${local.sufijo}"
}

# Las identidades las crea el bootstrap.
data "azurerm_user_assigned_identity" "lectora" {
  for_each = local.identidades_que_leen

  name                = "id-alcanzamos-${each.key}-${local.abreviatura[var.ambiente]}-${local.region}"
  resource_group_name = "rg-${local.sufijo}"
}

# Este rol solo deja leer el valor de un secreto: no deja escribirlo, listarlo ni administrar el Key Vault.
# Si el secreto no existe todavía, Azure rechaza la asignación: primero se carga el valor (ver el README).
resource "azurerm_role_assignment" "lectura" {
  for_each = local.lecturas

  scope                = "${data.azurerm_key_vault.boveda.id}/secrets/${local.nombres_de_secreto[each.value.secreto]}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = data.azurerm_user_assigned_identity.lectora[each.value.identidad].principal_id
  principal_type       = "ServicePrincipal"
}
