output "url_del_api" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}
