variable "subscription_id" {
  description = "Suscripción de Azure for Students. Se pasa al aplicar."
  type        = string
}

variable "imagen_api" {
  description = "Imagen del API en GitHub Container Registry (D-076). La pasa el pipeline de despliegue, con versión o digest."
  type        = string

  validation {
    condition     = can(regex("^ghcr\\.io/alcanzamos/[a-z0-9._/-]+(:[A-Za-z0-9._-]+|@sha256:[0-9a-f]{64})$", var.imagen_api)) && !endswith(var.imagen_api, ":latest")
    error_message = "Elige una imagen de ghcr.io/alcanzamos con versión o digest. No se acepta «latest»."
  }
}

variable "admin_postgres_object_id" {
  description = "Object ID en Entra ID de quien administra PostgreSQL. Sin contraseñas."
  type        = string
}

variable "admin_postgres_nombre" {
  description = "Nombre en Entra ID de quien administra PostgreSQL."
  type        = string
}

# O-5 (D-120): más de 10 eventos de un mismo tipo en 15 minutos, por correo.
variable "alerta_umbral" {
  description = "Eventos de un mismo tipo que se pueden tolerar en la ventana; la alerta salta con más (O-5, D-120)."
  type        = number
  default     = 10
}

variable "alerta_ventana" {
  description = "Ventana de evaluación en formato ISO 8601 (O-5, D-120)."
  type        = string
  default     = "PT15M"
}

variable "alerta_correo" {
  description = "Correo que recibe el aviso de la alerta (O-5, D-120)."
  type        = string
  default     = "andres@alcanzamos.co"
}
