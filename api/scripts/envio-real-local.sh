#!/usr/bin/env bash
# Envío real en local con Zoho CPaaS (US-80, D-205 (6), D-220).
#
# Manda UN correo de verificación a un buzón del dueño, desde una base local nueva y aparte:
#   1. levanta solo PostgreSQL en un proyecto de compose propio (alc-us80, puerto 55432) y comprueba que no existía;
#   2. corre las migraciones y arranca el API en 127.0.0.1:18080 con el SMTP de CPaaS;
#   3. hace un solo POST /api/v1/cuentas con el correo que se le pasa;
#   4. espera el envío en segundo plano, muestra el resultado y baja todo lo que creó.
#
# El token del agente de envío se lee del archivo (permisos 600) solo para pasárselo al proceso del API. Nunca se
# imprime: el script no usa `set -x`, no lo pone en la línea de comandos y revisa que no aparezca en el registro.
#
# Uso, desde cualquier carpeta del monorepo:
#   api/scripts/envio-real-local.sh tu-buzon@ejemplo.com
#
# Variables opcionales:
#   CORREO_TOKEN_ARCHIVO  archivo del token (por defecto ~/.config/alcanzamos/correo-uat.token)
#   CORREO_REMITENTE      por defecto no-responder@avisos-uat.alcanzamos.co (E11-INF)
#   CORREO_PRIVACIDAD     por defecto privacidad@alcanzamos.co (E11-INF)
#   CORREO_SMTP           por defecto smtp.zeptomail.com:587; otro valor solo sirve para probar el script sin CPaaS
set -euo pipefail
set +x
case $- in *x*) echo "No corras este script con -x: mostraría el token." >&2; exit 2 ;; esac

destino="${1:-}"
if [[ -z "$destino" || "$destino" != *@*.* || "$destino" == *[[:space:]]* ]]; then
  echo "Uso: $0 <correo-del-dueño>" >&2
  exit 2
fi

proyecto="alc-us80"
puerto_bd=55432
puerto_api=18080
archivo_token="${CORREO_TOKEN_ARCHIVO:-$HOME/.config/alcanzamos/correo-uat.token}"
remitente="${CORREO_REMITENTE:-no-responder@avisos-uat.alcanzamos.co}"
privacidad="${CORREO_PRIVACIDAD:-privacidad@alcanzamos.co}"
smtp="${CORREO_SMTP:-smtp.zeptomail.com:587}"

raiz="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
compose=(docker compose -p "$proyecto" -f "$raiz/infra/local/compose.yaml" --env-file "$raiz/infra/local/.env.example")

# --- comprobaciones antes de crear nada -------------------------------------------------------------------------
if [[ ! -f "$archivo_token" ]]; then
  echo "No existe el archivo del token: $archivo_token" >&2; exit 1
fi
if [[ "$(stat -c '%a' "$archivo_token")" != "600" || "$(stat -c '%u' "$archivo_token")" != "$(id -u)" ]]; then
  echo "El archivo del token tiene que ser tuyo y con permisos 600: $archivo_token" >&2; exit 1
fi
if [[ ! -s "$archivo_token" ]]; then
  echo "El archivo del token está vacío: $archivo_token" >&2; exit 1
fi
if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$proyecto")" || \
      -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$proyecto")" ]]; then
  echo "Ya existe el proyecto de compose $proyecto: la base no sería nueva. Bájalo con:" >&2
  echo "  ${compose[*]} down -v" >&2
  exit 1
fi
for puerto in "$puerto_bd" "$puerto_api"; do
  if ss -ltnH "sport = :$puerto" | grep -q .; then
    echo "El puerto $puerto ya está en uso." >&2; exit 1
  fi
done

echo "Se va a mandar UN correo de verificación real a: $destino"
echo "Remitente: $remitente · SMTP: $smtp · base nueva: proyecto $proyecto"
read -r -p "Escribe ENVIAR para seguir: " confirmacion
[[ "$confirmacion" == "ENVIAR" ]] || { echo "Cancelado."; exit 1; }

temporal="$(mktemp -d)"
pid_api=""
limpiar() {
  if [[ -n "$pid_api" ]] && kill -0 "$pid_api" 2>/dev/null; then
    kill "$pid_api" 2>/dev/null || true
    wait "$pid_api" 2>/dev/null || true
  fi
  "${compose[@]}" down -v >/dev/null 2>&1 || true
  rm -rf "$temporal"
}
trap limpiar EXIT

# --- base nueva y API -------------------------------------------------------------------------------------------
POSTGRES_PORT="$puerto_bd" "${compose[@]}" up -d --wait postgres >/dev/null
url_bd="postgres://alcanzamos:solo-local@127.0.0.1:$puerto_bd/alcanzamos?sslmode=disable"

(cd "$raiz/api" && go build -o "$temporal/api" ./src/cmd/api)
# Sin identidad de Azure: con ella el API rechaza BASE_DE_DATOS_URL.
unset AZURE_CLIENT_ID IDENTITY_ENDPOINT CONTAINER_APP_NAME
BASE_DE_DATOS_URL="$url_bd" "$temporal/api" migrar >"$temporal/migrar.log" 2>&1

CORREO_CONTRASENA="$(<"$archivo_token")" \
BASE_DE_DATOS_URL="$url_bd" \
CORREO_SMTP="$smtp" \
CORREO_USUARIO="emailapikey" \
CORREO_REMITENTE="$remitente" \
CORREO_PRIVACIDAD="$privacidad" \
URL_PUBLICA="http://localhost:5173" \
PUERTO="$puerto_api" \
  "$temporal/api" >"$temporal/api.log" 2>&1 &
pid_api=$!

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$puerto_api/salud" >/dev/null 2>&1 && break
  kill -0 "$pid_api" 2>/dev/null || { echo "El API no arrancó." >&2; break; }
  sleep 0.5
done

# --- un solo pedido -----------------------------------------------------------------------------------------------
codigo="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$puerto_api/api/v1/cuentas" \
  -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' \
  --data "{\"correo\":\"$destino\",\"mayor_de_edad\":true}")"
echo "POST /api/v1/cuentas → $codigo (202 = aceptado; el envío sigue en segundo plano)"

# El envío corre en segundo plano y solo deja registro si falla: se espera un rato y se revisa.
error=""
for _ in $(seq 1 30); do
  if grep -q 'no se pudo enviar el correo' "$temporal/api.log"; then error="sí"; break; fi
  sleep 1
done

if grep -qF -f "$archivo_token" "$temporal/api.log" "$temporal/migrar.log"; then
  echo "ALERTA: el token aparece en el registro. No se muestra el registro; avisa y revoca el token en CPaaS." >&2
  exit 1
fi

if [[ "$codigo" != "202" ]]; then
  echo "Resultado: el API no aceptó el pedido (HTTP $codigo). Registro del API (sin el token):"
  cat "$temporal/api.log"
  exit 1
elif [[ -n "$error" ]]; then
  echo "Resultado: FALLÓ el envío. Líneas del registro (sin el token ni el destino):"
  grep 'no se pudo enviar el correo' "$temporal/api.log"
  exit 1
else
  echo "Resultado: sin error de envío en 30 segundos. Revisa el buzón $destino (también spam)."
fi
