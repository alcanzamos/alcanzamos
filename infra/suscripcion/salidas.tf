output "proveedores_registrados" {
  description = "Proveedores de recursos que registra la configuración del proveedor azurerm al planear o aplicar. No son recursos del estado."
  value       = local.proveedores
}
