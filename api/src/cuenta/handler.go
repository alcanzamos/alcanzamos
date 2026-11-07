package cuenta

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

// Handler traduce HTTP a las operaciones del Servicio (E12 `CuentaHandler`). No tiene reglas: los códigos de
// error de campo los pone el Servicio y los textos, el cliente.
type Handler struct {
	servicio *Servicio
	log      *slog.Logger
}

// NuevoHandler crea el manejador de las rutas de la cuenta.
func NuevoHandler(s *Servicio, log *slog.Logger) *Handler {
	return &Handler{servicio: s, log: log}
}

// Registrar añade las rutas de la cuenta, cada una con su nivel de acceso. Crear la cuenta, reenviar el correo y
// completar la cuenta con el enlace son públicas: ninguna tiene sesión hasta que PN-74 guarda la contraseña (D-172).
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.Publica, "POST /api/v1/cuentas", http.HandlerFunc(h.crear))
	e.Registrar(seguridad.Publica, "POST /api/v1/cuentas/verificacion", http.HandlerFunc(h.completar))
	e.Registrar(seguridad.Publica, "POST /api/v1/cuentas/verificacion/reenvio", http.HandlerFunc(h.reenviar))
}

// leer decodifica el cuerpo JSON de la petición (ver servidor.LeerJSON).
func leer(w http.ResponseWriter, r *http.Request, destino any) bool {
	return servidor.LeerJSON(w, r, destino)
}

func (h *Handler) fallar(w http.ResponseWriter, r *http.Request, que string, err error) {
	h.log.ErrorContext(r.Context(), que, "peticion", seguridad.PeticionDe(r.Context()), "error", err)
	servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
}

// OrigenDe es el origen de la petición para los límites de intentos: la dirección IP del otro extremo de la conexión,
// y para IPv6 el prefijo /64 (una casa o una oficina recibe un /64 entero, y rotar dentro de él no debe evitar el
// límite). Solo vive en la memoria del limitador y nunca se registra (D-123).
//
// Es la dirección de la conexión en local. Detrás de Azure Container Apps todos los pedidos llegan con la dirección
// de su entrada y el límite por origen sería de todos juntos: en el despliegue solo se confiará en la dirección que
// agrega esa entrada (fila 17 del primer despliegue, D-143 (4)). No se lee `X-Forwarded-For` mientras tanto: sin un
// proxy de confianza, cualquiera podría escribirlo.
func OrigenDe(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	dir, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	dir = dir.Unmap()
	if dir.Is6() {
		if p, err := dir.Prefix(64); err == nil {
			return p.String()
		}
	}
	return dir.String()
}

// responderVerificacionPedida escribe el resultado de crear la cuenta o de reenviar el correo. Es una sola función para
// las dos rutas y para los tres casos de cuenta (nueva, sin verificar y verificada): sin ella habría dos lugares donde una
// diferencia se colaría. Siempre el mismo estado, las mismas cabeceras y el mismo cuerpo, sin cookie (D-172 (1), SEG-013).
func (h *Handler) responderVerificacionPedida(w http.ResponseWriter, r *http.Request, err error) {
	var invalida *ErrValidacion
	switch {
	case errors.Is(err, ErrDemasiadosIntentos):
		// La espera corta y los límites de la hora comparten texto (E14-PCP, PN-59): el mismo código.
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
	case errors.As(err, &invalida):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "validacion", "campos": invalida.Campos})
	case err != nil:
		h.fallar(w, r, "no se pudo pedir la verificación del correo", err)
	default:
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusAccepted, map[string]string{"estado": "verificacion_pendiente"})
	}
}

// crear atiende POST /api/v1/cuentas (PN-58): `{correo, mayor_de_edad}`. Pública: nunca da sesión ni `Set-Cookie`. Cuenta
// cada intento contra el límite del origen (D-140) antes de mirar nada; si se pasó, 429 con el mismo texto sin importar
// el correo.
func (h *Handler) crear(w http.ResponseWriter, r *http.Request) {
	if !h.servicio.PermitirCreacion(OrigenDe(r)) {
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
		return
	}
	var cuerpo struct {
		Correo      string `json:"correo"`
		MayorDeEdad bool   `json:"mayor_de_edad"`
	}
	if !leer(w, r, &cuerpo) {
		return
	}
	h.responderVerificacionPedida(w, r, h.servicio.CrearCuenta(r.Context(), SolicitudDeCuenta(cuerpo)))
}

// reenviar atiende POST /api/v1/cuentas/verificacion/reenvio (PN-59, «Reenviar el correo»): `{correo}`. Pública, con la
// misma respuesta que crear.
func (h *Handler) reenviar(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Correo string `json:"correo"`
	}
	if !leer(w, r, &cuerpo) {
		return
	}
	h.responderVerificacionPedida(w, r, h.servicio.ReenviarVerificacion(r.Context(), cuerpo.Correo, OrigenDe(r)))
}

// completar atiende POST /api/v1/cuentas/verificacion (PN-74, «Elige tu contraseña»): `{token, contrasena, nombre}`. Es
// pública y el token del enlace es la autoridad: funciona desde cualquier dispositivo y una sola vez.
//
//   - 200 `{"estado":"activa"}` con la sesión recién empezada: el token va en la cookie `__Host-sesion` (web) o en el
//     cuerpo (Android, `X-Alcanzamos-Cliente: android`), que se rechaza con 400 si el pedido trae `Origin` o
//     `Sec-Fetch-Site` (D-143 (3)). El correo queda verificado y la contraseña guardada antes de que exista la sesión.
//   - 400 `enlace_invalido`: el enlace no existe, ya se usó, venció o lo reemplazó uno nuevo (D-192). El cliente muestra
//     «Ese enlace ya no sirve.» y «Pedir otro enlace».
//   - 422 `validacion` con `contrasena` (`contrasena_vacia`, `contrasena_corta`, `contrasena_comun` o
//     `contrasena_personal`, que es la del correo o «Alcanzamos») o `nombre` (`nombre_vacio`, `nombre_largo`). El enlace
//     sigue vigente.
func (h *Handler) completar(w http.ResponseWriter, r *http.Request) {
	entrega, err := sesion.EntregaDe(r)
	if err != nil {
		servidor.EscribirError(w, http.StatusBadRequest, "solicitud_invalida")
		return
	}
	var cuerpo struct {
		Token      string `json:"token"`
		Contrasena string `json:"contrasena"`
		Nombre     string `json:"nombre"`
	}
	if !leer(w, r, &cuerpo) {
		return
	}
	nueva, err := h.servicio.VerificarYElegirContrasena(r.Context(), cuerpo.Token, cuerpo.Contrasena, cuerpo.Nombre)
	var invalida *ErrValidacion
	switch {
	case errors.Is(err, ErrEnlaceInvalido):
		servidor.EscribirError(w, http.StatusBadRequest, "enlace_invalido")
	case errors.As(err, &invalida):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "validacion", "campos": invalida.Campos})
	case err != nil:
		h.fallar(w, r, "no se pudo completar la cuenta", err)
	default:
		respuesta := map[string]string{"estado": "activa"}
		if entrega == sesion.PorCuerpo {
			respuesta["token"] = nueva.Token
		} else {
			http.SetCookie(w, sesion.Cookie(nueva.Token))
		}
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusOK, respuesta)
	}
}
