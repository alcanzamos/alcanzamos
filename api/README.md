# api/

API de Alcanzamos: monolito modular en Go con la biblioteca estándar (ADR-002). Incluye el motor de reglas en Go (ADR-005), las migraciones en `api/migraciones/` y la web embebida en la imagen (ADR-004).

- Archivo de construcción: `go.mod` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), pruebas con `go test -race`; las de integración usan `//go:build integration`.
- Estructura del monorepo: ADR-001 en [`docs/adr/`](../docs/adr/ADR-001-estructura-de-repositorios.md).

## Uso

- Un solo binario con subcomandos. Sin subcomando corre el servidor (`api`).
- `GET /salud` responde 200 con `{"estado":"ok"}` (queda en la raíz).
- El puerto sale de `PUERTO` (por defecto 8080). El registro es JSON por la salida estándar.
- Con `SIGTERM` o `Ctrl+C` el servidor termina las peticiones en curso (plazo de 10 s).

```sh
cd api
go test -race ./...
go run ./cmd/api
cd ..    # la imagen se construye desde la raíz del monorepo
docker build -f api/Dockerfile -t alcanzamos-api:dev .
docker run --rm -p 127.0.0.1:8080:8080 alcanzamos-api:dev
```

## Rutas y web embebida (ADR-004)

Un solo origen: la web y el API comparten dominio, sin CORS. No hay dominio fijo en el código (D-129).

| Ruta | Respuesta |
|---|---|
| `GET /salud` | `{"estado":"ok"}` |
| `/api/...` | Todo endpoint nuevo del API va aquí. Una ruta desconocida da 404 con `{"error":"no_encontrado"}` en JSON, nunca `index.html` |
| `GET`/`HEAD` de un archivo de la web (`/assets/...`, `/fuentes/...`) | El archivo. `/assets/` lleva `Cache-Control: public, max-age=31536000, immutable` (los nombres llevan hash) |
| Cualquier otro `GET`/`HEAD` | `index.html` con 200 y `Cache-Control: no-cache` (aplicación de una página) |
| Otro método fuera de `/salud` y `/api/` | 405 con `Allow: GET, HEAD` |

- Paquete `internal/web`: `//go:embed` de `internal/web/estatico/`. En el repositorio esa carpeta solo tiene un `index.html` de relleno ("la web no está compilada"), para que `go build` y `go test` pasen sin compilar la web. El `Dockerfile` lo sobrescribe con el `web/dist` real. Un `npm run build` local no toca esa carpeta, así que no deja cambios en git (`web/dist` está ignorado).
- Las respuestas de la web llevan `X-Content-Type-Options: nosniff`.
- **Content-Security-Policy** en todas las respuestas (web, `/api/`, `/salud`, errores 404 y 405), puesta por un envoltorio del manejador en `internal/servidor` con una sola constante (`politicaCSP`):

  ```
  default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
  ```

  | Directiva | Para qué |
  |---|---|
  | `default-src 'self'` | Scripts, estilos, fuentes, imágenes y conexiones solo del mismo origen; sin scripts ni estilos en línea ni terceros (la web ya cumple: fuentes propias, bundle externo) |
  | `object-src 'none'` | Sin `<object>`, `<embed>` ni applets |
  | `base-uri 'none'` | Una etiqueta `<base>` inyectada no puede redirigir las rutas relativas |
  | `frame-ancestors 'none'` | Nadie puede incrustar la web en un `<iframe>` (clickjacking); reemplaza a `X-Frame-Options` |
  | `form-action 'self'` | Los formularios solo envían al mismo origen |

  La prueba `TestContentSecurityPolicyEnTodasLasRespuestas` verifica el valor exacto. `vite preview` (que usa Playwright) repite el mismo texto en `web/vite.config.ts` y `web/e2e/csp.spec.ts` lo compara y falla ante cualquier violación; no hay un origen único posible porque Go no puede embeber archivos fuera de su módulo, así que son dos literales que hay que mantener iguales.
- La cookie de sesión es `__Host-sesion`, con `SameSite=Strict` (D-083); ver [Sesiones](#sesiones-us-49).
- Para ver la web real sin Docker: `cp -r web/dist/. api/internal/web/estatico/` y `go run ./cmd/api` (no confirmar ese cambio).

## Configuración

Ningún dominio ni dirección va fija en el código (D-129). `config.Cargar` lee estas variables y, si falta alguna o no es válida, devuelve un error que las nombra todas. El comando `api` la exige al arrancar; `migrar` y `tareas` no la necesitan.

| Variable | Qué es | Ejemplo local (Mailpit de `infra/local`) |
|---|---|---|
| `BASE_DE_DATOS_URL` | Cadena de conexión de PostgreSQL | `postgres://alcanzamos:solo-local@127.0.0.1:5432/alcanzamos` |
| `CORREO_SMTP` | `host:puerto` del servidor SMTP. Usa STARTTLS si el servidor lo ofrece; todavía no autentica (el proveedor de producción está por definir, O-4) | `127.0.0.1:1025` |
| `CORREO_REMITENTE` | Dirección que envía; no recibe respuestas (D-120). El valor sale de la configuración, no del código | `no-responder@avisos.ejemplo.test` |
| `CORREO_PRIVACIDAD` | Dirección del pie de cada correo, donde escribir sobre los datos (D-120, RF-060) | `privacidad@ejemplo.test` |
| `URL_PUBLICA` | Base de los enlaces de los correos, sin parámetros; la barra final se quita. El enlace de verificación es `URL_PUBLICA/verificar?t=<token>` y el de recuperación, `URL_PUBLICA/recuperar?t=<token>` | `http://127.0.0.1:8080` |
| `SESION_SENUELO_CLAVE` | Clave que firma las sesiones de mentira (D-141, D-143 (2)). Base64 estándar o de URL; decodificada debe tener **32 bytes o más**. Obligatoria para `api`; nunca se registra ni sale en un error (`config.Clave` se imprime como `[oculta]`). Todas las réplicas deben tener la misma. Genera una con `openssl rand -base64 32` | `Zm9vLWJhci1iYXotcXV4LXF1dXgtY29ycmUtbG9jYWw=` (solo local) |
| `PUERTO` | Puerto del servidor (opcional, 8080) | `8080` |

`infra/local/` queda fuera de esta carpeta: para una variable nueva allí, copia la tabla a su `.env.example`. Las pruebas inyectan los valores (`config.Cargar` recibe la función de lectura del entorno).

## Acceso negado por defecto (RNF-012, D-138)

Toda ruta de `/api/` se registra con `Enrutador.Registrar(nivel, patron, manejador)` y **declara su nivel de acceso**. No existe un registro sin nivel: el valor cero, una ruta fuera de `/api/`, un patrón repetido (con el mismo nivel o con otro) o en conflicto hacen que `Construir` devuelva un error y el servidor no arranque. `Registrar` nunca hace `panic`. El nivel que se declara para «todo lo demás» es `requiere_autorizacion`: ante la duda, el más estricto.

| Nivel | Qué exige | Rutas |
|---|---|---|
| `publica` | nada | crear la cuenta, verificar el correo con el enlace, iniciar sesión y recuperar el acceso (pedir el enlace y elegir la contraseña con él) |
| `sin_verificar` | una sesión, aunque sea la **limitada** de una cuenta con el correo sin verificar (o la sesión de mentira de D-141) | PN-59: revisar el estado, reenviar, cambiar el correo; cerrar sesión |
| `sin_autorizacion` | cuenta con el correo **verificado**, aunque no haya autorizado lo necesario | cerrar sesión y las acciones de PN-63 y PN-64 (US-50) |
| `requiere_autorizacion` | cuenta verificada y con las finalidades necesarias de su etapa **autorizadas** (`ReglaDeFinalidades`) | el ingreso anterior de PN-71, el cambio de contraseña de PN-73 y todo lo demás |

| Sujeto → | sin sesión | limitada o de mentira | verificada sin autorizar | autorizada |
|---|---|---|---|---|
| `publica` | 200 | 200 | 200 | 200 |
| `sin_verificar` | 401 `sin_sesion` | 200 | 200 | 200 |
| `sin_autorizacion` | 401 `sin_sesion` | 403 `verificacion_pendiente` | 200 | 200 |
| `requiere_autorizacion` | 401 `sin_sesion` | 403 `verificacion_pendiente` | 403 `autorizacion_pendiente` | 200 |

- **Un nivel más bajo no hereda las rutas de uno más alto.** Lo contrario sí: una cuenta ya verificada sigue pudiendo *revisar el estado* en PN-59 (si abrió el enlace en otro dispositivo, «Ya lo confirmé» debe poder contestar «verificado» con la misma sesión).
- Sin sesión: `401 {"error":"sin_sesion"}` y evento `error_autorizacion`. Con sesión que no alcanza el nivel: `403` con `verificacion_pendiente` o `autorizacion_pendiente` y evento `acceso_denegado` con la cuenta (la sesión de mentira queda como `desconocida`). Si falla la resolución de la sesión, `500`: ante la duda no pasa.
- **`seguridad.Sujeto`** (`Persona`, `Verificada`, `Autorizada`, `Senuelo`) lo arma quien implementa `servidor.Sesiones` (la interfaz `SujetoDe(r)` que resuelve la sesión; ver `sesion.Resolutor`) y el `Enrutador` lo deja en el contexto (`servidor.SujetoDe`). La sesión de mentira de D-141 se trata como la limitada real en todas las rutas, diga lo que diga el resto de sus campos.
- **Prueba por ruta** (`internal/servidor/accesotest`): `ProbarRutas` recorre las rutas registradas y, para cada una y cada clase de Sujeto, comprueba el estado, el código de error y el evento de seguridad de la tabla de arriba. Una ruta nueva entra sola. `TestTodaRutaDeAPITieneSuNivelDeclarado` (`cmd/api`) es además el inventario de rutas: una ruta nueva obliga a añadirla con su nivel.

### Finalidades necesarias por etapa del titular (`cuenta.ReglaDeFinalidades`, D-139)

`0002_catalogo.sql` tiene tres finalidades necesarias y activas, pero a cada persona solo le tocan algunas. La regla está en un solo lugar (`internal/cuenta/finalidades.go`) y según la etapa del **titular** (de quién son los datos; `autorizacion` separa `titular_id` de `otorgante_id`):

| Etapa del titular | Finalidades necesarias | Quién las otorga |
|---|---|---|
| adulta | `cuenta_y_acceso`, `funciones_financieras` | el titular mismo (`otorgante_id = titular_id`, PN-64) |
| menor | `cuenta_del_menor` | su tutor (PN-36) |
| a los 18 años (pasa a `adulta`) | la lista de adulto | la persona (PN-54), sin `cuenta_del_menor` |

Las accesorias (`avisos`, `horas_de_vida`, `correo_del_menor`) y `transferencia` (inactiva) no entran. `Cumple(etapa, titular, vigentes, tutores)` dice si se cumple; una etapa desconocida no cumple. **Prueba guardiana** (`TestElCatalogoNoTieneNecesariasSinClasificar`): lee las finalidades del INSERT de `0002_catalogo.sql` (la migración embebida, la misma que se aplica a la base) y falla si hay una necesaria y activa que la regla no clasifica; la prueba inversa falla si la regla exige un código que el catálogo no tiene como necesario y activo.

## Seguridad (`internal/seguridad`, US-49)

Lo que no depende de ningún módulo de negocio (E12 §5.9).

### Eventos de seguridad (RNF-025, E17-VTE 2.1)

Una línea JSON de `slog` por evento (`seguridad.Registro`), nivel `WARN`, `msg` «evento de seguridad», con estos campos y ninguno más: `time` (siempre en UTC: `nuevoRegistro` de `cmd/api`), `level`, `msg`, `evento_seguridad` (`inicio_sesion_fallido`, `acceso_denegado` o `error_autorizacion`), `cuenta` (uuid o `desconocida`), `ruta` (el patrón de `Request.Pattern`, sin valores), `codigo` (HTTP) y `peticion`. **No hay origen ni IP** (D-123), ni contraseñas, tokens, correos o cuerpos. El `peticion` es de 16 bytes aleatorios en hexadecimal; nunca se acepta el que mande el cliente.

### Tokens opacos (D-081)

`NuevoTokenOpaco` da 32 bytes de `crypto/rand` en base64 de URL sin relleno y su SHA-256, que es lo único que llega a la base. `HuellaDeToken` rechaza, sin tocar la base, lo que no decodifica a 32 bytes.

### Límites de intentos (`LimitadorDeIntentos`, RNF-014)

Es una **espera, no un bloqueo**: cada intento cuenta durante su ventana (deslizante) y deja de contar al cumplirla. Los contadores viven **solo en la memoria del API** (D-123): se reinician con él y no se comparten entre réplicas. La hora sale del `Reloj` inyectado (`internal/reloj`), así que las pruebas la adelantan sin esperar. Lo vencido se borra al tocar la clave y en un barrido cada minuto, y cada clave guarda a lo sumo tantos instantes como su límite, así que la memoria está acotada. Las cuentas, los correos y los orígenes se guardan como SHA-256, no en claro.

| Qué | Por cuenta o dirección | Por origen | Ventana | Decisión |
|---|---|---|---|---|
| Inicio de sesión (cuenta los **fallos**, también la contraseña de ahora errónea de PN-73) | 5 | 20 | 15 minutos | D-136 |
| Pedido del enlace de recuperación | 3 | 20 | 1 hora | D-136 (4) |
| Reenvío del correo de verificación y cambio de correo (contador propio), más una espera corta de 30 segundos entre uno y otro de la misma cuenta | 3 | 20 | 1 hora | D-138 (2), E14-PCP 4.2 (D-143 (5)) |
| Crear una cuenta (cuenta **todos** los intentos) | — | 20 | 1 hora | D-140 (1) |
| Correos a una misma dirección (verificación, reenvíos y aviso de D-141), desde cualquier origen | 3 | — | 1 hora | D-140 (2) |

- `PermitirIngreso` no cuenta: lo que cuenta es cada fallo (`RegistrarFalloDeIngreso`). Mientras dura la espera responde que no aunque la contraseña sea la correcta.
- Un pedido frenado no cuenta: la espera termina a la hora del primero, por mucho que se insista.
- El límite de la cuenta y el del origen se aplican juntos y solo cuenta si pasan los dos.
- **Origen:** lo decide quien llama; hoy es la dirección de la conexión. Detrás de Azure Container Apps todos llegarían con la dirección de su entrada y el límite por origen sería de todos juntos: se confiará solo en la dirección que agregue esa entrada (fila 17 del primer despliegue, D-143 (4)). No se lee `X-Forwarded-For` mientras tanto.
- Quien llama responde igual al cliente cuando no envía un correo por el límite de la dirección: el cliente no debe poder saberlo.

### Política de contraseñas (`PoliticaDeContrasena`, RF-035, D-089, D-142)

15 caracteres o más (se cuentan caracteres Unicode, no bytes), **sin reglas de composición** y sin recortar espacios. No consulta ningún servicio externo de contraseñas filtradas (E11-EIP). Todo se compara sin distinguir mayúsculas ni tildes («Contraseña» es «contrasena»). `Validar(contrasena, correo, usuario)` devuelve el primer error de esta lista:

| Código para el cliente | Error | Cuándo | Texto de E14-PCP (lo pone el cliente) |
|---|---|---|---|
| `contrasena_vacia` | `ErrContrasenaVacia` | no hay nada | «Falta la contraseña.» |
| `contrasena_corta` | `ErrContrasenaCorta` | menos de 15 caracteres | «Falta que la contraseña tenga al menos 15 caracteres.» |
| `contrasena_personal` | `ErrContrasenaPersonal` | contiene la parte local del correo (si tiene 4 caracteres o más), el nombre de usuario (ídem) o «alcanzamos» | «Falta una contraseña que no incluya tu correo ni el nombre de la app.» (propuesto, lo revisa el dueño) |
| `contrasena_comun` | `ErrContrasenaComun` | está en la lista de SecLists o en la propia; son todos los caracteres iguales o un bloque de hasta 4 repetido de punta a punta (`aaaaaaaaaaaaaaa`, `abababababababab`); es una secuencia de punta a punta, ascendente o descendente (`123456789012345`, `abcdefghijklmno`); o es un tramo seguido de las filas de un teclado en español, en cualquier sentido (`qwertyuiopasdfg`, `asdfghjklñzxcvb`) | «Falta una contraseña que no sea tan común. Prueba con una frase de tres o cuatro palabras.» |

Una prueba por regla en `contrasena_test.go`. Las reglas miran la contraseña entera: una secuencia o una repetición dentro de una frase más larga no se rechaza.

- **Lista de SecLists** (`datos/contrasenas_comunes.txt`): [SecLists](https://github.com/danielmiessler/SecLists) (MIT), `xato-net-10-million-passwords-1000000.txt` en el commit `4c0fd59432ab8508edc23b3c880127edb12e34d5` (2026-10-22), filtrada a las 10.908 entradas de 15 o más caracteres. URL exacta, hashes, filtro y licencia están en `internal/seguridad/datos/` (`README.md` y `LICENCIA-SecLists.txt`). Licencia MIT, compatible con la AGPLv3.
- **Lista propia en español** (`datos/contrasenas_comunes_es.txt`, AGPL-3.0-only): 502 entradas de 15 o más caracteres con frases y patrones de Colombia («contraseña», «teamo», «tequiero», ciudades, equipos) pegados a números y años. Sin datos filtrados. La genera [`datos/generar_es.go`](internal/seguridad/datos/generar_es.go) (`go run generar_es.go > contrasenas_comunes_es.txt`); **el dueño la revisa antes de fusionar**. Detalle en `datos/README.md`.

### Correo (`internal/correo`)

SMTP de la biblioteca estándar; texto plano en español. Los dos correos (el de verificación y el aviso de D-141, E14-PCP 4.2 bis) terminan **exactamente** con «Si tienes dudas sobre tus datos, escribe a <CORREO_PRIVACIDAD>.» (D-143); una prueba compara el texto en los dos. El puerto `Correo` tiene un `Falso` para las pruebas. Nunca se registra el token, la dirección ni el cuerpo.

## Cuenta (US-49)

| Ruta | Nivel | Qué hace |
|---|---|---|
| `POST /api/v1/cuentas` | `publica` | Crea la cuenta de una persona adulta, envía el correo de verificación y da una **sesión limitada** (CU-43, PN-58). Cuerpo: `{correo, contrasena, nombre, mayor_de_edad}` |
| `POST /api/v1/cuentas/verificacion` | `publica` | Confirma el correo con el token del enlace (PN-59) |
| `GET /api/v1/cuentas/estado` | `sin_verificar` | Revisa si el correo ya se verificó (PN-59, «Ya lo confirmé») |
| `POST /api/v1/cuentas/verificacion/reenvio` | `sin_verificar` | Reenvía el correo de verificación (PN-59) |
| `POST /api/v1/cuentas/correo` | `sin_verificar` | Cambia el correo de una cuenta sin verificar (PN-59) |
| `POST /api/v1/cuentas/verificacion` | `publica` | Confirma el correo con `{token}` (PN-59). El token del enlace es la autoridad |
| `GET /api/v1/cuentas/estado` | `sin_verificar` | «Ya lo confirmé»: `{"verificada":bool}` |
| `POST /api/v1/cuentas/verificacion/reenvio` | `sin_verificar` | «Reenviar el correo»: invalida los enlaces pendientes y manda uno nuevo |
| `POST /api/v1/cuentas/correo` | `sin_verificar` | «Cambiar el correo»: `{correo}` |

### Crear la cuenta

- **Respuesta.** `202 {"estado":"verificacion_pendiente"}` con la sesión (ver abajo), `Cache-Control: no-store`. `mayor_de_edad` debe ser `true` (la web lo manda desde la casilla de PN-58; Android, tras PN-65). **La fecha de nacimiento no se recibe ni se guarda:** un campo que no esté en el contrato da `400 solicitud_invalida` (D-089). Errores de campo: `422 {"error":"validacion","campos":{campo: código}}`, con `correo_vacio`, `correo_invalido`, `contrasena_vacia`, `contrasena_corta`, `contrasena_comun`, `contrasena_personal`, `nombre_vacio`, `nombre_largo` y `mayor_de_edad_requerido`. El API no manda textos: los clientes los toman de E14.
- **Una transacción** guarda `persona` (etapa `adulta`), `perfil_adulto` (correo en minúsculas, sin verificar), `credencial` (Argon2id, no temporal), `enlace_un_uso` de verificación (24 horas) y `sesion`. Los tokens son de 32 bytes de `crypto/rand`; en la base solo está su SHA-256. Si el envío del correo falla, la cuenta queda y se registra el error (sin correo ni token); la persona pide otro enlace con «Reenviar» (PN-59, abajo).
- **Límite por origen (D-140):** 20 intentos por hora, **todos**: correos nuevos, correos ya registrados, contraseñas rechazadas y JSON roto. El 21 es `429 {"error":"demasiados_intentos"}` con el mismo cuerpo siempre. El origen es la IP del otro extremo de la conexión (para IPv6, el prefijo /64) y vive solo en la memoria del limitador; **no se lee `X-Forwarded-For`**: detrás de Azure Container Apps hay que confiar solo en la dirección que agrega su entrada (fila 17 del primer despliegue, D-143 (4); ver «Gaps»). **Límite por dirección (D-140):** como máximo 3 correos por hora a una misma dirección, sumando el de verificación y el aviso de abajo; el correo que no sale por el límite no cambia la respuesta.

### Correo que ya tiene cuenta (D-141)

La respuesta nunca revela si el correo estaba registrado, ni da la sesión de esa cuenta.

| El correo… | Qué pasa | Sesión | Correo |
|---|---|---|---|
| no tiene cuenta | se crea | limitada real | verificación |
| tiene una cuenta **sin verificar** | se **borra** la pendiente (`ON DELETE CASCADE` se lleva sus sesiones y enlaces) y se crea de nuevo con la contraseña de ahora. Evita el *pre-hijacking*: crear una cuenta con un correo ajeno y esperar a que su dueña la verifique | limitada real nueva; la anterior y su enlace dejan de servir | verificación nueva (el enlace anterior ya no sirve) |
| tiene una cuenta **verificada** | no se toca nada | **de mentira** (abajo) | aviso «Alguien intentó crear una cuenta con tu correo» al dueño |

- **Sesión de mentira** (`sesion.Senuelos`, ver [Sesiones](#sesión-de-mentira-firmada-d-141-d-143-2)): un token firmado con HMAC y la clave `SESION_SENUELO_CLAVE`, del mismo formato y largo que uno real (43 caracteres). **No se guarda en ningún lado:** el API lo reconoce con la clave, así que sobrevive a un reinicio y funciona con varias réplicas. No está en la base ni apunta a ninguna cuenta. El router la trata como la limitada real **en todas las rutas** (`seguridad.Sujeto.Senuelo`): `sin_verificar` pasa; `sin_autorizacion` y `requiere_autorizacion` dan `403 verificacion_pendiente`.
- **Argon2id corre antes de saber en cuál caso estamos**, y los dos casos mandan un correo en segundo plano: el tiempo de respuesta tampoco los delata.
- **No se distingue** (SEG-013): mismo estado, mismas cabeceras (los nombres), mismos atributos de la cookie, mismo formato y largo del token y mismo cuerpo, en la web y en Android. Lo prueban `TestCrearCuentaNoSeDistingueEntreCorreoNuevoSinVerificarYVerificado` (que además comprueba que Argon2id corre una vez en cada caso, sin medir tiempos de reloj, que serían frágiles) y, contra la base, `TestPuntaAPuntaConElEnrutadorYLaBase`.
- **Aviso al dueño** (`correo.EnviarAvisoDeCorreoRegistrado`): asunto y cuerpo de E14-PCP 4.2 bis palabra por palabra (**texto propuesto, lo revisa el dueño**), pie «Si tienes dudas sobre tus datos, escribe a `CORREO_PRIVACIDAD`.» Sin enlaces ni contraseñas, desde `CORREO_REMITENTE`.
- Nunca se registran tokens, correos ni cuerpos.

- **Android** (D-143 (3)): con `X-Alcanzamos-Cliente: android` el token va en el cuerpo (`{"estado":"verificacion_pendiente","token":"…"}`) y no hay `Set-Cookie`. Si el pedido trae `Origin` o `Sec-Fetch-Site`, responde `400 {"error":"solicitud_invalida"}` sin token ni cookie y sin crear nada (`sesion.EntregaDe`; ver [Sesiones](#token-para-android-d-143-3)). La decisión solo depende de las cabeceras, así que no delata si el correo estaba registrado. El pedido cuenta contra el límite del origen como cualquier intento. `TestAndroidConCabecerasDeNavegadorSeRechaza` lo prueba con y sin cuenta verificada.

### Verificar el correo y las acciones de PN-59

| Ruta | Nivel | Qué hace |
|---|---|---|
| `POST /api/v1/cuentas/verificacion` | `publica` | Confirma el correo con `{token}` (PN-59). El token del enlace es la autoridad |
| `GET /api/v1/cuentas/estado` | `sin_verificar` | «Ya lo confirmé»: `{"verificada":bool}` |
| `POST /api/v1/cuentas/verificacion/reenvio` | `sin_verificar` | «Reenviar el correo»: invalida los enlaces pendientes y manda uno nuevo |
| `POST /api/v1/cuentas/correo` | `sin_verificar` | «Cambiar el correo»: `{correo}` |

- **Verificar.** Un enlace vigente y sin usar marca `usado_en` y `correo_verificado = true` en una transacción y responde `200 {"estado":"verificado","con_sesion":bool}`. **Funciona en cualquier dispositivo, con o sin sesión:** `con_sesion` es verdadero solo si la petición trae la sesión real de la cuenta que se acaba de verificar. El cliente muestra «Listo, confirmamos tu correo.» y, con sesión, sigue a PN-63; sin ella (el enlace se abrió en otro dispositivo, o en otro navegador) sigue a PN-60 para entrar. Cualquier otro caso (usado, vencido, anulado, inexistente o mal formado) da `400 {"error":"enlace_invalido"}` («Ese enlace ya no sirve.»).
- **Estado.** `{"verificada":false}` para la sesión limitada (y para la de mentira, siempre); `true` si la cuenta ya se verificó, por ejemplo desde otro dispositivo, con la misma sesión: por eso las rutas `sin_verificar` también las pasa una cuenta verificada.
- **Reenviar.** `202 {"estado":"verificacion_pendiente"}`. Además de la **espera corta** de E14 (30 segundos entre un reenvío y el siguiente, `seguridad.EsperaCortaDeReenvio`; documentada en E14-PCP 4.2 desde la v1.12, D-143 (5)) tiene los límites de la recuperación: **3 por hora por cuenta y 20 por origen** (D-138 (2)) y 3 correos por hora a la dirección (D-140). La espera corta y los límites de la hora dan el mismo `429 {"error":"demasiados_intentos"}` (el «mismo texto de espera» de E14). Un reenvío frenado no cuenta. Con la cuenta ya verificada: `409 {"error":"ya_verificada"}`. Si el límite de la dirección impide el envío, la respuesta es la misma que si hubiera salido.
- **Cambiar el correo.** Valida el correo nuevo como PN-58 (`422 validacion` con `correo_vacio` o `correo_invalido`), **invalida los enlaces pendientes** (el del correo anterior deja de servir), cambia el correo y manda un enlace de 24 horas al nuevo. Cuenta contra los mismos límites que el reenvío. Con un correo nuevo que ya existe aplica D-141: si es el de **otra cuenta sin verificar**, esa se borra y la cuenta se queda con el correo; si es el de una **cuenta verificada**, no cambia nada de la cuenta (conserva su correo, con los enlaces pendientes anulados), al dueño le llega el aviso y la respuesta es la misma. El mismo correo de la cuenta solo renueva el enlace.
- **Con la sesión de mentira** (D-141): cada una de estas acciones responde **igual** que con la sesión limitada de una cuenta real, también los `429` y los `422`. Cuenta contra los mismos límites (su token hace de cuenta) y valida igual; lo único que no hace es tocar la base ni escribirle a nadie: no tiene dirección y no se le escribe a quien no lo pidió. `TestLasAccionesDePN59RespondenIgualConLaSesionDeMentira` recorre un guion de 14 pasos (éxitos, espera corta, límite de la hora, validaciones y el correo de una cuenta verificada) y compara el estado, las cabeceras y el cuerpo de cada respuesta.
- **Ninguna de estas rutas manda texto** a la persona: los clientes toman los de E14-PCP.
- **Con un reinicio.** La sesión de mentira es un token firmado, no una fila ni una entrada en memoria: tras reiniciar el API (o en otra réplica con la misma `SESION_SENUELO_CLAVE`) cada acción responde lo mismo que antes y lo mismo que una sesión limitada real. Lo prueba `TestLaSesionDeMentiraRespondeIgualTrasUnReinicio`, que crea la sesión con un servidor, arma uno nuevo y una réplica con la misma clave sobre la misma base, y compara las seis respuestas de un guion; con otra clave el token da `401`. Los contadores de límites sí se reinician (viven en la memoria, D-123), igual para la sesión real y para la de mentira.

## Sesiones (US-49)

Es la capa de sesiones: el `Enrutador` resuelve la sesión de cada pedido con `sesion.Resolutor`, y la crean `POST /api/v1/cuentas` (arriba) y `POST /api/v1/sesiones` (abajo).

- **Almacén en PostgreSQL** (`pg.Sesiones`, E13 §5.3, D-081): `sesion` guarda solo el SHA-256 del token. Vencimiento **deslizante de 30 días** con **tope de 90 días** desde la creación (`vence_en = menor(ahora + 30 días, creada_en + 90 días)`). `ultimo_uso_en` solo se escribe si pasaron **más de 5 minutos** desde el anterior. **Máximo 5 sesiones por persona:** al crear una más se borran las menos recientes en la misma transacción. Cada sesión lleva un token nuevo. En cada petición se lee si la cuenta confirmó el correo y si tiene autorizadas las finalidades necesarias de su etapa (`ReglaDeFinalidades`), sin guardarlo: retirar una autorización surte efecto al instante.
- **Web: cookie `__Host-sesion`** con `HttpOnly; Secure; SameSite=Strict; Path=/` y `Max-Age=7776000` (90 días, el tope; el vencimiento real lo decide el servidor). El prefijo `__Host-` hace que el navegador exija `Secure` y `Path=/` y no deje fijarla a un subdominio.
- **Android: `Authorization: Bearer <token>`.** La web y Android se resuelven igual (gana el encabezado si vienen los dos). Un token ausente, mal formado o desconocido es `401 sin_sesion`.
- **Resolución** (`sesion.Resolutor`): consulta siempre el almacén real primero y, si no hay sesión, mira si el token es de mentira. Un fallo del almacén no se confunde con «sin sesión».

### Sesión de mentira firmada (D-141, D-143 (2))

Cuando alguien crea una cuenta con el correo de una ya verificada, la respuesta es idéntica a la de una cuenta nueva y lleva un token de mentira (`POST /api/v1/cuentas`). **No se guarda en ningún lado.** Si se guardara en memoria, un reinicio del API lo borraría y la sesión real no, y esa diferencia las distinguiría. Es un token firmado que el API reconoce con una clave de la configuración (`SESION_SENUELO_CLAVE`), así que sobrevive a un reinicio y lo reconoce cualquier réplica con la misma clave. No hay mapa en memoria ni tarea de purga.

```
token = base64url sin relleno( aleatorio(16) ‖ HMAC-SHA-256(clave, aleatorio ‖ día de creación "AAAA-MM-DD" en UTC)[:16] )
```

- Son 32 bytes y **43 caracteres**, igual que un token real (`seguridad.NuevoTokenOpaco`): mismo formato y mismo largo; la cookie y el cuerpo son los mismos.
- **Reconocimiento sin almacenar** (`Senuelos.Reconoce`): si el almacén real no tiene la sesión, se recalcula la firma para cada día de creación **de hoy menos 7 días hasta hoy, ambos incluidos** (8 días de calendario UTC; los 7 días de D-135). Un token creado el día D se reconoce hasta que termina el día D+7: entre 7 y 8 días después de crearse, según la hora. Se calculan siempre los 8 HMAC y se comparan en tiempo constante. Un token de un día futuro no se acepta.
- **Qué prueba cada cosa** (`senuelos_test.go`): una instancia nueva con la misma clave (reinicio) y una segunda (réplica) lo reconocen; otra clave no; vence al terminar el día D+7 con el reloj inyectado; un token aleatorio de 32 bytes no es de mentira; mismo formato y largo; y `TestPuntaAPuntaConElEnrutadorYLaBase` lo recorre contra la base.
- Rotar la clave invalida todas las sesiones de mentira vivas (y solo esas): quien tenga una recibirá `401`, mientras que las reales siguen. Es un efecto aceptado, ver «Gaps».

### Token para Android (D-143 (3))

Android no tiene cookies. Al crear la cuenta manda `X-Alcanzamos-Cliente: android` y recibe el token en el cuerpo, para guardarlo y mandarlo después en `Authorization: Bearer`. La web lo recibe solo en la cookie `HttpOnly`, que su JavaScript no puede leer.

`sesion.EntregaDe(r)` decide cómo entregar el token:

| `X-Alcanzamos-Cliente` | `Origin` o `Sec-Fetch-Site` | Resultado |
|---|---|---|
| ausente o distinto de `android` | cualquiera | cookie (camino de la web, sin cambios) |
| `android` | ninguno de los dos | token en el cuerpo, sin `Set-Cookie` |
| `android` | alguno presente, con **cualquier valor** | `400 {"error":"solicitud_invalida"}`, sin token ni `Set-Cookie` |

Los navegadores mandan `Origin` o `Sec-Fetch-Site` siempre y un script de una página no puede quitarlos (son cabeceras prohibidas para `fetch`): así un script de la web no puede pedir el token en el cuerpo para saltarse la cookie `HttpOnly`. La app de Android no las manda. Una prueba de tabla cubre cada combinación.

## Entrar y salir (US-49 parte 2)

| Ruta | Nivel | Qué hace |
|---|---|---|
| `POST /api/v1/sesiones` | `publica` | Inicia sesión (CU-52, PN-60). Cuerpo: `{identificador, contrasena}` |
| `DELETE /api/v1/sesiones/actual` | `sin_verificar` | Cierra la sesión de la petición, cualquiera: real, limitada o de mentira |
| `GET /api/v1/cuenta/seguridad` | `requiere_autorizacion` | El ingreso anterior (PN-71, RF-062) |
| `POST /api/v1/recuperacion` | `publica` | Pide el enlace para elegir una contraseña nueva (PN-61, RF-036). Cuerpo: `{correo}` |
| `POST /api/v1/recuperacion/contrasena` | `publica` | Elige la contraseña nueva con el enlace (PN-62). Cuerpo: `{token, contrasena}` |
| `POST /api/v1/cuenta/contrasena` | `requiere_autorizacion` | Cambia la contraseña con la sesión iniciada (PN-73, RF-065). Cuerpo: `{contrasena_actual, contrasena_nueva}` |

Código en `internal/autenticacion` (`Servicio` y `Handler`; E12 `AutenticacionServicio`) y `pg.Autenticacion`.

### Iniciar sesión

- **«Identificador» genérico** (D-137 (3)). Hoy solo se acepta un correo; el nombre de usuario de los menores llega en I11 sin cambiar el contrato. Un identificador que no sea un correo se trata como una cuenta que no existe: el mismo `401`, con Argon2id contra el hash de relleno. Sin identificador o sin contraseña: `422 {"error":"validacion","campos":{...}}` con `identificador_vacio` y `contrasena_vacia`, sin contar ni calcular nada.
- **Respuesta.** `200` con `Cache-Control: no-store` y `{"estado":"activa"}` si el correo ya se confirmó, o `{"estado":"verificacion_pendiente"}` si no: es la **sesión limitada** de D-138 y el cliente sigue a PN-59 (D-138). Lo que esa cuenta puede hacer después lo decide el `Enrutador` ruta por ruta. La entrega del token es la de crear la cuenta (`sesion.EntregaDe`): cookie `__Host-sesion` en la web; con `X-Alcanzamos-Cliente: android`, el token en el cuerpo (`{"estado":…,"token":"…"}`), y `400 solicitud_invalida` si el pedido trae `Origin` o `Sec-Fetch-Site` (D-143 (3)).
- **Token nuevo en cada inicio** (contra la fijación de sesión) y el máximo de 5 sesiones por persona de E13 §5.3: al iniciar la sexta se borra la menos reciente.
- **Límites (D-136).** 5 fallos por identificador y 20 por origen en 15 minutos (el identificador se compara en minúsculas y sin espacios). Es una espera: pasados los 15 minutos se puede intentar de nuevo. Con el límite alcanzado responde `429 {"error":"demasiados_intentos"}` **aunque la contraseña sea la correcta**, igual exista o no la cuenta, y sin calcular Argon2id. Solo cuentan los fallos, no los éxitos.
- **No revela si la cuenta existe** (CU-52 2a, RNF-014). Contraseña incorrecta, cuenta inexistente e identificador que no es un correo dan el mismo `401 {"error":"credenciales_invalidas"}` con las mismas cabeceras, y Argon2id corre **una vez** en cada caso (contra un hash de relleno que se calcula al arrancar). `TestElFalloEsIgualYArgon2idCorreUnaVezEnCadaCaso` lo prueba contando las llamadas al hasheador, sin medir tiempos de reloj.
- **Sube el hash de parámetros viejos (D-144, E12 `HasherArgon2id.NecesitaMejora`, ADR-002 §5.1).** Tras verificar la contraseña, si el hash guardado tiene memoria, iteraciones o paralelismo **menores** que los vigentes (o sal o clave más cortas), se calcula un hash nuevo con la misma contraseña, **fuera de la transacción** y con el mismo cupo de 4 operaciones de Argon2id, y se guarda en la misma transacción que la sesión y el ingreso anterior. Solo reemplaza el hash si sigue siendo el que se verificó (un cambio de contraseña en medio no se pisa). Si no se puede calcular, se registra sin correo, contraseña ni hash y se entra igual con el hash viejo. Con parámetros iguales o mayores no se toca. Pruebas: `TestNecesitaMejora` (`argon2id`), `TestIniciarSesionSubeElHashSoloSiTieneParametrosViejos` y `TestFallarAlSubirElHashNoImpideEntrar` (servicio), y contra la base `TestIniciarSesionSubeElHashDeParametrosViejos`, `TestIniciarSesionConParametrosVigentesNoReescribeElHash` y `TestLaMejoraDelHashNoPisaUnHashQueCambio`.
- **Eventos (D-136 (3), RNF-025).** Cada fallo (`401`) **y cada intento frenado** (`429`) deja `inicio_sesion_fallido`, con `cuenta` `desconocida` (no se atribuye ni cuando la cuenta existe, para que el registro tampoco la delate) y sin identificador ni origen.
- **Último ingreso (D-134).** Con la contraseña correcta, **en la misma transacción que inserta la sesión**: `credencial.ingreso_anterior = ultimo_ingreso` y `ultimo_ingreso = ahora` (la hora del `Reloj`, en UTC). En el primer ingreso `ingreso_anterior` queda `NULL`. Si la sesión no se puede guardar, el ingreso no se mueve. Solo fecha y hora, sin IP ni dispositivo (NM-03, D-123). Pruebas: `TestElIngresoAnteriorSeMueveEnLaMismaTransaccionQueLaSesion` (incluye el primer ingreso) y `TestUnInicioFallidoNoMueveElIngreso`.

### Cerrar sesión

`DELETE /api/v1/sesiones/actual` borra la fila de la sesión de la petición (revocar es borrar) y responde `204`. Siempre manda `Set-Cookie: __Host-sesion=; Max-Age=0` con los mismos atributos que la cookie de sesión (también en Android, donde no hace nada). La sesión de mentira de D-141 no tiene fila: responde **exactamente igual** (`TestCerrarSesionDeMentiraRespondeIgual` y, contra la base, `TestCerrarSesionDeMentiraRespondeIgualQueLaLimitada`). Una segunda llamada con el mismo token ya no tiene sesión: `401 sin_sesion`.

### Seguridad de la cuenta (PN-71)

`GET /api/v1/cuenta/seguridad` responde `{"ingreso_anterior":"2026-11-02T02:40:00Z"}` (RFC 3339 en UTC) o `{"ingreso_anterior":null}`. El cliente pone en `null` «Este es tu primer ingreso.» y convierte la fecha a su zona. Es el ingreso **anterior**, nunca el de la sesión de ahora. Con la cuenta sin autorizar o con la sesión limitada o de mentira lo niega el `Enrutador` (`403`).

### Recuperar el acceso (PN-61 y PN-62, RF-036)

- **Pedir el enlace** (`POST /api/v1/recuperacion`, `{correo}`). **Responde siempre** `202 {"estado":"enlace_enviado"}` si el correo está bien escrito, tenga cuenta o no: mismo estado, mismas cabeceras y mismo cuerpo (CU-44 2a). Un correo vacío o sin dominio da `422 validacion` (`correo_vacio` o `correo_invalido`), que no depende de la cuenta.
  - Cuenta con el correo **verificado** (en el trabajador, ver abajo): se borran los enlaces de recuperación pendientes (pedir uno nuevo invalida los anteriores, E13 §5.4) y se guarda uno nuevo, con un token de 32 bytes (en la base solo su SHA-256) que **vence a la hora y sirve una vez**. El correo lleva `URL_PUBLICA/recuperar?t=<token>` y termina con el pie de D-143.
  - **Cuenta sin verificar: no se manda nada**, con la misma respuesta (ver «Gaps»).
  - **Fuera del pedido (D-144).** Responder distinto de prisa o despacio delataría qué correos están registrados (lo mismo que cuidó D-141), así que el pedido hace siempre el mismo trabajo y no toca la cuenta: valida el correo, cuenta los límites (por correo normalizado y por origen, exista o no la cuenta), pone el correo en una cola y responde `202` enseguida. Un trabajador (`Servicio.Iniciar`; 2 trabajadores y una cola de 64, `Dependencias.TrabajadoresDeRecuperacion` y `ColaDeRecuperacion`) busca la cuenta, guarda el enlace, aplica el tope de 3 correos por hora a la dirección y manda el correo. Con la cola llena, el trabajo se descarta y se registra sin el correo; la respuesta es la misma. **Un correo perdido (cola llena, fallo del envío, apagado) se recupera pidiéndolo otra vez**, sin que el cliente lo note. Al apagar, el contexto del servidor detiene a los trabajadores: el trabajo en curso termina, lo que sigue en la cola se descarta (con su cuenta en el registro) y `Esperar` vuelve antes de cerrar la base. Pruebas, sin medir tiempos de reloj: `TestElPedidoDeRecuperacionNoTocaLaCuentaYRespondeIgualEnLosTresCasos` (la base y el correo no se llaman durante el pedido; mismo estado, cabeceras y cuerpo con cuenta verificada, sin verificar y sin cuenta), `TestElPedidoNoEsperaALaConsultaDeLaCuenta`, `TestLosLimitesDeLaRecuperacionNoDependenDeLaCuenta`, `TestConLaColaLlenaLaRecuperacionRespondeIgualYSeDescarta`, `TestLosTrabajadoresParanConElContexto` y, con el enrutador y PostgreSQL, `TestLaRecuperacionRespondeIgualYSaleDelPedido`.
  - Sin cuenta: no se hace nada.
- **Límites.** D-136 (4): **3 pedidos por hora por correo y 20 por origen**, exista o no la cuenta; el siguiente es `429 {"error":"demasiados_intentos"}`, idéntico para todos, y un pedido frenado no cuenta. D-140: como máximo **3 correos por hora a una misma dirección** (suma verificación, reenvíos, aviso y recuperación); si la dirección ya llegó al tope, la respuesta es la misma y el correo no sale. La recuperación tiene su propio contador: no mezcla con el del inicio de sesión.
- **Elegir la contraseña** (`POST /api/v1/recuperacion/contrasena`, `{token, contrasena}`). Primero mira el enlace, sin calcular nada: inexistente, mal formado, usado, vencido o de otro propósito (el de verificación no sirve aquí ni al revés) da `400 {"error":"enlace_invalido"}` («Ese enlace ya no sirve.»). Después aplica la política de contraseñas con el correo de la cuenta (`contrasena_personal`, D-142): si no cumple, `422 validacion` con el código en `contrasena` y **el enlace no se gasta**, así la persona corrige y vuelve a intentar.
- **Al guardar, en una sola transacción:** se marca el enlace usado (un `UPDATE` con las condiciones en el `WHERE`, atómico: de varios usos simultáneos pasa uno), se guarda el hash Argon2id nuevo y se **borran todas las sesiones de la persona**, la actual incluida (recuperar significa que la contraseña vieja pudo estar comprometida). Responde `200 {"estado":"contrasena_cambiada"}` **sin iniciar sesión** y sin cookie: el cliente va a PN-60 con «Listo, cambiaste tu contraseña.» E12 (s2, CU-44) y E14 (PN-62) dicen lo mismo: no hay inicio automático.
- Pruebas: `TestRecuperarElAccesoCierraTodasLasSesiones`, `TestElEnlaceDeRecuperacionVenceALaHora`, `TestPedirOtroEnlaceDeRecuperacionInvalidaLosPendientes`, `TestRecuperacionSoloParaCuentasVerificadas`, `TestLosEnlacesNoSeIntercambian` y `TestDosUsosSimultaneosDelEnlaceSoloPasaUno` (contra la base); las del 429, de los 3 correos por hora y de la política, en `internal/autenticacion/contrasenas_test.go`.

### Cambiar la contraseña con la sesión iniciada (PN-73, RF-065, D-090)

`POST /api/v1/cuenta/contrasena`, `{contrasena_actual, contrasena_nueva}`, nivel `requiere_autorizacion`.

- La de ahora se verifica con Argon2id. Si no es la de la cuenta: `400 {"error":"contrasena_actual_incorrecta"}` («No pudimos confirmar tu contraseña de ahora. Escríbela de nuevo.»). **Cuenta como un fallo del mismo límite por cuenta del inicio de sesión** (D-136: 5 en 15 minutos por correo, y 20 por origen) y deja `inicio_sesion_fallido` con la cuenta (aquí quien llama ya tiene sesión, así que se atribuye). Con el límite alcanzado: `429 demasiados_intentos`, también con evento, **aunque la de ahora sea la correcta**. Los dos caminos comparten el contador, así que el cambio de contraseña no da cinco intentos más para adivinar la contraseña.
- La nueva pasa la política con el correo de la cuenta: `422 validacion` con el código en `contrasena_nueva`; sin la de ahora, `contrasena_actual: contrasena_vacia`.
- **En una transacción:** hash nuevo y se borran todas las **demás** sesiones de la persona, **menos la actual** (la de la cookie o el `Bearer` de la petición, D-090). `200 {"estado":"contrasena_cambiada"}`; el cliente vuelve a PN-71 con «Listo, cambiamos tu contraseña. Cerramos tus otras sesiones. Esta sigue abierta.»
- Pruebas: `TestCambiarLaContrasenaCierraLasOtrasSesionesYConservaLaActual` (cuatro sesiones: la de crear la cuenta y tres de inicio de sesión; cambia desde una, las demás dan `401` y la actual sigue), `TestCambiarLaContrasenaConLaActualIncorrectaNoCambiaNada`, `TestLaContrasenaActualIncorrectaCuentaComoFalloDeIngreso`.

### Códigos de error para los clientes (iniciar sesión, recuperar y cambiar la contraseña)

| Ruta | Estado | `error` | Para el cliente |
|---|---|---|---|
| `POST /api/v1/sesiones` | 401 | `credenciales_invalidas` | PN-60 «Datos que no coinciden» |
| `POST /api/v1/sesiones` | 429 | `demasiados_intentos` | PN-60 «Demasiados intentos» |
| `POST /api/v1/sesiones` | 422 | `validacion` (`identificador_vacio`, `contrasena_vacia`) | errores de campo de PN-60 |
| `POST /api/v1/sesiones` | 400 | `solicitud_invalida` | cuerpo roto, campo desconocido, o modo Android con cabeceras de navegador |
| `POST /api/v1/recuperacion` | 202 | — (`estado: enlace_enviado`) | PN-61 «Enlace enviado», tenga cuenta o no |
| `POST /api/v1/recuperacion` | 422 | `validacion` (`correo_vacio`, `correo_invalido`) | errores de campo de PN-61 |
| `POST /api/v1/recuperacion` | 429 | `demasiados_intentos` | PN-61 «Demasiados intentos» |
| `POST /api/v1/recuperacion/contrasena` | 200 | — (`estado: contrasena_cambiada`) | a PN-60 con «Listo, cambiaste tu contraseña.» |
| `POST /api/v1/recuperacion/contrasena` | 400 | `enlace_invalido` | PN-62 «Enlace vencido» («Ese enlace ya no sirve.») |
| `POST /api/v1/recuperacion/contrasena` | 422 | `validacion` (`contrasena`: `contrasena_vacia`, `contrasena_corta`, `contrasena_comun`, `contrasena_personal`) | errores de campo de PN-62 |
| `POST /api/v1/cuenta/contrasena` | 200 | — (`estado: contrasena_cambiada`) | a PN-71 con el aviso de logro |
| `POST /api/v1/cuenta/contrasena` | 400 | `contrasena_actual_incorrecta` | PN-73 «No pudimos confirmar tu contraseña de ahora…» |
| `POST /api/v1/cuenta/contrasena` | 422 | `validacion` (`contrasena_actual`: `contrasena_vacia`; `contrasena_nueva`: los de la política) | errores de campo de PN-73 |
| `POST /api/v1/cuenta/contrasena` | 429 | `demasiados_intentos` | PN-73, mismo texto de espera que PN-60 |
| las de `/api/` que piden sesión | 401 | `sin_sesion` | PN-60 «Sesión cerrada» |
| `GET /api/v1/cuenta/seguridad` | 403 | `verificacion_pendiente`, `autorizacion_pendiente` | el cliente sigue a PN-59 o a PN-63 |

## Gaps de la US-49

- **Origen detrás de un proxy:** el límite por origen usa la dirección de la conexión. Detrás de Azure Container Apps todos los pedidos llegarían con la dirección de su entrada y el límite se volvería de todos juntos. Es la fila 17 del primer despliegue (D-143 (4)): se confiará solo en la dirección que agregue esa entrada. No se lee `X-Forwarded-For` mientras tanto.
- **Rotar `SESION_SENUELO_CLAVE`** deja sin sesión (401) a quien tenga una de mentira viva, a lo sumo 8 días de cuentas con un correo ajeno ya verificado. No hay clave anterior ni lista de claves: se evitó la complejidad. Si hace falta rotarla sin ese efecto, habría que aceptar dos claves.
- **Holgura de un día:** una sesión de mentira vive hasta el final del día D+7 (UTC), hasta un día más que la cuenta sin verificar que imita (D-135); en la práctica la tarea diaria que borra la cuenta real tiene la misma holgura.
- **Recuperar con la cuenta sin verificar (decisión conservadora):** no se manda enlace y la respuesta es la misma. Quien no confirmó su correo no tiene qué recuperar y un enlace a una dirección que nadie confirmó daría a quien la escribió una puerta a la cuenta; esa persona vuelve a crear la cuenta y D-141 reemplaza la pendiente con la contraseña de ahora. El cliente no distingue el caso (E14-PCP 4.4 no pide uno). Si el dueño prefiere mandar el enlace de verificación en su lugar, es un cambio de `procesarRecuperacion` (el trabajador); hoy no lo hace.
- **Texto del correo de recuperación:** E14-PCP solo dice que lleva el pie de D-143; el asunto («Recupera el acceso a tu cuenta de Alcanzamos») y el cuerpo son una **propuesta que revisa el dueño** (`correo.mensajeDeRecuperacion`).
- **Recuperar y cambiar la contraseña de un menor:** el menor no tiene correo (no hay enlace) y PN-73 le llega con I11, cuando exista su inicio de sesión; por ahora `requiere_autorizacion` lo deja fuera.
- **Hash de relleno y parámetros nuevos:** el hash de relleno se calcula al arrancar con los parámetros del `Hasheador`; si estos suben, hay que reiniciar para que el relleno los siga (la mejora de hashes ya existe, D-144, ver «Iniciar sesión»).
- **Inicio de sesión de menores y de cuentas con credencial temporal:** solo entra quien tiene correo (I11 suma el nombre de usuario; la exigencia de fijar contraseña propia, NM-14, tampoco está).
- **Respuesta `200` al iniciar sesión** (no `201`) y `204` al cerrar: E12 no fija el código; la web y Android solo dependen del cuerpo.
- **Menores:** una persona menor no tiene correo que verificar y su `Verificada` queda en falso: no llega más allá de las rutas `sin_verificar` hasta que I11 defina su ingreso.
- **La espera corta y el límite de la hora dan el mismo código** (`demasiados_intentos`): E14 dice que comparten texto.
- **Una cuenta verificada en una ruta `sin_verificar`:** se dejó pasar (para que «Ya lo confirmé» conteste «verificada» con la misma sesión), aunque E12 dice que cada nivel incluye solo lo que dice. Reenviar y cambiar el correo responden `409 ya_verificada`.
- **Cambiar el correo al de una cuenta verificada:** la cuenta queda con su correo anterior y sin enlace vigente (el cliente ya mostró «Revisa tu correo»); la persona puede pedir otro con «Reenviar». Alternativa descartada: dejar vivo el enlace del correo anterior, que verificaría una cuenta que la persona ya quiso cambiar.
- **Contadores y réplicas:** los contadores de los límites y la espera de 30 segundos viven en la memoria de cada réplica (D-123): con varias, cada una cuenta aparte. No afecta a la sesión de mentira, que se reconoce sin estado.

## Imagen

- Tres etapas: `node:24.22.1-alpine3.24` (digest `sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53`, índice multiarquitectura, resuelto el 2026-10-22; mismo Node que `.azure-pipelines/web.yml`) hace `npm ci` y `npm run build` en `web/` (necesita `diseno/`); `golang:1.27.3-alpine3.24` (digest `sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c`, índice multiarquitectura, resuelto el 2026-10-22) copia ese `web/dist` a `internal/web/estatico/` y compila un binario estático con la web embebida; `gcr.io/distroless/static-debian13:nonroot` lo ejecuta, fijada por digest `sha256:d62067879de890a1def9da0e7766b7d20810a5e5555cef8506b752437d7a3e88` (índice multiarquitectura, resuelto el 2026-10-22).
- El contexto es la raíz del monorepo; el `.dockerignore` de la raíz deja pasar solo `api/`, `web/` y `diseno/`.
- Distroless no trae shell, así que no hay `HEALTHCHECK` ni comandos en forma de shell; la salud se consulta por `/salud` desde fuera.
- Corre como usuario 65532 (nonroot), sin root. El `ENTRYPOINT` es el binario.
- Go 1.27.3 (go.dev, 2026-10-22; SHA-256 del tarball `65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40`, fijado en `.azure-pipelines/api.yml`).

## Base de datos y migraciones

- `pgx` v5 (`pgxpool`) conecta con PostgreSQL. La URL sale de `BASE_DE_DATOS_URL`.
- `goose` v3 se usa como biblioteca. Las migraciones van embebidas en el binario (`embed`).
- `api migrar` aplica las migraciones pendientes y termina.
- `0001_esquema_inicial.sql`, `0002_catalogo.sql` y `0003_ingreso_anterior.sql` (la columna `credencial.ingreso_anterior`, D-134) son copia idéntica de las de E13 (D-122). No se editan aquí. Si hay que cambiar algo, el cambio vuelve primero a E13, con nota fechada y versión nueva.

| Archivo | SHA-256 (igual en E13 y aquí) |
|---|---|
| `migraciones/0001_esquema_inicial.sql` | `1244bc98f8218c202851a2a7cc18ae212b0c5a316d9238220e55ff48f351ab30` |
| `migraciones/0002_catalogo.sql` | `f95c1a03e3a956cec11b448d913ebb79df5c96c72f1e475b446a35566c36de3b` |
| `migraciones/0003_ingreso_anterior.sql` | `005fb34328e7ab1a2bc2842ffa722b7b2f3fb3382e4adbdc216ed6a7c0ff87c5` |

`migraciones_test.go` compara el SHA-256 de cada archivo embebido con el de esta tabla. `TestMigracion0003AgregaYQuitaIngresoAnterior` comprueba que la columna (`timestamptz`) existe tras subir y no existe tras bajar solo esa migración.

Prueba de integración (PostgreSQL 18 del compose local; deja la base sin tablas):

```sh
POSTGRES_PORT=55432 docker compose -f infra/local/compose.yaml --env-file infra/local/.env.example up -d --wait postgres
cd api
BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@127.0.0.1:55432/alcanzamos go test -race -tags integration ./...
docker compose -f ../infra/local/compose.yaml --env-file ../infra/local/.env.example down -v
```

## Dependencias

Últimas versiones estables, verificadas en `proxy.golang.org` el 2026-10-22.

| Módulo | Versión | Licencia |
|---|---|---|
| `github.com/jackc/pgx/v5` | v5.11.0 (2026-09-07) | MIT |
| `github.com/pressly/goose/v3` | v3.29.0 (2026-10-11) | MIT |
| `golang.org/x/crypto` | v0.58.0 (2026-10-09) | BSD de 3 cláusulas |

Indirectas: `pgpassfile`, `pgservicefile`, `puddle/v2`, `mfridman/interpolate`, `multierr` (MIT), `go-retry` (Apache-2.0), `x/sync` y `x/text` (BSD de 3 cláusulas). Todas son compatibles con la AGPLv3.

## Contraseñas (Argon2id)

- Paquete `internal/argon2id`, sobre `golang.org/x/crypto/argon2`. Lo usa `cuenta.Servicio` al crear la cuenta. La política de contraseñas está en [Seguridad](#política-de-contraseñas-politicadecontrasena-rf-035-d-089-d-142).
- Parámetros OWASP: 19 MiB, 2 iteraciones, paralelismo 1. Sal de 16 bytes, clave de 32.
- Formato PHC: `$argon2id$v=19$m=19456,t=2,p=1$<sal>$<clave>`, base64 sin relleno.
- `Verificar` lee los parámetros del hash y compara en tiempo constante. Rechaza hashes con parámetros fuera de tope (memoria máxima 256 MiB).
- `NecesitaMejora` dice si un hash guardado quedó por debajo de los parámetros del `Hasher` (cualquiera de memoria, iteraciones o paralelismo menor, o sal o clave más cortas); un hash mal formado da `ErrFormato`. Lo usa el inicio de sesión (D-144).
- Un semáforo limita a 4 las operaciones simultáneas.
- Pruebas con los vectores Argon2id de la implementación de referencia (D-083): `src/test.c` de `P-H-C/phc-winner-argon2`, commit `92cd2e19b50b9a58d177e61e1d8ce925315d3d91` (último cambio del archivo; HEAD de `master` `f57e61e19229e23c4445b85494dbf7c07de721cb`, 2021-06-25). Los 8 vectores del bloque Argon2id no usan secreto ni datos asociados, así que aplican todos.
- Benchmark de una verificación: `go test -bench Verificar -run '^$' ./internal/argon2id`.

## Tareas programadas

- `api tareas` es el punto de entrada del trabajo programado (`tareas.Ejecutor`, E12 `EjecutorDeTareas`). Se conecta con PostgreSQL, corre cada tarea aunque otra falle, registra `tareas: inicio` y `tareas: fin` (con cuántas terminaron bien) y termina con código 0, o 1 si una tarea falla o no hay base.
- **`BorrarCuentasSinConfirmar` (D-135, DAT-006):** borra la `persona` (el `CASCADE` se lleva perfil, credencial, **sesiones**, enlaces y datos) de las cuentas adultas creadas hace 7 días o más que no confirmaron el correo **o** no tienen vigente cada finalidad necesaria de una persona adulta, otorgada por ella misma. **La lista sale de `cuenta.ReglaDeFinalidades` (D-139), no del SQL:** la consulta la recibe como parámetro. Sin correo de aviso. Nunca toca una cuenta con el correo confirmado y lo necesario autorizado. Excluye las cuentas que pasaron de menor a adulta (`fecha_de_paso`) y las de menores. Como `autorizacion` no tiene llave a la persona, las filas que hubiera quedan retiradas en ese instante y conservadas 3 años (E13 §7, plazo provisional). Es idempotente.
- **`LimpiarSesionesYEnlaces` (CU-52):** borra las filas de `sesion` y `enlace_un_uso` con `vence_en` anterior a ahora. Es idempotente.
- **Sesiones de mentira:** no hay nada que limpiar: no se guardan en ninguna parte (son tokens firmados, ver [Sesiones](#sesión-de-mentira-firmada-d-141-d-143-2)), así que no necesitan tarea de purga.
- Se prueba con la misma imagen del API:

```sh
docker run --rm --network alcanzamos-local_default \
  -e BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@postgres:5432/alcanzamos \
  alcanzamos-api:dev tareas
```

La imagen es la misma, con la web incluida.

## Medición de O-10

Método y cifras en [`MEDICION-O10.md`](MEDICION-O10.md).
