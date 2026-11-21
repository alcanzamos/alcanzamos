# Red privada y PostgreSQL privado (D-205 (2) y (3), D-208, E11-INF 2.2 y 2.3 bis): una red virtual por ambiente, sin emparejar, con la subred
# /27 del entorno de Container Apps (perfiles de carga de trabajo, solo consumo) y la subred delegada a PostgreSQL, que no tiene regla de
# firewall ni acceso público. Los administradores de Entra son el migrador y caj-psql; la identidad del API no lo es, y ni el API ni los
# trabajos reciben una URL de conexión ni una contraseña. Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
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
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id"
      principal_id = "00000000-0000-0000-0000-000000000000"
      client_id    = "00000000-0000-0000-0000-000000000000"
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

  mock_resource "azurerm_virtual_network" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet"
    }
  }

  mock_resource "azurerm_subnet" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet"
    }
  }

  mock_resource "azurerm_private_dns_zone" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/privateDnsZones/zona.postgres.database.azure.com"
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

# Cada identidad con su propio objeto de Entra y cada subred con su propio ID, para que las pruebas distingan una de otra.
override_data {
  target = data.azurerm_user_assigned_identity.api
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-api"
    principal_id = "11111111-1111-1111-1111-111111111111"
    client_id    = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.tareas
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-tareas"
    principal_id = "44444444-4444-4444-4444-444444444444"
    client_id    = "dddddddd-dddd-dddd-dddd-dddddddddddd"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.web
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-web"
    principal_id = "55555555-5555-5555-5555-555555555555"
    client_id    = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.migrador
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-migrador"
    principal_id = "22222222-2222-2222-2222-222222222222"
    client_id    = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
  }
}

override_data {
  target = data.azurerm_user_assigned_identity.psql
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-psql"
    principal_id = "33333333-3333-3333-3333-333333333333"
    client_id    = "cccccccc-cccc-cccc-cccc-cccccccccccc"
  }
}

override_resource {
  target = azurerm_subnet.entorno
  values = {
    id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet-entorno"
  }
}

override_resource {
  target = azurerm_subnet.postgres
  values = {
    id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet-postgres"
  }
}

variables {
  subscription_id          = "00000000-0000-0000-0000-000000000000"
  admin_postgres_object_id = "00000000-0000-0000-0000-000000000000"
  admin_postgres_nombre    = "andres@alcanzamos.co"
  imagen_api               = "ghcr.io/alcanzamos/alcanzamos-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  ghcr_usuario             = "usuario-de-prueba"
}

# --- La red ---------------------------------------------------------------------------------------------------------------------------

run "la_red_tiene_la_subred_del_entorno_y_la_de_postgres" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_virtual_network.red.name == "vnet-alcanzamos-prod-eus2",
      azurerm_virtual_network.red.address_space == toset(["10.60.0.0/24"]),
      azurerm_virtual_network.red.resource_group_name == data.azurerm_resource_group.principal.name,
      azurerm_virtual_network.red.tags == tomap({ proyecto = "alcanzamos", ambiente = "produccion", origen = "opentofu" }),
    ])
    error_message = "La red virtual de producción es vnet-alcanzamos-prod-eus2, con 10.60.0.0/24, en el grupo del ambiente y con las etiquetas de siempre."
  }

  # El entorno de Container Apps con perfiles de carga de trabajo pide una /27 como mínimo, delegada a Microsoft.App/environments.
  assert {
    condition = alltrue([
      azurerm_subnet.entorno.address_prefixes == tolist(["10.60.0.0/27"]),
      azurerm_subnet.entorno.virtual_network_name == azurerm_virtual_network.red.name,
      length(azurerm_subnet.entorno.delegation) == 1,
      azurerm_subnet.entorno.delegation[0].service_delegation[0].name == "Microsoft.App/environments",
    ])
    error_message = "La subred del entorno es una /27 (10.60.0.0/27) delegada a Microsoft.App/environments."
  }

  assert {
    condition = alltrue([
      azurerm_subnet.postgres.address_prefixes == tolist(["10.60.0.32/28"]),
      azurerm_subnet.postgres.virtual_network_name == azurerm_virtual_network.red.name,
      length(azurerm_subnet.postgres.delegation) == 1,
      azurerm_subnet.postgres.delegation[0].service_delegation[0].name == "Microsoft.DBforPostgreSQL/flexibleServers",
      azurerm_subnet.postgres.address_prefixes != azurerm_subnet.entorno.address_prefixes,
    ])
    error_message = "La subred de PostgreSQL es 10.60.0.32/28, distinta de la del entorno y delegada a Microsoft.DBforPostgreSQL/flexibleServers."
  }

  assert {
    condition = alltrue([
      endswith(azurerm_private_dns_zone.postgres.name, ".postgres.database.azure.com"),
      azurerm_private_dns_zone.postgres.name == "alcanzamos-prod-eus2.private.postgres.database.azure.com",
      azurerm_private_dns_zone_virtual_network_link.postgres.private_dns_zone_id == azurerm_private_dns_zone.postgres.id,
      azurerm_private_dns_zone_virtual_network_link.postgres.virtual_network_id == azurerm_virtual_network.red.id,
      azurerm_private_dns_zone_virtual_network_link.postgres.registration_enabled == false,
    ])
    error_message = "La zona DNS privada termina en .postgres.database.azure.com, se enlaza a la red del ambiente y no registra nombres."
  }
}

run "uat_tiene_su_propia_red" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_virtual_network.red.name == "vnet-alcanzamos-uat-eus2",
      azurerm_private_dns_zone.postgres.name == "alcanzamos-uat-eus2.private.postgres.database.azure.com",
      azurerm_virtual_network.red.tags["ambiente"] == "uat",
      azurerm_private_dns_zone.postgres.tags["ambiente"] == "uat",
    ])
    error_message = "UAT tiene su propia red y su propia zona DNS, con «uat» en el nombre y en la etiqueta."
  }
}

run "la_red_se_puede_cambiar_si_es_una_24_privada" {
  command = plan

  variables {
    ambiente                   = "uat"
    dominio_de_correo          = "avisos-uat.alcanzamos.co"
    red_espacio_de_direcciones = "172.20.5.0/24"
  }

  assert {
    condition = alltrue([
      azurerm_virtual_network.red.address_space == toset(["172.20.5.0/24"]),
      azurerm_subnet.entorno.address_prefixes == tolist(["172.20.5.0/27"]),
      azurerm_subnet.postgres.address_prefixes == tolist(["172.20.5.32/28"]),
    ])
    error_message = "Las dos subredes salen del espacio de direcciones que se pasa."
  }
}

run "rechaza_una_red_que_no_es_una_24" {
  command = plan

  variables {
    ambiente                   = "uat"
    dominio_de_correo          = "avisos-uat.alcanzamos.co"
    red_espacio_de_direcciones = "10.60.0.0/25"
  }

  expect_failures = [var.red_espacio_de_direcciones]
}

run "rechaza_una_red_publica" {
  command = plan

  variables {
    ambiente                   = "uat"
    dominio_de_correo          = "avisos-uat.alcanzamos.co"
    red_espacio_de_direcciones = "20.1.2.0/24"
  }

  expect_failures = [var.red_espacio_de_direcciones]
}

run "rechaza_una_red_que_no_es_un_cidr" {
  command = plan

  variables {
    ambiente                   = "uat"
    dominio_de_correo          = "avisos-uat.alcanzamos.co"
    red_espacio_de_direcciones = "10.60.0.0"
  }

  expect_failures = [var.red_espacio_de_direcciones]
}

# --- El entorno de Container Apps ---------------------------------------------------------------------------------------------------

run "el_entorno_va_en_su_subred_con_solo_consumo" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_container_app_environment.entorno.infrastructure_subnet_id == azurerm_subnet.entorno.id,
      length(azurerm_container_app_environment.entorno.workload_profile) == 1,
      one(azurerm_container_app_environment.entorno.workload_profile).name == "Consumption",
      one(azurerm_container_app_environment.entorno.workload_profile).workload_profile_type == "Consumption",
    ])
    error_message = "El entorno va en la subred /27 y tiene un solo perfil de carga de trabajo, el de consumo (D-205 (2))."
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.workload_profile_name == "Consumption",
      azurerm_container_app_job.tareas.workload_profile_name == "Consumption",
    ])
    error_message = "El API y el trabajo programado corren en el perfil de consumo."
  }
}

# --- PostgreSQL privado -------------------------------------------------------------------------------------------------------------

run "postgres_es_privado_y_sin_regla_de_firewall" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_postgresql_flexible_server.datos.delegated_subnet_id == azurerm_subnet.postgres.id,
      azurerm_postgresql_flexible_server.datos.private_dns_zone_id == azurerm_private_dns_zone.postgres.id,
      azurerm_postgresql_flexible_server.datos.public_network_access_enabled == false,
      azurerm_postgresql_flexible_server.datos.authentication[0].password_auth_enabled == false,
      azurerm_postgresql_flexible_server.datos.authentication[0].active_directory_auth_enabled == true,
    ])
    error_message = "PostgreSQL entra por su subred delegada y su zona DNS privada, sin acceso público y solo con Entra ID."
  }

  # Ni la regla que dejaba pasar a todos los servicios de Azure ni ninguna otra: la red privada es la única puerta.
  assert {
    condition = alltrue([
      for f in fileset(path.module, "*.tf") :
      !can(regex("azurerm_postgresql_flexible_server_firewall_rule|0\\.0\\.0\\.0", file("${path.module}/${f}")))
    ])
    error_message = "Ningún .tf de infra/azure declara una regla de firewall de PostgreSQL ni el rango 0.0.0.0."
  }
}

# Solo se puede activar al crear el servidor (D-208): producción lo trae desde el primer día; UAT no lo paga.
run "produccion_tiene_respaldo_georredundante" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.datos.geo_redundant_backup_enabled == true
    error_message = "Producción tiene geo_redundant_backup_enabled = true (D-208)."
  }
}

run "uat_no_tiene_respaldo_georredundante" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.datos.geo_redundant_backup_enabled == false
    error_message = "UAT no tiene respaldo georredundante (D-208)."
  }
}

# --- Los administradores de Entra ----------------------------------------------------------------------------------------------------

run "los_administradores_son_el_migrador_y_caj_psql" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      length(azurerm_postgresql_flexible_server_active_directory_administrator.admin) == 2,
      toset(keys(azurerm_postgresql_flexible_server_active_directory_administrator.admin)) == toset(["migrador", "psql"]),
      azurerm_postgresql_flexible_server_active_directory_administrator.admin["migrador"].object_id == "22222222-2222-2222-2222-222222222222",
      azurerm_postgresql_flexible_server_active_directory_administrator.admin["psql"].object_id == "33333333-3333-3333-3333-333333333333",
      azurerm_postgresql_flexible_server_active_directory_administrator.admin["migrador"].principal_name == "id-alcanzamos-migrador-prod-eus2",
      azurerm_postgresql_flexible_server_active_directory_administrator.admin["psql"].principal_name == "id-alcanzamos-psql-prod-eus2",
    ])
    error_message = "Los administradores de Entra de PostgreSQL son el migrador y caj-psql, por su objeto de Entra y con el nombre de su identidad."
  }

  assert {
    condition = alltrue([
      for a in values(azurerm_postgresql_flexible_server_active_directory_administrator.admin) :
      a.principal_type == "ServicePrincipal" && a.server_name == azurerm_postgresql_flexible_server.datos.name
    ])
    error_message = "Los dos administradores son ServicePrincipal del servidor de PostgreSQL del ambiente."
  }
}

# L24 (b): el API se conecta con un rol sin administración. Si su identidad fuera administradora de Entra, el rol que le crea el
# migrador no valdría de nada: tendría DDL y todo lo demás.
run "la_identidad_del_api_no_es_administradora" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      !contains([for a in values(azurerm_postgresql_flexible_server_active_directory_administrator.admin) : a.object_id], data.azurerm_user_assigned_identity.api.principal_id),
      !contains([for a in values(azurerm_postgresql_flexible_server_active_directory_administrator.admin) : a.principal_name], data.azurerm_user_assigned_identity.api.name),
      data.azurerm_user_assigned_identity.api.name == "id-alcanzamos-api-uat-eus2",
    ])
    error_message = "La identidad del API (id-alcanzamos-api-<ambiente>-eus2) no es administradora de Entra de PostgreSQL."
  }

  assert {
    condition = alltrue([
      length(distinct([for i in [data.azurerm_user_assigned_identity.api, data.azurerm_user_assigned_identity.web, data.azurerm_user_assigned_identity.tareas, data.azurerm_user_assigned_identity.migrador, data.azurerm_user_assigned_identity.psql] : i.principal_id])) == 5,
      alltrue([for f in fileset(path.module, "*.tf") : !can(regex("admin_postgres", file("${path.module}/${f}")))]),
      alltrue([for f in fileset(path.module, "*.example") : !can(regex("admin_postgres", file("${path.module}/${f}")))]),
    ])
    error_message = "Las cinco identidades de carga son distintas y el dueño ya no es administrador (no queda admin_postgres_* en las variables ni en los ejemplos)."
  }
}

# Cada pieza con su identidad (E11-INF 2.4): se leen con los nombres reales del bootstrap, y caj-tareas ya no comparte la del API ni en la
# asignación ni en la que usa para PostgreSQL (PGUSER y AZURE_CLIENT_ID).
run "las_identidades_se_leen_con_los_nombres_del_bootstrap" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      data.azurerm_user_assigned_identity.api.name == "id-alcanzamos-api-prod-eus2",
      data.azurerm_user_assigned_identity.web.name == "id-alcanzamos-web-prod-eus2",
      data.azurerm_user_assigned_identity.tareas.name == "id-alcanzamos-tareas-prod-eus2",
      data.azurerm_user_assigned_identity.migrador.name == "id-alcanzamos-migrador-prod-eus2",
      data.azurerm_user_assigned_identity.psql.name == "id-alcanzamos-psql-prod-eus2",
      alltrue([for i in [data.azurerm_user_assigned_identity.api, data.azurerm_user_assigned_identity.web, data.azurerm_user_assigned_identity.tareas, data.azurerm_user_assigned_identity.migrador, data.azurerm_user_assigned_identity.psql] : i.resource_group_name == data.azurerm_resource_group.principal.name]),
    ])
    error_message = "Las cinco identidades se leen como id-alcanzamos-<api|web|tareas|migrador|psql>-prod-eus2, en el grupo del ambiente."
  }
}

run "caj_tareas_usa_la_identidad_de_tareas_tambien_para_postgres" {
  command = plan

  variables {
    ambiente          = "uat"
    dominio_de_correo = "avisos-uat.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      azurerm_container_app.api.identity[0].identity_ids == toset([data.azurerm_user_assigned_identity.api.id]),
      azurerm_container_app_job.tareas.identity[0].identity_ids == toset([data.azurerm_user_assigned_identity.tareas.id]),
      [for e in azurerm_container_app.api.template[0].container[0].env : e.value if e.name == "PGUSER"] == ["id-alcanzamos-api-uat-eus2"],
      [for e in azurerm_container_app.api.template[0].container[0].env : e.value if e.name == "AZURE_CLIENT_ID"] == ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      [for e in azurerm_container_app_job.tareas.template[0].container[0].env : e.value if e.name == "PGUSER"] == ["id-alcanzamos-tareas-uat-eus2"],
      [for e in azurerm_container_app_job.tareas.template[0].container[0].env : e.value if e.name == "AZURE_CLIENT_ID"] == ["dddddddd-dddd-dddd-dddd-dddddddddddd"],
    ])
    error_message = "ca-api usa la identidad del API y caj-tareas la de tareas, en la asignación, en PGUSER y en AZURE_CLIENT_ID."
  }

  # El resto del entorno es el mismo para los dos: solo cambian PGUSER y AZURE_CLIENT_ID.
  assert {
    condition = alltrue([
      for envs in [azurerm_container_app.api.template[0].container[0].env, azurerm_container_app_job.tareas.template[0].container[0].env] :
      alltrue([
        [for e in envs : e.value if e.name == "PGSSLMODE"] == ["verify-full"],
        length([for e in envs : e if e.name == "PGDATABASE" && e.value == "alcanzamos"]) == 1,
        toset([for e in envs : e.name]) == toset(["PGHOST", "PGDATABASE", "PGUSER", "PGSSLMODE", "AZURE_CLIENT_ID", "CORREO_SMTP", "CORREO_USUARIO", "CORREO_CONTRASENA", "CORREO_REMITENTE"]),
      ])
    ])
    error_message = "ca-api y caj-tareas llevan las mismas variables, con PGSSLMODE = verify-full; solo cambian PGUSER y AZURE_CLIENT_ID."
  }
}

# --- L24 (a): el API y los trabajos no reciben una URL de conexión ni una contraseña ------------------------------------------------

run "ni_el_api_ni_los_trabajos_reciben_url_ni_contrasena_de_base" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      for envs in [azurerm_container_app.api.template[0].container[0].env, azurerm_container_app_job.tareas.template[0].container[0].env] :
      alltrue([
        length([for e in envs : e if e.name == "BASE_DE_DATOS_URL"]) == 0,
        length([for e in envs : e if can(regex("^PG(PASSWORD|PASSFILE|SERVICE|SSLROOTCERT)$", e.name))]) == 0,
        [for e in envs : e.value if e.name == "PGSSLMODE"] == ["verify-full"],
        length([for e in envs : e if e.name == "AZURE_CLIENT_ID"]) == 1,
      ])
    ])
    error_message = "ca-api y los trabajos no llevan BASE_DE_DATOS_URL ni contraseña de PostgreSQL: se conectan con su identidad, con PGSSLMODE = verify-full y AZURE_CLIENT_ID."
  }

  # Ni hoy ni mañana: ningún .tf nombra la variable de la URL ni baja el modo de TLS, así que una app o un trabajo nuevo no puede traerla.
  assert {
    condition = alltrue([
      for f in fileset(path.module, "*.tf") :
      !can(regex("BASE_DE_DATOS_URL|PGPASSWORD|sslmode\\s*=|PGSSLMODE\\s*=\\s*\"(disable|allow|prefer|require|verify-ca)\"", file("${path.module}/${f}")))
    ])
    error_message = "Ningún .tf de infra/azure nombra BASE_DE_DATOS_URL ni PGPASSWORD, ni pone un PGSSLMODE distinto de verify-full."
  }
}

# --- La región ----------------------------------------------------------------------------------------------------------------------

# D-208: East US 2. Nada de lo que está en infra/azure (código, ejemplos y README) conserva la región anterior.
run "no_queda_la_region_anterior" {
  command = plan

  variables {
    ambiente          = "produccion"
    dominio_de_correo = "avisos.alcanzamos.co"
  }

  assert {
    condition = alltrue([
      for f in concat(tolist(fileset(path.module, "*.tf")), tolist(fileset(path.module, "*.example")), ["README.md"]) :
      !can(regex("(?i)-mxc|mexicocentral|m[eé]xico ?central|mexico ?central", file("${path.module}/${f}")))
    ])
    error_message = "En infra/azure no queda -mxc, mexicocentral ni México Central: la región es East US 2 (eastus2, -eus2; D-208)."
  }

  assert {
    condition     = endswith(local.sufijo, "-eus2")
    error_message = "El sufijo de los nombres termina en -eus2."
  }
}
