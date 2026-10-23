package sesion

import (
	"errors"
	"net/http"
)

// El cliente de Android no tiene cookies: pide recibir el token en el cuerpo con `X-Alcanzamos-Cliente: android` y
// después lo manda en `Authorization: Bearer` (D-081). La web recibe el token solo en la cookie `HttpOnly`.
const (
	EncabezadoDeCliente = "X-Alcanzamos-Cliente"
	ClienteAndroid      = "android"
)

// ErrClienteMezclado: el pedido dice ser de Android pero trae una cabecera que solo mandan los navegadores.
var ErrClienteMezclado = errors.New("pedido de Android con cabeceras de navegador")

// EntregaDelToken es cómo se le da el token de la sesión nueva al cliente.
type EntregaDelToken int

const (
	// PorCookie es el camino de la web: `Set-Cookie` con la cookie `HttpOnly`, y el token no sale en el cuerpo.
	PorCookie EntregaDelToken = iota
	// PorCuerpo es el camino de Android: el token va en el cuerpo y no hay `Set-Cookie`.
	PorCuerpo
)

// EntregaDe decide cómo entregar el token de la sesión nueva (D-143 (3)).
//
//   - Sin `X-Alcanzamos-Cliente: android`: PorCookie. Es el camino de la web y no cambia.
//   - Con `X-Alcanzamos-Cliente: android`: PorCuerpo, salvo que el pedido traiga `Origin` o `Sec-Fetch-Site` (con
//     cualquier valor, también vacío si el cliente lo manda): entonces ErrClienteMezclado y el llamador responde 400
//     `solicitud_invalida`, sin token ni `Set-Cookie`. Los navegadores mandan esas cabeceras siempre y el JavaScript
//     de una página no puede quitarlas ni cambiarlas (son «prohibidas» para `fetch`), así que un script de la web no
//     puede pedir un token en el cuerpo para saltarse la cookie `HttpOnly`. La app de Android no las manda.
//
// La comparación del valor del cliente es exacta (`android`, en minúsculas): otro valor es el camino de la web.
func EntregaDe(r *http.Request) (EntregaDelToken, error) {
	if r.Header.Get(EncabezadoDeCliente) != ClienteAndroid {
		return PorCookie, nil
	}
	if _, hay := r.Header["Origin"]; hay {
		return PorCookie, ErrClienteMezclado
	}
	if _, hay := r.Header["Sec-Fetch-Site"]; hay {
		return PorCookie, ErrClienteMezclado
	}
	return PorCuerpo, nil
}
