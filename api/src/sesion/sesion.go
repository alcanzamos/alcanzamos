// Package sesion es el transporte y la resolución de las sesiones opacas (E12 `AlmacenDeSesiones` y
// `ResolutorDeSujeto`, E13 §5.3, D-081): de dónde sale el token de una petición, cómo viaja en la cookie de la web, y
// cómo se llega del token al Sujeto. El almacén real está en `src/pg`.
package sesion

import (
	"context"
	"errors"
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
// el tope, 90 días: el vencimiento real lo decide el servidor, que la desliza. Es la misma función para una sesión
// real y para la de mentira: no deben distinguirse por fuera.
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
// `Max-Age=0`. Se manda igual para una sesión real, de mentira o ya vencida: no deben distinguirse por fuera.
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

// Resolutor implementa servidor.Sesiones: del token de la petición al Sujeto, pasando por el almacén real y, si no
// está, por el reconocimiento de las sesiones de mentira (D-141). Una sesión de mentira da un Sujeto con Senuelo, que
// el Enrutador trata en todas las rutas como la sesión limitada de una cuenta sin verificar.
type Resolutor struct {
	almacen  Almacen
	senuelos *Senuelos
	reloj    reloj.Reloj
}

// NuevoResolutor arma el resolutor. senuelos puede ser nil si no hay sesiones de mentira.
func NuevoResolutor(a Almacen, s *Senuelos, r reloj.Reloj) *Resolutor {
	return &Resolutor{almacen: a, senuelos: s, reloj: r}
}

// SujetoDe resuelve la sesión de la petición. Un token ausente, mal formado o desconocido es seguridad.ErrSinSesion;
// siempre se consulta primero el almacén, también para un token que será de mentira, para que ni el tiempo de la
// consulta lo delate. El reconocimiento de la mentira no usa la base: solo la clave y la hora.
func (r *Resolutor) SujetoDe(req *http.Request) (seguridad.Sujeto, error) {
	token := TokenDe(req)
	huella, err := seguridad.HuellaDeToken(token)
	if err != nil {
		return seguridad.Sujeto{}, seguridad.ErrSinSesion
	}
	sujeto, err := r.almacen.Sujeto(req.Context(), huella, r.reloj.Ahora())
	if err == nil {
		return sujeto, nil
	}
	if !errors.Is(err, seguridad.ErrSinSesion) {
		return seguridad.Sujeto{}, err
	}
	if r.senuelos != nil && r.senuelos.Reconoce(token) {
		return seguridad.Sujeto{Senuelo: true}, nil
	}
	return seguridad.Sujeto{}, seguridad.ErrSinSesion
}
