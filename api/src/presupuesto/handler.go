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
	e.Registrar(seguridad.RequiereAutorizacion, "POST /api/v1/presupuestos", http.HandlerFunc(h.poner))
	e.Registrar(seguridad.RequiereAutorizacion, "PUT /api/v1/presupuestos/{id}", http.HandlerFunc(h.corregir))
	e.Registrar(seguridad.RequiereAutorizacion, "DELETE /api/v1/presupuestos/{id}", http.HandlerFunc(h.quitar))
	e.Registrar(seguridad.RequiereAutorizacion, "POST /api/v1/presupuestos/en-cero", http.HandlerFunc(h.dejarEnCero))
}

// responder escribe los errores comunes: `422 datos_invalidos`, `404 no_encontrado`, `409 periodo_no_editable`, `409
// periodo_con_ingreso_o_presupuesto`, `409 presupuesto_compartido`, `403 solo_personas_adultas`, `401 sin_sesion` (la
// cuenta se borró mientras tanto) o un fallo. Devuelve true si ya respondió.
func (h *Handler) responder(w http.ResponseWriter, r *http.Request, que string, err error) bool {
	var invalido *registro.ErrValidacion
	switch {
	case err == nil:
		return false
	case errors.As(err, &invalido):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "datos_invalidos", "campos": invalido.Campos})
	case errors.Is(err, ErrNoEncontrado):
		servidor.EscribirError(w, http.StatusNotFound, "no_encontrado")
	case errors.Is(err, ErrPeriodoNoEditable):
		servidor.EscribirError(w, http.StatusConflict, "periodo_no_editable")
	case errors.Is(err, ErrPeriodoConIngresoOPresupuesto):
		servidor.EscribirError(w, http.StatusConflict, "periodo_con_ingreso_o_presupuesto")
	case errors.Is(err, ErrPresupuestoCompartido):
		servidor.EscribirError(w, http.StatusConflict, "presupuesto_compartido")
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

// poner atiende POST /api/v1/presupuestos con `{"periodo":"AAAA-MM","categoria_id":<id>,"monto_centavos":<centavos>}`
// («Poner presupuesto»): `201` con el `Presupuesto`, o `200` si la categoría ya tenía presupuesto en el mes y se corrigió.
// `422 datos_invalidos` con todos los campos inválidos a la vez; `409 periodo_no_editable` si no es el mes en curso; `409
// presupuesto_compartido` si la categoría ya tiene en el mes un presupuesto compartido con el hogar, que no se toca; `400
// solicitud_invalida` con un campo fuera del contrato (`persona_id`, `hogar_id`…).
func (h *Handler) poner(w http.ResponseWriter, r *http.Request) {
	var sol SolicitudDePresupuesto
	if !servidor.LeerJSON(w, r, &sol) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	p, creado, err := h.servicio.Presupuestar(r.Context(), sujeto.Persona, sol)
	if h.responder(w, r, "no se pudo guardar el presupuesto", err) {
		return
	}
	h.log.InfoContext(r.Context(), "presupuesto guardado", "peticion", seguridad.PeticionDe(r.Context()), "creado", creado)
	codigo := http.StatusOK
	if creado {
		codigo = http.StatusCreated
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, codigo, p)
}

// corregir atiende PUT /api/v1/presupuestos/{id} con `{"monto_centavos":<centavos>}` («Corregir»): `200` con el
// `Presupuesto`. `422 datos_invalidos`, `404 no_encontrado` (ajeno, inexistente o mal formado) y `409
// periodo_no_editable`, en ese orden.
func (h *Handler) corregir(w http.ResponseWriter, r *http.Request) {
	var sol SolicitudDeCorreccion
	if !servidor.LeerJSON(w, r, &sol) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	p, err := h.servicio.Corregir(r.Context(), sujeto.Persona, r.PathValue("id"), sol)
	if h.responder(w, r, "no se pudo corregir el presupuesto", err) {
		return
	}
	h.log.InfoContext(r.Context(), "presupuesto corregido", "peticion", seguridad.PeticionDe(r.Context()))
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, p)
}

// quitar atiende DELETE /api/v1/presupuestos/{id} («Quitar presupuesto»): `204`; `404 no_encontrado`; `409
// periodo_no_editable`. Ningún gasto cambia.
func (h *Handler) quitar(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	if h.responder(w, r, "no se pudo quitar el presupuesto", h.servicio.Quitar(r.Context(), sujeto.Persona, r.PathValue("id"))) {
		return
	}
	h.log.InfoContext(r.Context(), "presupuesto quitado", "peticion", seguridad.PeticionDe(r.Context()))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// dejarEnCero atiende POST /api/v1/presupuestos/en-cero con `{"periodo":"AAAA-MM"}` («Dejar el presupuesto en cero»,
// PN-07): `204` sin cuerpo, también si ya estaba en cero. `422 datos_invalidos` con `periodo`; `409 periodo_no_editable`
// si no es el mes en curso; `409 periodo_con_ingreso_o_presupuesto` si el mes tiene ingreso registrado o algo asignado;
// `400 solicitud_invalida` con un campo fuera del contrato.
func (h *Handler) dejarEnCero(w http.ResponseWriter, r *http.Request) {
	var sol SolicitudEnCero
	if !servidor.LeerJSON(w, r, &sol) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	if h.responder(w, r, "no se pudo dejar el presupuesto en cero", h.servicio.DejarEnCero(r.Context(), sujeto.Persona, sol)) {
		return
	}
	h.log.InfoContext(r.Context(), "presupuesto dejado en cero", "peticion", seguridad.PeticionDe(r.Context()))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
