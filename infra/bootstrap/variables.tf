variable "ambiente" {
  description = "Ambiente que se prepara: uat (Azure for Students) o produccion (pago por uso). Forma los nombres (D-200 (8))."
  type        = string

  validation {
    condition     = contains(["uat", "produccion"], var.ambiente)
    error_message = "El ambiente debe ser «uat» o «produccion»."
  }
}

variable "subscription_id" {
  description = "Suscripción del ambiente: Azure for Students en UAT, pago por uso en producción (D-200 (7) y (8))."
  type        = string
}

variable "ubicacion" {
  description = "Región de Azure (ADR-006, D-080)."
  type        = string
  default     = "mexicocentral"
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
