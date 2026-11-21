# D-205 (5), E11-INF 2.5, 2.14): lo que el plan no expone se comprueba en los archivos de esta raíz.
# Esta raíz solo asigna «Key Vault Secrets User» sobre secretos. No crea el Key Vault ni los secretos, no lee sus valores
# (el valor no puede quedar en el estado), no registra proveedores y no usa azuread.
# Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
#   tofu init -backend=false && tofu test
mock_provider "azurerm" {
  mock_data "azurerm_key_vault" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv"
    }
  }

  mock_data "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id"
      client_id    = "00000000-0000-0000-0000-000000000000"
      principal_id = "00000000-0000-0000-0000-000000000000"
    }
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000000"
  ambiente        = "uat"
}

# Una sola asignación de rol, y nunca sobre el Key Vault ni el grupo: el alcance es siempre un secreto.
run "una_sola_asignacion_y_siempre_sobre_un_secreto" {
  command = plan

  assert {
    condition = alltrue([
      toset([for m in regexall("(?m)^resource\\s+\"azurerm_role_assignment\"\\s+\"([a-z_]+)\"", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")])) : m[0]]) == toset(["lectura"]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : strcontains(a.scope, "/secrets/")]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : a.scope != data.azurerm_key_vault.boveda.id]),
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("azurerm_resource_group", file("${path.module}/${f}")))]),
    ])
    error_message = "Solo azurerm_role_assignment.lectura, siempre sobre un secreto (<Key Vault>/secrets/<nombre>), nunca sobre el Key Vault ni el grupo."
  }
}

# El único rol es Key Vault Secrets User: ni Officer, ni Administrator, ni Owner, ni roles que asignan roles.
run "solo_key_vault_secrets_user" {
  command = plan

  assert {
    condition = alltrue([
      toset([for a in values(azurerm_role_assignment.lectura) : a.role_definition_name]) == toset(["Key Vault Secrets User"]),
      !anytrue([for f in fileset(path.module, "*.tf") : anytrue([for r in ["Secrets Officer", "Key Vault Administrator", "Owner", "Contributor", "User Access Administrator", "Role Based Access Control Administrator"] : strcontains(file("${path.module}/${f}"), r)])]),
    ])
    error_message = "El único rol es Key Vault Secrets User."
  }
}

# El Key Vault y las identidades se leen (data), no se crean; los secretos no se crean ni se leen: el valor no pasa por el estado.
run "no_crea_ni_lee_valores" {
  command = plan

  assert {
    condition = alltrue([
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("(?m)^\\s*resource\\s+\"azurerm_(key_vault|user_assigned_identity|resource_group|storage_account)\"", file("${path.module}/${f}")))]),
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("azurerm_key_vault_(secret|certificate|key)", file("${path.module}/${f}")))]),
    ])
    error_message = "Esta raíz no crea el Key Vault, las identidades ni los secretos, y no lee valores de secretos (no pueden quedar en el estado)."
  }
}

# El pipeline no asigna roles: esta raíz la aplica el dueño, y ninguna asignación usa la identidad del pipeline.
run "sin_identidad_de_pipeline_ni_psql" {
  command = plan

  assert {
    condition = alltrue([
      !anytrue([for f in fileset(path.module, "*.tf") : strcontains(lower(file("${path.module}/${f}")), "alcanzamos-pipeline")]),
      !contains(keys(data.azurerm_user_assigned_identity.lectora), "pipeline"),
      !contains(keys(data.azurerm_user_assigned_identity.lectora), "psql"),
    ])
    error_message = "Ni el pipeline ni caj-psql (imagen pública de PostgreSQL) leen secretos."
  }
}

# Sin registro de proveedores (los registra infra/suscripcion) y sin azuread.
run "sin_registro_de_proveedores_ni_azuread" {
  command = plan

  assert {
    condition = alltrue([
      !anytrue([for f in fileset(path.module, "*.tf") : strcontains(file("${path.module}/${f}"), "azurerm_resource_provider_registration")]),
      can(regex("resource_provider_registrations\\s*=\\s*\"none\"", file("${path.module}/versiones.tf"))),
      !can(regex("resource_providers_to_register", file("${path.module}/versiones.tf"))),
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("azuread", file("${path.module}/${f}")))]),
      !can(regex("azuread", file("${path.module}/.terraform.lock.hcl"))),
    ])
    error_message = "Esta raíz no registra proveedores (lo hace infra/suscripcion) ni usa azuread."
  }
}

# El estado es local, un archivo por ambiente, igual que el bootstrap.
run "estado_local_por_ambiente" {
  command = plan

  assert {
    condition     = can(regex("backend\\s+\"local\"\\s*\\{\\s*\\}", file("${path.module}/versiones.tf")))
    error_message = "El estado de infra/secretos es local, con la ruta por ambiente en -backend-config."
  }
}
