variable "subscription_id" {
  description = "Suscripción de Azure for Students."
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
  description = "Nombre de la conexión de servicio de Azure DevOps que usa esta identidad."
  type        = string
  default     = "sc-alcanzamos-prod-mxc"
}
