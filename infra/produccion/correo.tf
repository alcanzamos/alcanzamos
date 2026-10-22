# Correo de la app (D-113): Azure Communication Services con datos en Francia
# y dominio propio avisos.alcanzamos.co. Los registros DNS los carga el dueño
# en Cloudflare: OpenTofu no administra el DNS.
resource "azurerm_email_communication_service" "correo" {
  name                = "ecs-${local.sufijo}"
  resource_group_name = data.azurerm_resource_group.principal.name
  data_location       = "France"
  tags                = local.etiquetas
}

resource "azurerm_email_communication_service_domain" "avisos" {
  name                             = "avisos.alcanzamos.co"
  email_service_id                 = azurerm_email_communication_service.correo.id
  domain_management                = "CustomerManaged"
  user_engagement_tracking_enabled = false
  tags                             = local.etiquetas
}

# Remitente aprobado (D-120): no-responder@avisos.alcanzamos.co. Condición: cada
# correo dice dónde escribir, privacidad@alcanzamos.co (RF-060).
resource "azurerm_email_communication_service_domain_sender_username" "avisos" {
  name                    = "no-responder"
  email_service_domain_id = azurerm_email_communication_service_domain.avisos.id
  display_name            = "Alcanzamos"
}

resource "azurerm_communication_service" "correo" {
  name                = "acs-${local.sufijo}"
  resource_group_name = data.azurerm_resource_group.principal.name
  data_location       = "France"
  tags                = local.etiquetas
}

# El dominio solo se asocia cuando el dueño verificó los registros DNS.
resource "azurerm_communication_service_email_domain_association" "avisos" {
  communication_service_id = azurerm_communication_service.correo.id
  email_service_domain_id  = azurerm_email_communication_service_domain.avisos.id
}
