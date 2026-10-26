package registro

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// Handler traduce HTTP a las operaciones del Servicio (E12 `RegistroHandler`). No manda textos: los códigos de error
// los traduce cada app.
type Handler struct {
	servicio *Servicio
	log      *slog.Logger
}

// NuevoHandler crea el manejador de las rutas del formulario de registro.
func NuevoHandler(s *Servicio, log *slog.Logger) *Handler { return &Handler{servicio: s, log: log} }

// Registrar añade las rutas. Todas son `requiere_autorizacion`: guardan y leen datos financieros de la persona (las
// próximas fechas no tocan datos, pero solo las usa el formulario de quien ya autorizó).
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/categorias", http.HandlerFunc(h.categorias))
	e.Registrar(seguridad.RequiereAutorizacion, "POST /api/v1/movimientos", http.HandlerFunc(h.crear))
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/repeticiones/proximas", http.HandlerFunc(h.proximas))
}

func (h *Handler) fallar(w http.ResponseWriter, r *http.Request, que string, err error) {
	h.log.ErrorContext(r.Context(), que, "peticion", seguridad.PeticionDe(r.Context()), "error", err)
	servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
}

// categorias atiende GET /api/v1/categorias: `200 {"gasto":[…],"ingreso":[…]}`, cada categoría con `id`, `nombre` (la
// clave del catálogo de E09) y `general`. Solo las que la persona puede usar y no ocultó.
func (h *Handler) categorias(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	catalogo, err := h.servicio.Categorias(r.Context(), sujeto.Persona)
	if err != nil {
		h.fallar(w, r, "no se pudieron listar las categorías", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, catalogo)
}

// crear atiende POST /api/v1/movimientos. `201` con los ids y, si se repite, `proximas` y `pendientes`;
// `422 {"error":"datos_invalidos","campos":{"<campo>":"<código>"}}` con todos los campos inválidos a la vez; un campo
// que no está en el contrato (`persona_id`, `hogar_id`…) da `400 solicitud_invalida`: la dueña de la fila es siempre
// la persona de la sesión.
func (h *Handler) crear(w http.ResponseWriter, r *http.Request) {
	var sol Solicitud
	if !servidor.LeerJSON(w, r, &sol) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	res, err := h.servicio.Registrar(r.Context(), sujeto.Persona, sol)
	var invalido *ErrValidacion
	switch {
	case errors.As(err, &invalido):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "datos_invalidos", "campos": invalido.Campos})
	case err != nil:
		h.fallar(w, r, "no se pudo guardar el movimiento", err)
	default:
		h.log.InfoContext(r.Context(), "movimiento registrado", "peticion", seguridad.PeticionDe(r.Context()))
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusCreated, res)
	}
}

// proximas atiende GET /api/v1/repeticiones/proximas?periodicidad=…&inicio=AAAA-MM-DD: `200 {"proximas":[…]}` con hasta
// tres fechas AAAA-MM-DD después de hoy (D-165); `422 datos_invalidos` con `periodicidad` e `inicio`, como el POST.
func (h *Handler) proximas(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lista, err := h.servicio.Proximas(q.Get("periodicidad"), q.Get("inicio"))
	var invalido *ErrValidacion
	switch {
	case errors.As(err, &invalido):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "datos_invalidos", "campos": invalido.Campos})
	case err != nil:
		h.fallar(w, r, "no se pudieron calcular las próximas fechas", err)
	default:
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusOK, map[string][]string{"proximas": lista})
	}
}
