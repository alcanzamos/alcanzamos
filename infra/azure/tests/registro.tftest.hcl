# Imagen del API y acceso al registro privado (US-79, D-200 (8)(b) y (9)(a); revisión del dueño del #110, puntos 1 y 2).
# - Solo por digest: UAT despliega el digest que construyó el pipeline y producción, ese mismo digest. Una etiqueta,
#   aunque sea de versión, se rechaza en los dos ambientes.
# - El paquete de ghcr.io es privado: el API y el trabajo programado bajan la imagen con el token read:packages que
#   está en el Key Vault del ambiente, leído con la identidad del API. El valor del token nunca pasa por OpenTofu.
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
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id"
    }
  }

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

  mock_resource "azurerm_email_communication_service" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Communication/emailServices/ecs"
    }
  }

  mock_resource "azurerm_email_communication_service_domain" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Communication/emailServices/ecs/domains/avisos"
    }
  }

  mock_resource "azurerm_communication_service" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Communication/communicationServices/acs"
    }
  }

  mock_resource "azurerm_monitor_action_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Insights/actionGroups/ag"
    }
  }
}

variables {
  subscription_id          = "00000000-0000-0000-0000-000000000000"
  admin_postgres_object_id = "00000000-0000-0000-0000-000000000000"
  admin_postgres_nombre    = "andres@alcanzamos.co"
  imagen_api               = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  ghcr_usuario             = "usuario-de-prueba"
}

# El API y el trabajo programado: un registro ghcr.io con el usuario del token y la contraseña en un secreto que
# apunta al Key Vault del ambiente (sin versión, para que tome la última), leído con la identidad del API, sin valor.
run "uat_baja_la_imagen_con_el_token_del_key_vault" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue(flatten([for registros in [azurerm_container_app.api.registry, azurerm_container_app_job.tareas.registry] : [
      length(registros) == 1,
      registros[0].server == "ghcr.io",
      registros[0].username == "usuario-de-prueba",
      registros[0].password_secret_name == "ghcr-lectura",
      registros[0].identity == null,
    ]]))
    error_message = "El API y el trabajo programado deben bajar la imagen de ghcr.io con el usuario del token y el secreto ghcr-lectura."
  }

  assert {
    condition = alltrue(flatten([for secretos in [azurerm_container_app.api.secret, azurerm_container_app_job.tareas.secret] : [
      length([for s in secretos : s if s.name == "ghcr-lectura"]) == 1,
      [for s in secretos : s.key_vault_secret_id if s.name == "ghcr-lectura"] == ["https://kv.vault.azure.net/secrets/ghcr-lectura"],
      [for s in secretos : s.identity if s.name == "ghcr-lectura"] == [data.azurerm_user_assigned_identity.api.id],
      alltrue([for s in secretos : s.value == null if s.name == "ghcr-lectura"]),
    ]]))
    error_message = "El secreto del registro debe leerse del Key Vault del ambiente con la identidad del API, sin valor en OpenTofu."
  }

  assert {
    condition = alltrue([
      contains(azurerm_container_app.api.identity[0].identity_ids, data.azurerm_user_assigned_identity.api.id),
      contains(azurerm_container_app_job.tareas.identity[0].identity_ids, data.azurerm_user_assigned_identity.api.id),
    ])
    error_message = "La identidad que lee el secreto debe estar asignada a la app y al trabajo."
  }
}

run "produccion_baja_la_imagen_con_el_token_del_key_vault" {
  command = plan

  variables {
    ambiente                = "produccion"
    dominio_de_correo       = "avisos.alcanzamos.co"
    ghcr_usuario            = "otro-usuario"
    ghcr_nombre_del_secreto = "ghcr-otro"
  }

  assert {
    condition = alltrue(flatten([for registros in [azurerm_container_app.api.registry, azurerm_container_app_job.tareas.registry] : [
      length(registros) == 1,
      registros[0].server == "ghcr.io",
      registros[0].username == "otro-usuario",
      registros[0].password_secret_name == "ghcr-otro",
    ]]))
    error_message = "En producción, el registro debe usar el usuario y el nombre del secreto de sus variables."
  }

  assert {
    condition = alltrue(flatten([for secretos in [azurerm_container_app.api.secret, azurerm_container_app_job.tareas.secret] : [
      [for s in secretos : s.key_vault_secret_id if s.name == "ghcr-otro"] == ["https://kv.vault.azure.net/secrets/ghcr-otro"],
      [for s in secretos : s.identity if s.name == "ghcr-otro"] == [data.azurerm_user_assigned_identity.api.id],
      length([for s in secretos : s if s.name == "ghcr-otro"]) == 1,
      alltrue([for s in secretos : s.value == null if s.name == "ghcr-otro"]),
    ]]))
    error_message = "En producción, el secreto del registro debe leerse del Key Vault con la identidad del API."
  }
}

# La imagen que se despliega es exactamente el digest que recibe la variable, en los dos contenedores.
run "acepta_un_digest_y_lo_despliega_tal_cual" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.template[0].container[0].image == "ghcr.io/alcanzamos/alcanzamos-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      azurerm_container_app_job.tareas.template[0].container[0].image == "ghcr.io/alcanzamos/alcanzamos-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ])
    error_message = "El API y el trabajo programado deben usar el digest recibido."
  }
}

run "uat_rechaza_una_etiqueta_de_version" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:1.0.0"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_rechaza_una_etiqueta_de_version" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:v0.1.0"
  }
  expect_failures = [var.imagen_api]
}

run "rechaza_latest" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:latest"
  }
  expect_failures = [var.imagen_api]
}

# Etiqueta y digest juntos: Container Apps usaría el digest, pero la variable debe ser solo el digest probado.
run "rechaza_etiqueta_con_digest" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:1.0.0@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
  expect_failures = [var.imagen_api]
}

run "rechaza_digest_corto" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde"
  }
  expect_failures = [var.imagen_api]
}

run "rechaza_digest_en_mayusculas" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"
  }
  expect_failures = [var.imagen_api]
}

run "rechaza_otro_algoritmo" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha512:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
  expect_failures = [var.imagen_api]
}

run "rechaza_otra_imagen" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/otra-cuenta/alcanzamos-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
  expect_failures = [var.imagen_api]
}

run "rechaza_usuario_de_ghcr_vacio" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    ghcr_usuario      = ""
  }
  expect_failures = [var.ghcr_usuario]
}

run "rechaza_usuario_de_ghcr_con_espacios" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    ghcr_usuario      = "usuario de prueba"
  }
  expect_failures = [var.ghcr_usuario]
}

# Container Apps acepta en el nombre de un secreto solo minúsculas, números y guiones.
run "rechaza_nombre_de_secreto_invalido" {
  command = plan
  variables {
    ambiente                = "uat"
    dominio_de_correo       = "avisos-uat.alcanzamos.co"
    ghcr_nombre_del_secreto = "GHCR_lectura"
  }
  expect_failures = [var.ghcr_nombre_del_secreto]
}
