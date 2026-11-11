# Parámetros de cada ambiente (US-79, D-200 (8)): el mismo código sirve a UAT y a producción.
# Los valores de cada uno están en uat.tfvars.example y produccion.tfvars.example.
variable "ambiente" {
  description = "Ambiente que se crea: uat (Azure for Students) o produccion (pago por uso). Forma los nombres y las etiquetas (D-200 (8))."
  type        = string

  validation {
    condition     = contains(["uat", "produccion"], var.ambiente)
    error_message = "El ambiente debe ser «uat» o «produccion»."
  }
}

# Un dominio por ambiente: un dominio solo pertenece a un Email Communication Service (D-200 (8)).
variable "dominio_de_correo" {
  description = "Dominio propio de envío: avisos.alcanzamos.co en producción (D-113) y avisos-uat.alcanzamos.co en UAT (S5)."
  type        = string

  validation {
    condition     = can(regex("^avisos(-[a-z0-9]+)?\\.alcanzamos\\.co$", var.dominio_de_correo)) && (var.ambiente == "produccion") == (var.dominio_de_correo == "avisos.alcanzamos.co")
    error_message = "Producción usa avisos.alcanzamos.co; UAT, su propio subdominio (avisos-uat.alcanzamos.co)."
  }
}

# Tamaños: por defecto, los de producción (ADR-006 §5.2). UAT los cambia solo si hace falta (D-200 (8)).
variable "postgres_sku" {
  description = "SKU de PostgreSQL flexible (ADR-006 §5.2)."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_almacenamiento_mb" {
  description = "Almacenamiento de PostgreSQL en MiB (ADR-006 §5.2: 32 GiB)."
  type        = number
  default     = 32768
}

variable "registros_dias_de_retencion" {
  description = "Días que Log Analytics guarda los registros (RNF-025: 90)."
  type        = number
  default     = 90
}

variable "api_replicas_minimas" {
  description = "Réplicas mínimas del API. Con 0 se apaga sin tráfico y el primer pedido espera el arranque."
  type        = number
  default     = 1

  validation {
    condition     = contains([0, 1], var.api_replicas_minimas)
    error_message = "Las réplicas mínimas del API son 0 o 1 (la máxima es 1)."
  }
}

variable "contenedor_cpu" {
  description = "vCPU del API y del trabajo programado."
  type        = number
  default     = 0.25
}

variable "contenedor_memoria" {
  description = "Memoria del API y del trabajo programado; en Container Apps de consumo es el doble de la vCPU, en GiB."
  type        = string
  default     = "0.5Gi"
}
