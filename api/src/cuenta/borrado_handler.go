package cuenta

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

// HandlerDeBorrado traduce HTTP a las operaciones de Borrado (E12 `CuentaHandler`, PN-69). No tiene reglas: los
// códigos de error los pone el Servicio y los textos, el cliente.
type HandlerDeBorrado struct {
	servicio *Borrado
	eventos  *seguridad.Registro
	log      *slog.Logger
}

// NuevoHandlerDeBorrado crea el manejador de las rutas del borrado.
func NuevoHandlerDeBorrado(s *Borrado, eventos *seguridad.Registro, log *slog.Logger) *HandlerDeBorrado {
	return &HandlerDeBorrado{servicio: s, eventos: eventos, log: log}
}

// Registrar añade las rutas del borrado. Las dos son `sin_autorizacion` (SC-E21-25, criterio 3 y sección 5, paso 3): la
// cuenta a la que le falta una aceptación nueva decide en la hoja de «No autorizo» (D-102) y debe poder borrarse con su
// contraseña, sin aceptar antes. Una cuenta nueva sigue borrándose con «No autorizo» (PN-64, D-089). No hay riesgo de
// borrar sin querer: pide la contraseña. Es POST y no DELETE porque pide un cuerpo con la contraseña, y así cae en la
// defensa contra CSRF de los POST (E17-ECO 3.15).
func (h *HandlerDeBorrado) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.SinAutorizacion, "GET /api/v1/cuenta/borrado", http.HandlerFunc(h.resumen))
	e.Registrar(seguridad.SinAutorizacion, "POST /api/v1/cuenta/borrado", http.HandlerFunc(h.borrar))
}

func (h *HandlerDeBorrado) fallar(w http.ResponseWriter, r *http.Request, que string, err error) {
	h.log.ErrorContext(r.Context(), que, "peticion", seguridad.PeticionDe(r.Context()), "error", err)
	servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
}

type hogarAlBorrarJSON struct {
	Nombre             *string `json:"nombre"`
	EsAdministradora   bool    `json:"es_administradora"`
	UnicaAdulta        bool    `json:"unica_adulta"`
	NuevoAdministrador *string `json:"nuevo_administrador"`
}

// resumen atiende GET /api/v1/cuenta/borrado: lo que PN-69 dice del hogar (fila 4) y de los menores (filas 5 y 6).
// `{"hogar": null | {nombre, es_administradora, unica_adulta, nuevo_administrador}, "menores": [{"id", "nombre"}]}`.
// `hogar` es nulo sin hogar; `nuevo_administrador` solo viene si administra y queda otra persona adulta; `menores`
// son quienes dependen solo de ella. No cambia nada.
func (h *HandlerDeBorrado) resumen(w http.ResponseWriter, r *http.Request) {
	sujeto, _ := servidor.SujetoDe(r.Context())
	res, err := h.servicio.Resumen(r.Context(), sujeto.Persona)
	switch {
	case errors.Is(err, ErrNoExiste):
		servidor.EscribirError(w, http.StatusUnauthorized, servidor.CodigoSinSesion)
		return
	case err != nil:
		h.fallar(w, r, "no se pudo leer el resumen del borrado", err)
		return
	}
	var hogar *hogarAlBorrarJSON
	if res.Hogar != nil {
		hogar = &hogarAlBorrarJSON{Nombre: res.Hogar.Nombre, EsAdministradora: res.Hogar.EsAdministradora, UnicaAdulta: res.Hogar.UnicaAdulta}
		if res.Hogar.NuevoAdministrador != "" {
			hogar.NuevoAdministrador = &res.Hogar.NuevoAdministrador
		}
	}
	menores := make([]map[string]string, 0, len(res.Menores))
	for _, m := range res.Menores {
		menores = append(menores, map[string]string{"id": m.ID, "nombre": m.Nombre})
	}
	w.Header().Set("Cache-Control", "no-store")
	servidor.EscribirJSON(w, http.StatusOK, map[string]any{"hogar": hogar, "menores": menores})
}

// borrar atiende POST /api/v1/cuenta/borrado (PN-69): `{contrasena, confirma_menores, menores}`, con `menores` los ids
// que la pantalla mostró (los del GET).
//
//   - 200 `{"estado":"cuenta_borrada"}`: todo borrado en una transacción, todas las sesiones de la persona ya no
//     sirven y la cookie de la web se manda a borrar. El cliente va a PN-60 con «Borramos tu cuenta.»
//   - 400 `contrasena_incorrecta` («No pudimos confirmar tu contraseña. Escríbela de nuevo.»): cuenta como fallo del
//     límite de D-136 y deja `inicio_sesion_fallido` de la cuenta; con el límite alcanzado, 429 `demasiados_intentos`
//     (también con evento).
//   - 422 `validacion` con `contrasena: contrasena_vacia` («Falta tu contraseña.») o con
//     `confirma_menores: confirmacion_requerida` («Falta confirmar lo de {nombre}.»): no cambia nada.
//   - 409 `menores_cambiaron`: los menores que dependen solo de la persona ya no son los mostrados; no se borró nada y
//     la pantalla vuelve a leer el resumen. 503 `ocupado`: la base siguió ocupada tras varios intentos y la cuenta sigue.
//   - 403 `cuenta_de_menor`: el menor no borra su cuenta (E14-PME); 401 `sin_sesion` si la cuenta ya no existe.
//
// Una segunda llamada con la misma sesión es 401: la primera ya la borró. Nada de lo que se borra queda en el registro.
func (h *HandlerDeBorrado) borrar(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Contrasena      string   `json:"contrasena"`
		ConfirmaMenores bool     `json:"confirma_menores"`
		Menores         []string `json:"menores"`
	}
	if !servidor.LeerJSON(w, r, &cuerpo) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	err := h.servicio.Borrar(r.Context(), sujeto.Persona, cuerpo.Contrasena, cuerpo.Menores, cuerpo.ConfirmaMenores, OrigenDe(r))
	var invalida *ErrValidacion
	switch {
	case errors.As(err, &invalida):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "validacion", "campos": invalida.Campos})
	case errors.Is(err, ErrFaltaConfirmarMenores):
		servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": "validacion", "campos": map[string]string{campoConfirmaMenores: ConfirmacionRequerida}})
	case errors.Is(err, ErrMenoresCambiaron):
		servidor.EscribirError(w, http.StatusConflict, "menores_cambiaron")
	case errors.Is(err, ErrOcupada):
		// Sin datos personales (E17-ECO 3.13): el error trae solo el código y la restricción de la base.
		h.log.WarnContext(r.Context(), "el borrado de la cuenta sigue ocupado tras varios intentos", "peticion", seguridad.PeticionDe(r.Context()), "error", err)
		servidor.EscribirError(w, http.StatusServiceUnavailable, "ocupado")
	case errors.Is(err, ErrDemasiadosIntentos):
		h.eventos.Registrar(r.Context(), seguridad.InicioSesionFallido, sujeto.Persona, r.Pattern, http.StatusTooManyRequests)
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
	case errors.Is(err, ErrContrasenaIncorrecta):
		h.eventos.Registrar(r.Context(), seguridad.InicioSesionFallido, sujeto.Persona, r.Pattern, http.StatusBadRequest)
		servidor.EscribirError(w, http.StatusBadRequest, "contrasena_incorrecta")
	case errors.Is(err, ErrCuentaDeMenor):
		servidor.EscribirError(w, http.StatusForbidden, "cuenta_de_menor")
	case errors.Is(err, ErrNoExiste):
		servidor.EscribirError(w, http.StatusUnauthorized, servidor.CodigoSinSesion)
	case err != nil:
		h.fallar(w, r, "no se pudo borrar la cuenta", err)
	default:
		http.SetCookie(w, sesion.CookieVencida())
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusOK, map[string]string{"estado": "cuenta_borrada"})
	}
}
