# D-205 (5), E11-INF 2.5, 2.14): lo que el plan no expone se comprueba en los archivos de esta raíz.
# Esta raíz asigna «Key Vault Secrets User» sobre secretos y un solo «Key Vault Secrets Officer» al dueño sobre el Key
# Vault. No crea el Key Vault ni los secretos, no lee sus valores (el valor no puede quedar en el estado), no registra
# proveedores y no usa azuread.
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
  dueno_object_id = "12345678-1234-1234-1234-123456789abc"
}

# Dos recursos de asignación de rol: la lectura de cada secreto (siempre sobre un secreto) y la carga del dueño (sobre el
# Key Vault). Nunca sobre el grupo.
run "lectura_sobre_secretos_y_carga_del_dueno_sobre_el_key_vault" {
  command = plan

  assert {
    condition = alltrue([
      toset([for m in regexall("(?m)^resource\\s+\"azurerm_role_assignment\"\\s+\"([a-z_]+)\"", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")])) : m[0]]) == toset(["lectura", "carga_del_dueno"]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : strcontains(a.scope, "/secrets/")]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : a.scope != data.azurerm_key_vault.boveda.id]),
      azurerm_role_assignment.carga_del_dueno.scope == data.azurerm_key_vault.boveda.id,
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("azurerm_resource_group", file("${path.module}/${f}")))]),
    ])
    error_message = "Solo azurerm_role_assignment.lectura (siempre sobre un secreto, <Key Vault>/secrets/<nombre>) y azurerm_role_assignment.carga_del_dueno (sobre el Key Vault); nunca sobre el grupo."
  }
}

# Solo dos roles: Key Vault Secrets User en la lectura y un Key Vault Secrets Officer en la carga del dueño. Ni
# Administrator, ni Owner, ni Contributor, ni roles que asignan roles, ni ningún rol por ID (esquivaría esta comprobación).
run "solo_secrets_user_y_un_secrets_officer" {
  command = plan

  assert {
    condition = alltrue([
      toset([for a in values(azurerm_role_assignment.lectura) : a.role_definition_name]) == toset(["Key Vault Secrets User"]),
      azurerm_role_assignment.carga_del_dueno.role_definition_name == "Key Vault Secrets Officer",
      toset(flatten([for f in fileset(path.module, "*.tf") : [for m in regexall("role_definition_name\\s*=\\s*\"([^\"]+)\"", file("${path.module}/${f}")) : m[0]]])) == toset(["Key Vault Secrets User", "Key Vault Secrets Officer"]),
      length(flatten([for f in fileset(path.module, "*.tf") : regexall("role_definition_name\\s*=", file("${path.module}/${f}"))])) == 2,
      !anytrue([for f in fileset(path.module, "*.tf") : can(regex("role_definition_id", file("${path.module}/${f}")))]),
      !anytrue([for f in fileset(path.module, "*.tf") : anytrue([for r in ["Key Vault Administrator", "Owner", "Contributor", "User Access Administrator", "Role Based Access Control Administrator"] : strcontains(file("${path.module}/${f}"), r)])]),
    ])
    error_message = "Los únicos roles son Key Vault Secrets User (lectura) y un solo Key Vault Secrets Officer (el dueño); ni Administrator, Owner, Contributor ni roles que asignan roles."
  }
}

# La carga del dueño es la única asignación con alcance en el Key Vault completo, con el object id de una variable obligatoria
# (sin valor por defecto).
run "la_carga_del_dueno_es_la_unica_sobre_el_key_vault_y_su_variable_es_obligatoria" {
  command = plan

  assert {
    condition = alltrue([
      length(flatten([for f in fileset(path.module, "*.tf") : regexall("scope\\s*=\\s*data\\.azurerm_key_vault\\.boveda\\.id\\s*\n", file("${path.module}/${f}"))])) == 1,
      azurerm_role_assignment.carga_del_dueno.principal_id == var.dueno_object_id,
      can(regex("(?m)^\\s*type\\s*=\\s*string", regex("(?s)variable\\s+\"dueno_object_id\"\\s*\\{.*?\n\\}", file("${path.module}/variables.tf")))),
      !can(regex("(?m)^\\s*default\\s*=", regex("(?s)variable\\s+\"dueno_object_id\"\\s*\\{.*?\n\\}", file("${path.module}/variables.tf")))),
    ])
    error_message = "Una sola asignación con scope = el id del Key Vault (la del dueño, con var.dueno_object_id); dueno_object_id es obligatoria y no tiene valor por defecto."
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
      !contains([for a in values(azurerm_role_assignment.lectura) : a.principal_id], azurerm_role_assignment.carga_del_dueno.principal_id),
    ])
    error_message = "El pipeline no tiene ninguna asignación aquí, y la identidad del dueño no es la de ninguna lectora."
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

# Los nombres de los secretos son los mismos que los de infra/azure: Container Apps referencia ese nombre en el Key Vault y
# aquí se asigna el rol sobre ese mismo secreto. Se comparan los valores por defecto de las dos variables.tf.
run "nombres_de_secreto_iguales_a_los_de_infra_azure" {
  command = plan

  assert {
    condition = alltrue([
      for n in ["ghcr_nombre_del_secreto", "correo_nombre_del_secreto"] :
      regex("(?m)^\\s*default\\s*=\\s*\"([^\"]+)\"", regex("(?s)variable\\s+\"${n}\"\\s*\\{.*?\n\\}", file("${path.module}/../azure/variables.tf")))[0] == regex("(?m)^\\s*default\\s*=\\s*\"([^\"]+)\"", regex("(?s)variable\\s+\"${n}\"\\s*\\{.*?\n\\}", file("${path.module}/variables.tf")))[0]
    ])
    error_message = "ghcr_nombre_del_secreto y correo_nombre_del_secreto tienen el mismo valor por defecto en infra/azure y en infra/secretos."
  }

  assert {
    condition = alltrue([
      var.ghcr_nombre_del_secreto == regex("(?m)^\\s*default\\s*=\\s*\"([^\"]+)\"", regex("(?s)variable\\s+\"ghcr_nombre_del_secreto\"\\s*\\{.*?\n\\}", file("${path.module}/../azure/variables.tf")))[0],
      var.correo_nombre_del_secreto == regex("(?m)^\\s*default\\s*=\\s*\"([^\"]+)\"", regex("(?s)variable\\s+\"correo_nombre_del_secreto\"\\s*\\{.*?\n\\}", file("${path.module}/../azure/variables.tf")))[0],
    ])
    error_message = "Sin pasar nada, los nombres de secreto de esta raíz son los que usa infra/azure."
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
