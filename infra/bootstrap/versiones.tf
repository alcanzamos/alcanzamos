# Bootstrap (D-119, opción A): lo aplica una sola vez por ambiente el dueño con
# su propia cuenta, antes del primer despliegue de ese ambiente.
terraform {
  required_version = "= 1.13.2"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.11.0"
    }
  }

  # Estado local, un archivo por ambiente (uat.tfstate, produccion.tfstate):
  # tofu init -reconfigure -backend-config=path=<ambiente>.tfstate (ver README).
  backend "local" {}
}

# Los proveedores de recursos no se registran aquí: con una sola suscripción, los dos bootstraps serían dueños del
# mismo registro. Los registra infra/suscripcion, una sola vez, antes de este bootstrap.
provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
}
