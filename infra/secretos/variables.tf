variable "ambiente" {
  description = "Ambiente al que se asignan los roles: uat o produccion, los dos en la misma suscripción de pago por uso (D-205 (11)). Forma los nombres del Key Vault y de las identidades."
  type        = string

  validation {
    condition     = contains(["uat", "produccion"], var.ambiente)
    error_message = "El ambiente debe ser «uat» o «produccion»."
  }
}

variable "subscription_id" {
  description = "Suscripción de pago por uso, la misma para los dos ambientes (D-205 (11), E11-INF 2.17)."
  type        = string
}

variable "dueno_object_id" {
  description = "Object ID en Entra ID del dueño, quien carga y rota los secretos: recibe «Key Vault Secrets Officer» sobre el Key Vault del ambiente. Se obtiene con az ad signed-in-user show --query id -o tsv. Sin valor por defecto."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.dueno_object_id))
    error_message = "El object ID del dueño es un GUID: 8-4-4-4-12 caracteres hexadecimales, sin espacios."
  }
}

# Los dos nombres son los mismos que las variables de infra/azure: si allá cambian, aquí también.
variable "ghcr_nombre_del_secreto" {
  description = "Nombre del secreto del Key Vault del ambiente con el token read:packages de ghcr.io. Igual a ghcr_nombre_del_secreto de infra/azure."
  type        = string
  default     = "ghcr-lectura"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,125}[a-z0-9])?$", var.ghcr_nombre_del_secreto))
    error_message = "El nombre del secreto va en minúsculas, números y guiones, sin guion al inicio ni al final (Key Vault y Container Apps)."
  }
}

variable "correo_nombre_del_secreto" {
  description = "Nombre del secreto del Key Vault del ambiente con la contraseña de SMTP de Zoho CPaaS. Igual a correo_nombre_del_secreto de infra/azure."
  type        = string
  default     = "correo-contrasena"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,125}[a-z0-9])?$", var.correo_nombre_del_secreto))
    error_message = "El nombre del secreto va en minúsculas, números y guiones, sin guion al inicio ni al final (Key Vault y Container Apps)."
  }

  validation {
    condition     = var.correo_nombre_del_secreto != var.ghcr_nombre_del_secreto
    error_message = "El secreto del correo no puede ser el mismo que el del registro de imágenes (ghcr_nombre_del_secreto)."
  }
}
