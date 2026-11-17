# Bootstrap (D-119, opción A): lo aplica una sola vez por ambiente el dueño con
# su propia cuenta, antes del primer despliegue de ese ambiente.
terraform {
  required_version = "= 1.13.2"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.11.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "= 3.10.0"
    }
  }

  # Estado local, un archivo por ambiente (uat.tfstate, produccion.tfstate):
  # tofu init -reconfigure -backend-config=path=<ambiente>.tfstate (ver README).
  backend "local" {}
}

provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
}

provider "azuread" {}
