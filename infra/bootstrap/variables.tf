variable "ambiente" {
  description = "Ambiente que se prepara: uat o produccion, los dos en la misma suscripción de pago por uso. Forma los nombres (D-205 (11))."
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

variable "ubicacion" {
  description = "Región de Azure: East US 2 (D-208)."
  type        = string
  default     = "eastus2"
}

variable "azure_devops_organizacion_id" {
  description = "ID (GUID) de la organización alcanzamos en Azure DevOps. Forma el emisor de la identidad federada."
  type        = string
}

variable "conexion_de_servicio" {
  description = "Nombre de la conexión de servicio de Azure DevOps que usa esta identidad. Por defecto, sc-<sufijo del ambiente>."
  type        = string
  default     = null
}

variable "credencial_federada_emisor" {
  description = "Emisor de la credencial federada, tal como lo muestra la conexión de servicio de Azure DevOps. Por defecto, https://vstoken.dev.azure.com/<ID de la organización>."
  type        = string
  default     = null
}

variable "credencial_federada_sujeto" {
  description = "Sujeto de la credencial federada, tal como lo muestra la conexión de servicio de Azure DevOps. Por defecto, sc://alcanzamos/alcanzamos/<conexión de servicio>."
  type        = string
  default     = null
}
