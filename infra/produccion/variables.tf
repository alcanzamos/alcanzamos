variable "subscription_id" {
  description = "Suscripción de Azure for Students. Se pasa al aplicar."
  type        = string
}

variable "imagen_api" {
  description = "Imagen del API en GitHub Container Registry (D-076)."
  type        = string
  default     = "ghcr.io/alcanzamos/alcanzamos-api:latest"
}

variable "admin_postgres_object_id" {
  description = "Object ID en Entra ID de quien administra PostgreSQL. Sin contraseñas."
  type        = string
}

variable "admin_postgres_nombre" {
  description = "Nombre en Entra ID de quien administra PostgreSQL."
  type        = string
}

# Pendiente O-5: el dueño decide umbral, ventana y canal del aviso (RNF-025).
variable "alerta_umbral" {
  description = "Pendiente O-5. Eventos de seguridad que disparan la alerta."
  type        = number
}

variable "alerta_ventana" {
  description = "Pendiente O-5. Ventana de evaluación en formato ISO 8601 (por ejemplo, PT15M)."
  type        = string
}

variable "alerta_correo" {
  description = "Pendiente O-5. Correo que recibe el aviso de la alerta."
  type        = string
}
