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

# Un dominio por ambiente: es el del remitente y el que se verifica en el agente de Zoho CPaaS (D-205 (6), E11-INF 2.14).
variable "dominio_de_correo" {
  description = "Dominio propio del remitente: avisos.alcanzamos.co en producción (D-113) y avisos-uat.alcanzamos.co en UAT (S5)."
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

# Azure acepta de 7 a 90 días. La protección contra el borrado sigue activa en los dos ambientes (S11).
variable "secretos_dias_de_retencion" {
  description = "Días que se puede recuperar el Key Vault después de eliminarlo: 90 en producción y 7 en UAT (S11)."
  type        = number
  default     = 90

  validation {
    condition     = var.secretos_dias_de_retencion >= 7 && var.secretos_dias_de_retencion <= 90
    error_message = "La retención del Key Vault eliminado es de 7 a 90 días."
  }
}

# Una red por ambiente, sin emparejar (E11-INF 2.2, P1): las dos pueden usar el mismo rango porque nunca se conectan entre sí.
# Se parte en una /27 para el entorno de Container Apps (el mínimo con perfiles de carga de trabajo) y una /28 delegada a PostgreSQL.
variable "red_espacio_de_direcciones" {
  description = "Espacio de direcciones de la red virtual del ambiente: una /24 privada (RFC 1918). De ahí salen la /27 del entorno de Container Apps y la /28 delegada a PostgreSQL."
  type        = string
  default     = "10.60.0.0/24"

  validation {
    condition = (
      can(regex("^(10\\.[0-9]{1,3}|172\\.(1[6-9]|2[0-9]|3[01])|192\\.168)\\.[0-9]{1,3}\\.[0-9]{1,3}/24$", var.red_espacio_de_direcciones)) &&
      can(cidrhost(var.red_espacio_de_direcciones, 0)) &&
      try(cidrhost(var.red_espacio_de_direcciones, 0) == split("/", var.red_espacio_de_direcciones)[0], false)
    )
    error_message = "La red del ambiente es una /24 privada (10.x.x.0/24, 172.16-31.x.0/24 o 192.168.x.0/24) con la dirección de red, como 10.60.0.0/24."
  }
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
