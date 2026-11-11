# api/

API de Alcanzamos: monolito modular en Go con la biblioteca estándar (ADR-002). Incluye el motor de reglas en Go (ADR-005), las migraciones en `api/migraciones/` y la web embebida en la imagen (ADR-004).

- Archivo de construcción: `go.mod` en esta carpeta.
- Reglas: estándar de codificación (E17-ECO), pruebas con `go test -race`; las de integración usan `//go:build integration`.
- Código en `src/` y pruebas en `test/`, en espejo (D-145, E17-ECO 3.1 bis): `src/<paquete>` se prueba en `test/<paquete>`, siempre de caja negra (`package <paquete>_test`), sin `export_test.go` y sin `internal/`. Los ayudantes de prueba (`test/pgtest`, `test/servidor/accesotest`, `test/correo/correotest`, `test/reloj/relojtest`) son paquetes normales bajo `test/`. `src/cmd/api` solo llama a `src/app`, que tiene el compositor y los subcomandos: un paquete `main` no se puede importar desde las pruebas.
- Estructura del monorepo: ADR-001 en [`docs/adr/`](../docs/adr/ADR-001-estructura-de-repositorios.md).

## Uso

- Un solo binario con subcomandos. Sin subcomando corre el servidor (`api`).
- `GET /salud` responde 200 con `{"estado":"ok"}` (queda en la raíz).
- El puerto sale de `PUERTO` (por defecto 8080). El registro es JSON por la salida estándar.
- Con `SIGTERM` o `Ctrl+C` el servidor termina las peticiones en curso (plazo de 10 s).

```sh
cd api
go test -race ./...
go run ./src/cmd/api
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

- Paquete `src/web`: `//go:embed` de `src/web/estatico/`. En el repositorio esa carpeta solo tiene un `index.html` de relleno ("la web no está compilada"), para que `go build` y `go test` pasen sin compilar la web. El `Dockerfile` lo sobrescribe con el `web/dist` real. Un `npm run build` local no toca esa carpeta, así que no deja cambios en git (`web/dist` está ignorado).
- Las respuestas de la web llevan `X-Content-Type-Options: nosniff`.
- **Content-Security-Policy** en todas las respuestas (web, `/api/`, `/salud`, errores 404 y 405), puesta por un envoltorio del manejador en `src/servidor` con una sola constante (`politicaCSP`):

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
- Para ver la web real sin Docker: `cp -r web/dist/. api/src/web/estatico/` y `go run ./src/cmd/api` (no confirmar ese cambio).

## Configuración

Ningún dominio ni dirección va fija en el código (D-129). `config.Cargar` lee estas variables y, si falta alguna o no es válida, devuelve un error que las nombra todas. El comando `api` la exige al arrancar; `migrar` y `tareas` no la necesitan.

| Variable | Qué es | Ejemplo local (Mailpit de `infra/local`) |
|---|---|---|
| `BASE_DE_DATOS_URL` | Cadena de conexión de PostgreSQL | `postgres://alcanzamos:solo-local@127.0.0.1:5432/alcanzamos` |
| `CORREO_SMTP` | `host:puerto` del servidor SMTP. Usa STARTTLS si el servidor lo ofrece; todavía no autentica (el proveedor de producción está por definir, O-4) | `127.0.0.1:1025` |
| `CORREO_REMITENTE` | Dirección que envía; no recibe respuestas (D-120). El valor sale de la configuración, no del código | `no-responder@avisos.ejemplo.test` |
| `CORREO_PRIVACIDAD` | Dirección del pie de cada correo, donde escribir sobre los datos (D-120, RF-060) | `privacidad@ejemplo.test` |
| `URL_PUBLICA` | Base de los enlaces de los correos, sin parámetros; la barra final se quita. El enlace de verificación es `URL_PUBLICA/verificar?t=<token>` y el de recuperación, `URL_PUBLICA/recuperar?t=<token>` | `http://127.0.0.1:8080` |
| `PUERTO` | Puerto del servidor (opcional, 8080) | `8080` |

`infra/local/` queda fuera de esta carpeta: para una variable nueva allí, copia la tabla a su `.env.example`. Las pruebas inyectan los valores (`config.Cargar` recibe la función de lectura del entorno).

## Acceso negado por defecto (RNF-012, D-138, D-172 (5))

Toda ruta de `/api/` se registra con `Enrutador.Registrar(nivel, patron, manejador)` y **declara su nivel de acceso**. No existe un registro sin nivel: el valor cero, una ruta fuera de `/api/`, un patrón repetido (con el mismo nivel o con otro) o en conflicto hacen que `Construir` devuelva un error y el servidor no arranque. `Registrar` nunca hace `panic`. El nivel que se declara para «todo lo demás» es `requiere_autorizacion`: ante la duda, el más estricto.

| Nivel | Qué exige | Rutas |
|---|---|---|
| `publica` | nada | pedir la verificación del correo (crear la cuenta), reenviar el correo, completar la cuenta con el enlace (PN-74), iniciar sesión y recuperar el acceso (pedir el enlace y elegir la contraseña con él) |
| `sin_autorizacion` | cuenta con el correo **verificado**, aunque no haya autorizado lo necesario | cerrar sesión y las acciones de PN-64: ver las finalidades, autorizar y «No autorizo» ([Autorización](#autorización-us-50)) |
| `requiere_autorizacion` | cuenta verificada y con las finalidades necesarias de su etapa **autorizadas** (`ReglaDeFinalidades`) | el ingreso anterior de PN-71, el cambio de contraseña de PN-73, las categorías, guardar, consultar, corregir y borrar movimientos ([Registro](#registro-de-movimientos-us-51) y [Movimientos](#movimientos-lista-detalle-corregir-y-borrar-us-52)), el presupuesto y los ingresos del periodo ([Presupuesto](#presupuesto-del-periodo-us-77-srcpresupuesto)) y todo lo demás |

| Sujeto → | sin sesión | con sesión y sin correo verificado (solo un menor, hasta I11) | verificada sin autorizar | autorizada |
|---|---|---|---|---|
| `publica` | 200 | 200 | 200 | 200 |
| `sin_autorizacion` | 401 `sin_sesion` | 403 `verificacion_pendiente` | 200 | 200 |
| `requiere_autorizacion` | 401 `sin_sesion` | 403 `verificacion_pendiente` | 403 `autorizacion_pendiente` | 200 |

- **Hay tres niveles, no cuatro (D-172 (5), SEG-010).** Desapareció `sin_verificar`: crear una cuenta no da sesión, así que una cuenta sin verificar no tiene a dónde entrar, y una ruta no puede declararlo (no existe la constante ni un valor que valga: `TestElCodigoNoTieneElNivelSinVerificarNiLaSesionDeMentira` mira el árbol de sintaxis de `src/` y `TestRegistroInvalidoNoArranca` registra el cuarto valor y espera el error de arranque). Un nivel más bajo no hereda las rutas de uno más alto.
- Sin sesión: `401 {"error":"sin_sesion"}` y evento `error_autorizacion`. Con sesión que no alcanza el nivel: `403` con `verificacion_pendiente` o `autorizacion_pendiente` y evento `acceso_denegado` con la cuenta. Si falla la resolución de la sesión, `500`: ante la duda no pasa.
- **`seguridad.Sujeto`** (`Persona`, `Verificada`, `Autorizada`) lo arma quien implementa `servidor.Sesiones` (la interfaz `SujetoDe(r)` que resuelve la sesión; ver `sesion.Resolutor`) y el `Enrutador` lo deja en el contexto (`servidor.SujetoDe`).
- **Prueba por ruta** (`test/servidor/accesotest`): `ProbarRutas` recorre las rutas registradas y, para cada una y cada clase de Sujeto, comprueba el estado, el código de error y el evento de seguridad de la tabla de arriba. Una ruta nueva entra sola. `TestTodaRutaDeAPITieneSuNivelDeclarado` (`src/cmd/api`) es además el inventario de rutas: una ruta nueva obliga a añadirla con su nivel.

### Finalidades necesarias por etapa del titular (`cuenta.ReglaDeFinalidades`, D-139)

`0002_catalogo.sql` tiene tres finalidades necesarias y activas, pero a cada persona solo le tocan algunas. La regla está en un solo lugar (`src/cuenta/finalidades.go`) y según la etapa del **titular** (de quién son los datos; `autorizacion` separa `titular_id` de `otorgante_id`):

| Etapa del titular | Finalidades necesarias | Quién las otorga |
|---|---|---|
| adulta | `cuenta_y_acceso`, `funciones_financieras` | el titular mismo (`otorgante_id = titular_id`, PN-64) |
| menor | `cuenta_del_menor` | su tutor (PN-36) |
| a los 18 años (pasa a `adulta`) | la lista de adulto | la persona (PN-54), sin `cuenta_del_menor` |

Las accesorias (`avisos`, `horas_de_vida`, `correo_del_menor`) y `transferencia` (inactiva) no entran. `Cumple(etapa, titular, vigentes, tutores)` dice si se cumple; una etapa desconocida no cumple. **Prueba guardiana** (`TestElCatalogoNoTieneNecesariasSinClasificar`): lee las finalidades del INSERT de `0002_catalogo.sql` (la migración embebida, la misma que se aplica a la base) y falla si hay una necesaria y activa que la regla no clasifica; la prueba inversa falla si la regla exige un código que el catálogo no tiene como necesario y activo.

## Seguridad (`src/seguridad`, US-49)

Lo que no depende de ningún módulo de negocio (E12 §5.9).

### Eventos de seguridad (RNF-025, E17-VTE 2.1)

Una línea JSON de `slog` por evento (`seguridad.Registro`), nivel `WARN`, `msg` «evento de seguridad», con estos campos y ninguno más: `time` (siempre en UTC: `nuevoRegistro` de `src/cmd/api`), `level`, `msg`, `evento_seguridad` (`inicio_sesion_fallido`, `acceso_denegado` o `error_autorizacion`), `cuenta` (uuid o `desconocida`), `ruta` (el patrón de `Request.Pattern`, sin valores), `codigo` (HTTP) y `peticion`. **No hay origen ni IP** (D-123), ni contraseñas, tokens, correos o cuerpos. El `peticion` es de 16 bytes aleatorios en hexadecimal; nunca se acepta el que mande el cliente.

### Tokens opacos (D-081)

`NuevoTokenOpaco` da 32 bytes de `crypto/rand` en base64 de URL sin relleno y su SHA-256, que es lo único que llega a la base. `HuellaDeToken` rechaza, sin tocar la base, lo que no decodifica a 32 bytes.

### Límites de intentos (`LimitadorDeIntentos`, RNF-014)

Es una **espera, no un bloqueo**: cada intento cuenta durante su ventana (deslizante) y deja de contar al cumplirla. Los contadores viven **solo en la memoria del API** (D-123): se reinician con él y no se comparten entre réplicas. La hora sale del `Reloj` inyectado (`src/reloj`), así que las pruebas la adelantan sin esperar. Lo vencido se borra al tocar la clave y en un barrido cada minuto, y cada clave guarda a lo sumo tantos instantes como su límite, así que la memoria está acotada. Las cuentas, los correos y los orígenes se guardan como SHA-256, no en claro.

| Qué | Por cuenta o dirección | Por origen | Ventana | Decisión |
|---|---|---|---|---|
| Inicio de sesión (cuenta los **fallos**, también la contraseña de ahora errónea de PN-73) | 5 | 20 | 15 minutos | D-136 |
| Pedido del enlace de recuperación | 3 | 20 | 1 hora | D-136 (4) |
| «Reenviar el correo» de PN-59 (contador propio), por la dirección escrita, exista o no la cuenta (no crea cuentas), más una espera corta de 30 segundos entre uno y otro a la misma dirección | 3 | 20 | 1 hora | D-172 (4), D-136, E14-PCP 4.2 (D-143 (5)) |
| Crear una cuenta (cuenta **todos** los intentos) | — | 20 | 1 hora | D-140 (1) |
| Correos a una misma dirección (verificación, reenvíos y aviso de que alguien intentó crear una cuenta con el correo), desde cualquier origen. **No cuentan los de recuperación**: tienen su propio límite, el de la fila «Pedido del enlace de recuperación» | 3 | — | 1 hora | D-140 (2), D-172 (7) |

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

Una prueba por regla en `test/seguridad/contrasena_test.go`. Las reglas miran la contraseña entera: una secuencia o una repetición dentro de una frase más larga no se rechaza.

- **Lista de SecLists** (`datos/contrasenas_comunes.txt`): [SecLists](https://github.com/danielmiessler/SecLists) (MIT), `xato-net-10-million-passwords-1000000.txt` en el commit `4c0fd59432ab8508edc23b3c880127edb12e34d5` (2026-10-22), filtrada a las 10.908 entradas de 15 o más caracteres. URL exacta, hashes, filtro y licencia están en `src/seguridad/datos/` (`README.md` y `LICENCIA-SecLists.txt`). Licencia MIT, compatible con la AGPLv3.
- **Lista propia en español** (`datos/contrasenas_comunes_es.txt`, AGPL-3.0-only): 502 entradas de 15 o más caracteres con frases y patrones de Colombia («contraseña», «teamo», «tequiero», ciudades, equipos) pegados a números y años. Sin datos filtrados. La genera [`datos/generar_es.go`](src/seguridad/datos/generar_es.go) (`go run generar_es.go > contrasenas_comunes_es.txt`); **el dueño la revisa antes de fusionar**. Detalle en `datos/README.md`.

### Correo (`src/correo`)

SMTP de la biblioteca estándar; texto plano en español. Los dos correos de la cuenta (el de verificación, E14-PCP 4.2 quater, y el aviso de que alguien intentó crear una cuenta con el correo, 4.2 bis) terminan **exactamente** con «Si tienes dudas sobre tus datos, escribe a <CORREO_PRIVACIDAD>.» (D-143); una prueba compara el texto en los dos. El puerto `Correo` tiene un `Falso` para las pruebas. Nunca se registra el token, la dirección ni el cuerpo. Tampoco el texto que responde el servidor SMTP, que suele repetir la dirección (A-15): de un error con código queda solo el código, uno de la red o de la conexión cerrada se conserva y cualquier otro (por ejemplo una línea sin código) se reemplaza por «respuesta del servidor no válida». Una prueba con un servidor de mentira recorre esos casos y busca la dirección en cada línea del registro.

## Cuenta (US-49, US-61)

Crear una cuenta **verifica primero** (D-172, D-174, D-192; US-61): PN-58 pide solo el correo y nunca da sesión; la contraseña y el nombre se piden al abrir el enlace del correo (PN-74) y **la sesión empieza solo al guardarlos**, con el correo ya verificado.

| Ruta | Nivel | Qué hace |
|---|---|---|
| `POST /api/v1/cuentas` | `publica` | PN-58: pide la verificación del correo (CU-43). Cuerpo: `{correo, mayor_de_edad}`. **Nunca da sesión ni `Set-Cookie`** |
| `POST /api/v1/cuentas/verificacion/reenvio` | `publica` | PN-59, «Reenviar el correo». Cuerpo: `{correo}`. Misma respuesta que crear, pero **solo actúa sobre cuentas que ya existen** |
| `POST /api/v1/cuentas/verificacion` | `publica` | PN-74, «Elige tu contraseña». Cuerpo: `{token, contrasena, nombre}`. Completa la cuenta y **empieza la sesión** |

**Retiradas (D-172 (5)):** `GET /api/v1/cuentas/estado` («Ya lo confirmé») y `POST /api/v1/cuentas/correo` («Cambiar el correo») ya no existen (responden el 404 de `/api/`): PN-59 no tiene sesión, y para cambiar de dirección se crea la cuenta de nuevo con la otra (PN-58). Tampoco existen la sesión limitada, la sesión de mentira ni la clave `SESION_SENUELO_CLAVE`.

### Crear la cuenta (PN-58)

- **Cuerpo y errores.** `{correo, mayor_de_edad}`; `mayor_de_edad` debe ser `true` (la web lo manda desde la casilla de PN-58; Android, tras PN-65). **La contraseña y el nombre ya no se reciben aquí** (D-172 (1), D-174 (2)): un campo que no esté en el contrato, también `contrasena` o `nombre`, da `400 {"error":"solicitud_invalida"}` sin crear nada. **La fecha de nacimiento tampoco se recibe ni se guarda** (D-089). Errores de campo: `422 {"error":"validacion","campos":{campo: código}}` con `correo_vacio`, `correo_invalido` y `mayor_de_edad_requerido`. Dependen de lo escrito, nunca de la cuenta. El API no manda textos: los clientes los toman de E14 (`diseno/textos/es.json`).
- **Siempre la misma respuesta (D-172 (1), SEG-013):** `202 {"estado":"verificacion_pendiente"}` con `Cache-Control: no-store` y sin `Set-Cookie`, tenga o no cuenta ese correo, esté verificada o no, también con `X-Alcanzamos-Cliente: android` (no hay token que entregar). Es una sola función (`Handler.responderVerificacionPedida`) para crear y reenviar.
- **Qué llega al correo (D-172 (2)):**

| El correo… | En la base | Correo |
|---|---|---|
| no tiene cuenta | se crea `persona` (etapa `adulta`, nombre provisional `Pendiente`) y `perfil_adulto` sin verificar, **sin credencial ni sesión**, y un `enlace_un_uso` de verificación de 24 horas | verificación (E14-PCP 4.2 quater) |
| tiene una cuenta **sin verificar** | **no se borra ni se recrea nada** (misma persona, misma fecha de creación): solo se borran sus enlaces pendientes y se guarda el nuevo | verificación con un enlace nuevo; el anterior deja de servir |
| tiene una cuenta **verificada** | no se toca nada | aviso «Alguien intentó crear una cuenta con tu correo» (E14-PCP 4.2 bis, aprobado en D-192) |

- **Sin migración.** `persona.nombre` es `NOT NULL` y PN-58 no pide el nombre: la cuenta pendiente lleva el nombre provisional `cuenta.NombreProvisional` hasta PN-74, que lo reemplaza. Nunca se muestra (una cuenta pendiente no tiene sesión) y la tarea de D-135 la borra a los 7 días si nadie la confirma. Los tokens son de 32 bytes de `crypto/rand`; en la base solo está su SHA-256.
- **Orden del trabajo en segundo plano (A1, A2).** Primero el **cupo global**: como máximo 100 pedidos de crear o reenviar trabajando a la vez (`cuenta.CupoDeSolicitudes`, `Dependencias.CupoDeSolicitudes`; un semáforo, no una cola: no hay trabajadores aparte). Con el cupo lleno el trabajo se descarta y se registra sin el correo ni el token («pedido de verificación descartado»), y el cliente recibe la misma respuesta; pedirlo otra vez lo recupera. Después el **límite de 3 correos por hora a la dirección, antes de tocar la base**: un pedido que no va a poder enviar nada no revoca el enlace que la persona ya tiene (el cuarto pedido de la hora no la deja sin un enlace que sirva). Pruebas: `TestElTrabajoEnSegundoPlanoTieneUnTopeGlobal`, `TestElCuartoPedidoDeLaHoraNoRevocaElEnlaceVigente`, `TestElCuartoPedidoNoDejaSinEnlaceQueSirva`.
- **Fuera del pedido.** Como la recuperación (D-144), todo lo que depende de la cuenta (la base y el envío) pasa **en segundo plano** (`Servicio.pedirVerificacion`): el pedido solo valida, cuenta los límites y responde, así que tarda lo mismo en los tres casos. Un fallo de la base o del correo se registra sin el correo ni el token y no cambia la respuesta; la persona pide otro enlace con «Reenviar el correo». `Servicio.Esperar` espera ese trabajo (pruebas y apagado). El trabajo en segundo plano está acotado por los límites de origen y por un tope global de 100 pedidos a la vez (`CupoDeSolicitudes`): con el tope lleno, el pedido se descarta y la respuesta es la misma.
- **Límites.** Por origen (D-140 (1)): 20 intentos por hora, **todos** (correos nuevos, ya registrados, errores de campo y JSON roto); el 21 es `429 {"error":"demasiados_intentos"}` con el mismo cuerpo siempre. El origen es la IP del otro extremo de la conexión (para IPv6, el prefijo /64) y vive solo en la memoria del limitador; **no se lee `X-Forwarded-For`** (ver «Gaps»). Por dirección (D-140 (2)): como máximo 3 correos por hora a una misma dirección, sumando verificación, reenvíos y aviso; el que no sale por el límite no cambia la respuesta. La recuperación del acceso no cuenta ahí (D-172 (7)).
- **Pre-hijacking (SEG-012).** Quien crea una cuenta con el correo de otra persona no recibe sesión (no hay sesión al crear), no puede fijar la contraseña (solo la fija quien abre el enlace, que llega al buzón de la dueña) y no le quita nada: la cuenta pendiente ni se borra ni se recrea, y la dueña, al pedir su propio correo, recibe un enlace nuevo que invalida el del atacante. Lo prueban `TestPrehijackingElQueCreaConElCorreoAjenoNuncaEntraNiBloqueaALaDuena` y, en el repositorio, `TestPedirOtraVezLaVerificacionNoBorraNiRecreaLaCuenta`.

### Completar la cuenta con el enlace (PN-74)

`POST /api/v1/cuentas/verificacion` con `{token, contrasena, nombre}`. Pública: el token del enlace es la autoridad, sirve desde cualquier dispositivo y **una sola vez**.

- **`200 {"estado":"activa"}`** con `Cache-Control: no-store` y la sesión nueva: el token va en la cookie `__Host-sesion` (web) o, con `X-Alcanzamos-Cliente: android`, en el cuerpo (`{"estado":"activa","token":"…"}`, sin `Set-Cookie`); con esa cabecera, un pedido con `Origin` o `Sec-Fetch-Site` da `400 solicitud_invalida` sin gastar el enlace (D-143 (3)). El cliente sigue a PN-63 con «Listo, confirmamos tu correo.»
- **Una sola transacción** (`pg.Cuentas.CompletarCuenta`): consume el enlace (un `UPDATE` con las condiciones en el `WHERE`, atómico: de dos usos simultáneos pasa uno), guarda el nombre y la credencial (Argon2id), marca el correo como verificado, borra los demás enlaces pendientes, **borra las sesiones previas de la persona** (A3, `TestCompletarLaCuentaBorraLasSesionesPrevias`) y crea la sesión. **Sin la contraseña guardada no hay sesión** (D-172 (3)); si algo falla no queda nada. Toma los candados de la cuenta en el mismo orden que el borrado y que la recuperación (credencial, persona, perfil).
- **Primero mira el enlace, sin gastarlo, y valida.** Contraseña con la política de D-142 usando el correo de la cuenta del enlace; nombre de hasta 60 caracteres. Si algo no cumple: `422 {"error":"validacion","campos":{…}}` con `contrasena` (`contrasena_vacia`, `contrasena_corta`, `contrasena_comun` o `contrasena_personal`) o `nombre` (`nombre_vacio`, `nombre_largo`), sin sesión, sin cookie y **sin gastar el enlace**: la persona corrige y vuelve a intentar. **`contrasena_personal` es el error de D-142 y D-192**: la contraseña incluye el correo o la palabra «Alcanzamos»; su texto «Falta una contraseña que no incluya tu correo ni la palabra «Alcanzamos».» vive solo en `diseno/textos/es.json` (D-160), el API manda el código.
- **El enlace (D-192).** Dura **24 horas** (`cuenta.VigenciaDelEnlaceDeVerificacion`; a las 24 horas exactas ya no sirve), sirve **una sola vez** y pedir uno nuevo (crear de nuevo o «Reenviar el correo») **invalida el anterior**. Un enlace vencido, ya usado, reemplazado, inexistente o mal formado da **el mismo error específico**: `400 {"error":"enlace_invalido"}`, sin sesión, sin `Set-Cookie` y sin cambiar nada. El cliente lo muestra como «Ese enlace ya no sirve.» con «Pedir otro enlace» (PN-74, como PN-62), nunca como un error genérico. Con 8 usos simultáneos del mismo enlace pasa uno solo: un `200` y siete `enlace_invalido`, con una credencial y una sesión (`TestOchoUsosSimultaneosDelMismoEnlaceSoloPasaUno`). Una prueba por condición: `TestElEnlaceSirveUnaSolaVez` (a), `TestPedirUnEnlaceNuevoInvalidaElAnterior` (b, creando de nuevo y con «Reenviar») y `TestUnEnlaceVencidoNoSirve` (c).
- **Una cuenta de antes** (sin verificar y con contraseña de la versión anterior) se completa igual: la credencial se reemplaza. Y una cuenta sin verificar **no entra**: `POST /api/v1/sesiones` responde `credenciales_invalidas` como con una cuenta que no existe (`pg.Autenticacion.CredencialPorCorreo` solo mira cuentas verificadas).
- **«No hay sesión hasta PN-74»:** `TestNoHaySesionHastaGuardarLaContrasena` (crear no abre ninguna sesión, ni siquiera con Android; sin contraseña no se entra; el enlace con la contraseña rechazada no da sesión; solo guardarla la da).

### Reenviar el correo (PN-59)

`POST /api/v1/cuentas/verificacion/reenvio` con `{correo}`. **Pública**: PN-59 no tiene sesión. Valida el correo como PN-58 (`422 validacion` con `correo_vacio` o `correo_invalido`) y responde **igual que crear**, con o sin cuenta: `202 {"estado":"verificacion_pendiente"}`. **No crea cuentas** (B1): crear la cuenta exige `mayor_de_edad`, que el reenvío no recibe. Con una cuenta sin verificar manda un enlace nuevo (el anterior deja de servir); con una verificada, el aviso; **sin cuenta no hace nada** (ninguna fila, ningún correo) y responde lo mismo (`TestReenviarConUnCorreoSinCuentaNoCreaNada`). Límites **por la dirección escrita**, exista o no la cuenta, con su propio contador: **espera corta de 30 segundos** (`seguridad.EsperaCortaDeReenvio`, E14-PCP 4.2, D-143 (5)), **3 por hora por dirección** y **20 por origen** (D-136), y además los 3 correos por hora a la dirección (D-140 (2)). La espera y los límites de la hora dan el mismo `429 {"error":"demasiados_intentos"}` (el «mismo texto de espera» de E14); un reenvío frenado no cuenta. Ya no hay `409 ya_verificada`: decir que la cuenta está verificada revelaría que existe.

### Qué prueba SEG-013 (A-16)

- `TestCrearYReenviarNoSeDistinguenEntreCorreoNuevoSinVerificarYVerificado` (`test/cuenta`): mismo estado, mismas cabeceras (con sus valores) y mismo cuerpo, sin cookie, en la web y en Android, en las dos rutas.
- `TestSEG013LaRespuestaYElTiempoNoDistinguenSiElCorreoTieneCuenta` (`test/app`, contra el enrutador de producción y la base): 360 repeticiones por caso, una dirección y un origen por pedido, un solo orden al azar de los 3×N pedidos (barajar dentro de cada grupo de tres sesgaba la mezcla del pedido anterior de cada caso, B2), las cuentas sembradas antes de medir, y la prueba de **Kolmogórov-Smirnov** de dos muestras (`test/estadistica`) de los tres pares (nuevo/sin verificar, nuevo/verificada, sin verificar/verificada). En el reenvío, «nuevo» es un correo sin cuenta, con nivel 0,01 (D-174 (4)): si p < 0,01 distingue los casos. **Un par que sale con p < 0,01 se mide otra vez con muestras nuevas y solo falla si lo distingue las dos veces**: con tres pares por ruta y 0,01 un equipo ruidoso daría un falso positivo cada tantas corridas, y una diferencia real (por ejemplo, hacer la consulta a la base dentro del pedido, que da D = 1 y p ≈ 10⁻¹⁶⁰) sale siempre. Un correo con cuenta no cambia lo que dura el pedido: el trabajo que depende de la cuenta pasa fuera de él.

## Borrar la cuenta (US-53, PN-69)

| Ruta | Nivel | Qué hace |
|---|---|---|
| `GET /api/v1/cuenta/borrado` | `requiere_autorizacion` | Lo que PN-69 dice del hogar (fila 4) y de los menores (filas 5 y 6): `{"hogar": null \| {nombre, es_administradora, unica_adulta, nuevo_administrador}, "menores": [{"id", "nombre"}]}`. No cambia nada |
| `GET /api/v1/cuenta/datos` | `requiere_autorizacion` | «Descargar mis datos» (RF-032, D-102, D-180): un ZIP armado al pedirlo, `Content-Type: application/zip`, `Content-Disposition: attachment; filename="alcanzamos-mis-datos.zip"`, `Cache-Control: no-store`. No guarda copia ni registra su contenido. `401` si la cuenta ya no existe |
| `POST /api/v1/cuenta/borrado` | `requiere_autorizacion` | Borra la cuenta. Cuerpo `{contrasena, confirma_menores, menores}` |

E12 no nombra la ruta (`CuentaServicio.BorrarCuenta(s, contrasena, confirmaMenores)`); es POST, como `POST /api/v1/cuenta/contrasena`, porque lleva la contraseña en el cuerpo y así cae en la defensa de E17-ECO 3.15 cuando llegue (hoy ninguna ruta la tiene: bug #214 de I06).

- **La confirmación de los menores es de cada menor (RN-006).** `menores` son los ids que la pantalla mostró (los del `GET`) y `confirma_menores` es la casilla marcada. Dentro de la transacción el servidor vuelve a calcular a quienes dependen solo de la persona; si no son **exactamente** los de `menores` (otro tutor borró su cuenta, o se sumó uno), `409 menores_cambiaron` y no se borra nada: el cliente vuelve a leer el resumen y muestra de nuevo el texto de E14. Sin `menores`, vale una lista vacía. Con menores que coinciden y `confirma_menores` falso, `422`.
- **Respuestas.** `200 {"estado":"cuenta_borrada"}` con la cookie `__Host-sesion` mandada a borrar (`Max-Age=0`) y `Cache-Control: no-store`; el cliente va a PN-60. `400 contrasena_incorrecta`, que cuenta como fallo del límite de D-136 (el mismo contador del inicio de sesión) y deja `inicio_sesion_fallido`; `429 demasiados_intentos`; `422 validacion` con `contrasena: contrasena_vacia` o `confirma_menores: confirmacion_requerida` (no cambia nada); `409 menores_cambiaron`; `403 cuenta_de_menor`, que se decide **antes** de mirar la contraseña (400 y 403 no deben decir si acertó); `503 ocupado` (la base siguió ocupada tras 3 intentos y la cuenta sigue: se puede intentar de nuevo); `401 sin_sesion`.
- **Una sola transacción** (`pg.Borrado.BorrarCuenta`): o queda todo borrado o no cambia nada.
  0. **Los candados van primero, en un orden global fijo, y después se lee y se calcula.** (0) El hogar de la persona: dos personas del mismo hogar se turnan enteras, sin cruzarse (una pasando el papel de administrador a la otra, que ya tendría su perfil bloqueado); si la persona cambió de hogar mientras se esperaba, se repite. (1) La credencial, la persona y su perfil de adulta: el orden de `IniciarSesion`, de **elegir la contraseña con el enlace** y de **pedir el enlace** (los dos toman la credencial y la persona antes de tocar el enlace; el borrado llega al enlace por la cascada, y con otro orden había interbloqueo). (2) Los menores que ella tutela: su persona, su perfil de menor y **todas las tutorías de esos menores**. Dos tutores de la misma menor que borran a la vez se turnan (la segunda ve a la menor a cargo solo de ella y responde `409 menores_cambiaron`); una tutoría nueva espera; lo que escribe la menor espera. (3) Los miembros del hogar. Corre en READ COMMITTED y no en SERIALIZABLE (se probaron los dos: con inicios de sesión seguidos que actualizan la credencial, en SERIALIZABLE el primer candado aborta con 40001 en los tres intentos y el borrado queda en `503`; en READ COMMITTED, con los candados puestos, las pruebas de concurrencia pasan). Si aun así la base aborta o una escritura se cuela se repite todo, hasta 3 veces, **solo** ante 40001, 40P01 o estas restricciones: `ck_movimiento_persona_o_hogar`, `ck_recurrente_persona_o_hogar`, `ck_meta_persona_o_hogar`, `ck_presupuesto_persona_o_hogar`, `ck_deuda_persona_o_hogar`, `fk_hogar_administrador_id` y `fk_hogar_administrador_miembro`. Cualquier otro error de integridad se intenta una vez y sale como `500` con su línea de registro (código y restricción, sin datos). Tras los intentos: `401` si la cuenta ya no existe y `503 ocupado` (que también deja su línea de registro) si sigue.
  - **Lo que otras rutas hacen a la vez.** Elegir la contraseña con un enlace de una cuenta que se borra responde `400 enlace_invalido` (el enlace se fue con la cuenta); cambiar la contraseña (`POST /api/v1/cuenta/contrasena`) y guardar un movimiento (`POST /api/v1/movimientos`) con la cuenta ya borrada responden `401 sin_sesion`, como cualquier sesión que ya no sirve. Las demás rutas de movimientos (corregir, borrar, listar) filtran por la persona de la sesión: sin cuenta no encuentran nada (`404` o lista vacía), nunca un 500.
  - **Inicio de sesión a la vez.** Un inicio de sesión que encuentra la cuenta borrada entre buscarla y entrar responde el mismo `401 credenciales_invalidas` de una cuenta que no existe.
  1. Los menores que dependen solo de la persona (su única tutoría es la suya) se borran con ella (RN-006), si coinciden con `menores`.
  2. Si administra el hogar y queda otra persona adulta, el papel pasa a la de `miembro_hogar.desde` más antigua (RN-007). Si era la única adulta, el hogar se disuelve: todo lo de ese `hogar_id` se borra con ella.
  3. Se borra lo **propio** (`hogar_id` nulo) de `movimiento`, `movimiento_recurrente`, `meta`, `presupuesto` y `deuda`. Hay que hacerlo antes: el `SET NULL` de `persona_id` dejaría la fila sin dueño y violaría `ck_*_persona_o_hogar`. Lo compartido de un hogar que sigue queda en el hogar con `persona_id` nulo (D-053).
  4. `autorizacion` no tiene llave a la persona: sus filas quedan retiradas y con `conservar_hasta` a 3 años (E13 §7, provisional).
  5. `DELETE FROM persona` y el `CASCADE` se lleva perfiles, credencial, **todas las sesiones** y tokens de dispositivo, enlaces, avisos, pertenencia al hogar, tutorías y propuestas pendientes.
- **Descargar mis datos.** Cuatro CSV en UTF-8 con marca de orden de bytes (para que Excel lea las tildes), la primera fila con los nombres de las columnas, montos en pesos con dos decimales y punto (`45000.00`; en la base van en centavos) y fechas `AAAA-MM-DD`. Sin ningún id. Solo la librería estándar (`archive/zip`, `encoding/csv`).
  - `movimientos.csv`: `fecha, tipo, monto_en_pesos, categoria, medio_de_pago, descripcion, meta, sentido, compartido_con_el_hogar`. Son los movimientos con `persona_id` de la persona (los que ella registró, también los que compartió con el hogar, marcados «sí»); nada de lo que registró otra persona ni las filas compartidas sin dueño. `meta` solo es el nombre de una meta suya (un aporte); `sentido` es `entrada` o `salida`.
  - `metas.csv` (`nombre, monto_objetivo_en_pesos, fecha_objetivo, creada_el`), `deudas.csv` (`nombre, monto_en_pesos, total_a_pagar_en_pesos, cuotas, inicio, vence, origen`) y `presupuestos.csv` (`periodo, categoria, monto_asignado_en_pesos`): solo la fila de nombres hasta que existan esos temas (D-180). Los nombres de columnas los propuse con los de E13; los confirma el dueño al llenarlos.
  - Un texto que empieza con `= + - @` o un control lleva antes una comilla simple, para que la hoja de cálculo no lo ejecute como fórmula.
- **Segunda llamada.** Con la misma sesión es `401 sin_sesion`: la primera ya la borró. Con una carrera (las dos pasaron el control de acceso a la vez), la segunda encuentra la cuenta ya borrada y también responde `401`; las pruebas de `test/pg` y `test/app` lo recorren con PostgreSQL.
- **Registro.** Nada de lo borrado ni la contraseña quedan en el registro: ni correos, ni nombres, ni ids de menores. El id interno de la cuenta solo aparece en el evento `inicio_sesion_fallido` de una contraseña mal escrita (E17-ECO 3.13).
- **Pendiente (decide el dueño; D-180 cerró el aviso y la descarga).** No se avisa al nuevo administrador (decide el dueño, D-180: el aviso del hogar llega con I08); `autorizacion.otorgante_id` de un menor cuyo tutor borra su cuenta sigue apuntando a ese uuid (la retención de `autorizacion` no se tocó).

## Sesiones (US-49)

Es la capa de sesiones: el `Enrutador` resuelve la sesión de cada pedido con `sesion.Resolutor`, y la crean `POST /api/v1/cuentas/verificacion` (PN-74, arriba) y `POST /api/v1/sesiones` (abajo).

- **Almacén en PostgreSQL** (`pg.Sesiones`, E13 §5.3, D-081): `sesion` guarda solo el SHA-256 del token. Vencimiento **deslizante de 30 días** con **tope de 90 días** desde la creación (`vence_en = menor(ahora + 30 días, creada_en + 90 días)`). `ultimo_uso_en` solo se escribe si pasaron **más de 5 minutos** desde el anterior. **Máximo 5 sesiones por persona:** al crear una más se borran las menos recientes en la misma transacción. Cada sesión lleva un token nuevo. En cada petición se lee si la cuenta confirmó el correo y si tiene autorizadas las finalidades necesarias de su etapa (`ReglaDeFinalidades`), sin guardarlo: retirar una autorización surte efecto al instante.
- **Web: cookie `__Host-sesion`** con `HttpOnly; Secure; SameSite=Strict; Path=/` y `Max-Age=7776000` (90 días, el tope; el vencimiento real lo decide el servidor). El prefijo `__Host-` hace que el navegador exija `Secure` y `Path=/` y no deje fijarla a un subdominio.
- **Android: `Authorization: Bearer <token>`.** La web y Android se resuelven igual (gana el encabezado si vienen los dos). Un token ausente, mal formado o desconocido es `401 sin_sesion`.
- **Resolución** (`sesion.Resolutor`): consulta el almacén real. No hay sesiones de mentira (D-172 (5)): un token que el almacén no tiene es `401 sin_sesion`. Un fallo del almacén no se confunde con «sin sesión».

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
| `DELETE /api/v1/sesiones/actual` | `sin_autorizacion` | Cierra la sesión de la petición (SEG-010) |
| `GET /api/v1/cuenta/seguridad` | `requiere_autorizacion` | El ingreso anterior (PN-71, RF-062) |
| `POST /api/v1/recuperacion` | `publica` | Pide el enlace para elegir una contraseña nueva (PN-61, RF-036). Cuerpo: `{correo}` |
| `POST /api/v1/recuperacion/contrasena` | `publica` | Elige la contraseña nueva con el enlace (PN-62). Cuerpo: `{token, contrasena}` |
| `POST /api/v1/cuenta/contrasena` | `requiere_autorizacion` | Cambia la contraseña con la sesión iniciada (PN-73, RF-065). Cuerpo: `{contrasena_actual, contrasena_nueva}` |

Código en `src/autenticacion` (`Servicio` y `Handler`; E12 `AutenticacionServicio`) y `pg.Autenticacion`.

### Iniciar sesión

- **«Identificador» genérico** (D-137 (3)). Hoy solo se acepta un correo; el nombre de usuario de los menores llega en I11 sin cambiar el contrato. Un identificador que no sea un correo se trata como una cuenta que no existe: el mismo `401`, con Argon2id contra el hash de relleno. Sin identificador o sin contraseña: `422 {"error":"validacion","campos":{...}}` con `identificador_vacio` y `contrasena_vacia`, sin contar ni calcular nada.
- **Respuesta.** `200` con `Cache-Control: no-store` y `{"estado":"activa"}`. **Una cuenta sin verificar no entra** (D-172 (3)): no tiene contraseña hasta que la elige con el enlace, así que responde `401 credenciales_invalidas` como una cuenta que no existe. Lo que la cuenta puede hacer después lo decide el `Enrutador` ruta por ruta. La entrega del token es la de completar la cuenta (`sesion.EntregaDe`): cookie `__Host-sesion` en la web; con `X-Alcanzamos-Cliente: android`, el token en el cuerpo (`{"estado":…,"token":"…"}`), y `400 solicitud_invalida` si el pedido trae `Origin` o `Sec-Fetch-Site` (D-143 (3)).
- **Token nuevo en cada inicio** (contra la fijación de sesión) y el máximo de 5 sesiones por persona de E13 §5.3: al iniciar la sexta se borra la menos reciente.
- **Límites (D-136).** 5 fallos por identificador y 20 por origen en 15 minutos (el identificador se compara en minúsculas y sin espacios). Es una espera: pasados los 15 minutos se puede intentar de nuevo. Con el límite alcanzado responde `429 {"error":"demasiados_intentos"}` **aunque la contraseña sea la correcta**, igual exista o no la cuenta, y sin calcular Argon2id. Solo cuentan los fallos, no los éxitos.
- **No revela si la cuenta existe** (CU-52 2a, RNF-014). Contraseña incorrecta, cuenta inexistente e identificador que no es un correo dan el mismo `401 {"error":"credenciales_invalidas"}` con las mismas cabeceras, y Argon2id corre **una vez** en cada caso (contra un hash de relleno que se calcula al arrancar). `TestElFalloEsIgualYArgon2idCorreUnaVezEnCadaCaso` lo prueba contando las llamadas al hasheador, sin medir tiempos de reloj.
- **Sube el hash de parámetros viejos (D-144, E12 `HasherArgon2id.NecesitaMejora`, ADR-002 §5.1).** Tras verificar la contraseña, si el hash guardado tiene memoria, iteraciones o paralelismo **menores** que los vigentes (o sal o clave más cortas), se calcula un hash nuevo con la misma contraseña, **fuera de la transacción** y con el mismo cupo de 4 operaciones de Argon2id, y se guarda en la misma transacción que la sesión y el ingreso anterior. Solo reemplaza el hash si sigue siendo el que se verificó (un cambio de contraseña en medio no se pisa). Si no se puede calcular, se registra sin correo, contraseña ni hash y se entra igual con el hash viejo. Con parámetros iguales o mayores no se toca. Pruebas: `TestNecesitaMejora` (`argon2id`), `TestIniciarSesionSubeElHashSoloSiTieneParametrosViejos` y `TestFallarAlSubirElHashNoImpideEntrar` (servicio), y contra la base `TestIniciarSesionSubeElHashDeParametrosViejos`, `TestIniciarSesionConParametrosVigentesNoReescribeElHash` y `TestLaMejoraDelHashNoPisaUnHashQueCambio`.
- **Eventos (D-136 (3), RNF-025).** Cada fallo (`401`) **y cada intento frenado** (`429`) deja `inicio_sesion_fallido`, con `cuenta` `desconocida` (no se atribuye ni cuando la cuenta existe, para que el registro tampoco la delate) y sin identificador ni origen.
- **Último ingreso (D-134).** Con la contraseña correcta, **en la misma transacción que inserta la sesión**: `credencial.ingreso_anterior = ultimo_ingreso` y `ultimo_ingreso = ahora` (la hora del `Reloj`, en UTC). En el primer ingreso `ingreso_anterior` queda `NULL`. Si la sesión no se puede guardar, el ingreso no se mueve. Solo fecha y hora, sin IP ni dispositivo (NM-03, D-123). Pruebas: `TestElIngresoAnteriorSeMueveEnLaMismaTransaccionQueLaSesion` (incluye el primer ingreso) y `TestUnInicioFallidoNoMueveElIngreso`.

### Cerrar sesión

`DELETE /api/v1/sesiones/actual` borra la fila de la sesión de la petición (revocar es borrar) y responde `204`. Siempre manda `Set-Cookie: __Host-sesion=; Max-Age=0` con los mismos atributos que la cookie de sesión (también en Android, donde no hace nada). Una segunda llamada con el mismo token ya no tiene sesión: `401 sin_sesion`.

### Seguridad de la cuenta (PN-71)

`GET /api/v1/cuenta/seguridad` responde `{"ingreso_anterior":"2026-11-02T02:40:00Z"}` (RFC 3339 en UTC) o `{"ingreso_anterior":null}`. El cliente pone en `null` «Este es tu primer ingreso.» y convierte la fecha a su zona. Es el ingreso **anterior**, nunca el de la sesión de ahora. Con la cuenta sin autorizar lo niega el `Enrutador` (`403`).

### Recuperar el acceso (PN-61 y PN-62, RF-036)

- **Pedir el enlace** (`POST /api/v1/recuperacion`, `{correo}`). **Responde siempre** `202 {"estado":"enlace_enviado"}` si el correo está bien escrito, tenga cuenta o no: mismo estado, mismas cabeceras y mismo cuerpo (CU-44 2a). Un correo vacío o sin dominio da `422 validacion` (`correo_vacio` o `correo_invalido`), que no depende de la cuenta.
  - Cuenta con el correo **verificado** (en el trabajador, ver abajo): se borran los enlaces de recuperación pendientes (pedir uno nuevo invalida los anteriores, E13 §5.4) y se guarda uno nuevo, con un token de 32 bytes (en la base solo su SHA-256) que **vence a la hora y sirve una vez**. El correo lleva `URL_PUBLICA/recuperar?t=<token>` y termina con el pie de D-143.
  - **Cuenta sin verificar: no se manda nada**, con la misma respuesta (ver «Gaps»).
  - **Fuera del pedido (D-144).** Responder distinto de prisa o despacio delataría qué correos están registrados (lo mismo que cuidó D-141), así que el pedido hace siempre el mismo trabajo y no toca la cuenta: valida el correo, cuenta los límites (por correo normalizado y por origen, exista o no la cuenta), pone el correo en una cola y responde `202` enseguida. Un trabajador (`Servicio.Iniciar`; 2 trabajadores y una cola de **100 pendientes como máximo**, `Dependencias.TrabajadoresDeRecuperacion` y `ColaDeRecuperacion`) busca la cuenta, guarda el enlace y manda el correo (sin el tope de 3 correos por hora de la verificación: la recuperación tiene su propio límite, el del pedido). Con la cola llena, el trabajo se descarta y se registra sin el correo; la respuesta es la misma. **Un correo perdido (cola llena, fallo del envío, apagado) se recupera pidiéndolo otra vez**, sin que el cliente lo note. Al apagar, el contexto del servidor detiene a los trabajadores: el trabajo en curso termina, lo que sigue en la cola se descarta (con su cuenta en el registro) y `Esperar` vuelve antes de cerrar la base. Pruebas, sin medir tiempos de reloj: `TestElPedidoDeRecuperacionNoTocaLaCuentaYRespondeIgualEnLosTresCasos` (la base y el correo no se llaman durante el pedido; mismo estado, cabeceras y cuerpo con cuenta verificada, sin verificar y sin cuenta), `TestElPedidoNoEsperaALaConsultaDeLaCuenta`, `TestLosLimitesDeLaRecuperacionNoDependenDeLaCuenta`, `TestConLaColaLlenaLaRecuperacionRespondeIgualYSeDescarta`, `TestLosTrabajadoresParanConElContexto` y, con el enrutador y PostgreSQL, `TestLaRecuperacionRespondeIgualYSaleDelPedido`.
  - Sin cuenta: no se hace nada.
  - **Cola llena:** si ya hay 100 pendientes, el pedido se descarta en silencio y responde el mismo `202`, para que no se note desde afuera (D-144). Se registra el descarte, sin el correo.
  - **Si el API se reinicia, los correos que estaban en la cola se pierden:** la cola vive en la memoria del proceso. La persona no recibe el enlace y lo pide de nuevo desde PN-61.
- **Límites.** D-136 (4): **3 pedidos por hora por correo y 20 por origen**, exista o no la cuenta; el siguiente es `429 {"error":"demasiados_intentos"}`, idéntico para todos, y un pedido frenado no cuenta. **Los correos de recuperación no cuentan en el tope de 3 correos por hora a una misma dirección de D-140 (verificación, reenvíos y aviso) ni se frenan en él (D-172 (7), A-17)**: con tres creaciones por hora con el correo de otra persona, esa persona seguiría recibiendo su enlace para recuperar el acceso. La recuperación tiene su propio contador por dirección (los 3 por hora de arriba), separado del de verificación y del del inicio de sesión.
- **Elegir la contraseña** (`POST /api/v1/recuperacion/contrasena`, `{token, contrasena}`). Primero mira el enlace, sin calcular nada: inexistente, mal formado, usado, vencido o de otro propósito (el de verificación no sirve aquí ni al revés) da `400 {"error":"enlace_invalido"}` («Ese enlace ya no sirve.»). Después aplica la política de contraseñas con el correo de la cuenta (`contrasena_personal`, D-142): si no cumple, `422 validacion` con el código en `contrasena` y **el enlace no se gasta**, así la persona corrige y vuelve a intentar.
- **Al guardar, en una sola transacción:** se marca el enlace usado (un `UPDATE` con las condiciones en el `WHERE`, atómico: de varios usos simultáneos pasa uno), se guarda el hash Argon2id nuevo y se **borran todas las sesiones de la persona**, la actual incluida (recuperar significa que la contraseña vieja pudo estar comprometida). Responde `200 {"estado":"contrasena_cambiada"}` **sin iniciar sesión** y sin cookie: el cliente va a PN-60 con «Listo, cambiaste tu contraseña.» E12 (s2, CU-44) y E14 (PN-62) dicen lo mismo: no hay inicio automático.
- Pruebas: `TestRecuperarElAccesoCierraTodasLasSesiones`, `TestElEnlaceDeRecuperacionVenceALaHora`, `TestPedirOtroEnlaceDeRecuperacionInvalidaLosPendientes`, `TestRecuperacionSoloParaCuentasVerificadas`, `TestLosEnlacesNoSeIntercambian` y `TestDosUsosSimultaneosDelEnlaceSoloPasaUno` (contra la base); las del 429 y de la política, en `test/autenticacion/contrasenas_test.go`; las de A-17 (SEG-009), `TestLaRecuperacionNoSeFrenaPorLosCorreosDeVerificacionNiDeAviso` y `TestLosCorreosDeRecuperacionNoGastanElLimiteDeVerificacionNiDeAviso`, en `test/autenticacion/recuperacion_test.go`.

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
| `GET /api/v1/cuenta/seguridad` | 403 | `autorizacion_pendiente` (`verificacion_pendiente` solo para un menor, hasta I11) | el cliente sigue a PN-63 |

## Autorización (US-50)

PN-63 es solo información (no llama al API). PN-64 usa estas tres rutas, todas `sin_autorizacion`: las usa la sesión de una cuenta con el correo verificado que aún no autorizó lo necesario. Código en `src/autorizacion` (`Servicio` y `Handler`) y `pg.Autorizaciones`. **El API no manda textos de interfaz:** los textos de las finalidades salen de E14-PCP 5 (`diseno/textos`) y cada app asocia el `codigo` con su texto.

| Ruta | Nivel | Qué hace |
|---|---|---|
| `GET /api/v1/autorizaciones` | `sin_autorizacion` | Las finalidades que una persona adulta puede autorizar ahora y la versión vigente del texto |
| `POST /api/v1/autorizaciones` | `sin_autorizacion` | Guarda la autorización (PN-64, «Autorizar y continuar»). Cuerpo: `{"finalidades":[…],"version":"1.0"}` |
| `POST /api/v1/autorizaciones/rechazo` | `sin_autorizacion` | «No autorizo»: borra la cuenta recién creada y cierra la sesión (RF-031, D-089) |

### Ver las finalidades

`200` con `Cache-Control: no-store`:

```json
{
  "version": { "numero": "1.0", "fecha": "2026-10-30" },
  "finalidades": [
    { "codigo": "cuenta_y_acceso", "tipo": "necesaria", "otorgada": false },
    { "codigo": "funciones_financieras", "tipo": "necesaria", "otorgada": false },
    { "codigo": "avisos", "tipo": "accesoria", "otorgada": false },
    { "codigo": "horas_de_vida", "tipo": "accesoria", "otorgada": false }
  ]
}
```

- **Por qué solo estas cuatro (D-139).** La lista sale de `cuenta.ReglaDeFinalidades` (`Codigos` y `Accesorias` de la etapa adulta): las dos necesarias de la persona adulta y las accesorias activas que PN-64 le ofrece. Quedan fuera `cuenta_del_menor` (necesaria, pero se autoriza en PN-36 con la tutoría), `correo_del_menor` (es del menor, I11) y `transferencia` (inactiva, NM-06). Lo que no está en la lista no se puede autorizar: el `POST` lo rechaza.
- `otorgada` es verdadero si la persona tiene esa finalidad vigente (`retirada_en` nula) otorgada por ella misma.
- `version` es el texto vigente. En la base se guarda como «1.0 del 2026-10-30» (`autorizacion.version_del_texto`); cada app escribe la fecha en palabras con la función común (D-090): «Texto versión 1.0 del 30 de octubre de 2026.».

### Autorizar

Cuerpo `{"finalidades":["cuenta_y_acceso","funciones_financieras","avisos"],"version":"1.0"}`; un campo que no esté en el contrato da `400 solicitud_invalida`. Respuesta `200 {"estado":"autorizada"}` con `Cache-Control: no-store`.

| Código | Error | Cuándo |
|---|---|---|
| `409` | `version_desactualizada` | `version` no es la vigente (o falta). Se revisa primero. El cliente vuelve a pedir la lista y muestra el texto nuevo: es un conflicto con el estado actual, no un campo mal escrito |
| `422` | `finalidad_invalida` | un código desconocido, inactivo o que no le toca a una persona adulta |
| `422` | `faltan_necesarias` | no vienen las dos necesarias (las dos viajan juntas, en una sola casilla). Las accesorias son libres |
| `401` | `sin_sesion` | la cuenta se borró entre el guard y la escritura |

- **Una transacción** inserta una fila de `autorizacion` por finalidad: `titular_id = otorgante_id = la persona`, `version_del_texto = "1.0 del 2026-10-30"`, `otorgada_en` = la hora del `Reloj`. Antes toma la fila de la persona (`FOR UPDATE`) para turnarse con «No autorizo».
- **Idempotente.** Repetir la llamada no duplica nada ni mueve la fecha: `ON CONFLICT … DO NOTHING` sobre el índice único de las vigentes (`ix_autorizacion_vigente`). Si se suma una accesoria, solo entra esa. Una finalidad repetida en la lista cuenta una vez.
- **La misma sesión sube de nivel, sin reautenticar.** El nivel no se guarda: `pg.Sesiones.Sujeto` calcula `Autorizada` en cada petición desde la base. No hay sesión nueva, no se rota el token y **`credencial.ingreso_anterior` no se toca**: tras autorizar, PN-71 de la misma sesión responde `{"ingreso_anterior":null}` y la persona ve «Este es tu primer ingreso.» (S2, `TestS2LaPersonaNuevaAutorizaYVeSuPrimerIngresoEnLaMismaSesion`).
- **Evento.** No hay un evento de seguridad nuevo: el conjunto de E17-VTE 2.1 es cerrado (`inicio_sesion_fallido`, `acceso_denegado`, `error_autorizacion`) y la alerta de producción cuenta por esos tres valores; agregar uno cambiaría `infra/azure/alertas.tf`. Un otorgamiento correcto no es un fallo ni una negación: queda en el registro común (`INFO`, solo el identificador de la petición).

### «No autorizo»

`POST /api/v1/autorizaciones/rechazo` (sin cuerpo): `204`, `Cache-Control: no-store` y la cookie `__Host-sesion` vencida (Android no tiene cookie: el token ya no sirve porque la sesión se borró). La app va a PN-60.

- **Solo la sesión de nivel exactamente `sin_autorizacion`.** Con lo necesario ya autorizado responde `403 {"error":"ya_autorizada"}` y deja el evento `acceso_denegado` con la cuenta; no borra nada. Quien ya autorizó borra su cuenta por PN-69. La condición se vuelve a comprobar **dentro de la transacción** (si autorizó entre el guard y el borrado, también `403`).
- **Una transacción** borra la persona y, por `ON DELETE CASCADE`, todo lo que tenga llave a ella: `perfil_adulto`, `credencial`, `sesion` (todas, no solo la de la petición), `enlace_un_uso` (verificación y recuperación), `token_dispositivo`, `ocultamiento_categoria`, `aviso`… La prueba recorre las llaves foráneas desde el catálogo de PostgreSQL (la consulta de E13 §7), así que una tabla nueva con llave a la persona entra sola, y comprueba que no queda ninguna fila.
- **`autorizacion` es la excepción de E13 §7 y D-135.** No tiene llave a la persona, así que no se borra en cascada: las que hubiera (una necesaria suelta, por ejemplo) quedan retiradas (`retirada_en`) y conservadas hasta `conservar_hasta` (3 años, plazo provisional, `cuenta.AniosDeLaPruebaDeAutorizacion`) como prueba mínima, sin datos de contacto. Es el mismo criterio de `BorrarSinConfirmar`. Con el flujo normal no hay ninguna, porque no se guarda nada antes de autorizar.
- Después, el correo y la contraseña ya no sirven (`401 credenciales_invalidas`) y la persona puede empezar de nuevo.

### «Nada se guarda antes de autorizar» (S1, Ley 1581)

Las rutas por debajo de `requiere_autorizacion` son solo las del ingreso (crear la cuenta y verificar el correo, entrar, recuperar el acceso, cerrar sesión y las tres de arriba); hoy la única que escribe datos de la persona más allá de eso, el cambio de contraseña (PN-73), exige autorización, igual que PN-71. `TestSoloLasRutasDelIngresoNoExigenAutorizacion` (`test/app`) falla si aparece una ruta nueva por debajo de `requiere_autorizacion` que no esté en esa lista a propósito. `TestSinAutorizarLasRutasProtegidasDan403YAutorizandoPasan` prueba `403 autorizacion_pendiente` sin autorizar y que, al autorizar en la misma sesión, pasan.

## Registro de movimientos (US-51)

El formulario de registro (E14-PPN 3.1) y PN-03 usan estas tres rutas, todas `requiere_autorizacion`: sin autorizar dan `403 autorizacion_pendiente` (las dos primeras escriben y leen datos financieros de la persona; la tercera no toca datos, pero solo la usa quien ya puede registrar). Código en `src/registro` (`Servicio` y `Handler`), `src/fechas` (las fechas de una repetición, E15 5.2) y `pg.Movimientos`. **El API no manda textos de interfaz:** manda ids, claves del catálogo y códigos de error, y cada app pone el texto de E14 (`diseno/textos`). Alcance de D-164: solo «Efectivo» y «Transferencia» (sin «Tarjeta» ni «Cuotas»), «Solo mío» (`hogar_id` nulo) y sin lenguaje natural.

| Ruta | Nivel | Qué hace |
|---|---|---|
| `GET /api/v1/categorias` | `requiere_autorizacion` | Las categorías visibles de la persona, por tipo |
| `POST /api/v1/movimientos` | `requiere_autorizacion` | Guarda un gasto o un ingreso, con o sin repetición |
| `GET /api/v1/repeticiones/proximas` | `requiere_autorizacion` | Las próximas fechas de una repetición, antes de guardarla (PN-03) |

### Categorías

`200` con `Cache-Control: no-store`:

```json
{
  "gasto": [{ "id": 1, "nombre": "Alimentación", "general": false }, …, { "id": 16, "nombre": "Otros gastos", "general": true }, { "id": 26, "nombre": "Ayuda a la familia", "general": false }],
  "ingreso": [{ "id": 17, "nombre": "Salario", "general": false }, …, { "id": 25, "nombre": "Otros ingresos", "general": true }]
}
```

- **`id` es lo que las apps usan** (es estable entre ambientes, `0002_catalogo.sql`) para elegir el texto y el ícono de E14; `nombre` es la clave del catálogo de E09 (`ClaveDeCategoria` de E12: nombre y tipo), no el texto de la pantalla. Los nombres están en español en la base porque el catálogo es dato de E09, pero la fuente de los textos de interfaz es `diseno/textos/es.json` (E17-ECO 4.13, D-160): una app que mostrara `nombre` directamente duplicaría esa fuente.
- Una persona adulta ve todas menos las que ocultó (`ocultamiento_categoria`, RN-011: las generales nunca se ocultan). Una persona menor ve solo las `apta_para_menores`. Ordenadas por `id`. `general` marca «Otros gastos» y «Otros ingresos», la categoría de reserva (RF-005).

### Guardar un movimiento

Cuerpo (un campo que no esté en el contrato, como `persona_id` o `hogar_id`, da `400 solicitud_invalida`: la dueña de la fila es siempre la persona de la sesión):

```json
{
  "tipo": "gasto",
  "monto_centavos": 65000000,
  "fecha": "2026-08-15",
  "categoria_id": 4,
  "medio": "transferencia",
  "descripcion": "Arriendo",
  "repeticion": { "periodicidad": "mensual" }
}
```

`descripcion` y `repeticion` son opcionales. `periodicidad`: `semanal`, `quincenal`, `mensual`, `semestral` o `anual` (D-084). Respuesta `201` con `Cache-Control: no-store`; las fechas van como `AAAA-MM-DD`:

```json
{ "movimiento_id": "…", "recurrente_id": "…", "proximas": ["2026-11-15", "2026-12-15", "2027-01-15"], "pendientes": [] }
```

| Campo | Cuándo |
|---|---|
| `movimiento_id` | El `movimiento` guardado; `null` si solo se guardó la repetición (fecha futura) |
| `recurrente_id` | El `movimiento_recurrente`; `null` si no se repite |
| `proximas` | Hasta tres fechas programadas **posteriores a hoy** (PN-03, «Próximas fechas desde Hoy»); `[]` sin repetición |
| `pendientes` | Fechas de la repetición que ya llegaron y están por confirmar (`FechasPendientes` de E15 5.2, con `f ≤ hoy`); `[]` sin repetición |

**Reglas.**

- **Montos en centavos, enteros (D-082, EXA-001).** `monto_centavos` es un entero de `int64` mayor que cero; el API nunca usa `float64` para dinero (se lee como texto del JSON y se convierte con `strconv.ParseInt`). `12345678901` es $123.456.789,01 y vuelve igual.
- **«Hoy» es el de Colombia** (UTC−5 fijo, sin horario de verano), calculado con el `Reloj` (`fechas.HoyEnColombia`).
- **Sin repetición:** una fila de `movimiento` con la fecha escrita, también si todavía no llegó (RF-057: «Regalos de Navidad» del 20 de diciembre, E14-PPN 9). No queda nada pendiente: D-091 es solo de los recurrentes.
- **Con repetición y fecha de hoy o pasada (D-164):** en una transacción, un `movimiento_recurrente` (`inicio` = `fecha`, `monto_habitual` = el monto, `creado_en` = ahora) y el `movimiento` de esa fecha, enlazado con `recurrente_id` y `fecha_programada = fecha` (su fecha confirmada).
- **Con repetición y fecha futura:** solo el `movimiento_recurrente`; esa fecha queda pendiente y aparece en `proximas`. **Nunca se guarda un movimiento con fecha futura.**
- **Las fechas intermedias son historia (E15 5.2, D-164 «E15 como está»).** `pendientes` solo trae fechas desde el día en que se creó la repetición (`f ≥ máx(inicio, creado_en)`), sin confirmadas ni omitidas. El arriendo del 15 de agosto, mensual, escrito el 26 de octubre de 2026, guarda el movimiento del 15 de agosto; el 15 de septiembre y el 15 de octubre **no** quedan pendientes (`pendientes: []`) y `proximas` es el 15 de noviembre, el 15 de diciembre y el 15 de enero de 2027. Una fecha programada de hoy que no es la escrita sí queda pendiente (el lunes 19 de octubre, semanal, escrito el lunes 26: `pendientes: ["2026-10-26"]`).
- **Fechas de la repetición (`src/fechas`, código puro):** semanal cada 7 días desde `inicio`; quincenal `base` y `base + 15` (con `base` el día de `inicio`, menos 15 si pasa de 15); mensual el día de `inicio`; semestral solo si `(mes − mes de inicio) mod 6 = 0`; anual solo en el mes de `inicio`. Un día que no existe en el mes (el 31, el 30 de febrero) cae el último día. Las pruebas son los casos FP-01 a FP-16 de E15.
- `medio` es `efectivo` o `transferencia`; `tarjeta` da `422 medio_invalido` (D-164; llega con las tarjetas en I07). `descripcion` admite hasta 280 caracteres (no bytes); se recorta y, vacía, no se guarda. La fecha no puede ser anterior al año 1900.

**Errores.** `422 {"error":"datos_invalidos","campos":{"<campo>":"<código>"}}` con **todos** los campos inválidos a la vez (E14-PPN 3.1 los muestra juntos); no se guarda nada. `400 solicitud_invalida` si el cuerpo no es JSON, un campo trae un tipo que no es el suyo o sobra un campo.

| Campo | Códigos |
|---|---|
| `tipo` | `tipo_requerido` («Falta elegir si es un gasto o un ingreso.»), `tipo_invalido` |
| `monto_centavos` | `monto_requerido` («Falta el monto.»), `monto_no_positivo` (cero o negativo: «El monto debe ser mayor que $0.»), `monto_invalido` (no es un entero que quepa en `int64`: decimal, texto, notación científica) |
| `fecha` | `fecha_requerida` («Falta la fecha.»), `fecha_invalida` (no es `AAAA-MM-DD` ni una fecha real) |
| `categoria_id` | `categoria_requerida`, `categoria_invalida` (no existe, es del otro tipo —la llave `(categoria_id, tipo)` de E13 lo hace cumplir, también para la repetición— o la persona no la ve: el POST aplica la misma regla que `GET /api/v1/categorias`, así que una persona menor no guarda en «Bebidas alcohólicas y tabaco» (E09) y nadie guarda en una categoría que ocultó; no se guarda nada, tampoco la repetición) |
| `medio` | `medio_requerido` («Falta elegir el medio de pago.»), `medio_invalido` (incluye `tarjeta`) |
| `descripcion` | `descripcion_larga` |
| `repeticion` | `periodicidad_requerida` («Falta elegir cada cuánto se repite.»), `periodicidad_invalida` |

Pruebas: `test/fechas` (E15 5.2), `test/registro/handler_test.go` (contrato y validación con un repositorio falso) y `test/registro/integracion_test.go` (de punta a punta contra PostgreSQL, en web con cookie y en Android con Bearer, incluido el caso del arriendo).

### Próximas fechas de una repetición

`GET /api/v1/repeticiones/proximas?periodicidad=mensual&inicio=2026-08-15` calcula las fechas de «Próximas fechas desde Hoy» de PN-03 **antes de guardar** (D-165): el cliente no lleva reglas de negocio (E17-ECO 4.7), llama al API y muestra lo que recibe. No lee ni escribe en la base. `200` con `Cache-Control: no-store`, hasta tres fechas `AAAA-MM-DD` **posteriores a hoy** (el de Colombia, del `Reloj`), con `fechas.Proximas` y las mismas tres (`ProximasQueSeMuestran`) que `proximas` del POST:

```json
{ "proximas": ["2026-11-15", "2026-12-15", "2027-01-15"] }
```

Es el arriendo del 15 de agosto, mensual, a 26 de octubre de 2026; con `inicio=2026-11-01` salen el 1 de noviembre, el 1 de diciembre y el 1 de enero de 2027 (un inicio futuro cuenta como primera fecha). `periodicidad` es una de las cinco de D-084 y `inicio` no puede ser anterior al año 1900: las mismas reglas y códigos del POST. Si falla alguno, `422 {"error":"datos_invalidos","campos":{…}}` con todos a la vez:

| Campo | Códigos |
|---|---|
| `periodicidad` | `periodicidad_requerida` (falta o vacía), `periodicidad_invalida` |
| `inicio` | `fecha_requerida`, `fecha_invalida` |

Pruebas: `test/registro/handler_test.go` (arriendo, inicio futuro, casos de E15 por periodicidad, cada código) y `test/registro/integracion_test.go` (401, 403, 200 con cookie y con Bearer).

## Movimientos: lista, detalle, corregir y borrar (US-52)

PN-01 (lista y filtros) y PN-02 (detalle, corregir y borrar) usan estas cuatro rutas, todas `requiere_autorizacion` (sin autorizar, `403 autorizacion_pendiente` antes de leer o tocar nada; sin sesión, `401`), iguales en web (cookie) y Android (Bearer). Código en `src/registro` (`movimientos.go`, `Handler`) y `pg.Movimientos` (`movimientos_consulta.go`). Como el resto del registro, **el API no manda textos**: ids, claves y códigos. Solo ve y toca lo suyo: toda consulta lleva `persona_id` de la sesión, y un id ajeno, inexistente o mal formado da el mismo `404 {"error":"no_encontrado"}` (sin revelar que existe).

| Ruta | Qué hace |
|---|---|
| `GET /api/v1/movimientos?periodo=AAAA-MM&categoria=<id>` | Los movimientos del mes de la persona y lo que necesitan los filtros de PN-01 |
| `GET /api/v1/movimientos/{id}` | El detalle de PN-02 |
| `PUT /api/v1/movimientos/{id}` | Corregir (PN-02 «Corregir»); un aporte o un retiro, `409` (D-170) |
| `DELETE /api/v1/movimientos/{id}` | Borrar (PN-02, hoja «Borrar»): `204`; un aporte o un retiro, `409` (D-170) |

### Lista

`periodo` es opcional (por defecto el mes de hoy en Colombia, no el del servidor) y `categoria` también. `200` con `Cache-Control: no-store`; `422 {"error":"datos_invalidos","campos":{…}}` con `periodo` (`periodo_invalido`: no es `AAAA-MM`, o antes de 1900) y `categoria` (`categoria_invalida`: no es un entero entre 1 y 32767), a la vez. Una categoría sin movimientos o que la persona ocultó no es un error: la lista sale vacía o con sus filas.

```json
{
  "periodo_actual": "2026-11",
  "periodo": "2026-11",
  "categoria_id": 1,
  "resumen": { "movimientos": 2, "total_centavos": 12000000 },
  "meses": ["2026-12", "2026-11", "2026-10", "2026-09"],
  "categorias": [{ "categoria_id": 1, "movimientos": 2, "oculta": false }, { "categoria_id": 4, "movimientos": 2, "oculta": false }, { "categoria_id": 3, "movimientos": 1, "oculta": true }],
  "movimientos": [
    { "id": "…", "tipo": "gasto", "monto_centavos": 4500000, "fecha": "2026-11-01", "categoria_id": 1, "medio": "efectivo", "descripcion": "Mercado",
      "compartido": false, "meta": null, "sentido": null, "recurrente": null }
  ]
}
```

| Campo | Qué es (E14-PRR PN-01) |
|---|---|
| `periodo_actual` | El mes de hoy: el que llega seleccionado y el que el cliente usa para «Noviembre» y «Octubre» (el anterior) |
| `meses` | Los meses con al menos un movimiento de la persona, del más reciente al más antiguo, **sin importar la categoría elegida**: es la lista de «Otro mes». Los de fecha futura cuentan (un gasto sin repetición se guarda con su fecha, RF-057) |
| `categorias` | Las categorías con movimientos en `periodo`, de más a menos movimientos (y por `id` si empatan), **sin importar la categoría elegida**. Las primeras tres son los chips; la lista completa es «Ver todas» e **incluye las ocultas** (`oculta: true`, `ocultamiento_categoria`), para que ningún movimiento quede sin poder filtrarse (RN-011). Un aporte no tiene categoría y no cuenta aquí: se ve con «Todas» |
| `resumen` | `movimientos` es la cantidad de filas de la lista. `total_centavos` es la suma **exacta** de sus montos (se calcula con enteros grandes, sin `float64`, y no desborda `int64`), y solo viene con una categoría elegida; sin ella es `null`, porque mezclaría gastos, ingresos y aportes |
| `movimientos` | Del más reciente al más antiguo: `fecha` descendente y, con la misma fecha, el que se registró después primero (`creado_en` descendente). `[]` si no hay |

Cada movimiento (también el de `GET /api/v1/movimientos/{id}`):

| Campo | Qué es |
|---|---|
| `id`, `tipo` | `tipo` es `gasto`, `ingreso` o `aporte` |
| `monto_centavos`, `fecha` | Entero de centavos (D-082) y `AAAA-MM-DD` |
| `categoria_id` | `null` en un aporte |
| `medio`, `descripcion` | `efectivo` o `transferencia` (D-164); `descripcion` puede ser `null` |
| `compartido` | `true` si `hogar_id` no es nulo: la marca «Compartido con el hogar» (NM-05, SEG-002, NC-E16-40) |
| `meta` | Solo en un aporte: `{"id":"…","nombre":"Arriendo de enero"}`. La fila de PN-01 muestra este nombre en lugar de la categoría (E14-PRR 2.2, fila 7). Con `sentido` (`entrada` o `salida`, un retiro) |
| `recurrente` | Solo si es una fecha confirmada de una repetición: `{"recurrente_id":"…","fecha_programada":"2026-10-26","periodicidad":"quincenal","vuelve_a_pendiente":true}`. Con él la app muestra la fila «Se repite», quita «Fecha» de «Corregir» y, solo si `vuelve_a_pendiente` es `true`, agrega «Esta fecha volverá a quedar por confirmar.» a la hoja de borrar (D-169). Sin `recurrente` no hay `vuelve_a_pendiente` |

**Contexto.** Esta versión lista lo propio (`persona_id` de la sesión), que incluye lo que la persona compartió con su hogar, con `compartido: true` («Mis finanzas»). La vista de un hogar, con lo compartido de todas las personas y «Registrado por», llega con los hogares. Los aportes y los retiros de una meta se listan y se ven en el detalle, pero **no se corrigen ni se borran** (D-170, ver «Aportes y retiros» más abajo); todavía no hay cómo crearlos (llegan con las metas). No hay paginación: es un mes de una persona.

### Corregir: `PUT`

Es `PUT` y no `PATCH`: «Corregir» abre el formulario con todos los campos ya llenos y los manda todos, así valen exactamente las validaciones del POST sin distinguir «no cambia» de «se borra». Cuerpo, con los mismos nombres y códigos que el POST (`tipo_requerido`, `monto_no_positivo`, `fecha_invalida`, `categoria_invalida`, `medio_invalido`, `descripcion_larga`…, todos a la vez); no lleva `repeticion`, y un campo fuera del contrato (`persona_id`, `hogar_id`…) da `400 solicitud_invalida`:

```json
{ "tipo": "gasto", "monto_centavos": 4000000, "fecha": "2026-11-01", "categoria_id": 1, "medio": "efectivo", "descripcion": "Mercado" }
```

`200` con el movimiento ya corregido (la forma de arriba) y `Cache-Control: no-store`. `descripcion` omitida o vacía la borra. `hogar_id`, `recurrente_id` y `fecha_programada` nunca cambian: corregir no cambia de quién es un movimiento ni lo suelta de su repetición.

- **Categoría y tipo.** Debe existir, ser del tipo del movimiento (la llave `(categoria_id, tipo)` de E13: pasar de gasto a ingreso exige una categoría de ingreso) y que la persona la vea, como en el POST. **Excepción:** la categoría que el movimiento ya tiene vale aunque la persona la haya ocultado después: un movimiento conserva su categoría (RN-011).
- **D-168: una fecha de un recurrente.** «Corregir» no muestra Fecha: el cuerpo la omite. Si llega y es **la misma**, se acepta; si es otra, `422 {"campos":{"fecha":"fecha_no_editable"}}` (también con un valor que no es fecha). Tampoco cambia el tipo (`tipo_no_editable`). **Monto, categoría, medio y descripción cambian solo en esa fila:** `movimiento_recurrente` (`monto_habitual`, `categoria_id`, `medio`) queda como estaba, y las demás fechas siguen igual.
- **Un aporte o un retiro de una meta no se corrige** (D-170): `409 {"error":"movimiento_no_editable"}`, sin cambiar nada y antes de validar el cuerpo. Ver «Aportes y retiros».
- Sin Fecha en un movimiento suelto, `fecha_requerida`.

### Aportes y retiros: sin corregir ni borrar (D-170)

`PUT` y `DELETE` sobre un aporte o un retiro de una meta (`tipo` `aporte`, con `meta` y `sentido` `entrada` o `salida`) responden `409 {"error":"movimiento_no_editable"}` y no cambian nada. Se eligió `409` y no `422`: el cuerpo no tiene nada inválido y el mismo `PUT` valdría cuando llegue la historia de metas; es un conflicto con el estado del movimiento, como `ya_verificada` y `version_desactualizada` en el resto del API (`422` queda para `datos_invalidos` con `campos`). El `404` de lo ajeno va primero: un aporte de otra persona da `404 no_encontrado`, igual que uno inexistente, sin revelar que existe. La lista y el detalle no cambian.

**Contradicción pendiente, para resolver en la historia de metas:** E14-PRR PN-02 («Un aporte a una meta»: «El avance nunca queda por debajo de cero») frente a E14-PMH (D-084, punto 5: se rechaza si la meta queda con más retiros que aportes). Este API no aplica ninguna de las dos reglas: por eso no deja corregir ni borrar. Hoy nada crea aportes.

### Borrar: `DELETE`

`204` sin cuerpo y `Cache-Control: no-store`; la segunda vez, `404`; un aporte o un retiro, `409 movimiento_no_editable` (D-170). Quita la fila. **D-168 y D-091:** si era una fecha confirmada de una repetición, esa fecha **vuelve a quedar pendiente**: no se omite (no se crea ninguna `ocurrencia_omitida`), la repetición sigue y E15 5.2 (`fechas.PorConfirmar`) la vuelve a calcular; la restricción única `(recurrente_id, fecha_programada)` permite confirmarla otra vez, y entonces nace con la fecha programada (D-094). **D-169: no toda fecha vuelve.** `recurrente.vuelve_a_pendiente` (booleano, en la lista y en el detalle) dice si al borrar el movimiento su fecha vuelve a pendiente: `true` si `fecha_programada` es igual o posterior al día (hora de Colombia) en que se creó la repetición (`movimiento_recurrente.creado_en`), porque las anteriores son historia en E15 5.2 y no quedan pendientes. Ejemplo: el arriendo mensual con inicio 2026-08-15 creado el 2026-10-26: su movimiento del 2026-08-15 trae `false`; al borrarlo la fecha se borra sin quedar pendiente y `fechas.PorConfirmar` no la devuelve. Una repetición creada hoy con la fecha de hoy trae `true`. El API lo calcula con `fechas.VuelveAPendiente`, que usa la misma condición (`fechas.EsHistoria`) que `fechas.Pendientes` y por tanto `PorConfirmar`: no pueden separarse. Para cambiar el día **no** se borra: la persona marca «No pasó» y registra un movimiento aparte.

**Una salvedad de E15 5.2.** Las fechas anteriores al día en que se creó la repetición son historia y no quedan pendientes (D-164). Si la persona borra el movimiento de la primera fecha de una repetición que empezó en el pasado (el arriendo del 15 de agosto, creado el 26 de octubre), esa fecha no vuelve a «Por confirmar»: queda sin movimiento y sin pendiente, y se registra a mano. Con una repetición que empieza hoy o después, o con cualquier fecha confirmada desde el día de su creación, sí vuelve.

Pruebas: `test/registro/movimientos_test.go` (contrato, validación y D-168 con un repositorio falso) y `test/registro/movimientos_integracion_test.go` (de punta a punta contra PostgreSQL, en web y en Android): la lista con orden, filtros, meses y categorías ocultas; el 404 de lo ajeno en las tres rutas; **D-170: el `409 movimiento_no_editable` al corregir o borrar un aporte y un retiro, sin cambiar nada;** D-168 al corregir y al borrar (con `fechas.PorConfirmar` sobre lo que queda en la base y la restricción única); **D-169: `vuelve_a_pendiente` en lista y detalle para el arriendo de agosto (`false`, y tras borrar `PorConfirmar` no lo devuelve) y para una repetición creada hoy (`true`, y tras borrar vuelve), con una prueba de consistencia entre el booleano y `PorConfirmar`;** **SEG-002 con «Arriendo de enero»**: se siembran por SQL un hogar con la persona como miembro, la meta «Arriendo de enero» y un aporte compartido de $100.000, y la lista y el detalle lo traen con `compartido: true` y su `meta`, mientras quien no es del hogar no lo ve (RNF-003); y el 401 y 403 de las cuatro rutas. `test/app/rutas_test.go` lleva el inventario de rutas.

## Por confirmar: fechas pendientes de una repetición (US-60, API)

La sección «Por confirmar» de PN-01 y «Confirmar todos» (E14-PRR 4.8) usan estas cuatro rutas, todas `requiere_autorizacion`. Las reglas viven aquí (E17-ECO 4.7): el cliente no calcula fechas ni cuentas. Código en `src/fechas` (`ConfirmarVarias`, `FechaDelMovimiento`, `PorConfirmar`), `src/registro` (`pendientes.go`: `PorConfirmar`, `ConfirmarOcurrencia`, `OmitirOcurrencia`, `ConfirmarVarias`), `pg.Movimientos` (`Recurrentes`, `Decidir`); la defensa contra CSRF la aplica el `Enrutador` a todo pedido que no es GET (D-194). **E12 y E17 no fijan las rutas HTTP: estas son una propuesta** consistente con `/api/v1/repeticiones/proximas`. Sin PN-72 ni la tarjeta de Inicio (D-170).

| Ruta | Qué hace | Éxito |
|---|---|---|
| `GET /api/v1/repeticiones/pendientes` | Las fechas pendientes que ya llegaron (`f ≤ hoy`) y las cuentas del resumen | `200` |
| `POST /api/v1/repeticiones/{id}/confirmacion` | Confirma una fecha con el monto habitual o con otro | `201` con el `Movimiento` |
| `POST /api/v1/repeticiones/{id}/omision` | «No pasó»: guarda la fecha omitida, no crea movimiento | `204` |
| `POST /api/v1/repeticiones/decisiones` | «Confirmar todos»: solo las filas marcadas y las «No pasó», todo o nada | `200` |

**Qué fecha está pendiente (E15 5.2, D-091).** `pendiente(f) ⇔ f ∈ fechasDelMes ∧ f ≥ máx(inicio, día de creación) ∧ (sin detenido_en ∨ f < detenido_en) ∧ ¬∃ movimiento (recurrente, f) ∧ ¬∃ omitida (recurrente, f)`; la lista agrega `f ≤ hoy` (el «hoy» es el de Colombia, del `Reloj`). Es `fechas.PorConfirmar`, la misma que usa el POST de movimientos. **Solo las repeticiones de la persona** (`persona_id`): las de un hogar no se ofrecen (E14 4.8: «puede confirmar quien registró el recurrente»). Una fecha futura no se puede confirmar ni omitir: da `409` (decisión de esta API; E15 solo habla de las que ya llegaron).

### Lista: `GET /api/v1/repeticiones/pendientes`

`200` con `Cache-Control: no-store`, de la más antigua a la más reciente y, con la misma fecha, primero el ingreso (E14 4.8). La repetición no guarda un nombre: la fila se titula con la categoría, que la app resuelve por `categoria_id`. Montos en centavos enteros.

```json
{
  "pendientes": [
    {"recurrente_id": "0192f3c4-…", "fecha": "2026-11-27", "tipo": "gasto", "categoria_id": 4,
     "medio": "transferencia", "monto_habitual_centavos": 65000000, "periodicidad": "mensual"},
    {"recurrente_id": "0192f3c4-…", "fecha": "2026-11-26", "tipo": "ingreso", "categoria_id": 17,
     "medio": "transferencia", "monto_habitual_centavos": 120000000, "periodicidad": "quincenal"}
  ],
  "resumen": {"total": 13, "ingresos": 2, "gastos": 11}
}
```

`resumen` trae lo de «13 por confirmar: 2 ingresos y 11 gastos»; el texto lo arma la app. Sin fechas, `{"pendientes":[],"resumen":{"total":0,"ingresos":0,"gastos":0}}`. «Por confirmar» no se muestra con una categoría elegida: es del cliente.

### Confirmar una: `POST /api/v1/repeticiones/{id}/confirmacion`

```json
{"fecha": "2026-11-26", "monto_centavos": 110000000}
```

`monto_centavos` es opcional (omitido o `null`: el habitual); el cambio es solo para esa fecha y no toca `monto_habitual`. `201` con el `Movimiento` (el mismo de la lista y el detalle de PN-01 y PN-02), con `recurrente.vuelve_a_pendiente` y **la fecha programada, nunca la de hoy (D-094, FP-22 y FP-23)**: un salario del 16 de noviembre confirmado el 14 de diciembre queda en noviembre; `creado_en` es el momento de la confirmación. El tipo, la categoría y el medio son los de la repetición.

### «No pasó»: `POST /api/v1/repeticiones/{id}/omision`

```json
{"fecha": "2026-11-26"}
```

`204` sin cuerpo. Guarda la fecha en `ocurrencia_omitida` (D-092), no crea ningún movimiento, y la fecha deja de ofrecerse y de contarse como esperada. No lleva monto (un campo `monto_centavos` es `400`). Una fecha confirmada y una omitida son exclusivas.

### Confirmar todos: `POST /api/v1/repeticiones/decisiones`

```json
{"decisiones": [
  {"recurrente_id": "0192f3c4-…", "fecha": "2026-11-12", "omitida": true},
  {"recurrente_id": "0192f3c4-…", "fecha": "2026-12-01", "monto_centavos": 110000000},
  {"recurrente_id": "0192f3c4-…", "fecha": "2026-11-05"}
]}
```

Solo van las filas marcadas y las «No pasó»; lo desmarcado no se manda y **sigue pendiente (FP-18)**. `200` con `Cache-Control: no-store`:

```json
{
  "movimientos": [{"id": "…", "tipo": "gasto", "monto_centavos": 12000000, "fecha": "2026-11-05", "…": "…"}],
  "omitidas": [{"recurrente_id": "0192f3c4-…", "fecha": "2026-11-12"}],
  "siguen_pendientes": 0,
  "resumen": {"guardados": 12, "omitidas": 1, "ingresos_centavos": 230000000, "gastos_centavos": 225000000}
}
```

`resumen.guardados` y `resumen.omitidas` son los números del aviso «Listo, guardamos 12 movimientos y dejamos de contar 1 fecha.»; los centavos son la suma exacta (FP-17: ingresos $2.300.000 y gastos $2.250.000). **Es una sola transacción** (D-093): si una decisión no vale, no se guarda ninguna, ni las válidas ni las «No pasó» («No se guardó ninguno», E14 4.8). Sin decisiones válidas que guardar, `422`. Tope: `DecisionesMaximas` (500) decisiones y 72 KB de cuerpo; con más, `422 demasiadas_decisiones` y la persona confirma en tandas.

### Errores

| Código | Cuándo | Rutas |
|---|---|---|
| `422 datos_invalidos` con `campos` | `fecha_requerida`, `fecha_invalida` (AAAA-MM-DD, año ≥ 1900), `monto_requerido`, `monto_invalido` (no es un entero de centavos que quepa en `int64`; también un monto en una «No pasó»), `monto_no_positivo`, `recurrente_requerido`, `recurrente_invalido` (no es un identificador), `decisiones_requeridas`, `demasiadas_decisiones`. En «Confirmar todos» la clave es `decisiones[i].<campo>`, todas a la vez | confirmación, omisión, decisiones |
| `404 no_encontrado` | La repetición no existe **o es de otra persona** (el mismo código: no revela que existe); en la ruta, un id mal formado también | las cuatro rutas con id |
| `409 fecha_no_pendiente` | Ya confirmada u omitida, todavía no llegó, anterior a la creación de la repetición o a `inicio`, no es una fecha de su periodicidad, de `detenido_en` en adelante, dos decisiones sobre la misma fecha en una operación, **o alguien la resolvió a la vez**: `ErrFechaNoPendiente` (E15 `ErrFechaNoPendiente`) | confirmación, omisión, decisiones |
| `400 solicitud_invalida` | Cuerpo que no es un JSON de un objeto o con un campo fuera del contrato | POST |
| `403 solicitud_no_permitida` · `415 tipo_de_contenido_no_permitido` | La defensa contra CSRF (abajo) | POST, PUT y DELETE (D-194) |
| `401 sin_sesion` · `403 autorizacion_pendiente` · `403 verificacion_pendiente` | El guard de `requiere_autorizacion` | todas |
| `409 conflicto_concurrente` | La base abortó la operación por un bloqueo mutuo o un fallo de serialización con otra petición; no se guardó nada y se puede reintentar (ver «Concurrencia») | confirmación, omisión, decisiones |
| `500 error_interno` | Fallo de la base o datos incoherentes | todas |

El orden es: forma (`422`), dueña (`404`), estado (`409`). `ErrMontoInvalido` y `ErrFechaNoPendiente` de E15 son los de `fechas.ConfirmarVarias`; el servicio traduce el primero a `422` con el campo antes de llamarla.

### Concurrencia

Confirmar dos veces la misma fecha a la vez no crea dos movimientos: la restricción única `uq_movimiento_recurrente_programada` hace fallar al segundo `INSERT` (`23505`) y el repositorio lo traduce a `409 fecha_no_pendiente`, no a `500`. Confirmar y omitir la misma fecha a la vez: los disparadores de E13 (`fn_movimiento_sin_omitida` y `fn_omitida_sin_movimiento`) bloquean la fila de la repetición y rechazan al segundo (`check_violation` sin restricción), con el mismo `409`. Dos «Confirmar todos» iguales: gana uno entero y el otro no guarda nada (misma transacción).

**Sin bloqueos mutuos.** Esos disparadores toman `FOR UPDATE` de la fila de la repetición en el orden de las decisiones; dos «Confirmar todos» de la misma persona sobre las mismas repeticiones en orden contrario (`[r1, r2]` y `[r2, r1]`) se bloqueaban entre sí (`deadlock detected`, `500`). `pg.Decidir` ahora toma, al empezar su transacción y antes de cualquier `INSERT`, `SELECT … FROM movimiento_recurrente WHERE id = ANY(…) AND persona_id = … ORDER BY id FOR UPDATE` con todas las repeticiones que intervienen: el orden de los bloqueos es siempre el mismo (por id). Confirmar una y «No pasó» pasan por la misma operación, así que valen igual. Una repetición que no sale en ese `SELECT` (no existe o es de otra persona) es `404`: cada operación bloquea y escribe solo con `persona_id` propio.

**Segunda línea: `409 conflicto_concurrente`.** Si aun así la base aborta la operación con `40P01` (`deadlock_detected`) o `40001` (`serialization_failure`), la respuesta es `409 {"error":"conflicto_concurrente"}` y no se guardó nada. Se eligió el `409` reintentable en lugar de reintentar dentro del API porque el servicio calculó las fechas pendientes con lo que leyó antes: tras un choque, ese estado pudo cambiar, y el reintento correcto es el del cliente, que vuelve a pedir la lista y decide con lo nuevo. No usa `fecha_no_pendiente`, que dice otra cosa (la fecha no se puede decidir). El cliente puede repetir el mismo pedido o recargar «Por confirmar». Cada `INSERT` lee la repetición con `persona_id`: una ajena no inserta nada aunque el servicio fallara antes. No hace falta migración.

**Pendiente de decisión con hogares:** el movimiento que nace de confirmar una repetición se guarda con `hogar_id = NULL` (de la persona), y hoy solo se ofrecen las repeticiones con `persona_id` propio. Cuando lleguen los hogares hay que decidir quién confirma las de un hogar y si su movimiento queda compartido.

### Defensa contra CSRF (E17 3.15, D-173 a D-175, D-194)

Todo pedido que no es GET (POST, PUT y DELETE: todo pedido que cambia algo, D-194) pasa por la defensa, que el `Enrutador` aplica antes del guard de acceso (`Enrutador.ConURLPublica`; US-61, SEG-016): (a) si viene `Sec-Fetch-Site`, solo `same-origin`; (b) si no, si viene `Origin`, igual al origen de `URL_PUBLICA`; (c) si no viene ninguna, exige `Authorization: Bearer` o `X-Alcanzamos-Cliente` (Android); lo incumplido da `403 solicitud_no_permitida` sin tocar nada y sin `Set-Cookie`; (d) `Content-Type: application/json`, con o sin cuerpo, o `415 tipo_de_contenido_no_permitido`. Una ruta nueva que cambia algo queda cubierta sola, sea cual sea su método (el `Enrutador` solo deja registrar GET, POST, PUT y DELETE), y `test/app/rutas_test.go` lo comprueba recorriendo las rutas del `Enrutador` de producción; `test/app/csrf_put_delete_integracion_test.go` prueba los casos (a) a (d) de SEG-016 en `PUT` y `DELETE /api/v1/movimientos/{id}` y `DELETE /api/v1/sesiones/actual`, con la base real: ni el movimiento ni la sesión cambian. Los códigos de rechazo (`solicitud_no_permitida`, `tipo_de_contenido_no_permitido`) son una propuesta: D-174 fija el `403` y el `415`, no el texto del código. **Los clientes web y móvil mandan `Content-Type: application/json` en todo POST, PUT y DELETE, con o sin cuerpo, y nunca en GET** (D-175, D-194).

Pruebas: `test/fechas/confirmar_test.go` (FP-17 a FP-23 por nombre, más montos, desbordes y casos vacíos); `test/registro/pendientes_test.go` (contrato, errores y CSRF con un repositorio falso); `test/registro/pendientes_integracion_test.go` (de punta a punta contra PostgreSQL, en web y Android: la lista, D-094 en la lista de noviembre y diciembre, «No pasó», todo o nada, carreras con 8 pedidos a la vez, lotes en orden contrario a la vez (36 pares, sin 500), 40P01 y 40001 como `conflicto_concurrente`, lo ajeno, hogar, `detenido_en`, categoría oculta, 401/403 y CSRF); `test/pg/repeticiones_integracion_test.go`; `test/servidor/csrf_test.go`; `test/app/repeticiones_integracion_test.go` (`verificacion_pendiente` en las cuatro rutas y el cableado de producción: `URL_PUBLICA` llega a la defensa CSRF). `test/app/rutas_test.go` lleva el inventario de rutas.

## Presupuesto del periodo (US-77, `src/presupuesto`)

PN-06 (presupuesto por categorías), PN-07 (la misma pantalla con un ingreso bajo o nulo) y PN-08 (los ingresos del periodo de varias fuentes) de E14-PPA usan estas rutas, todas `requiere_autorizacion` (sin sesión `401`, sin autorizar `403 autorizacion_pendiente`, antes de leer nada), iguales en web (cookie) y Android (Bearer). Código en `src/presupuesto` (`Servicio`, `Handler`; E12 §5.4) y `pg.Presupuestos`. **Las reglas viven aquí** (E17-ECO 4.7): modo de la pantalla, sumas, estados y orden; la app solo pone los textos de E14. Como el resto del API, **no manda textos**: ids, claves del catálogo, montos en centavos y códigos. Solo lee lo propio (`persona_id` de la sesión). **E12 y E17 no fijan las rutas HTTP: estas son una propuesta.**

| Ruta | Qué hace |
|---|---|
| `GET /api/v1/presupuestos?periodo=AAAA-MM` | PN-06 y PN-07: el resumen del periodo y «Por categoría» |
| `GET /api/v1/ingresos?periodo=AAAA-MM` | PN-08: los ingresos del periodo por fuente, registrados, esperados y por confirmar |

`periodo` es opcional en las dos: por defecto el mes de hoy **en Colombia** (`registro.LeerPeriodo`, la misma lectura de `GET /api/v1/movimientos`); `422 {"error":"datos_invalidos","campos":{"periodo":"periodo_invalido"}}` si no es `AAAA-MM` o es anterior a 1900. Las dos responden `200` con `Cache-Control: no-store`. **Montos en centavos enteros y sumas exactas** (RNF-002, D-082): toda suma se hace con enteros grandes (`math/big`) y sale como número JSON entero, también si no cabe en `int64`; lo gastado por categoría es `sum(monto)` de la base (`numeric`, exacto).

### PN-06 y PN-07: `GET /api/v1/presupuestos`

```json
{
  "periodo_actual": "2026-11",
  "periodo": "2026-11",
  "editable": true,
  "resumen": {
    "modo": "normal",
    "ingreso_registrado_centavos": 120000000,
    "asignado_centavos": 4000000,
    "sin_asignar_centavos": 116000000,
    "asignado_supera_por_centavos": null,
    "llega_despues_centavos": 120000000
  },
  "llega_despues": [
    { "recurrente_id": "0192f3c4-…", "fecha": "2026-11-16", "categoria_id": 17, "monto_centavos": 120000000, "marca": "esperado" }
  ],
  "categorias": [
    { "categoria_id": 8, "nombre": "Transporte", "oculta": false, "presupuesto": { "id": "…", "monto_centavos": 4000000 },
      "gastado_centavos": 4000000, "estado": "usado_todo", "quedan_centavos": null },
    { "categoria_id": 4, "nombre": "Arriendo o cuota de vivienda", "oculta": false, "presupuesto": null,
      "gastado_centavos": 65000000, "estado": null, "quedan_centavos": null }
  ]
}
```

Es Laura el 2 de noviembre de 2026 (E14-PPA 2.2, caso F): «Ingreso registrado $1.200.000», «Asignado $40.000», «Sin asignar $1.160.000» y «Llega después: $1.200.000 (esperado)».

| Campo | Qué es |
|---|---|
| `periodo_actual`, `periodo` | El mes de hoy en Colombia y el que se muestra |
| `editable` | `periodo` es el mes en curso: solo entonces se pone, corrige y quita un presupuesto (D-094, SC-E21-13) |
| `resumen.modo` | Qué tarjeta muestra la app (D-094, P-3): `normal` (PN-06) si hay ingreso registrado y lo asignado no lo supera; `ingreso_bajo` (PN-07) si lo asignado supera el ingreso registrado; `ingreso_nulo` (PN-07) si el ingreso registrado es cero, haya o no algo asignado |
| `ingreso_registrado_centavos` | La suma de los movimientos de **ingreso** del periodo (RF-007: nunca supone un salario). Un retiro de una meta no es un ingreso (RN-013) |
| `asignado_centavos` | La suma de los presupuestos **propios** del periodo (`hogar_id` nulo, como la escritura y la descarga; L12 (2) de la US-77): uno compartido con el hogar no suma ni es fila de `categorias` |
| `sin_asignar_centavos` | Registrado menos asignado, **solo en `normal`** (≥ 0); `null` en los otros dos modos |
| `asignado_supera_por_centavos` | Asignado menos registrado, **solo en `ingreso_bajo`** (> 0): «Lo asignado supera por $10.000 lo que registraste.» El API da el hecho y la app lo dice sin signo menos (RNF-017); `null` en los otros modos. Con `ingreso_nulo` no hay diferencia (E14-PPA 4.2) |
| `llega_despues_centavos` y `llega_despues` | Las fechas pendientes de las repeticiones de **ingreso** del periodo: `esperado` si todavía no llegan y `por_confirmar` si ya llegaron. **No cuentan en «Sin asignar»** (D-094, P-1) hasta que se confirman. Cada una trae `recurrente_id` y `fecha`, los de las rutas de confirmar y omitir de la US-60. Sin pendientes, `0` y `[]`: la fila «Llega después» no se ve |
| `categorias` | «Por categoría»: las categorías de gasto con presupuesto en el periodo, **también las ocultas** (`oculta: true`, RN-011, CU-55 2c), y las demás categorías de gasto con gasto en el periodo que la persona **no** ocultó. Primero las que tienen presupuesto y después las demás, cada grupo de mayor a menor `gastado_centavos` y, si empatan, **por nombre** (E14-PPA 4.1, PN-06 fila 4; L6 (6) de la US-77). El nombre del catálogo se compara en Go con la intercalación del español de Unicode (CLDR, `golang.org/x/text/collate` con `language.Spanish`, la versión de `go.mod`), no con la de la base, que depende de cómo se creó: las tildes y las mayúsculas no cambian el orden de las letras (`Educación` antes que `Transporte`, `Árbol` antes que `Bebida`), la «ñ» va entre la «n» y la «o» y, con las mismas letras, sin tilde va antes. Dos nombres iguales quedan por `categoria_id`. Solo gasto: ni ingresos ni aportes (RN-013). `[]` sin nada |
| `presupuesto` | `{id, monto_centavos}` o `null` («Poner presupuesto») |
| `gastado_centavos` | La suma de los gastos del periodo en esa categoría (`0` sin gastos) |
| `estado` | Solo con presupuesto: `quedan` («Quedan $X por gastar.», con `quedan_centavos` = presupuesto − gastado), `usado_todo` («Ya usaste todo lo presupuestado.») o `superado` («Gastado $X de $Y presupuestados.»). Describe sin calificar |

**Reglas.**

- **Lo pendiente es E15 5.2** (`fechas.Pendientes`, la misma regla de «Por confirmar» de la US-60): sin las fechas confirmadas, las omitidas («No pasó», D-092), las anteriores a la creación de la repetición ni las de `detenido_en` en adelante. Es por confirmar si `fecha ≤ hoy` (Colombia). Solo las repeticiones de la persona (`persona_id`).
- **Lo registrado y lo pendiente salen de la misma lectura** (`REPEATABLE READ`, solo lectura): una fecha que se confirma a la vez no cuenta dos veces.
- **Solo una persona adulta presupuesta** (E12 §6, RF-007): una persona menor recibe `403 {"error":"solo_personas_adultas"}`. Hoy un menor no llega a ninguna ruta con sesión (I11); la base lo asegura también (`presupuesto.persona_id` apunta a `perfil_adulto`).
- **«Dejar el presupuesto en cero»** (PN-07, CU-10 2a) no escribe nada: con ingreso nulo y nada asignado el periodo ya está en cero, y la app solo muestra el aviso. E13 no tiene dónde guardar «definido en cero» y la historia no lo pide.

### PN-08: `GET /api/v1/ingresos`

```json
{
  "periodo_actual": "2026-11",
  "periodo": "2026-11",
  "meses": ["2026-11", "2026-10"],
  "total": { "entran_centavos": 240000000, "registrado_centavos": 120000000, "esperado_centavos": 120000000, "por_confirmar": 0 },
  "fuentes": [
    { "categoria_id": 17, "nombre": "Salario", "oculta": false, "total_centavos": 240000000, "ingresos": [
      { "fecha": "2026-11-01", "marca": "registrado", "monto_centavos": 120000000, "medio": "transferencia", "descripcion": null,
        "movimiento_id": "…", "recurrente_id": null },
      { "fecha": "2026-11-16", "marca": "esperado", "monto_centavos": 120000000, "medio": "transferencia", "descripcion": null,
        "movimiento_id": null, "recurrente_id": "0192f3c4-…" }
    ] }
  ]
}
```

| Campo | Qué es |
|---|---|
| `meses` | Los meses con ingresos registrados, del más reciente al más antiguo: la lista de «Otro mes». Los chips del mes anterior, el actual y el siguiente los arma la app con `periodo_actual` |
| `total` | «Entran este mes»: `entran_centavos` = `registrado_centavos` + `esperado_centavos`, el «ingresos del mes» de la simulación (E14-PPN 9.3). **Lo esperado incluye lo por confirmar** (D-091, E15 5.5: lo pendiente no es registrado aunque su fecha haya llegado). `por_confirmar` cuenta las fechas por confirmar del periodo: con dos o más la app ofrece «Confirmar todos» (D-093). Si el periodo ya terminó, la app dice «Entraron este mes» comparando `periodo` con `periodo_actual` |
| `fuentes` | Una por categoría de ingreso con algo en el periodo (RF-009), de mayor a menor `total_centavos` y, si empatan, por `categoria_id`; también una categoría oculta (`oculta: true`): un movimiento conserva su categoría. `[]` sin ingresos («Todavía no registras ingresos este mes.») |
| `ingresos` | Por fecha y, con la misma fecha, primero lo registrado. `marca`: `registrado` (con `movimiento_id`, el de PN-02), `esperado` o `por_confirmar` (con `recurrente_id`: «Confirmar» es `POST /api/v1/repeticiones/{recurrente_id}/confirmacion` con `fecha`, y «No pasó», `/omision`, de la US-60; el monto es el habitual y el medio, el de la repetición). La marca va siempre en texto, nunca solo en color |

PN-08 no comprueba la etapa: muestra ingresos propios, que una persona menor también registra.

Pruebas: `test/presupuesto/presupuesto_test.go` (contrato con un repositorio falso: Laura en noviembre, el caso P de octubre, los modos de D-094 P-3, los estados, las ocultas, el empate por nombre en español (tildes, «ñ», mayúsculas y nombres iguales), lo omitido y lo detenido, un mes pasado, el periodo de Colombia, sumas al centavo por encima de `int64` y los errores) y `test/presupuesto/integracion_test.go` (de punta a punta contra PostgreSQL, en web y Android: E14-PPA 2.2 con lo de otra persona, sumas exactas de la base, aportes y retiros fuera, categorías ocultas, el empate por nombre con el catálogo de la base, PN-08 con la confirmación de la US-60, una persona menor y una cuenta borrada contra el repositorio, 401 y 403). `test/app/rutas_test.go` lleva el inventario de rutas.

## Interpretación (US-62, `src/interpretacion`)

Convierte un texto escrito en español en una interpretación **con reglas y sin IA** (opción D, D-075, D-191). Es el puerto `Interpretador` de ADR-005 §5.1 y E12 §5.2 con su motor. La ruta HTTP que lo usa es [`POST /api/v1/movimientos/interpretacion`](#interpretar-un-texto-post-apiv1movimientosinterpretacion).

```go
type Interpretador interface {
	Interpretar(ctx context.Context, entrada Entrada) (Interpretacion, error)
}
type Entrada struct { Texto string; FechaReferencia time.Time }   // de la fecha solo cuenta el día
type Interpretacion struct {
	Monto *int64; Tipo Tipo; Fecha *time.Time; Categoria string; Intencion Intencion; ReglasVersion string
}
```

| Parte | Qué hace |
|---|---|
| `Interpretacion` | **Transitoria: nunca se guarda** (RN-001). `Monto` en **centavos** (D-082; las reglas dan pesos enteros y se multiplican por 100), `nil` si el texto no trae uno. Solo un texto con intención `registro` trae tipo, fecha (día en UTC) y categoría; una `pregunta` o una `recomendacion` los trae vacíos. La categoría es el nombre del catálogo: `RegistroServicio` la resuelve |
| `InterpretadorPorReglas` | El motor. Port a Go de `motor.py` (E11-PDC-D): normaliza (minúsculas, sin tildes, sustituciones) y aplica las reglas de `reglas.json` en orden de prioridad (intención, fecha, monto, tipo, categoría). **Reproduce D-1.0 sin tocar ninguna regla** (D-075 (4)). `NuevoPorReglas(reglas, ConPresupuesto(d))` |
| `ConjuntoDeReglas` | `CargarReglas(datos)` / `ReglasIncluidas()` leen `reglas.json`, expanden las macros `<<NOMBRE>>` y compilan cada patrón con **RE2** (`regexp`, tiempo lineal: sin ReDoS). **Falla al cargar**, no al interpretar, si un patrón sale del subconjunto portable (`EsPortable`) o no compila. Se carga una vez al arrancar y se comparte entre goroutines |
| `InterpretadorFalso` | Segunda implementación, con respuestas fijas (`Respuesta` y `Err`), para IAR-003 y para probar el flujo sin reglas |
| Límites (D-084 (2)) | **280 caracteres** (no bytes): más es `ErrTextoLargo`; vacío o solo espacios, `ErrTextoVacio`. **200 ms** por texto, con el contexto: `ErrTiempoAgotado`. RE2 no se puede interrumpir, así que el plazo se revisa entre etapas. Ante cualquier error la persona sigue con el formulario (RF-002) |
| `DetectorDeVariosMovimientos` | Heurística aparte (D-077 (4), E12 §6.3, E15 5.15): `ContarMontos(texto)` y `HayVarios(texto)` (dos o más). No usa el motor ni `reglas.json`. No cuenta fechas y días, la cantidad de una compra por precio, el valor de las cuotas ni el total explícito; es una heurística y se equivoca (DV-21 y DV-22). Su exactitud no se mide aquí: la mide E18 con un conjunto nuevo |
| `MontoAmbiguo(texto)` | D-084 (8): un número de 1 a 3 dígitos con un solo punto o una sola coma y 1 o 2 dígitos después («12.5», «12,50», «$8,5») se rechaza sin adivinar y devuelve las dos lecturas (`12.500` con punto de miles y `12,50` con coma decimal). No cuentan «8.500», «1.234,56», «12,5 mil», los porcentajes ni las fechas. Un número de cuatro dígitos o más antes de la coma («1234,50») no es ambiguo. **No cubre** «más de dos decimales» de E14 (por ejemplo «12,345»): lo lee el motor como siempre |
| Sin efectos | No guarda el texto ni lo registra (RN-001, RNF-005): el paquete no importa `log`, `slog`, `os`, red ni base de datos, y ningún error lleva el texto (lo comprueban las pruebas) |

**Dónde viven las reglas.** `reglas/reglas.json` es la fuente (con su SHA-256 en `reglas/SHA256SUMS`); `src/interpretacion/reglas.json` es una copia idéntica que va dentro del binario con `go:embed`, porque Go no embebe archivos de fuera de `api/` y la imagen solo copia `api/`. Una prueba y el pipeline de `reglas/` comprueban que sean idénticas. Ver [`reglas/README.md`](../reglas/README.md).

**Diferencias con el prototipo** (solo en entradas que el prototipo no resuelve: lanza una excepción o no tiene tope): un importe mayor que 2^53 pesos (o que desborda `float64`) da `Monto` `nil`; una fecha relativa fuera del calendario (año < 1) se ignora en vez de lanzar `OverflowError`; el UTF-8 inválido se sustituye por «�». Con las entradas de los dos conjuntos congelados y de 1 476 variaciones de los mensajes de desarrollo y de los autores externos (en mayúsculas, con otra fecha de referencia, con un «hace 2 días» agregado), la salida es idéntica.

**Pruebas** (`test/interpretacion`): **IAR-004** (misma salida que el prototipo, mensaje por mensaje, en los dos conjuntos, con el SHA-256 verificado antes); **IAR-001** (exactitud del código real contra RNF-006; imprime los porcentajes con `-v`); portabilidad RE2 (los 83 patrones compilan y están en el subconjunto portable); límites de 280 caracteres y de 200 ms; sin registro ni almacenamiento del texto; `InterpretadorFalso` cumple el puerto (IAR-003); `varios_test.go` (DV-01 a DV-22 de E15 5.15 y los montos ambiguos). La ruta se prueba en `test/registro` (ver arriba). La referencia está en `reglas/referencia/`.

### Interpretar un texto: `POST /api/v1/movimientos/interpretacion`

CU-03 (RF-001, RF-004). Nivel `requiere_autorizacion`, con la defensa contra CSRF de abajo, que pone el `Enrutador` (la ruta no la lleva); `TestElEnrutadorProtegeLaRutaDeInterpretacion` comprueba que sigue protegida y que un rechazo no llega al Interpretador. **No guarda nada** (RN-001): la persona revisa la propuesta en «Revisa y confirma» y, si confirma, el cliente guarda con `POST /api/v1/movimientos` y los campos que ella confirmó. Las reglas viven solo aquí (E17-ECO 4.7): el cliente muestra lo que recibe.

Cuerpo: `{"texto": "gasté 15 mil en almuerzo ayer"}`. Hasta **280 caracteres** (no bytes). La fecha de referencia es el hoy de Colombia (`Reloj`). `200` con `Cache-Control: no-store`; el resultado va siempre en `resultado`:

| `resultado` | Cuándo | Qué más trae | Qué muestra el cliente (E14-PPN 3.1) |
|---|---|---|---|
| `propuesta` | Un registro con monto | `tipo` (`gasto`/`ingreso`), `monto_centavos` (entero, D-082), `categoria` (`{id, nombre}` o `null`), `fecha` (`AAAA-MM-DD`), `varios_movimientos` | Llena el formulario y pasa a «Revisa y confirma» |
| `monto_ambiguo` | Un registro con un monto como «12.5» (D-084 (8)) | Lo mismo, con `monto_centavos: null`, y `lecturas_del_monto: {con_punto_de_miles, con_coma_decimal}` | «¿Quisiste decir $12.500 o $12,50?» en el campo Monto |
| `recomendacion` | Pide una recomendación financiera: RF-021, RE-001 (RP-027, RP-028) | nada | «Aquí no damos recomendaciones sobre créditos ni inversiones.» |
| `pregunta` | Una pregunta, no un registro (RF-044) | nada | «Aquí solo registramos movimientos.» |
| `no_entendido` | Un registro sin monto (CU-03 2c) | nada | «No pudimos entender el texto.» |
| `tiempo_agotado` | Pasaron los 200 ms (D-084 (2)) | nada | Lo mismo: la persona sigue con el formulario (RF-002) |

- **Categoría.** Solo una que la persona ve (RN-011, RF-005): si la que sugiere el motor está oculta o no es apta para un menor, `categoria` es `null` y ella elige; nunca se cambia por otra. El motor no usa la base de datos; el servicio hace una lectura del catálogo visible.
- **Varios movimientos** (D-077): `varios_movimientos: true` cuando el detector cuenta dos o más montos; solo se propone el primero («Tomamos solo el primer movimiento. Registra los otros por separado.»). Es una pista, no una decisión: nada se guarda.
- **Con varios montos, sin categoría** (D-196, paso 1, provisional hasta la US-68): con `varios_movimientos: true` la `categoria` es `null`, porque el motor puede sacarla de otro movimiento que el del monto y la fecha («mercado 45 mil ayer y 12 mil de pasajes» daba «Transporte»). El monto y la fecha siguen siendo los del primero y la persona elige la categoría; el cliente no pasa a «Revisa y confirma» sin ella («Falta elegir la categoría.»). La regla vive en el servicio (`src/registro/interpretar.go`), no en el motor: `reglas.json` no cambia. `TestInterpretarConMasDeUnMontoDejaLaCategoriaVacia` lo prueba, también que con un solo monto la categoría se sigue proponiendo.
- Errores: `422 datos_invalidos` con `campos.texto` = `texto_requerido` (vacío, solo espacios o sin el campo) o `texto_largo` (más de 280 caracteres), sin llamar al motor; `400 solicitud_invalida` con un campo fuera del contrato; `403`/`415` de la defensa CSRF; `401`/`403` del acceso. Un fallo inesperado del interpretador o del catálogo es `500 error_interno`; el tiempo agotado **no** es un 500.
- **El texto no se registra ni se guarda.** El registro técnico solo lleva la petición y el `resultado`.
- **IAR-003 y RN-005.** El `Servicio` recibe el `Interpretador` con `ConInterpretador`: el motor, el falso o un espía. `test/registro/interpretacion_test.go` comprueba que cambiarlo no cambia ninguna otra función (el mismo recorrido de categorías, guardar, listar, detalle, corregir, borrar, próximas y pendientes da byte a byte lo mismo), y que ninguna ruta que no es la de interpretación lo llama (un espía que falla), también con todo el Enrutador y PostgreSQL (`interpretacion_integracion_test.go`): los montos, totales y repeticiones que calcula el API nunca pasan por él (RN-005).

## Gaps de la US-49

- **Origen detrás de un proxy:** el límite por origen usa la dirección de la conexión. Detrás de Azure Container Apps todos los pedidos llegarían con la dirección de su entrada y el límite se volvería de todos juntos. Es la fila 17 del primer despliegue (D-143 (4)): se confiará solo en la dirección que agregue esa entrada. No se lee `X-Forwarded-For` mientras tanto.
- **Texto del correo de recuperación:** asunto («Recupera el acceso a tu cuenta de Alcanzamos») y cuerpo en E14-PCP 4.4 bis, aprobados por el dueño (D-144). El pie es el de D-143.
- **Recuperar y cambiar la contraseña de un menor:** el menor no tiene correo (no hay enlace) y PN-73 le llega con I11, cuando exista su inicio de sesión; por ahora `requiere_autorizacion` lo deja fuera.
- **Hash de relleno y parámetros nuevos:** el hash de relleno se calcula al arrancar con los parámetros del `Hasheador`; si estos suben, hay que reiniciar para que el relleno los siga (la mejora de hashes ya existe, D-144, ver «Iniciar sesión»).
- **Inicio de sesión de menores y de cuentas con credencial temporal:** solo entra quien tiene correo (I11 suma el nombre de usuario; la exigencia de fijar contraseña propia, NM-14, tampoco está).
- **Respuesta `200` al iniciar sesión** (no `201`) y `204` al cerrar: E12 no fija el código; la web y Android solo dependen del cuerpo.
- **Menores:** una persona menor no tiene correo que verificar y su `Verificada` queda en falso: con `sin_verificar` fuera, no llega a ninguna ruta con sesión (tampoco a cerrarla, que es `sin_autorizacion` como dice E18-PPR SEG-010) hasta que I11 defina su ingreso. Hoy no hay forma de iniciar sesión como menor.
- **Recuperar con la cuenta sin verificar:** no se manda enlace y la respuesta es la misma. Quien no confirmó su correo no tiene contraseña que recuperar; vuelve a PN-58 y recibe un enlace nuevo (D-172 (2)).
- **Quien insiste con el correo de otra persona puede agotarle los correos de la hora (D-140 (2), D-172 (2)):** los tres correos por hora a una dirección valen para quien lo pide y para quien lo recibe, así que 3 pedidos de un atacante hacen que durante esa hora no salga el de la dueña. No le da acceso a nada y la dueña puede intentar de nuevo pasada la hora; la recuperación de acceso no se afecta (A-17). Es el costo de limitar el correo por dirección, decidido por el dueño.
- **Trabajo en segundo plano de PN-58 y PN-59:** una goroutine por pedido, acotada solo por los límites de origen (20 por hora cada uno) y no por una cola: con muchos orígenes distintos a la vez, la base recibe todos esos trabajos. La recuperación sí tiene cola y trabajadores (D-144); si el despliegue lo pide, `pedirVerificacion` puede pasar a la misma cola.
- **La espera corta y el límite de la hora dan el mismo código** (`demasiados_intentos`): E14 dice que comparten texto.
- **Contadores y réplicas:** los contadores de los límites y la espera de 30 segundos viven en la memoria de cada réplica (D-123): con varias, cada una cuenta aparte. No afecta a la sesión de mentira, que se reconoce sin estado.

## Imagen

- Tres etapas: `node:24.22.1-alpine3.24` (digest `sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53`, índice multiarquitectura, resuelto el 2026-10-22; mismo Node que `.azure-pipelines/web.yml`) hace `npm ci` y `npm run build` en `web/` (necesita `diseno/`); `golang:1.27.3-alpine3.24` (digest `sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c`, índice multiarquitectura, resuelto el 2026-10-22) copia ese `web/dist` a `src/web/estatico/` y compila un binario estático con la web embebida; `gcr.io/distroless/static-debian13:nonroot` lo ejecuta, fijada por digest `sha256:18f4cc26c9ffa7f20a359298be7deadac5c607c8e03a02b8119f1a5fc2f82c99` (índice multiarquitectura subido el 2026-10-23, D-161; se usa el más nuevo que cumple 7 días de antigüedad).
- El contexto es la raíz del monorepo; el `.dockerignore` de la raíz deja pasar solo `api/`, `web/` y `diseno/`.
- Distroless no trae shell, así que no hay `HEALTHCHECK` ni comandos en forma de shell; la salud se consulta por `/salud` desde fuera.
- Corre como usuario 65532 (nonroot), sin root. El `ENTRYPOINT` es el binario.
- Go 1.27.3 (go.dev, 2026-10-22; SHA-256 del tarball `65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40`, fijado en `.azure-pipelines/api.yml`).

## Base de datos y migraciones

- `pgx` v5 (`pgxpool`) conecta con PostgreSQL. La URL sale de `BASE_DE_DATOS_URL`. Toda conexión del pool fija `TimeZone=UTC` (`bd.Conectar`; E17 3.9), aunque la URL o `PGTZ` pidan otra zona (A-05).
- `goose` v3 se usa como biblioteca. Las migraciones van embebidas en el binario (`embed`).
- `api migrar` aplica las migraciones pendientes y termina.
- `0001_esquema_inicial.sql`, `0002_catalogo.sql` y `0003_ingreso_anterior.sql` (la columna `credencial.ingreso_anterior`, D-134) son copia idéntica de las de E13 (D-122). No se editan aquí. Si hay que cambiar algo, el cambio vuelve primero a E13, con nota fechada y versión nueva.

| Archivo | SHA-256 (igual en E13 y aquí) |
|---|---|
| `migraciones/0001_esquema_inicial.sql` | `1244bc98f8218c202851a2a7cc18ae212b0c5a316d9238220e55ff48f351ab30` |
| `migraciones/0002_catalogo.sql` | `f95c1a03e3a956cec11b448d913ebb79df5c96c72f1e475b446a35566c36de3b` |
| `migraciones/0003_ingreso_anterior.sql` | `005fb34328e7ab1a2bc2842ffa722b7b2f3fb3382e4adbdc216ed6a7c0ff87c5` |

`test/migraciones/migraciones_test.go` compara el SHA-256 de cada archivo embebido con el de esta tabla. `TestMigracion0003AgregaYQuitaIngresoAnterior` comprueba que la columna (`timestamptz`) existe tras subir y no existe tras bajar solo esa migración.

Prueba de integración (PostgreSQL 18 del compose local; deja la base sin tablas):

```sh
POSTGRES_PORT=55432 docker compose -f infra/local/compose.yaml --env-file infra/local/.env.example up -d --wait postgres
cd api
BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@127.0.0.1:55432/alcanzamos go test -race -tags integration ./...
docker compose -f ../infra/local/compose.yaml --env-file ../infra/local/.env.example down -v
```

## Cobertura y barrera del pipeline (E17-ECO 5.5, D-146, D-148, D-149)

Las pruebas viven en `test/` y miden `src/` con `-coverpkg=./src/...`. Las dos listas de paquetes son explícitas (E17-ECO 5.5) y se comparan por ruta completa relativa a `src/` (`cmd/api` es ese paquete; `cmd` solo no lo es). El pipeline `api` (`.azure-pipelines/api.yml`) falla si:

- el grupo **núcleo y seguridad** (`nucleo` cuando exista, `seguridad`, `argon2id`, `sesion`, `servidor`, `autenticacion`, `cuenta`, D-151, `autorizacion`, US-50, `fechas` y `registro`, US-51, `interpretacion`, US-62, y `presupuesto`, US-77) queda bajo **90 %**;
- el grupo **resto del API** (`app`, `bd`, `cmd/api`, `config`, `correo`, `pg`, `reloj`, `tareas` y `web`) queda bajo **75 %**;
- algún grupo queda bajo la base de `test/cobertura-base.json` (sin bajar respecto de `main`). Un PR que sube la cobertura puede subir la base (valores con un decimal, redondeados hacia abajo); **nunca bajarla**;
- aparece un paquete de `src/` que **no está en ninguna de las dos listas**. Se busca en el perfil de cobertura y también en un recorrido de las carpetas de `src/` con archivos `.go` (tercer argumento de `medir`), así que un paquete sin pruebas tampoco pasa. Hay que clasificarlo en E17-ECO 5.5 y en `cobertura.py`. Un paquete nuevo de seguridad no cae al 75 % sin que nadie lo note. `nucleo` puede no existir todavía: su ausencia no falla.

El recorrido ignora los archivos `.go` con `//go:build ignore` (generadores que se corren con `go run`, como `src/seguridad/datos/generar_es.go`): no forman parte de ningún paquete.

Para correr la barrera en local, con el PostgreSQL del compose (ver arriba) y desde la raíz del monorepo:

```sh
cd api
export BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@127.0.0.1:55432/alcanzamos?sslmode=disable
go run ./src/cmd/api migrar
go test -count=1 -p 1 -tags integration -coverpkg=./src/... -coverprofile=c.out ./test/...
cd ..
python3 -I -B .azure-pipelines/pruebas/cobertura.py medir api/c.out api/test/cobertura-base.json api/src
python3 -I -B .azure-pipelines/pruebas/cobertura.py probar   # prueba del propio script
```

La salida es una tabla por grupo y por paquete; el código de salida es 1 si algo falla. `c.out` no se confirma. Sin PostgreSQL las pruebas de integración se saltan y la cobertura sale más baja de lo que el pipeline mide.

## Pruebas de escritorio de E15 (EXA-006, D-111, D-181)

Regla fuerte de D-111 (Q-13): cada id de E15 existe como subprueba `t.Run("<id>", …)` y pasa. EXA-006 se cumple **por algoritmo**, no de una vez (D-181): **cada historia que construye un algoritmo de E15 trae todas sus filas como subpruebas con su id, y pasan** (E17-ECO paso 41). Hoy el API implementa el 5.2 y el 5.15. El 5.2 (`src/fechas`, con `src/registro`) tiene sus 23 ids (FP-01 a FP-23) en `test/fechas`, bajo `TestFP` (`go test ./test/fechas -run 'TestFP/^FP-17$' -v`). El 5.15, el detector de varios movimientos (`src/interpretacion`), tiene sus 22 ids (DV-01 a DV-22) en `test/interpretacion/varios_test.go`. Los otros 17 algoritmos (241 ids) entran con la historia que los construya.

`test/e15` lo vigila (`TestEXA_006…`): lee `test/e15/ids.json`, una copia de los ids de E15 (los documentos están en otro repositorio y el pipeline no los ve), y falla si a un prefijo de `construidos` le falta una subprueba, o si alguna subprueba con forma de id de E15 usa un id que E15 no tiene. **Agregar el prefijo a `construidos` en `ids.json` es parte de la historia que construye el algoritmo.** Si cambia E15 (una fila nueva o retirada), se regenera la copia con el repositorio de documentos al lado:

```sh
python3 -I -B api/test/e15/generar_ids.py <documentos>/docs/adso/proyecto/03-diseno/E15-diseno-algoritmico/01-diseno-algoritmico.md > /tmp/ids.json && mv /tmp/ids.json api/test/e15/ids.json
```

El generador solo lee E15, usa la lógica de `e18-ids-e15.py` y conserva la lista `construidos` del archivo actual.

## Análisis estático (golangci-lint)

El pipeline `api` corre `go vet ./...` y después `go tool golangci-lint run` (v2.15.0, publicado el 2026-10-16), con la configuración `api/.golangci.yml`. La herramienta es una directiva `tool` de `go.mod` (D-161), como `govulncheck`: no se instala nada aparte, no entra en el binario del API y no está en `src/`. Activa solo los cuatro analizadores de E17-ECO 3.5 (`Q-2`, D-110): `errcheck` (con `check-blank`: también marca `_ = f()`), `staticcheck`, `asciicheck` y `depguard`. Reglas de `depguard` (E17 3.2): el núcleo (`reloj`, `fechas`) no importa paquetes del proyecto, `seguridad` no importa módulos de negocio, y ningún módulo ni `seguridad` importa `pg`, `bd`, `app` ni `pgx`. E17 no trae una lista concreta de paquetes: las reglas son las mínimas de E12 §4 (reglas 1, 3 y 4) y E17 3.10; se amplían cuando E12 §4 se actualice (D-1 de la auditoría).

Excepciones de `errcheck` (A-13, D-178 (2)), todas con su razón en la configuración o junto al código: `crypto/rand.Read` (desde Go 1.24 no devuelve error: si no hay entropía, el programa se detiene); `pgx.Tx.Rollback` (el `defer tx.Rollback(ctx)` tras el `Commit` devuelve `ErrTxClosed` y no hay nada que hacer); todo `api/test/`; y cinco `//nolint:errcheck` con su razón junto al código (`EscribirJSON`: la conexión ya cerrada por la persona; `mime.AddExtensionType` con una constante válida; `SetDeadline` de una conexión TCP recién abierta; el cierre de la conexión y del cliente SMTP cuando ya se devuelve otro error). En local: `cd api && go tool golangci-lint run` (con `go vet ./...` aparte, que no está en el agregador).

## Vulnerabilidades (govulncheck)

El pipeline `api` corre `go tool govulncheck -format json ./...` (v1.9.0, 2026-10-11) después de `golangci-lint`, y `.azure-pipelines/pruebas/vulnerabilidades.py` aplica la regla de los 7 días a cada vulnerabilidad que el código alcanza (las que harían salir a govulncheck con código 3): avisa sin fallar si el arreglo se publicó hace menos de 7 días, con el momento en que los cumple (para Go, contados desde el final del día de publicación, 00:00 UTC del día siguiente, D-201: la regla que obliga a adoptar una versión nunca se adelanta a la que permite adoptarla); falla si tiene 7 días o más, si no hay arreglo, si es solo una pseudo-versión o si no puede obtener la fecha. El aviso solo vale para fusionar, no para desplegar. Las fuentes de la fecha y el detalle están en `.azure-pipelines/README.md`. La herramienta está como directiva `tool` en `go.mod`, con sus sumas en `go.sum`, así que la versión queda fijada con el resto de las dependencias; no entra en el binario del API (`go version -m` lista los mismos módulos) y no está en `src/`, de modo que la barrera de cobertura no la ve. En local, desde la raíz del repositorio:

```sh
(cd api && mkdir -p bin && go tool govulncheck -format json ./... > bin/govulncheck.json)
python3 -I -B .azure-pipelines/pruebas/vulnerabilidades.py revisar api/bin/govulncheck.json
```

Con la salida de texto (`cd api && go tool govulncheck ./...`) se ven las trazas, sin la regla de los 7 días.

Hallazgo conocido y documentado: `GO-2026-5932` (el paquete `golang.org/x/crypto/openpgp` está sin mantenimiento y es inseguro por diseño; su único arreglo es la pseudo-versión `v0.58.1-0.20261009181718-2f1f834330b2`). Afecta al módulo `golang.org/x/crypto` que el API requiere, pero solo importa `x/crypto/argon2` y no llama a `openpgp`: govulncheck lo informa como «vulnerabilidad en módulos que requiere» y no cuenta. Si algún día el código llama a `openpgp`, el paso falla (el arreglo es solo una pseudo-versión).

## Dependencias

Últimas versiones estables, verificadas en `proxy.golang.org` el 2026-10-22.

| Módulo | Versión | Licencia |
|---|---|---|
| `github.com/jackc/pgx/v5` | v5.11.0 (2026-09-07) | MIT |
| `github.com/pressly/goose/v3` | v3.29.0 (2026-10-11) | MIT |
| `golang.org/x/crypto` | v0.58.0 (2026-10-09) | BSD de 3 cláusulas |

Herramienta (directiva `tool`): `golang.org/x/vuln` v1.9.0 (2026-10-11, BSD de 3 cláusulas), que sube `golang.org/x/mod` a v0.42.0 (2026-10-09) y `golang.org/x/tools` a v0.52.0 (2026-10-10) y suma `golang.org/x/telemetry` (2026-10-10), todos con más de 7 días.

Indirectas: `pgpassfile`, `pgservicefile`, `puddle/v2`, `mfridman/interpolate`, `multierr` (MIT), `go-retry` (Apache-2.0), `x/sync` y `x/text` (BSD de 3 cláusulas). Todas son compatibles con la AGPLv3.

## Contraseñas (Argon2id)

- Paquete `src/argon2id`, sobre `golang.org/x/crypto/argon2`. Lo usa `cuenta.Servicio` al crear la cuenta. La política de contraseñas está en [Seguridad](#política-de-contraseñas-politicadecontrasena-rf-035-d-089-d-142).
- Parámetros OWASP: 19 MiB, 2 iteraciones, paralelismo 1. Sal de 16 bytes, clave de 32.
- Formato PHC: `$argon2id$v=19$m=19456,t=2,p=1$<sal>$<clave>`, base64 sin relleno.
- `Verificar` lee los parámetros del hash y compara en tiempo constante. Rechaza hashes con parámetros fuera de tope (memoria máxima 256 MiB).
- `NecesitaMejora` dice si un hash guardado quedó por debajo de los parámetros del `Hasher` (cualquiera de memoria, iteraciones o paralelismo menor, o sal o clave más cortas); un hash mal formado da `ErrFormato`. Lo usa el inicio de sesión (D-144).
- Un semáforo limita a 4 las operaciones simultáneas.
- Pruebas con los vectores Argon2id de la implementación de referencia (D-083): `src/test.c` de `P-H-C/phc-winner-argon2`, commit `92cd2e19b50b9a58d177e61e1d8ce925315d3d91` (último cambio del archivo; HEAD de `master` `f57e61e19229e23c4445b85494dbf7c07de721cb`, 2021-06-25). Los 8 vectores del bloque Argon2id no usan secreto ni datos asociados, así que aplican todos.
- Benchmark de una verificación: `go test -bench Verificar -run '^$' ./test/argon2id`.

## Tareas programadas

- `api tareas` es el punto de entrada del trabajo programado (`tareas.Ejecutor`, E12 `EjecutorDeTareas`). Se conecta con PostgreSQL, corre cada tarea aunque otra falle, registra `tareas: inicio` y `tareas: fin` (con cuántas terminaron bien) y termina con código 0, o 1 si una tarea falla o no hay base.
- **`BorrarCuentasSinConfirmar` (D-135, DAT-006):** borra la `persona` (el `CASCADE` se lleva perfil, credencial, **sesiones**, enlaces y datos) de las cuentas adultas creadas hace 7 días o más que no confirmaron el correo **o** no tienen vigente cada finalidad necesaria de una persona adulta, otorgada por ella misma. **La lista sale de `cuenta.ReglaDeFinalidades` (D-139), no del SQL:** la consulta la recibe como parámetro. Sin correo de aviso. Nunca toca una cuenta con el correo confirmado y lo necesario autorizado. **Con D-172 es la limpieza de las cuentas pendientes** (solo correo y enlace, sin credencial ni sesión): a los 7 días de su primera creación (pedir de nuevo el correo no reinicia el plazo) se borran con su enlace; `TestLaTareaBorraLaCuentaPendienteALosSieteDias` y `TestBorrarCuentasSinConfirmar` lo prueban. Excluye las cuentas que pasaron de menor a adulta (`fecha_de_paso`) y las de menores. Como `autorizacion` no tiene llave a la persona, las filas que hubiera quedan retiradas en ese instante y conservadas 3 años (E13 §7, plazo provisional). Es idempotente.
- **`LimpiarSesionesYEnlaces` (CU-52):** borra las filas de `sesion` y `enlace_un_uso` con `vence_en` anterior a ahora. Es idempotente.
- Se prueba con la misma imagen del API:

```sh
docker run --rm --network alcanzamos-local_default \
  -e BASE_DE_DATOS_URL=postgres://alcanzamos:solo-local@postgres:5432/alcanzamos \
  alcanzamos-api:dev tareas
```

La imagen es la misma, con la web incluida.

## Medición de O-10

Método y cifras en [`MEDICION-O10.md`](MEDICION-O10.md).
