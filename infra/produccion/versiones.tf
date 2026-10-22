# Producción (D-119): se valida en cada PR y no se aplica hasta el primer despliegue.
terraform {
  required_version = "= 1.13.2"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.10.0"
    }
  }

  # Estado remoto en Azure Storage. Los valores se pasan en el primer despliegue
  # con -backend-config; nunca se guardan en el repositorio.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  use_oidc        = true
}
