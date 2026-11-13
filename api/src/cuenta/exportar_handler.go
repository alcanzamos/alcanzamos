package cuenta

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// HandlerDeExportacion sirve «Descargar mis datos» (PN-69).
type HandlerDeExportacion struct {
	servicio *Exportador
	log      *slog.Logger
}

// NuevoHandlerDeExportacion crea el manejador.
func NuevoHandlerDeExportacion(s *Exportador, log *slog.Logger) *HandlerDeExportacion {
	return &HandlerDeExportacion{servicio: s, log: log}
}

// Registrar añade la ruta. Es `sin_autorizacion` (SC-E21-25, criterio 3): quien no ha aceptado lo nuevo puede descargar sus
// datos antes de decidir si borra la cuenta (RF-032, hoja de «No autorizo»).
func (h *HandlerDeExportacion) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.SinAutorizacion, "GET /api/v1/cuenta/datos", http.HandlerFunc(h.descargar))
}

// descargar atiende GET /api/v1/cuenta/datos: «Descargar mis datos» de PN-69 (RF-032, D-102). Entrega el ZIP de la
// persona de la sesión, armado en el momento: `no-store`, sin copia. 401 si la cuenta ya no existe; nunca registra lo que
// lleva el archivo.
func (h *HandlerDeExportacion) descargar(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	datos, err := h.servicio.ZIP(r.Context(), sujeto.Persona)
	switch {
	case errors.Is(err, ErrNoExiste):
		servidor.EscribirError(w, http.StatusUnauthorized, servidor.CodigoSinSesion)
	case err != nil:
		h.log.ErrorContext(r.Context(), "no se pudo armar la descarga de los datos", "peticion", seguridad.PeticionDe(r.Context()), "error", err)
		servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
	default:
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+NombreDelArchivo+`"`)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Con el encabezado ya enviado, un fallo al escribir es que la persona cerró la conexión: no hay a quién avisar.
		_, _ = w.Write(datos) //nolint:errcheck // ver el comentario de arriba
	}
}
