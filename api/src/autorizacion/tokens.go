package autorizacion

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/servidor"
)

// El registro del token de dispositivo de los avisos con la app cerrada (E12 `AvisosServicio.RegistrarTokenDeDispositivo`,
// CU-21, NM-17) vive aquí, junto a la autorización de la que depende: sin la autorización `avisos` vigente de la persona
// no se guarda ningún token, y al retirarla se borran (SC-E21-25, criterios 10 y 12). Los adaptadores de FCM y Web Push y
// el envío de los avisos son otra historia (Boards 302) y tendrán su propio paquete.

// Límites de `token_dispositivo` (E13): el identificador del dispositivo de 1 a 64 caracteres y el token de 1 a 2048.
const (
	LongitudMaximaDelDispositivo = 64
	LongitudMaximaDelToken       = 2048
)

// Formato de lo que se guarda, además de la longitud:
//
//   - `dispositivo_id` es el identificador aleatorio que genera la app al instalarse (UUID o base64url): letras y dígitos
//     ASCII, punto, guion y guion bajo. Nada de blancos, de `/` ni de caracteres de control.
//   - `token` es el de FCM (letras, dígitos, `_`, `-`, `:`) o la suscripción de Web Push, que la web manda como JSON
//     compacto (`JSON.stringify`, sin blancos; la URL del servicio de push y sus claves en base64url son ASCII). Se admite
//     cualquier carácter ASCII imprimible sin espacio (0x21 a 0x7E): sin NUL ni otros de control (la base rechaza el NUL),
//     sin blancos al principio, al final ni en medio, y sin letras fuera de ASCII.
var (
	formatoDelDispositivo = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	formatoDelToken       = regexp.MustCompile(`^[\x21-\x7E]+$`)
)

// Errores del registro del token. El HandlerDeTokens los traduce a su código HTTP; ErrSinCuenta es el de siempre.
var (
	// ErrSinAutorizacionDeAvisos: la persona no tiene la autorización `avisos` vigente. No se guarda nada.
	ErrSinAutorizacionDeAvisos = errors.New("la persona no autorizó los avisos con la app cerrada")
	// ErrDatoInvalido: el dispositivo o el token no caben en `token_dispositivo` o no tienen el formato aceptado.
	ErrDatoInvalido = errors.New("el dispositivo o el token no son válidos")
)

// RepositorioDeTokens es la persistencia del registro del token (la implementa src/pg).
type RepositorioDeTokens interface {
	// Registrar guarda el token del dispositivo de la persona en una sola transacción: toma el bloqueo de la persona,
	// comprueba que tenga `avisos` vigente (ErrSinAutorizacionDeAvisos, sin guardar nada), borra el mismo token si estaba en otro
	// dispositivo (el registro lo reemplaza, E13) y lo guarda o lo confirma (`ultimo_uso_en`). ErrSinCuenta si la persona
	// ya no existe. Retirar `avisos` toma el mismo bloqueo, así que un registro no sobrevive a un retiro que lo precede.
	Registrar(ctx context.Context, persona, dispositivo, token string, ahora time.Time) error
}

// ServicioDeTokens es el caso de uso del registro del token de dispositivo.
type ServicioDeTokens struct {
	repo  RepositorioDeTokens
	reloj reloj.Reloj
}

// NuevoServicioDeTokens arma el servicio.
func NuevoServicioDeTokens(repo RepositorioDeTokens, r reloj.Reloj) *ServicioDeTokens {
	return &ServicioDeTokens{repo: repo, reloj: r}
}

// RegistrarTokenDeDispositivo guarda, o confirma, el token del dispositivo de la persona (E12
// `AvisosServicio.RegistrarTokenDeDispositivo`). Repetirlo con los mismos datos no cambia nada salvo `ultimo_uso_en`.
// ErrDatoInvalido si el dispositivo o el token no cumplen la longitud o el formato de arriba; ErrSinAutorizacionDeAvisos sin `avisos` vigente.
func (s *ServicioDeTokens) RegistrarTokenDeDispositivo(ctx context.Context, persona, dispositivo, token string) error {
	// Los dos formatos son ASCII, así que la longitud en bytes es la longitud en caracteres.
	if len(dispositivo) > LongitudMaximaDelDispositivo || !formatoDelDispositivo.MatchString(dispositivo) {
		return ErrDatoInvalido
	}
	if len(token) > LongitudMaximaDelToken || !formatoDelToken.MatchString(token) {
		return ErrDatoInvalido
	}
	return s.repo.Registrar(ctx, persona, dispositivo, token, s.reloj.Ahora())
}

// HandlerDeTokens traduce HTTP a las operaciones del ServicioDeTokens (E12 `AvisosHandler`).
type HandlerDeTokens struct {
	servicio *ServicioDeTokens
	eventos  *seguridad.Registro
	log      *slog.Logger
}

// NuevoHandlerDeTokens crea el manejador de la ruta del token de dispositivo.
func NuevoHandlerDeTokens(s *ServicioDeTokens, eventos *seguridad.Registro, log *slog.Logger) *HandlerDeTokens {
	return &HandlerDeTokens{servicio: s, eventos: eventos, log: log}
}

// Registrar añade la ruta, `requiere_autorizacion`: el token es un dato de la persona y no se guarda antes de que
// autorice lo necesario.
func (h *HandlerDeTokens) Registrar(e *servidor.Enrutador) {
	e.Registrar(seguridad.RequiereAutorizacion, "PUT /api/v1/dispositivos/{dispositivo_id}/token", http.HandlerFunc(h.registrarToken))
}

// registrarToken atiende PUT /api/v1/dispositivos/{dispositivo_id}/token (CU-21, NM-17): `{token}`. `dispositivo_id` es el
// identificador aleatorio que la app genera al instalarse (1 a 64 caracteres) y `token` el de FCM o la suscripción de Web
// Push (1 a 2048). Guarda o confirma el token de ese dispositivo para la persona de la sesión; la app lo manda al abrirse,
// como mucho una vez al día. Es idempotente.
//
//   - 204 sin cuerpo.
//   - 403 `avisos_no_autorizados`: la persona no tiene la autorización `avisos` vigente; no se guarda nada y queda el
//     evento `acceso_denegado` (SC-E21-25, criterio 10). La app ni siquiera le pide el token al sistema sin ella.
//   - 400 `solicitud_invalida`: el dispositivo o el token no caben, o el cuerpo no es el del contrato.
//   - 401 `sin_sesion` si la cuenta ya no existe.
//
// Ni el token ni el dispositivo van al registro.
func (h *HandlerDeTokens) registrarToken(w http.ResponseWriter, r *http.Request) {
	var cuerpo struct {
		Token string `json:"token"`
	}
	if !servidor.LeerJSON(w, r, &cuerpo) {
		return
	}
	sujeto, _ := servidor.SujetoDe(r.Context())
	err := h.servicio.RegistrarTokenDeDispositivo(r.Context(), sujeto.Persona, r.PathValue("dispositivo_id"), cuerpo.Token)
	switch {
	case errors.Is(err, ErrDatoInvalido):
		servidor.EscribirError(w, http.StatusBadRequest, "solicitud_invalida")
	case errors.Is(err, ErrSinAutorizacionDeAvisos):
		h.eventos.Registrar(r.Context(), seguridad.AccesoDenegado, sujeto.Persona, r.Pattern, http.StatusForbidden)
		servidor.EscribirError(w, http.StatusForbidden, "avisos_no_autorizados")
	case errors.Is(err, ErrSinCuenta):
		servidor.EscribirError(w, http.StatusUnauthorized, servidor.CodigoSinSesion)
	case err != nil:
		h.log.ErrorContext(r.Context(), "no se pudo registrar el token de dispositivo", "peticion", seguridad.PeticionDe(r.Context()), "error", err)
		servidor.EscribirError(w, http.StatusInternalServerError, "error_interno")
	default:
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}
