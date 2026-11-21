# Segundo paso del bootstrap (E11-INF 2.5, 2.14; D-205 (5)): el rol de lectura de cada secreto del Key Vault. Lo aplica el
# dueño con su propia cuenta, una vez por ambiente, DESPUÉS de infra/azure (que crea el Key Vault) y de cargar los
# secretos: un rol sobre un secreto necesita que el secreto exista.
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

# Los proveedores de recursos los registra infra/suscripcion, una sola vez.
provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
}
