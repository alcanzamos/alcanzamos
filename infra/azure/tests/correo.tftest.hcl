# Correo por Zoho CPaaS (D-205 (6), E11-INF 2.9 y 2.14, US-80): sin Azure Communication Services, y la contraseña de SMTP solo
# como referencia a un secreto del Key Vault. Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
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

  # La URI del Key Vault arma el ID de los secretos, y el proveedor valida su forma.
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
  imagen_api               = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  ghcr_usuario             = "usuario-de-prueba"
}

# Azure Communication Services queda descartado (D-205 (6)): ningún .tf de la raíz declara sus recursos, ni CORREO_ENDPOINT, ni la
# salida con los registros DNS de ACS, y correo.tf ya no existe.
run "sin_acs_ni_correo_endpoint" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.name != "",
      !fileexists("${path.module}/correo.tf"),
      length([for f in fileset(path.module, "*.tf") : f if can(regex("azurerm_email_communication_service|azurerm_communication_service|Microsoft\\.Communication", file("${path.module}/${f}")))]) == 0,
      length([for f in fileset(path.module, "*.tf") : f if can(regex("CORREO_ENDPOINT", file("${path.module}/${f}")))]) == 0,
      length([for f in fileset(path.module, "*.tf") : f if can(regex("registros_dns_de_avisos", file("${path.module}/${f}")))]) == 0,
    ])
    error_message = "Sin ACS (D-205 (6)): no debe quedar correo.tf, ningún recurso de Communication Services, CORREO_ENDPOINT ni la salida registros_dns_de_avisos."
  }
}

# El API y el trabajo de tareas leen el correo igual: variables simples y la contraseña como referencia al secreto.
run "produccion_api_y_tareas_con_cpaas" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      for envs in [azurerm_container_app.api.template[0].container[0].env, azurerm_container_app_job.tareas.template[0].container[0].env] :
      toset([for e in envs : e.name]) == toset(["PGHOST", "PGDATABASE", "PGUSER", "PGSSLMODE", "AZURE_CLIENT_ID", "CORREO_SMTP", "CORREO_USUARIO", "CORREO_CONTRASENA", "CORREO_REMITENTE"])
    ])
    error_message = "El API y caj-tareas llevan exactamente estas variables: las de la base, CORREO_SMTP, CORREO_USUARIO, CORREO_CONTRASENA y CORREO_REMITENTE. CORREO_ENDPOINT no existe."
  }

  assert {
    condition = alltrue([
      for envs in [azurerm_container_app.api.template[0].container[0].env, azurerm_container_app_job.tareas.template[0].container[0].env] :
      alltrue([
        [for e in envs : e.value if e.name == "CORREO_SMTP"] == ["smtp.zeptomail.com:587"],
        [for e in envs : e.value if e.name == "CORREO_USUARIO"] == ["emailapikey"],
        [for e in envs : e.value if e.name == "CORREO_REMITENTE"] == ["no-responder@avisos.alcanzamos.co"],
      ])
    ])
    error_message = "CORREO_SMTP es smtp.zeptomail.com:587, CORREO_USUARIO es emailapikey y CORREO_REMITENTE es no-responder@avisos.alcanzamos.co (E11-INF 2.14)."
  }

  # La contraseña nunca va por valor: solo secret_name, y ninguna variable de nombre secreto lleva un valor.
  assert {
    condition = alltrue([
      for envs in [azurerm_container_app.api.template[0].container[0].env, azurerm_container_app_job.tareas.template[0].container[0].env] :
      alltrue([
        length([for e in envs : e if e.name == "CORREO_CONTRASENA" && e.secret_name == "correo-contrasena" && e.value == null]) == 1,
        alltrue([for e in envs : e.value == null if can(regex("CONTRASENA|CLAVE|TOKEN|SECRET", e.name))]),
        alltrue([for e in envs : e.secret_name == null if e.name != "CORREO_CONTRASENA"]),
      ])
    ])
    error_message = "CORREO_CONTRASENA va solo como secret_name (correo-contrasena), nunca con un valor, y ninguna otra variable usa secret_name."
  }

  # El secreto de Container Apps apunta al Key Vault del ambiente, sin versión, y se lee con la identidad de la app.
  assert {
    condition = alltrue([
      for secretos in [azurerm_container_app.api.secret, azurerm_container_app_job.tareas.secret] :
      alltrue([
        [for s in secretos : s.key_vault_secret_id if s.name == "correo-contrasena"] == ["https://kv.vault.azure.net/secrets/correo-contrasena"],
        [for s in secretos : s.identity if s.name == "correo-contrasena"] == [data.azurerm_user_assigned_identity.api.id],
        length([for s in secretos : s if s.name == "correo-contrasena" && s.value == null]) == 1,
        toset([for s in secretos : s.name]) == toset(["ghcr-lectura", "correo-contrasena"]),
      ])
    ])
    error_message = "Cada app declara el secreto correo-contrasena con key_vault_secret_id (<vault_uri>secrets/correo-contrasena), la identidad de la app y sin valor."
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.identity[0].identity_ids == toset([data.azurerm_user_assigned_identity.api.id]),
      azurerm_container_app_job.tareas.identity[0].identity_ids == toset([data.azurerm_user_assigned_identity.api.id]),
    ])
    error_message = "Las dos apps leen el secreto con la identidad que tienen asignada."
  }
}

run "uat_api_y_tareas_con_cpaas" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      for envs in [azurerm_container_app.api.template[0].container[0].env, azurerm_container_app_job.tareas.template[0].container[0].env] :
      alltrue([
        toset([for e in envs : e.name]) == toset(["PGHOST", "PGDATABASE", "PGUSER", "PGSSLMODE", "AZURE_CLIENT_ID", "CORREO_SMTP", "CORREO_USUARIO", "CORREO_CONTRASENA", "CORREO_REMITENTE"]),
        [for e in envs : e.value if e.name == "CORREO_SMTP"] == ["smtp.zeptomail.com:587"],
        [for e in envs : e.value if e.name == "CORREO_USUARIO"] == ["emailapikey"],
        [for e in envs : e.value if e.name == "CORREO_REMITENTE"] == ["no-responder@avisos-uat.alcanzamos.co"],
        length([for e in envs : e if e.name == "CORREO_CONTRASENA" && e.secret_name == "correo-contrasena" && e.value == null]) == 1,
      ])
    ])
    error_message = "UAT: el mismo correo que producción, con remitente no-responder@avisos-uat.alcanzamos.co."
  }

  assert {
    condition = alltrue([
      for secretos in [azurerm_container_app.api.secret, azurerm_container_app_job.tareas.secret] :
      alltrue([
        [for s in secretos : s.key_vault_secret_id if s.name == "correo-contrasena"] == ["https://kv.vault.azure.net/secrets/correo-contrasena"],
        [for s in secretos : s.identity if s.name == "correo-contrasena"] == [data.azurerm_user_assigned_identity.api.id],
      ])
    ])
    error_message = "UAT: el secreto correo-contrasena apunta al Key Vault y se lee con la identidad de la app."
  }
}

# Las tres variables nuevas: remitente, usuario y nombre del secreto.
run "remitente_usuario_y_secreto_se_pueden_cambiar" {
  command = plan

  variables {
    ambiente                  = "uat"
    dominio_de_correo         = "avisos-uat.alcanzamos.co"
    correo_remitente          = "avisos@avisos-uat.alcanzamos.co"
    correo_usuario            = "otro-usuario"
    correo_nombre_del_secreto = "cpaas-contrasena"
  }

  assert {
    condition = alltrue([
      for envs in [azurerm_container_app.api.template[0].container[0].env, azurerm_container_app_job.tareas.template[0].container[0].env] :
      alltrue([
        [for e in envs : e.value if e.name == "CORREO_REMITENTE"] == ["avisos@avisos-uat.alcanzamos.co"],
        [for e in envs : e.value if e.name == "CORREO_USUARIO"] == ["otro-usuario"],
        [for e in envs : e.secret_name if e.name == "CORREO_CONTRASENA"] == ["cpaas-contrasena"],
      ])
    ])
    error_message = "correo_remitente, correo_usuario y correo_nombre_del_secreto llegan a CORREO_REMITENTE, CORREO_USUARIO y al secret_name de CORREO_CONTRASENA."
  }

  assert {
    condition = alltrue([
      for secretos in [azurerm_container_app.api.secret, azurerm_container_app_job.tareas.secret] :
      [for s in secretos : s.key_vault_secret_id if s.name == "cpaas-contrasena"] == ["https://kv.vault.azure.net/secrets/cpaas-contrasena"]
    ])
    error_message = "El nombre del secreto del Key Vault sigue a correo_nombre_del_secreto."
  }
}

run "rechaza_remitente_de_otro_dominio" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    correo_remitente  = "no-responder@avisos.alcanzamos.co"
  }

  expect_failures = [var.correo_remitente]
}

run "rechaza_remitente_sin_arroba" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
    correo_remitente  = "no-responder"
  }

  expect_failures = [var.correo_remitente]
}

run "rechaza_usuario_de_correo_vacio" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
    correo_usuario    = ""
  }

  expect_failures = [var.correo_usuario]
}

run "rechaza_nombre_de_secreto_de_correo_invalido" {
  command = plan

  variables {
    ambiente                  = "uat"
    dominio_de_correo         = "avisos-uat.alcanzamos.co"
    correo_nombre_del_secreto = "Correo_Contrasena"
  }

  expect_failures = [var.correo_nombre_del_secreto]
}
