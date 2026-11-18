# T3/P1/T9: lo que el plan no expone se comprueba en los archivos de esta raíz (prevent_destroy, proveedores, sin azuread).
# Corre sin credenciales ni Azure: el proveedor es un simulacro y solo se hace plan.
#   tofu init -backend=false && tofu test
mock_provider "azurerm" {}

variables {
  subscription_id    = "00000000-0000-0000-0000-000000000000"
  correos_de_alerta  = ["dueno@example.com"]
  presupuesto_inicio = "2026-12-01T00:00:00Z"
}

run "configuracion_estatica" {
  command = plan

  # Ningún recurso de registro de proveedores: la configuración del proveedor los registra y el estado no los posee.
  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : strcontains(file("${path.module}/${f}"), "azurerm_resource_provider_registration")])
    error_message = "Los proveedores no van como recursos en ningún estado (decisión del dueño, 2026-11-18)."
  }

  assert {
    condition = alltrue([
      can(regex("resource_provider_registrations\\s*=\\s*\"none\"", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))),
      can(regex("resource_providers_to_register\\s*=\\s*local\\.proveedores", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))),
    ])
    error_message = "El proveedor azurerm registra solo la lista de local.proveedores: resource_provider_registrations = \"none\" y resource_providers_to_register."
  }

  # Cada recurso de esta raíz lleva prevent_destroy: el plan no lo expone, se cuenta en el código.
  assert {
    condition = alltrue([
      length(regexall("(?m)^resource \"", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))) == 3,
      length(regexall("prevent_destroy\\s*=\\s*true", join("\n", [for f in fileset(path.module, "*.tf") : file("${path.module}/${f}")]))) == 3,
    ])
    error_message = "Los tres recursos (regiones, etiquetas y presupuestos) deben llevar prevent_destroy = true y no debe haber otros."
  }

  # Sin azuread (D-049).
  assert {
    condition     = !anytrue([for f in fileset(path.module, "*.tf") : can(regex("azuread", file("${path.module}/${f}")))])
    error_message = "Esta raíz no usa azuread."
  }
}
