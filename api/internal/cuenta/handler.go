package cuenta

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"

	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
)

// Handler traduce HTTP a las operaciones del Servicio (E12 `CuentaHandler`). No tiene reglas: los códigos de
// error de campo los pone el Servicio y los textos, el cliente.
type Handler struct {
	servicio *Servicio
	sesiones servidor.Sesiones
	log      *slog.Logger
}

// NuevoHandler crea el manejador de las rutas de la cuenta. sesiones es el mismo resolutor del Enrutador: la ruta
// que verifica el correo es pública, pero mira si la petición trae la sesión de la cuenta para decirle al cliente a
// dónde seguir.
func NuevoHandler(s *Servicio, sesiones servidor.Sesiones, log *slog.Logger) *Handler {
	return &Handler{servicio: s, sesiones: sesiones, log: log}
}

// Registrar añade las rutas de la cuenta, cada una con su nivel de acceso (D-138). Las tres de PN-59 son
// `sin_verificar`: las usa la sesión limitada de una cuenta sin verificar y, con la misma respuesta, la de mentira.
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.Publica, "POST /api/v1/cuentas", http.HandlerFunc(h.crear))
	e.Registrar(seguridad.Publica, "POST /api/v1/cuentas/verificacion", http.HandlerFunc(h.verificar))
	e.Registrar(seguridad.SinVerificar, "GET /api/v1/cuentas/estado", http.HandlerFunc(h.estado))
	e.Registrar(seguridad.SinVerificar, "POST /api/v1/cuentas/verificacion/reenvio", http.HandlerFunc(h.reenviar))
	e.Registrar(seguridad.SinVerificar, "POST /api/v1/cuentas/correo", http.HandlerFunc(h.cambiarCorreo))
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

// escribirSesion responde 202 con la sesión nueva, con el token en la cookie (web) o en el cuerpo (Android, D-143 (3)).
// Es la única forma de responder una creación de cuenta: la real y
// la de mentira pasan por aquí, así tienen el mismo estado, las mismas cabeceras y el mismo cuerpo.
func escribirSesion(w http.ResponseWriter, entrega sesion.EntregaDelToken, s SesionNueva) {
	cuerpo := map[string]string{"estado": "verificacion_pendiente"}
	if entrega == sesion.PorCuerpo {
		cuerpo["token"] = s.Token
	} else {
		http.SetCookie(w, sesion.Cookie(s.Token))
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusAccepted, cuerpo)
}

// crear atiende POST /api/v1/cuentas (PN-58). Publica: la persona aún no tiene sesión. Cuenta cada intento contra el
// límite del origen (D-140) antes de mirar nada; si se pasó, 429 con el mismo texto sin importar el correo.
func (h *Handler) crear(w http.ResponseWriter, r *http.Request) {
	if !h.servicio.PermitirCreacion(OrigenDe(r)) {
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
		return
	}
	// Android pide el token en el cuerpo, pero un pedido con cabeceras de navegador no puede (D-143 (3)). Solo depende
	// de las cabeceras, nunca de la cuenta: rechazarlo no delata nada. Se decide antes de crear nada.
	entrega, err := sesion.EntregaDe(r)
	if err != nil {
		servidor.EscribirError(w, http.StatusBadRequest, "solicitud_invalida")
		return
	}
	var cuerpo struct {
		Correo      string `json:"correo"`
		Contrasena  string `json:"contrasena"`
		Nombre      string `json:"nombre"`
		MayorDeEdad bool   `json:"mayor_de_edad"`
	}
	if !leer(w, r, &cuerpo) {
		return
	}
	sesionNueva, err := h.servicio.CrearCuenta(r.Context(), SolicitudDeCuenta(cuerpo))
	var invalida *ErrValidacion
	switch {
	case errors.As(err, &invalida):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "validacion", "campos": invalida.Campos})
	case err != nil:
		h.fallar(w, r, "no se pudo crear la cuenta", err)
	default:
		escribirSesion(w, entrega, sesionNueva)
	}
}

// verificar atiende POST /api/v1/cuentas/verificacion (PN-59). Es pública y el token del enlace es la autoridad:
// funciona desde cualquier dispositivo, con o sin sesión. Responde `{"estado":"verificado","con_sesion":bool}`:
// `con_sesion` es verdadero solo si la petición trae la sesión real de la cuenta que se acaba de verificar. El cliente
// muestra «Listo, confirmamos tu correo.» y, con sesión, sigue a PN-63; sin ella (el enlace se abrió en otro
// dispositivo) sigue a PN-60 para entrar.
func (h *Handler) verificar(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Token string `json:"token"`
	}
	if !leer(w, r, &cuerpo) {
		return
	}
	persona, err := h.servicio.VerificarCorreo(r.Context(), cuerpo.Token)
	switch {
	case errors.Is(err, ErrEnlaceInvalido):
		servidor.EscribirError(w, http.StatusBadRequest, "enlace_invalido") // PN-59: «Ese enlace ya no sirve.»
	case err != nil:
		h.fallar(w, r, "no se pudo verificar el correo", err)
	default:
		sujeto, errSesion := h.sesiones.SujetoDe(r)
		conSesion := errSesion == nil && !sujeto.Senuelo && sujeto.Persona == persona
		servidor.EscribirJSON(w, http.StatusOK, map[string]any{"estado": "verificado", "con_sesion": conSesion})
	}
}

// claveDeCuenta es lo que identifica a la cuenta ante los límites: la persona, o el token de la sesión de mentira.
// Los dos se limitan igual, así el 429 no los distingue.
func claveDeCuenta(r *http.Request, s seguridad.Sujeto) string {
	if s.Senuelo {
		return "senuelo:" + sesion.TokenDe(r)
	}
	return s.Persona
}

// estado atiende GET /api/v1/cuentas/estado (PN-59, «Ya lo confirmé»): `{"verificada":bool}`. La sesión de mentira
// siempre da falso, como una cuenta real que nadie ha confirmado.
func (h *Handler) estado(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	servidor.EscribirJSON(w, http.StatusOK, map[string]bool{"verificada": sujeto.Verificada && !sujeto.Senuelo})
}

// responderPN59 escribe el resultado de reenviar o cambiar el correo. Es una sola función para las dos acciones y para
// los dos tipos de sesión: sin ella habría dos lugares donde una diferencia se colaría.
func (h *Handler) responderPN59(w http.ResponseWriter, r *http.Request, err error) {
	var invalida *ErrValidacion
	switch {
	case errors.Is(err, ErrDemasiadosIntentos):
		// La espera corta y los límites de la hora comparten texto (E14-PCP, PN-59): el mismo código.
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
	case errors.Is(err, ErrYaVerificado):
		servidor.EscribirError(w, http.StatusConflict, "ya_verificada")
	case errors.As(err, &invalida):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "validacion", "campos": invalida.Campos})
	case err != nil:
		h.fallar(w, r, "no se pudo atender la acción de PN-59", err)
	default:
		servidor.EscribirJSON(w, http.StatusAccepted, map[string]string{"estado": "verificacion_pendiente"})
	}
}

// reenviar atiende POST /api/v1/cuentas/verificacion/reenvio (PN-59, «Reenviar el correo»).
func (h *Handler) reenviar(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	h.responderPN59(w, r, h.servicio.ReenviarVerificacion(r.Context(), sujeto, claveDeCuenta(r, sujeto), OrigenDe(r)))
}

// cambiarCorreo atiende POST /api/v1/cuentas/correo (PN-59, «Cambiar el correo»): `{correo}`.
func (h *Handler) cambiarCorreo(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Correo string `json:"correo"`
	}
	if !leer(w, r, &cuerpo) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	h.responderPN59(w, r, h.servicio.CambiarCorreoSinVerificar(r.Context(), sujeto, claveDeCuenta(r, sujeto), OrigenDe(r), cuerpo.Correo))
}
