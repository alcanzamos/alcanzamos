variable "subscription_id" {
  description = "Suscripción de pago por uso, la misma para los dos ambientes (D-205 (11), E11-INF 2.17). Se pasa al aplicar."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.subscription_id))
    error_message = "El ID de la suscripción es un GUID."
  }
}

variable "correos_de_alerta" {
  description = "Correos que reciben los avisos de los presupuestos de la suscripción (T9). Va al estado local del dueño y no se sube al repositorio."
  type        = list(string)

  validation {
    condition     = length(var.correos_de_alerta) > 0 && alltrue([for c in var.correos_de_alerta : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", c))])
    error_message = "Hace falta al menos un correo, y cada uno debe tener la forma usuario@dominio."
  }
}

variable "presupuesto_inicio" {
  description = "Inicio de los presupuestos: el primer día de un mes, en UTC, por ejemplo 2026-12-01T00:00:00Z. Azure lo pide así y no admite un mes ya pasado."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{4}-(0[1-9]|1[0-2])-01T00:00:00Z$", var.presupuesto_inicio))
    error_message = "El inicio debe ser el primer día de un mes, con la forma AAAA-MM-01T00:00:00Z."
  }
}
