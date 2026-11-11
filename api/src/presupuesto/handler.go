package presupuesto

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/alcanzamos/alcanzamos/api/src/registro"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// CodigoSoloAdultos es el del 403 de ErrSoloAdultos.
const CodigoSoloAdultos = "solo_personas_adultas"

// Handler traduce HTTP a las operaciones del Servicio (E12 `PresupuestoHandler`). No manda textos: los códigos de error
// los traduce cada app. No registra montos ni textos (SEG-006).
type Handler struct {
	servicio *Servicio
	log      *slog.Logger
}

// NuevoHandler crea el manejador de las rutas del presupuesto.
func NuevoHandler(s *Servicio, log *slog.Logger) *Handler { return &Handler{servicio: s, log: log} }

// Registrar añade las rutas. Todas son `requiere_autorizacion`, como las del registro: leen y cambian datos financieros de
// la persona. La defensa contra CSRF de lo que no es GET la pone el Enrutador (D-194).
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/presupuestos", http.HandlerFunc(h.ver))
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/ingresos", http.HandlerFunc(h.ingresos))
}

// responder escribe los errores comunes: `422 datos_invalidos`, `403 solo_personas_adultas`, `401 sin_sesion` (la cuenta
// se borró mientras tanto) o un fallo. Devuelve true si ya respondió.
func (h *Handler) responder(w http.ResponseWriter, r *http.Request, que string, err error) bool {
	var invalido *registro.ErrValidacion
	switch {
	case err == nil:
		return false
	case errors.As(err, &invalido):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "datos_invalidos", "campos": invalido.Campos})
	case errors.Is(err, ErrSoloAdultos):
		servidor.EscribirError(w, http.StatusForbidden, CodigoSoloAdultos)
	case errors.Is(err, registro.ErrSinCuenta):
		servidor.EscribirError(w, http.StatusUnauthorized, servidor.CodigoSinSesion)
	default:
		h.log.ErrorContext(r.Context(), que, "peticion", seguridad.PeticionDe(r.Context()), "error", err)
		servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
	}
	return true
}

// ver atiende GET /api/v1/presupuestos?periodo=AAAA-MM (PN-06 y PN-07): `200` con la `Vista`. Sin `periodo`, el mes de hoy
// en Colombia. `422 datos_invalidos` con `periodo`.
func (h *Handler) ver(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	v, err := h.servicio.Ver(r.Context(), sujeto.Persona, r.URL.Query().Get("periodo"))
	if h.responder(w, r, "no se pudo leer el presupuesto", err) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, v)
}

// ingresos atiende GET /api/v1/ingresos?periodo=AAAA-MM (PN-08): `200` con `Ingresos`. Sin `periodo`, el mes de hoy en
// Colombia. `422 datos_invalidos` con `periodo`.
func (h *Handler) ingresos(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	l, err := h.servicio.VerIngresos(r.Context(), sujeto.Persona, r.URL.Query().Get("periodo"))
	if h.responder(w, r, "no se pudieron leer los ingresos", err) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, l)
}
