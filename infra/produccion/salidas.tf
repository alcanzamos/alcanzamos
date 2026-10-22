output "registros_dns_de_avisos" {
  description = "Registros que el dueño carga en Cloudflare para avisos.alcanzamos.co (E17-CCO §10.6)."
  value       = azurerm_email_communication_service_domain.avisos.verification_records
}

output "url_del_api" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}
