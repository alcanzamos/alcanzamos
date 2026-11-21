# D-205 (5), E11-INF 2.5, 2.14): «Key Vault Secrets User» sobre cada secreto, no sobre el Key Vault ni el grupo, y
# «Key Vault Secrets Officer» del dueño, la única asignación sobre el Key Vault completo.
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

# Cada identidad lleva un principal propio: así se comprueba qué identidad lee qué secreto.
override_data {
  target = data.azurerm_user_assigned_identity.lectora["api"]
  values = {
    principal_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.lectora["web"]
  values = {
    principal_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.lectora["tareas"]
  values = {
    principal_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.lectora["migrador"]
  values = {
    principal_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.lectora["psql"]
  values = {
    principal_id = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000000"
  dueno_object_id = "12345678-1234-1234-1234-123456789abc"
}

# ghcr-lectura: API, web, tareas, migrador y caj-psql (imagen alcanzamos-psql, privada). La contraseña de CPaaS: API y tareas.
run "uat_un_rol_por_identidad_y_secreto" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      length(azurerm_role_assignment.lectura) == 7,
      toset(keys(azurerm_role_assignment.lectura)) == toset(["ghcr-api", "ghcr-web", "ghcr-tareas", "ghcr-migrador", "ghcr-psql", "correo-api", "correo-tareas"]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : a.role_definition_name == "Key Vault Secrets User"]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : a.principal_type == "ServicePrincipal"]),
    ])
    error_message = "Debe haber siete asignaciones de Key Vault Secrets User: ghcr-lectura para API, web, tareas, migrador y caj-psql, y la contraseña de CPaaS para API y tareas."
  }

  assert {
    condition = {
      for k, a in azurerm_role_assignment.lectura : k => a.principal_id
      } == {
      "ghcr-api"      = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
      "ghcr-web"      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
      "ghcr-tareas"   = "cccccccc-cccc-cccc-cccc-cccccccccccc"
      "ghcr-migrador" = "dddddddd-dddd-dddd-dddd-dddddddddddd"
      "ghcr-psql"     = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
      "correo-api"    = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
      "correo-tareas" = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    }
    error_message = "Cada asignación va a la identidad que corresponde: la web, el migrador y caj-psql no leen la contraseña de CPaaS."
  }

  # El alcance es el secreto, no el Key Vault ni el grupo.
  assert {
    condition = {
      for k, a in azurerm_role_assignment.lectura : k => a.scope
      } == {
      "ghcr-api"      = "${data.azurerm_key_vault.boveda.id}/secrets/ghcr-lectura"
      "ghcr-web"      = "${data.azurerm_key_vault.boveda.id}/secrets/ghcr-lectura"
      "ghcr-tareas"   = "${data.azurerm_key_vault.boveda.id}/secrets/ghcr-lectura"
      "ghcr-migrador" = "${data.azurerm_key_vault.boveda.id}/secrets/ghcr-lectura"
      "ghcr-psql"     = "${data.azurerm_key_vault.boveda.id}/secrets/ghcr-lectura"
      "correo-api"    = "${data.azurerm_key_vault.boveda.id}/secrets/correo-contrasena"
      "correo-tareas" = "${data.azurerm_key_vault.boveda.id}/secrets/correo-contrasena"
    }
    error_message = "El alcance de cada rol es el secreto (<id del Key Vault>/secrets/<nombre>), no el Key Vault ni el grupo."
  }
}

run "produccion_igual_que_uat" {
  command = plan
  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      length(azurerm_role_assignment.lectura) == 7,
      alltrue([for a in values(azurerm_role_assignment.lectura) : startswith(a.scope, data.azurerm_key_vault.boveda.id)]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : length(regexall("/secrets/(ghcr-lectura|correo-contrasena)$", a.scope)) == 1]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : a.role_definition_name == "Key Vault Secrets User"]),
    ])
    error_message = "El código es el mismo en los dos ambientes."
  }
}

# Se leen el Key Vault y las identidades del ambiente, por nombre: los mismos que crean infra/azure y el bootstrap.
run "uat_nombres_de_lo_que_se_lee" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      "kv-alcanzamos-uat-eus2" == data.azurerm_key_vault.boveda.name,
      data.azurerm_key_vault.boveda.resource_group_name == "rg-alcanzamos-uat-eus2",
      toset(keys(data.azurerm_user_assigned_identity.lectora)) == toset(["api", "web", "tareas", "migrador", "psql"]),
      data.azurerm_user_assigned_identity.lectora["api"].name == "id-alcanzamos-api-uat-eus2",
      data.azurerm_user_assigned_identity.lectora["web"].name == "id-alcanzamos-web-uat-eus2",
      data.azurerm_user_assigned_identity.lectora["tareas"].name == "id-alcanzamos-tareas-uat-eus2",
      data.azurerm_user_assigned_identity.lectora["migrador"].name == "id-alcanzamos-migrador-uat-eus2",
      data.azurerm_user_assigned_identity.lectora["psql"].name == "id-alcanzamos-psql-uat-eus2",
      alltrue([for i in values(data.azurerm_user_assigned_identity.lectora) : i.resource_group_name == "rg-alcanzamos-uat-eus2"]),
    ])
    error_message = "UAT lee el Key Vault kv-alcanzamos-uat-eus2 y las identidades id-alcanzamos-<api|web|tareas|migrador|psql>-uat-eus2, en rg-alcanzamos-uat-eus2."
  }
}

run "produccion_nombres_de_lo_que_se_lee" {
  command = plan
  variables {
    ambiente = "produccion"
  }

  assert {
    condition = alltrue([
      "kv-alcanzamos-prod-eus2" == data.azurerm_key_vault.boveda.name,
      data.azurerm_key_vault.boveda.resource_group_name == "rg-alcanzamos-prod-eus2",
      data.azurerm_user_assigned_identity.lectora["tareas"].name == "id-alcanzamos-tareas-prod-eus2",
      alltrue([for i in values(data.azurerm_user_assigned_identity.lectora) : i.resource_group_name == "rg-alcanzamos-prod-eus2"]),
    ])
    error_message = "Producción lee el Key Vault kv-alcanzamos-prod-eus2 y las identidades con el sufijo -prod-eus2, en rg-alcanzamos-prod-eus2."
  }
}

# Los nombres de los secretos son las variables de infra/azure (ghcr_nombre_del_secreto y correo_nombre_del_secreto).
run "nombres_de_secreto_propios" {
  command = plan
  variables {
    ambiente                  = "uat"
    ghcr_nombre_del_secreto   = "ghcr-otro"
    correo_nombre_del_secreto = "correo-otro"
  }

  assert {
    condition = alltrue([
      endswith(azurerm_role_assignment.lectura["ghcr-api"].scope, "/secrets/ghcr-otro"),
      endswith(azurerm_role_assignment.lectura["ghcr-migrador"].scope, "/secrets/ghcr-otro"),
      endswith(azurerm_role_assignment.lectura["ghcr-psql"].scope, "/secrets/ghcr-otro"),
      endswith(azurerm_role_assignment.lectura["correo-api"].scope, "/secrets/correo-otro"),
      endswith(azurerm_role_assignment.lectura["correo-tareas"].scope, "/secrets/correo-otro"),
    ])
    error_message = "El alcance sigue los nombres de secreto de las variables."
  }
}

# La salida resume qué identidad lee qué secreto, para que el dueño lo compruebe después de aplicar.
run "salida_de_lecturas" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      toset(keys(output.lecturas)) == toset(["ghcr-lectura", "correo-contrasena"]),
      toset(output.lecturas["ghcr-lectura"]) == toset(["api", "web", "tareas", "migrador", "psql"]),
      toset(output.lecturas["correo-contrasena"]) == toset(["api", "tareas"]),
    ])
    error_message = "La salida lecturas da, por secreto, las identidades que lo leen."
  }
}

# El acceso del dueño para cargar y rotar secretos (E11-INF 2.14, P9): «Key Vault Secrets Officer» sobre el Key Vault del
# ambiente (su id, no el de un secreto), con el object id de la variable.
run "uat_el_dueno_carga_secretos_sobre_el_key_vault" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      azurerm_role_assignment.carga_del_dueno.role_definition_name == "Key Vault Secrets Officer",
      azurerm_role_assignment.carga_del_dueno.scope == data.azurerm_key_vault.boveda.id,
      azurerm_role_assignment.carga_del_dueno.principal_id == var.dueno_object_id,
      azurerm_role_assignment.carga_del_dueno.principal_id == "12345678-1234-1234-1234-123456789abc",
      azurerm_role_assignment.carga_del_dueno.principal_type == "User",
    ])
    error_message = "El dueño tiene Key Vault Secrets Officer sobre el Key Vault (su id exacto), con el object id de dueno_object_id."
  }
}

run "produccion_el_dueno_carga_secretos_sobre_el_key_vault" {
  command = plan
  variables {
    ambiente        = "produccion"
    dueno_object_id = "ABCDEF12-3456-7890-ABCD-EF1234567890"
  }

  assert {
    condition = alltrue([
      azurerm_role_assignment.carga_del_dueno.role_definition_name == "Key Vault Secrets Officer",
      azurerm_role_assignment.carga_del_dueno.scope == data.azurerm_key_vault.boveda.id,
      azurerm_role_assignment.carga_del_dueno.principal_id == "ABCDEF12-3456-7890-ABCD-EF1234567890",
    ])
    error_message = "En producción es lo mismo, con el object id que se pasa (se aceptan mayúsculas)."
  }
}

# Es la única asignación sobre el Key Vault completo: las otras siete van sobre /secrets/<nombre>.
run "la_del_dueno_es_la_unica_sobre_el_key_vault_completo" {
  command = plan
  variables {
    ambiente = "uat"
  }

  assert {
    condition = alltrue([
      length([for a in concat(values(azurerm_role_assignment.lectura), [azurerm_role_assignment.carga_del_dueno]) : a if a.scope == data.azurerm_key_vault.boveda.id]) == 1,
      alltrue([for a in values(azurerm_role_assignment.lectura) : startswith(a.scope, "${data.azurerm_key_vault.boveda.id}/secrets/")]),
      alltrue([for a in values(azurerm_role_assignment.lectura) : a.principal_id != var.dueno_object_id]),
    ])
    error_message = "Solo la del dueño tiene como alcance el Key Vault completo; las de lectura van sobre <id del Key Vault>/secrets/<nombre> y no son del dueño."
  }
}

run "rechaza_ambiente_desconocido" {
  command = plan
  variables {
    ambiente = "prod"
  }
  expect_failures = [var.ambiente]
}

run "rechaza_ambiente_en_mayusculas" {
  command = plan
  variables {
    ambiente = "UAT"
  }
  expect_failures = [var.ambiente]
}

run "rechaza_nombre_de_secreto_invalido" {
  command = plan
  variables {
    ambiente                = "uat"
    ghcr_nombre_del_secreto = "Ghcr_Lectura"
  }
  expect_failures = [var.ghcr_nombre_del_secreto]
}

run "rechaza_nombre_de_secreto_de_correo_invalido" {
  command = plan
  variables {
    ambiente                  = "uat"
    correo_nombre_del_secreto = "-correo"
  }
  expect_failures = [var.correo_nombre_del_secreto]
}

run "rechaza_dueno_que_no_es_un_guid" {
  command = plan
  variables {
    ambiente        = "uat"
    dueno_object_id = "no-es-un-guid"
  }
  expect_failures = [var.dueno_object_id]
}

run "rechaza_dueno_vacio" {
  command = plan
  variables {
    ambiente        = "uat"
    dueno_object_id = ""
  }
  expect_failures = [var.dueno_object_id]
}

run "rechaza_dueno_con_guid_incompleto" {
  command = plan
  variables {
    ambiente        = "uat"
    dueno_object_id = "12345678-1234-1234-1234-123456789ab"
  }
  expect_failures = [var.dueno_object_id]
}

run "rechaza_dueno_con_texto_de_mas" {
  command = plan
  variables {
    ambiente        = "uat"
    dueno_object_id = "12345678-1234-1234-1234-123456789abc "
  }
  expect_failures = [var.dueno_object_id]
}

run "rechaza_el_mismo_secreto_para_los_dos" {
  command = plan
  variables {
    ambiente                  = "uat"
    ghcr_nombre_del_secreto   = "mismo"
    correo_nombre_del_secreto = "mismo"
  }
  expect_failures = [var.correo_nombre_del_secreto]
}
