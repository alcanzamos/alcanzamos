output "lecturas" {
  description = "Por secreto, las identidades de carga que lo leen. Sirve para comprobar el resultado después de aplicar."
  value = {
    for secreto, identidades in local.lectores : local.nombres_de_secreto[secreto] => identidades
  }
}
