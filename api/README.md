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

Ningún dominio ni dirección va fija en el código (D-129). `config.Cargar` lee estas variables y, si falta alguna o no es válida, devuelve un error que las nombra todas. El comando `api` la exige al arrancar; `migrar` y `tareas` no la necesitan. `migrar` y `tareas` no la necesitan.

| Variable | Qué es | Ejemplo local (Mailpit de `infra/local`) |
|---|---|---|
| `BASE_DE_DATOS_URL` | Cadena de conexión de PostgreSQL | `postgres://alcanzamos:solo-local@127.0.0.1:5432/alcanzamos` |
| `CORREO_SMTP` | `host:puerto` del servidor SMTP. Usa STARTTLS si el servidor lo ofrece; todavía no autentica (el proveedor de producción está por definir, O-4) | `127.0.0.1:1025` |
| `CORREO_REMITENTE` | Dirección que envía; no recibe respuestas (D-120). El valor sale de la configuración, no del código | `no-responder@avisos.ejemplo.test` |
| `CORREO_PRIVACIDAD` | Dirección del pie de cada correo, donde escribir sobre los datos (D-120, RF-060) | `privacidad@ejemplo.test` |
| `URL_PUBLICA` | Base de los enlaces de los correos, sin parámetros; la barra final se quita. El enlace de verificación es `URL_PUBLICA/verificar?t=<token>` | `http://127.0.0.1:8080` |
| `SESION_SENUELO_CLAVE` | Clave que firma las sesiones de mentira (D-141, D-143 (2)). Base64 estándar o de URL; decodificada debe tener **32 bytes o más**. Obligatoria para `api`; nunca se registra ni sale en un error (`config.Clave` se imprime como `[oculta]`). Todas las réplicas deben tener la misma. Genera una con `openssl rand -base64 32` | `Zm9vLWJhci1iYXotcXV4LXF1dXgtY29ycmUtbG9jYWw=` (solo local) |
| `PUERTO` | Puerto del servidor (opcional, 8080) | `8080` |

`infra/local/` queda fuera de esta carpeta: para una variable nueva allí, copia la tabla a su `.env.example`. Las pruebas inyectan los valores (`config.Cargar` recibe la función de lectura del entorno).

## Acceso negado por defecto (RNF-012, D-138)

Toda ruta de `/api/` se registra con `Enrutador.Registrar(nivel, patron, manejador)` y **declara su nivel de acceso**. No existe un registro sin nivel: el valor cero, una ruta fuera de `/api/`, un patrón repetido (con el mismo nivel o con otro) o en conflicto hacen que `Construir` devuelva un error y el servidor no arranque. `Registrar` nunca hace `panic`. El nivel que se declara para «todo lo demás» es `requiere_autorizacion`: ante la duda, el más estricto.

| Nivel | Qué exige | Rutas |
|---|---|---|
| `publica` | nada | crear la cuenta; en el PR 6, verificar el correo con el enlace; en la US-49 parte 2, iniciar sesión y recuperar el acceso |
| `sin_verificar` | una sesión, aunque sea la **limitada** de una cuenta con el correo sin verificar (o la sesión de mentira de D-141) | PN-59: revisar el estado, reenviar, cambiar el correo; cerrar sesión |
| `sin_autorizacion` | cuenta con el correo **verificado**, aunque no haya autorizado lo necesario | cerrar sesión y las acciones de PN-63 y PN-64 (US-50) |
| `requiere_autorizacion` | cuenta verificada y con las finalidades necesarias de su etapa **autorizadas** (`ReglaDeFinalidades`) | todo lo demás |

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
| Inicio de sesión (cuenta los **fallos**) | 5 | 20 | 15 minutos | D-136 |
| Pedido del enlace de recuperación | 3 | 20 | 1 hora | D-136 (4) |
| Reenvío del correo de verificación y cambio de correo (contador propio) | 3 | 20 | 1 hora | D-138 (2) |
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

### Crear la cuenta

- **Respuesta.** `202 {"estado":"verificacion_pendiente"}` con la sesión (ver abajo), `Cache-Control: no-store`. `mayor_de_edad` debe ser `true` (la web lo manda desde la casilla de PN-58; Android, tras PN-65). **La fecha de nacimiento no se recibe ni se guarda:** un campo que no esté en el contrato da `400 solicitud_invalida` (D-089). Errores de campo: `422 {"error":"validacion","campos":{campo: código}}`, con `correo_vacio`, `correo_invalido`, `contrasena_vacia`, `contrasena_corta`, `contrasena_comun`, `contrasena_personal`, `nombre_vacio`, `nombre_largo` y `mayor_de_edad_requerido`. El API no manda textos: los clientes los toman de E14.
- **Una transacción** guarda `persona` (etapa `adulta`), `perfil_adulto` (correo en minúsculas, sin verificar), `credencial` (Argon2id, no temporal), `enlace_un_uso` de verificación (24 horas) y `sesion`. Los tokens son de 32 bytes de `crypto/rand`; en la base solo está su SHA-256. Si el envío del correo falla, la cuenta queda y se registra el error (sin correo ni token); la persona pide otro enlace con «Reenviar» (PN-59, PR 6).
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

## Sesiones (US-49)

Es la capa de sesiones: el `Enrutador` resuelve la sesión de cada pedido con `sesion.Resolutor`, y la crea `POST /api/v1/cuentas` (arriba).

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

## Gaps de la US-49

- **Origen detrás de un proxy:** el límite por origen usa la dirección de la conexión. Detrás de Azure Container Apps todos los pedidos llegarían con la dirección de su entrada y el límite se volvería de todos juntos. Es la fila 17 del primer despliegue (D-143 (4)): se confiará solo en la dirección que agregue esa entrada. No se lee `X-Forwarded-For` mientras tanto.
- **Rotar `SESION_SENUELO_CLAVE`** deja sin sesión (401) a quien tenga una de mentira viva, a lo sumo 8 días de cuentas con un correo ajeno ya verificado. No hay clave anterior ni lista de claves: se evitó la complejidad. Si hace falta rotarla sin ese efecto, habría que aceptar dos claves.
- **Holgura de un día:** una sesión de mentira vive hasta el final del día D+7 (UTC), hasta un día más que la cuenta sin verificar que imita (D-135); en la práctica la tarea diaria que borra la cuenta real tiene la misma holgura.
- **Menores:** una persona menor no tiene correo que verificar y su `Verificada` queda en falso: no llega más allá de las rutas `sin_verificar` hasta que I11 defina su ingreso.

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
- `0001_esquema_inicial.sql` y `0002_catalogo.sql` son copia idéntica de las de E13 (D-122). No se editan aquí. Si hay que cambiar algo, el cambio vuelve primero a E13, con nota fechada y versión nueva.

| Archivo | SHA-256 (igual en E13 y aquí) |
|---|---|
| `migraciones/0001_esquema_inicial.sql` | `1244bc98f8218c202851a2a7cc18ae212b0c5a316d9238220e55ff48f351ab30` |
| `migraciones/0002_catalogo.sql` | `f95c1a03e3a956cec11b448d913ebb79df5c96c72f1e475b446a35566c36de3b` |

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
- Un semáforo limita a 4 las operaciones simultáneas.
- Pruebas con los vectores Argon2id de la implementación de referencia (D-083): `src/test.c` de `P-H-C/phc-winner-argon2`, commit `92cd2e19b50b9a58d177e61e1d8ce925315d3d91` (último cambio del archivo; HEAD de `master` `f57e61e19229e23c4445b85494dbf7c07de721cb`, 2021-06-25). Los 8 vectores del bloque Argon2id no usan secreto ni datos asociados, así que aplican todos.
- Benchmark de una verificación: `go test -bench Verificar -run '^$' ./internal/argon2id`.

## Tareas programadas

- `api tareas` es el punto de entrada del trabajo programado. No tiene tareas reales: las tareas son de I05.
- Se conecta con PostgreSQL, registra `tareas: inicio` y `tareas: fin`, y termina con código 0. Sin base alcanzable, termina con código 1.
- Se prueba con la misma imagen del API:

```sh
docker run --rm --network alcanzamos-local_default \
  -e BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@postgres:5432/alcanzamos \
  alcanzamos-api:dev tareas
```

La imagen es la misma, con la web incluida.

## Medición de O-10

Método y cifras en [`MEDICION-O10.md`](MEDICION-O10.md).
