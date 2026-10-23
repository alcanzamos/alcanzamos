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
// cualquier sesión, la limitada y la de mentira también. El ingreso anterior (PN-71) y el cambio de contraseña (PN-73)
// piden la cuenta autorizada; pedir el enlace de recuperación y elegir la contraseña con él son públicas (PN-61, PN-62).
func (h *Handler) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.Publica, "POST /api/v1/sesiones", http.HandlerFunc(h.iniciar))
	e.Registrar(seguridad.SinVerificar, "DELETE /api/v1/sesiones/actual", http.HandlerFunc(h.cerrar))
	e.Registrar(seguridad.RequiereAutorizacion, "GET /api/v1/cuenta/seguridad", http.HandlerFunc(h.seguridad))
	e.Registrar(seguridad.Publica, "POST /api/v1/recuperacion", http.HandlerFunc(h.pedirRecuperacion))
	e.Registrar(seguridad.Publica, "POST /api/v1/recuperacion/contrasena", http.HandlerFunc(h.fijarContrasena))
	e.Registrar(seguridad.RequiereAutorizacion, "POST /api/v1/cuenta/contrasena", http.HandlerFunc(h.cambiarContrasena))
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

func escribirValidacion(w http.ResponseWriter, invalida *cuenta.ErrValidacion) {
	servidor.EscribirJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "validacion", "campos": invalida.Campos})
}

// pedirRecuperacion atiende POST /api/v1/recuperacion (PN-61): `{correo}`. Pública. Responde **siempre**
// `202 {"estado":"enlace_enviado"}` si el correo está bien escrito, tenga cuenta o no (CU-44 2a), y enseguida: la cuenta,
// el enlace y el correo se atienden fuera del pedido (D-144), así que el tiempo tampoco lo delata. `429 demasiados_intentos`
// pasados 3 pedidos por hora por correo o 20 por origen (D-136 (4)), igual para todos. Un correo vacío o sin dominio:
// `422 validacion` con `correo_vacio` o `correo_invalido`.
func (h *Handler) pedirRecuperacion(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Correo string `json:"correo"`
	}
	if !servidor.LeerJSON(w, r, &cuerpo) {
		return
	}
	err := h.servicio.PedirRecuperacion(r.Context(), cuerpo.Correo, cuenta.OrigenDe(r))
	var invalida *cuenta.ErrValidacion
	switch {
	case errors.As(err, &invalida):
		escribirValidacion(w, invalida)
	case errors.Is(err, ErrDemasiadosIntentos):
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
	case err != nil:
		h.fallar(w, r, "no se pudo pedir la recuperación", err)
	default:
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusAccepted, map[string]string{"estado": "enlace_enviado"})
	}
}

// fijarContrasena atiende POST /api/v1/recuperacion/contrasena (PN-62): `{token, contrasena}`. Pública: el token del
// enlace es la autoridad. `200 {"estado":"contrasena_cambiada"}` y **no inicia sesión**: borró todas las sesiones de la
// persona y el cliente va a PN-60. `400 enlace_invalido` si el enlace no sirve («Ese enlace ya no sirve.»);
// `422 validacion` con el código de la política en `contrasena` (el enlace sigue vigente).
func (h *Handler) fijarContrasena(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Token      string `json:"token"`
		Contrasena string `json:"contrasena"`
	}
	if !servidor.LeerJSON(w, r, &cuerpo) {
		return
	}
	err := h.servicio.FijarContrasena(r.Context(), cuerpo.Token, cuerpo.Contrasena)
	var invalida *cuenta.ErrValidacion
	switch {
	case errors.Is(err, cuenta.ErrEnlaceInvalido):
		servidor.EscribirError(w, http.StatusBadRequest, "enlace_invalido")
	case errors.As(err, &invalida):
		escribirValidacion(w, invalida)
	case err != nil:
		h.fallar(w, r, "no se pudo fijar la contraseña", err)
	default:
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusOK, map[string]string{"estado": "contrasena_cambiada"})
	}
}

// cambiarContrasena atiende POST /api/v1/cuenta/contrasena (PN-73): `{contrasena_actual, contrasena_nueva}`.
// `200 {"estado":"contrasena_cambiada"}`: las demás sesiones de la persona ya no sirven y la de la petición sigue
// (D-090). `400 contrasena_actual_incorrecta` («No pudimos confirmar tu contraseña de ahora…»), que cuenta como fallo
// del límite de D-136 y deja `inicio_sesion_fallido` de la cuenta; con el límite alcanzado, `429 demasiados_intentos`
// (también con evento); `422 validacion` con `contrasena_actual` o `contrasena_nueva`.
func (h *Handler) cambiarContrasena(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Actual string `json:"contrasena_actual"`
		Nueva  string `json:"contrasena_nueva"`
	}
	if !servidor.LeerJSON(w, r, &cuerpo) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	err := h.servicio.CambiarContrasena(r.Context(), sujeto.Persona, sesion.TokenDe(r), cuerpo.Actual, cuerpo.Nueva, cuenta.OrigenDe(r))
	var invalida *cuenta.ErrValidacion
	switch {
	case errors.As(err, &invalida):
		escribirValidacion(w, invalida)
	case errors.Is(err, ErrDemasiadosIntentos):
		h.eventos.Registrar(r.Context(), seguridad.InicioSesionFallido, sujeto.Persona, r.Pattern, http.StatusTooManyRequests)
		servidor.EscribirError(w, http.StatusTooManyRequests, "demasiados_intentos")
	case errors.Is(err, ErrContrasenaActualIncorrecta):
		h.eventos.Registrar(r.Context(), seguridad.InicioSesionFallido, sujeto.Persona, r.Pattern, http.StatusBadRequest)
		servidor.EscribirError(w, http.StatusBadRequest, "contrasena_actual_incorrecta")
	case err != nil:
		h.fallar(w, r, "no se pudo cambiar la contraseña", err)
	default:
		w.Header().Set("Cache-Control", "no-store")
		servidor.EscribirJSON(w, http.StatusOK, map[string]string{"estado": "contrasena_cambiada"})
	}
}
