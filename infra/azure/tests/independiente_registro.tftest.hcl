# S3/S4: casos independientes del verificador del PR #110.
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


run "uat_empty" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = ""
  }
  expect_failures = [var.imagen_api]
}

run "uat_tag" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:v1.2.3"
  }
  expect_failures = [var.imagen_api]
}

run "uat_latest" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:latest"
  }
  expect_failures = [var.imagen_api]
}

run "uat_tag_digest" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:v1.2.3@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "uat_short" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "uat_long" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "uat_uppercase" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  }
  expect_failures = [var.imagen_api]
}

run "uat_nonhex" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"
  }
  expect_failures = [var.imagen_api]
}

run "uat_newline" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
  }
  expect_failures = [var.imagen_api]
}

run "uat_space" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = " ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "uat_other_repo" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/otro-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "uat_zero" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.template[0].container[0].image == var.imagen_api,
      azurerm_container_app_job.tareas.template[0].container[0].image == var.imagen_api,
    ])
    error_message = "S3: ambos contenedores reciben el digest sin transformarlo."
  }
}

run "uat_f" {
  command = plan
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.template[0].container[0].image == var.imagen_api,
      azurerm_container_app_job.tareas.template[0].container[0].image == var.imagen_api,
    ])
    error_message = "S3: ambos contenedores reciben el digest sin transformarlo."
  }
}

run "uat_vault_target" {
  command = plan
  plan_options {
    target = [azurerm_key_vault.secretos]
  }
  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }
  assert {
    condition     = azurerm_key_vault.secretos.name == "kv-alcanzamos-uat-mxc" && azurerm_key_vault.secretos.rbac_authorization_enabled
    error_message = "S4: el primer paso crea el Key Vault con RBAC."
  }
}

run "produccion_empty" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = ""
  }
  expect_failures = [var.imagen_api]
}

run "produccion_tag" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:v1.2.3"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_latest" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:latest"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_tag_digest" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api:v1.2.3@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_short" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_long" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_uppercase" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_nonhex" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_newline" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_space" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = " ghcr.io/alcanzamos/alcanzamos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_other_repo" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/otro-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.imagen_api]
}

run "produccion_zero" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.template[0].container[0].image == var.imagen_api,
      azurerm_container_app_job.tareas.template[0].container[0].image == var.imagen_api,
    ])
    error_message = "S3: ambos contenedores reciben el digest sin transformarlo."
  }
}

run "produccion_f" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    imagen_api        = "ghcr.io/alcanzamos/alcanzamos-api@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.template[0].container[0].image == var.imagen_api,
      azurerm_container_app_job.tareas.template[0].container[0].image == var.imagen_api,
    ])
    error_message = "S3: ambos contenedores reciben el digest sin transformarlo."
  }
}

run "produccion_vault_target" {
  command = plan
  plan_options {
    target = [azurerm_key_vault.secretos]
  }
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }
  assert {
    condition     = azurerm_key_vault.secretos.name == "kv-alcanzamos-prod-mxc" && azurerm_key_vault.secretos.rbac_authorization_enabled
    error_message = "S4: el primer paso crea el Key Vault con RBAC."
  }
}

run "registro_en_ambos" {
  command = plan
  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }
  assert {
    condition     = length(azurerm_container_app.api.registry) == 1 && length(azurerm_container_app_job.tareas.registry) == 1
    error_message = "S4: ambos necesitan el registro privado."
  }
}
