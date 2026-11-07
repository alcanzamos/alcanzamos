package servidor

import (
	"mime"
	"net/http"
	"net/url"
	"strings"
)

// Códigos de rechazo de la defensa contra CSRF (E17 3.15): 403 si falla (a), (b) o (c); 415 si falla (d).
const (
	CodigoSolicitudNoPermitida = "solicitud_no_permitida"
	CodigoTipoNoPermitido      = "tipo_de_contenido_no_permitido"
)

// DefensaCSRF envuelve un POST con la defensa de E17 3.15 (D-173, D-174, D-175), en este orden:
// (a) si viene `Sec-Fetch-Site`, solo se acepta `same-origin`; (b) si no viene pero viene `Origin`, tiene que ser el de
// `urlPublica`; (c) si no viene ninguna de las dos, es el cliente Android y exige `Authorization: Bearer` o
// `X-Alcanzamos-Cliente`; lo incumplido responde 403 sin llamar al manejador. (d) El cuerpo exige
// `Content-Type: application/json` (con o sin cuerpo), y otro tipo responde 415. Con `urlPublica` vacía o inválida,
// ningún `Origin` vale: ante la duda se niega. El Enrutador la aplica solo a todo POST que registra.
func DefensaCSRF(urlPublica string, siguiente http.Handler) http.Handler {
	origen := origenDe(urlPublica)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rechazarCSRF(w, r, origen) {
			return
		}
		siguiente.ServeHTTP(w, r)
	})
}

// rechazarCSRF responde 403 o 415 y devuelve true si el pedido incumple E17 3.15; si no, no escribe nada.
func rechazarCSRF(w http.ResponseWriter, r *http.Request, origen string) bool {
	if !origenPermitido(r, origen) {
		EscribirError(w, http.StatusForbidden, CodigoSolicitudNoPermitida)
		return true
	}
	if tipo, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || tipo != "application/json" {
		EscribirError(w, http.StatusUnsupportedMediaType, CodigoTipoNoPermitido)
		return true
	}
	return false
}

// origenDe es el origen (esquema y anfitrión) de la URL pública, o "" si no es una URL absoluta.
func origenDe(urlPublica string) string {
	u, err := url.Parse(urlPublica)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func origenPermitido(r *http.Request, origen string) bool {
	if sitio, hay := r.Header["Sec-Fetch-Site"]; hay {
		return len(sitio) == 1 && sitio[0] == "same-origin"
	}
	if enviado, hay := r.Header["Origin"]; hay {
		return origen != "" && len(enviado) == 1 && enviado[0] == origen
	}
	return strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || r.Header.Get("X-Alcanzamos-Cliente") != ""
}
