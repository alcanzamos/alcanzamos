// Package sesion es el transporte y la resolución de las sesiones opacas (E12 `AlmacenDeSesiones` y
// `ResolutorDeSujeto`, E13 §5.3, D-081): de dónde sale el token de una petición, cómo viaja en la cookie de la web, y
// cómo se llega del token al Sujeto. El almacén real está en `src/pg`.
package sesion

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
)

// Duraciones y límites de la sesión (E13 §5.3, decididos por el dueño en D-085).
const (
	// Vigencia es el vencimiento deslizante: 30 días desde el último uso.
	Vigencia = 30 * 24 * time.Hour
	// Tope es el límite absoluto: 90 días desde la creación, por mucho que se use.
	Tope = 90 * 24 * time.Hour
	// IntervaloDeEscritura: el último uso solo se escribe si pasaron más de 5 minutos desde el anterior.
	IntervaloDeEscritura = 5 * time.Minute
	// MaximoPorPersona: al iniciar la sexta sesión se borran las menos recientes, en la misma transacción.
	MaximoPorPersona = 5
)

// NombreDeLaCookie es la cookie de la web. El prefijo `__Host-` hace que el navegador solo la acepte con `Secure`,
// `Path=/` y sin `Domain`: no puede fijarla un subdominio.
const NombreDeLaCookie = "__Host-sesion"

// Cookie arma la cookie de sesión de la web: `HttpOnly; Secure; SameSite=Strict; Path=/` (D-081, D-083). Dura lo que
// el tope, 90 días: el vencimiento real lo decide el servidor, que la desliza.
func Cookie(token string) *http.Cookie {
	return &http.Cookie{
		Name:     NombreDeLaCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(Tope / time.Second),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	}
}

// CookieVencida es la orden de borrar la cookie de sesión al cerrarla: mismo nombre y mismos atributos que Cookie, con
// `Max-Age=0`. Se manda igual para una sesión real o ya vencida: no deben distinguirse por fuera.
func CookieVencida() *http.Cookie {
	c := Cookie("")
	c.MaxAge = -1 // net/http lo escribe como `Max-Age=0`
	return c
}

// TokenDe devuelve el token de la petición: `Authorization: Bearer <token>` (Android) o la cookie (web). Si vienen
// las dos gana el encabezado. Devuelve "" si no hay ninguno. El formato no se valida aquí.
func TokenDe(r *http.Request) string {
	if esquema, token, ok := strings.Cut(r.Header.Get("Authorization"), " "); ok && strings.EqualFold(esquema, "Bearer") {
		return strings.TrimSpace(token)
	}
	if c, err := r.Cookie(NombreDeLaCookie); err == nil {
		return c.Value
	}
	return ""
}

// Almacen busca la sesión de una huella (el SHA-256 del token) y arma el Sujeto de su cuenta.
type Almacen interface {
	// Sujeto devuelve el Sujeto de la sesión vigente en `ahora`, o seguridad.ErrSinSesion si no existe o venció. Si
	// la sesión sigue vigente, desliza su vencimiento (escribiendo el último uso solo si pasaron más de 5 minutos).
	Sujeto(ctx context.Context, huella []byte, ahora time.Time) (seguridad.Sujeto, error)
}

// Resolutor implementa servidor.Sesiones: del token de la petición al Sujeto, pasando por el almacén real. No hay
// sesiones de mentira (D-172 (5)): un token que el almacén no tiene no tiene sesión.
type Resolutor struct {
	almacen Almacen
	reloj   reloj.Reloj
}

// NuevoResolutor arma el resolutor.
func NuevoResolutor(a Almacen, r reloj.Reloj) *Resolutor {
	return &Resolutor{almacen: a, reloj: r}
}

// SujetoDe resuelve la sesión de la petición. Un token ausente, mal formado o desconocido es seguridad.ErrSinSesion.
func (r *Resolutor) SujetoDe(req *http.Request) (seguridad.Sujeto, error) {
	huella, err := seguridad.HuellaDeToken(TokenDe(req))
	if err != nil {
		return seguridad.Sujeto{}, seguridad.ErrSinSesion
	}
	return r.almacen.Sujeto(req.Context(), huella, r.reloj.Ahora())
}
