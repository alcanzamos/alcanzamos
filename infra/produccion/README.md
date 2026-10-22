# infra/produccion/

Producción en Azure con OpenTofu (D-112, D-119). **Se valida en cada PR y no se aplica hasta el primer despliegue a producción.**

## Qué crea

| Recurso | Nombre definitivo (O-14) | Notas |
|---|---|---|
| Log Analytics | `log-alcanzamos-prod-mxc` | Registros de Container Apps y eventos de seguridad; 90 días (RNF-025) |
| Key Vault Standard | `kv-alcanzamos-prod-mxc` | Permisos por RBAC; protección contra purga |
| PostgreSQL flexible 18 | `psql-alcanzamos-prod-mxc` | B1ms, 32 GiB (ADR-006 §5.2). Solo Entra ID, sin contraseñas; TLS obligatorio |
| Entorno de Container Apps | `cae-alcanzamos-prod-mxc` | Consumo |
| App del API | `ca-api-alcanzamos-prod-mxc` | 0,25 vCPU, 0,5 GiB, réplica mínima 1 |
| Trabajo programado | `caj-tareas-alcanzamos-prod-mxc` | Misma imagen, comando `tareas`, cada 15 minutos (UTC) |
| Servicio de correo | `ecs-alcanzamos-prod-mxc` | Datos en Francia (D-113) |
| Dominio de correo | `avisos.alcanzamos.co` | Administrado por el cliente; remitente propuesto `no-responder@avisos.alcanzamos.co` |
| Communication Services | `acs-alcanzamos-prod-mxc` | Datos en Francia |
| Grupo de acciones y alerta | `ag-seguridad-…`, `alrt-seguridad-…` | RNF-025. Umbral, ventana y correo: **pendiente O-5** |

El grupo `rg-alcanzamos-prod-mxc`, la identidad del API `id-alcanzamos-prod-mxc` y sus roles los crea `infra/bootstrap/`.

Los nombres siguen las abreviaturas de Microsoft Cloud Adoption Framework: tipo, proyecto, ambiente y región (`mxc`, México Central). **Son una propuesta: los aprueba el dueño.** Nunca se reutilizan los de la prueba R-9.

## Decisiones de seguridad

- Sin secretos en el repositorio. El estado de OpenTofu va en Azure Storage, con Entra ID y sin claves compartidas.
- El API entra a PostgreSQL, Key Vault y el correo con su identidad administrada, sin contraseñas ni claves.
- PostgreSQL admite conexiones solo desde servicios de Azure (regla `0.0.0.0`), porque Container Apps de consumo no tiene una IP de salida fija. Esa regla deja pasar servicios de otros clientes de Azure. Lo compensan la autenticación solo con Entra ID y TLS obligatorio. Si el riesgo no se acepta, la alternativa es una red virtual, que cuesta más (ADR-006).
- El API escucha en el puerto 8080; se confirma en la US-45.
- OpenTofu no administra el DNS. La salida `registros_dns_de_avisos` lista los registros que el dueño carga en Cloudflare (E17-CCO §10.6).
- El grupo de acciones manda el aviso por correo. Si O-5 elige otro canal, se cambia aquí.

## Pendientes del dueño

1. **O-5:** umbral, ventana y correo de la alerta de RNF-025.
2. **O-14:** aprobar los nombres.
3. Aprobar el remitente `no-responder`.

## Versiones

Consultadas el 2026-10-22:

- OpenTofu 1.13.2 (publicada el 2026-10-21): `https://github.com/opentofu/opentofu/releases`.
- Proveedor `hashicorp/azurerm` 5.10.0 (2026-10-15): `https://github.com/hashicorp/terraform-provider-azurerm/releases`. Desde la versión 5 no registra proveedores de recursos por su cuenta.
- Proveedor `hashicorp/azuread` 3.10.0 (2026-09-24), solo en `bootstrap`.

## Validación

Sin credenciales y sin aplicar:

```sh
cd infra/produccion
tofu init -backend=false
tofu validate
tofu fmt -check -recursive ..
```
