package cuenta

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"

	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
)

// tamanoMaximoDelCuerpo basta de sobra para tres campos de texto y corta cuerpos abusivos antes de calcular un hash.
const tamanoMaximoDelCuerpo = 16 << 10

// Handler traduce HTTP a las operaciones del Servicio (E12 `CuentaHandler`). No tiene reglas: los códigos de
// error de campo los pone el Servicio y los textos, el cliente.
type Handler struct {
	servicio *Servicio
	log      *slog.Logger
}

// NuevoHandler crea el manejador de las rutas de la cuenta.
func NuevoHandler(s *Servicio, log *slog.Logger) *Handler { return &Handler{servicio: s, log: log} }

// Registrar añade las rutas de la cuenta con su nivel de acceso.
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.Publica, "POST /api/v1/cuentas", http.HandlerFunc(h.crear))
}

// leer decodifica un cuerpo JSON de un solo objeto. Un campo que no esté en destino es un error: así, un cliente que
// mande la fecha de nacimiento recibe 400 y el API nunca la lee (D-089).
func leer(w http.ResponseWriter, r *http.Request, destino any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, tamanoMaximoDelCuerpo))
	d.DisallowUnknownFields()
	if err := d.Decode(destino); err != nil || d.Decode(&struct{}{}) != io.EOF {
		servidor.EscribirError(w, http.StatusBadRequest, "solicitud_invalida")
		return false
	}
	return true
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
