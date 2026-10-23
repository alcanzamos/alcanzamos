package autenticacion

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/cuenta"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
	"github.com/alcanzamos/alcanzamos/api/internal/servidor"
	"github.com/alcanzamos/alcanzamos/api/internal/sesion"
)

// Handler traduce HTTP a las operaciones del Servicio (E12 `AutenticacionHandler`). No tiene reglas: los códigos de
// error los pone el Servicio y los textos, el cliente.
type Handler struct {
	servicio *Servicio
	eventos  *seguridad.Registro
	log      *slog.Logger
}

// NuevoHandler crea el manejador de las rutas de entrar y salir.
func NuevoHandler(s *Servicio, eventos *seguridad.Registro, log *slog.Logger) *Handler {
	return &Handler{servicio: s, eventos: eventos, log: log}
}

// Registrar añade las rutas, cada una con su nivel de acceso (D-138). Cerrar sesión es `sin_verificar`: la cierra
// cualquier sesión, la limitada y la de mentira también. El ingreso anterior es de PN-71: pide la cuenta autorizada.
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.Publica, "POST /api/v1/sesiones", http.HandlerFunc(h.iniciar))
	e.Registrar(seguridad.SinVerificar, "DELETE /api/v1/sesiones/actual", http.HandlerFunc(h.cerrar))
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/cuenta/seguridad", http.HandlerFunc(h.seguridad))
}

func (h *Handler) fallar(w http.ResponseWriter, r *http.Request, que string, err error) {
	h.log.ErrorContext(r.Context(), que, "peticion", seguridad.PeticionDe(r.Context()), "error", err)
	servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
}

// iniciar atiende POST /api/v1/sesiones (PN-60): `{identificador, contrasena}`. Es pública.
//
//   - 200 `{"estado":"activa"}` con el correo ya confirmado, o `{"estado":"verificacion_pendiente"}` con la sesión
//     limitada de D-138 (el cliente sigue a PN-59). Si la cuenta puede usar lo demás lo decide el Enrutador en cada
//     ruta. El token va en la cookie `__Host-sesion` (web) o en el cuerpo (Android, `X-Alcanzamos-Cliente: android`),
//     que se rechaza con 400 si el pedido trae `Origin` o `Sec-Fetch-Site` (D-143 (3)).
//   - 401 `credenciales_invalidas`: igual para una contraseña mal escrita y para una cuenta que no existe.
//   - 429 `demasiados_intentos`: igual exista o no la cuenta.
//
// Cada fallo y cada intento frenado deja el evento `inicio_sesion_fallido` (D-136 (3)), sin cuenta ni origen.
func (h *Handler) iniciar(w http.ResponseWriter, r *http.Request) {
	entrega, err := sesion.EntregaDe(r)
	if err != nil {
		servidor.EscribirError(w, http.StatusBadRequest, "solicitud_invalida")
		return
	}
	var cuerpo struct {
		Identificador string `json:"identificador"`
		Contrasena    string `json:"contrasena"`
	}
	if !servidor.LeerJSON(w, r, &cuerpo) {
		return
	}
	iniciada, err := h.servicio.IniciarSesion(r.Context(), cuerpo.Identificador, cuerpo.Contrasena, cuenta.OrigenDe(r))
	var invalida *cuenta.ErrValidacion
	switch {
	case errors.As(err, &invalida):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "validacion", "campos": invalida.Campos})
	case errors.Is(err, ErrDemasiadosIntentos):
		h.eventos.Registrar(r.Context(), seguridad.InicioSesionFallido, "", r.Pattern, http.StatusTooManyRequests)
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
	case errors.Is(err, ErrCredencialesInvalidas):
		h.eventos.Registrar(r.Context(), seguridad.InicioSesionFallido, "", r.Pattern, http.StatusUnauthorized)
		servidor.EscribirError(w, http.StatusUnauthorized, "credenciales_invalidas")
	case err != nil:
		h.fallar(w, r, "no se pudo iniciar la sesión", err)
	default:
		estado := "verificacion_pendiente"
		if iniciada.Verificada {
			estado = "activa"
		}
		cuerpo := map[string]string{"estado": estado}
		if entrega == sesion.PorCuerpo {
			cuerpo["token"] = iniciada.Token
		} else {
			http.SetCookie(w, sesion.Cookie(iniciada.Token))
		}
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusOK, cuerpo)
	}
}

// cerrar atiende DELETE /api/v1/sesiones/actual: borra la sesión de la petición y responde 204. Siempre manda la orden
// de borrar la cookie (`Max-Age=0`, mismos atributos), también en Android, donde no hace nada. La sesión de mentira
// responde exactamente igual: no hay fila que borrar (D-141).
func (h *Handler) cerrar(w http.ResponseWriter, r *http.Request) {
	if err := h.servicio.CerrarSesion(r.Context(), sesion.TokenDe(r)); err != nil {
		h.fallar(w, r, "no se pudo cerrar la sesión", err)
		return
	}
	http.SetCookie(w, sesion.CookieVencida())
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// seguridad atiende GET /api/v1/cuenta/seguridad (PN-71): `{"ingreso_anterior": <RFC 3339 en UTC> | null}`. Es el
// inicio de sesión anterior al de ahora; `null` es el primer ingreso y el cliente dice que lo es.
func (h *Handler) seguridad(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	anterior, err := h.servicio.IngresoAnterior(r.Context(), sujeto.Persona)
	if err != nil {
		h.fallar(w, r, "no se pudo leer el ingreso anterior", err)
		return
	}
	var valor *string
	if anterior != nil {
		texto := anterior.UTC().Format(time.RFC3339)
		valor = &texto
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, map[string]*string{"ingreso_anterior": valor})
}
