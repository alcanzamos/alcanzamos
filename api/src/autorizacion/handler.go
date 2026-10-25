package autorizacion

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

// Handler traduce HTTP a las operaciones del Servicio (E12 `AutorizacionHandler`). No manda textos: los códigos de
// error los traduce cada app.
type Handler struct {
	servicio *Servicio
	eventos  *seguridad.Registro
	log      *slog.Logger
}

// NuevoHandler crea el manejador de las rutas de PN-63 y PN-64.
func NuevoHandler(s *Servicio, eventos *seguridad.Registro, log *slog.Logger) *Handler {
	return &Handler{servicio: s, eventos: eventos, log: log}
}

// Registrar añade las rutas. Las tres son `sin_autorizacion`: las usa la persona que ya verificó el correo y aún no
// autorizó. Las de la persona autorizada también pasan el guard, pero «No autorizo» la rechaza (ver rechazar).
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.SinAutorizacion, "GET /api/v1/autorizaciones", http.HandlerFunc(h.listar))
	e.Registrar(seguridad.SinAutorizacion, "POST /api/v1/autorizaciones", http.HandlerFunc(h.otorgar))
	e.Registrar(seguridad.SinAutorizacion, "POST /api/v1/autorizaciones/rechazo", http.HandlerFunc(h.rechazar))
}

func (h *Handler) fallar(w http.ResponseWriter, r *http.Request, que string, err error) {
	h.log.ErrorContext(r.Context(), que, "peticion", seguridad.PeticionDe(r.Context()), "error", err)
	servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
}

// listar atiende GET /api/v1/autorizaciones (PN-64): la versión vigente del texto y las finalidades que la persona
// puede autorizar, cada una con `codigo`, `tipo` (`necesaria` o `accesoria`) y `otorgada`.
func (h *Handler) listar(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	lista, err := h.servicio.Listar(r.Context(), sujeto.Persona)
	if err != nil {
		h.fallar(w, r, "no se pudieron listar las autorizaciones", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, map[string]any{"version": VersionActual, "finalidades": lista})
}

// otorgar atiende POST /api/v1/autorizaciones (PN-64, «Autorizar y continuar»): `{finalidades, version}`.
// `200 {"estado":"autorizada"}`; repetirla da lo mismo. `409 version_desactualizada` si `version` no es la vigente;
// `422 finalidad_invalida` con un código que no se ofrece; `422 faltan_necesarias` sin las dos necesarias.
func (h *Handler) otorgar(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Finalidades []string `json:"finalidades"`
		Version     string   `json:"version"`
	}
	if !servidor.LeerJSON(w, r, &cuerpo) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	err := h.servicio.Otorgar(r.Context(), sujeto.Persona, cuerpo.Finalidades, cuerpo.Version)
	switch {
	case errors.Is(err, ErrVersionDesactualizada):
		servidor.EscribirError(w, http.StatusConflict, "version_desactualizada")
	case errors.Is(err, ErrFinalidadInvalida):
		servidor.EscribirError(w, http.StatusUnprocessableEntity, "finalidad_invalida")
	case errors.Is(err, ErrFaltanNecesarias):
		servidor.EscribirError(w, http.StatusUnprocessableEntity, "faltan_necesarias")
	case errors.Is(err, ErrSinCuenta):
		servidor.EscribirError(w, http.StatusUnauthorized, servidor.CodigoSinSesion)
	case err != nil:
		h.fallar(w, r, "no se pudo guardar la autorización", err)
	default:
		// No es un evento de seguridad: el conjunto de E17-VTE 2.1 es cerrado (fallos y negaciones). Queda en el
		// registro común, sin cuenta ni finalidades.
		h.log.InfoContext(r.Context(), "autorización otorgada", "peticion", seguridad.PeticionDe(r.Context()))
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusOK, map[string]string{"estado": "autorizada"})
	}
}

// rechazar atiende POST /api/v1/autorizaciones/rechazo (PN-64, «No autorizo»; RF-031, D-089): borra en una
// transacción la cuenta recién creada, con sus sesiones y enlaces, y cierra la sesión. `204`, con la cookie vencida.
// Solo sirve a la sesión de nivel exactamente `sin_autorizacion`: con lo necesario ya autorizado responde
// `403 ya_autorizada` y evento `acceso_denegado`, y no borra nada. Quien ya autorizó borra su cuenta por PN-69.
func (h *Handler) rechazar(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	err := error(ErrYaAutorizada)
	if !sujeto.Autorizada {
		err = h.servicio.Rechazar(r.Context(), sujeto.Persona)
	}
	switch {
	case errors.Is(err, ErrYaAutorizada):
		h.eventos.Registrar(r.Context(), seguridad.AccesoDenegado, sujeto.Persona, r.Pattern, http.StatusForbidden)
		servidor.EscribirError(w, http.StatusForbidden, "ya_autorizada")
	case errors.Is(err, ErrSinCuenta):
		servidor.EscribirError(w, http.StatusUnauthorized, servidor.CodigoSinSesion)
	case err != nil:
		h.fallar(w, r, "no se pudo borrar la cuenta", err)
	default:
		h.log.InfoContext(r.Context(), "cuenta sin autorizar borrada", "peticion", seguridad.PeticionDe(r.Context()))
		http.SetCookie(w, sesion.CookieVencida())
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}
