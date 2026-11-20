# Raíz de la suscripción de pago por uso (D-205 (11), E11-INF 2.17): lo que es de toda la suscripción y no de un
# ambiente. La aplica el dueño, una sola vez, con su cuenta, antes de los bootstraps y de infra/azure.
terraform {
  required_version = "= 1.13.2"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.11.0"
    }
  }

  # Estado local, un solo archivo (suscripcion.tfstate) en el equipo del dueño. No depende de la cuenta de
  # almacenamiento de ningún ambiente: destruir un bootstrap no puede tocarlo (ver README).
  backend "local" {
    path = "suscripcion.tfstate"
  }
}

# Aquí, y solo aquí, se registran los proveedores de recursos (azurerm 5.11.0: resource_providers_to_register).
# No son recursos: el estado no los posee, nunca se desregistran y registrar dos veces no falla.
# Los bootstraps y infra/azure llevan resource_provider_registrations = "none".
provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
  resource_providers_to_register  = local.proveedores
}
