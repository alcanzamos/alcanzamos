variable "subscription_id" {
  description = "Suscripción de pago por uso, la misma para los dos ambientes (D-205 (11), E11-INF 2.17). Se pasa al aplicar."
  type        = string
}

# Solo por digest (D-200 (8)(b)): UAT despliega el digest que construyó el pipeline y producción, ese mismo digest.
# Una etiqueta, aunque sea de versión, puede moverse a otra imagen: se rechaza en los dos ambientes.
variable "imagen_api" {
  description = "Imagen del API en GitHub Container Registry (D-076), solo por digest: ghcr.io/alcanzamos/alcanzamos-api@sha256:<64 hex>. La pasa el pipeline de despliegue."
  type        = string

  validation {
    condition     = can(regex("^ghcr\\.io/alcanzamos/alcanzamos-api@sha256:[0-9a-f]{64}$", var.imagen_api))
    error_message = "La imagen va solo por digest: ghcr.io/alcanzamos/alcanzamos-api@sha256:<64 caracteres hexadecimales en minúscula>. No se acepta una etiqueta (D-200 (8)(b))."
  }
}

# El paquete de ghcr.io es privado (D-200 (9)(a)): Container Apps baja la imagen con un token clásico read:packages
# guardado en el Key Vault del ambiente y leído con la identidad del API. El valor nunca pasa por OpenTofu.
variable "ghcr_usuario" {
  description = "Usuario de GitHub dueño del token read:packages con el que Container Apps baja la imagen de ghcr.io."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$", var.ghcr_usuario))
    error_message = "El usuario de GitHub no puede ir vacío: de 1 a 39 letras, números o guiones, sin guion al inicio ni al final."
  }
}

variable "ghcr_nombre_del_secreto" {
  description = "Nombre del secreto del Key Vault del ambiente con el token read:packages de ghcr.io. También nombra el secreto en Container Apps."
  type        = string
  default     = "ghcr-lectura"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,125}[a-z0-9])?$", var.ghcr_nombre_del_secreto))
    error_message = "El nombre del secreto va en minúsculas, números y guiones, sin guion al inicio ni al final (Key Vault y Container Apps)."
  }
}

# Correo por Zoho CPaaS (D-205 (6), US-80): SMTP autenticado contra smtp.zeptomail.com:587 después de STARTTLS. Servidor y puerto
# son fijos en aplicacion.tf. La contraseña (el «Send Mail Token» del agente de envío del ambiente) vive en el Key Vault y la
# carga el dueño por la entrada estándar; el valor nunca pasa por OpenTofu ni por el estado.
variable "correo_remitente" {
  description = "Remitente de los correos (CORREO_REMITENTE): no-responder@avisos-uat.alcanzamos.co en UAT y no-responder@avisos.alcanzamos.co en producción (D-120). Sin valor, se arma con dominio_de_correo; si se pasa, tiene que ser de ese dominio."
  type        = string
  default     = null

  validation {
    condition     = var.correo_remitente == null || can(regex("^[a-z0-9][a-z0-9._-]*@${replace(var.dominio_de_correo, ".", "\\.")}$", var.correo_remitente))
    error_message = "El remitente es <usuario>@<dominio_de_correo>, en minúsculas y del mismo dominio de correo del ambiente."
  }
}

variable "correo_usuario" {
  description = "Usuario de SMTP del agente de envío de Zoho CPaaS (CORREO_USUARIO). Siempre es emailapikey; no es un secreto."
  type        = string
  default     = "emailapikey"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._-]*$", var.correo_usuario))
    error_message = "El usuario de SMTP no puede ir vacío: letras, números, punto, guion y guion bajo."
  }
}

variable "correo_nombre_del_secreto" {
  description = "Nombre del secreto del Key Vault del ambiente con la contraseña de SMTP de Zoho CPaaS. También nombra el secreto en Container Apps y es el que CORREO_CONTRASENA referencia."
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
