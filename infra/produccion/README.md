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
| Dominio de correo | `avisos.alcanzamos.co` | Administrado por el cliente; remitente `no-responder@avisos.alcanzamos.co` (D-120) |
| Communication Services | `acs-alcanzamos-prod-mxc` | Datos en Francia |
| Grupo de acciones y alerta | `ag-seguridad-…`, `alrt-seguridad-…` | RNF-025: más de 10 eventos de un mismo tipo en 15 minutos, aviso a `andres@alcanzamos.co` (O-5, D-120) |

El grupo `rg-alcanzamos-prod-mxc`, la identidad del API `id-alcanzamos-prod-mxc` y sus roles los crea `infra/bootstrap/`.

Los nombres siguen las abreviaturas de Microsoft Cloud Adoption Framework: tipo, proyecto, ambiente y región (`mxc`, México Central). **Aprobados por el dueño (O-14, D-120).** Nunca se reutilizan los de la prueba R-9.

## Decisiones de seguridad

- Sin secretos en el repositorio. El estado de OpenTofu va en Azure Storage, con Entra ID y sin claves compartidas.
- El API entra a PostgreSQL, Key Vault y el correo con su identidad administrada, sin contraseñas ni claves.
- PostgreSQL admite conexiones solo desde servicios de Azure (regla `0.0.0.0`), porque Container Apps de consumo no tiene una IP de salida fija. Esa regla deja pasar servicios de otros clientes de Azure. Lo compensan la autenticación solo con Entra ID y TLS obligatorio. Si el riesgo no se acepta, la alternativa es una red virtual, que cuesta más (ADR-006).
- El API escucha en el puerto 8080; se confirma en la US-45.
- OpenTofu no administra el DNS. La salida `registros_dns_de_avisos` lista los registros que el dueño carga en Cloudflare (E17-CCO §10.6).
- La alerta cuenta por tipo de evento (E11-DAR §7): la consulta agrupa por la dimensión `tipo`, y el umbral vale para cada tipo por separado.
- La imagen del API no tiene valor por defecto. La pasa el pipeline de despliegue, con versión o digest; `latest` se rechaza.
- Cada correo dice dónde escribir: `privacidad@alcanzamos.co` (RF-060). Es la condición del remitente (D-120) y se cumple en las plantillas de la US-45.

## Antes del primer despliegue (D-120)

No bloquean la US-44.

1. **Red de PostgreSQL.** Llevar el riesgo de la regla `0.0.0.0` a E11-EIP y calcular, con fuente, el costo de la red virtual. Lo decide el dueño antes de crear el servidor: esa elección no se cambia después en el mismo servidor.
2. **Rol mínimo para enviar correo** en lugar de «Communication and Email Service Owner» sobre todo el grupo. Se define en la US-45.
3. **Comprobar con `list-skus`** que PostgreSQL 18 y la zona 1 existen en México Central.
4. **Costos en ADR-006:** Communication Services, la regla de alerta y la retención de 90 días.
5. **Probar que el aviso de la alerta llega** a `andres@alcanzamos.co` (O-5).
6. **Variables de la base (D-123).** La configuración pasa `PGHOST`, `PGDATABASE`, `PGUSER` y `PGSSLMODE`, pero el API lee `BASE_DE_DATOS_URL`. Se resuelve en I05, con la conexión por Entra ID.

## Para la US-45

- El campo con el tipo de evento se llama `evento_seguridad`; la alerta depende de ese nombre.
- E11-DAR §7 habla de un «contador por origen», pero la lista de campos no incluye el origen. Si es la IP, es un dato personal (NM-03). Se resuelve al escribir el registro.

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
