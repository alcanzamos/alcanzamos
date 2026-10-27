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

// Registrar añade las rutas. Todas son `requiere_autorizacion`: guardan, leen, corrigen y borran datos financieros de la
// persona (las próximas fechas no tocan datos, pero solo las usa el formulario de quien ya autorizó).
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/categorias", http.HandlerFunc(h.categorias))
	e.Registrar(seguridad.RequiereAutorizacion, "POST /api/v1/movimientos", http.HandlerFunc(h.crear))
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/movimientos", http.HandlerFunc(h.listar))
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/movimientos/{id}", http.HandlerFunc(h.detalle))
	e.Registrar(seguridad.RequiereAutorizacion, "PUT /api/v1/movimientos/{id}", http.HandlerFunc(h.corregir))
	e.Registrar(seguridad.RequiereAutorizacion, "DELETE /api/v1/movimientos/{id}", http.HandlerFunc(h.borrar))
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

// responder escribe lo común de las rutas de un movimiento: `422 datos_invalidos`, `404 no_encontrado` (el movimiento no
// existe o es de otra persona: el mismo código para los dos) o un fallo. Devuelve true si ya respondió.
func (h *Handler) responder(w http.ResponseWriter, r *http.Request, que string, err error) bool {
	var invalido *ErrValidacion
	switch {
	case err == nil:
		return false
	case errors.As(err, &invalido):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "datos_invalidos", "campos": invalido.Campos})
	case errors.Is(err, ErrNoEncontrado):
		servidor.EscribirError(w, http.StatusNotFound, "no_encontrado")
	default:
		h.fallar(w, r, que, err)
	}
	return true
}

// listar atiende GET /api/v1/movimientos?periodo=AAAA-MM&categoria=<id> (PN-01): `200` con `Listado`. Sin `periodo`, el mes
// de hoy en Colombia. `422 datos_invalidos` con `periodo` o `categoria`.
func (h *Handler) listar(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	q := r.URL.Query()
	l, err := h.servicio.Listar(r.Context(), sujeto.Persona, q.Get("periodo"), q.Get("categoria"))
	if h.responder(w, r, "no se pudieron listar los movimientos", err) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, l)
}

// detalle atiende GET /api/v1/movimientos/{id} (PN-02): `200` con el `Movimiento`; `404` si no es de la persona.
func (h *Handler) detalle(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	m, err := h.servicio.Obtener(r.Context(), sujeto.Persona, r.PathValue("id"))
	if h.responder(w, r, "no se pudo leer el movimiento", err) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, m)
}

// corregir atiende PUT /api/v1/movimientos/{id}: reemplaza los campos de «Corregir» y responde `200` con el movimiento
// guardado. Es PUT y no PATCH porque el formulario manda siempre todos los campos, ya llenos (E14-PRR PN-02), y así
// valen las mismas reglas del POST sin tener que distinguir «no cambia» de «se borra». `422 datos_invalidos` con todos
// los campos inválidos; `404` si no es de la persona; `400 solicitud_invalida` con un campo fuera del contrato.
func (h *Handler) corregir(w http.ResponseWriter, r *http.Request) {
	var sol SolicitudDeCorreccion
	if !servidor.LeerJSON(w, r, &sol) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	m, err := h.servicio.Corregir(r.Context(), sujeto.Persona, r.PathValue("id"), sol)
	if h.responder(w, r, "no se pudo corregir el movimiento", err) {
		return
	}
	h.log.InfoContext(r.Context(), "movimiento corregido", "peticion", seguridad.PeticionDe(r.Context()))
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, m)
}

// borrar atiende DELETE /api/v1/movimientos/{id}: `204`; `404` si no es de la persona.
func (h *Handler) borrar(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	if h.responder(w, r, "no se pudo borrar el movimiento", h.servicio.Borrar(r.Context(), sujeto.Persona, r.PathValue("id"))) {
		return
	}
	h.log.InfoContext(r.Context(), "movimiento borrado", "peticion", seguridad.PeticionDe(r.Context()))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
