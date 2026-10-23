package sesion

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Tabla del modo de entrega del token (D-143 (3)): cada combinación de la cabecera de cliente, Origin y Sec-Fetch-Site.
func TestEntregaDelToken(t *testing.T) {
	casos := []struct {
		nombre   string
		cabecera map[string]string
		entrega  EntregaDelToken
		err      error
	}{
		{"web: sin cabeceras", nil, PorCookie, nil},
		{"web: con Origin", map[string]string{"Origin": "https://app.ejemplo.test"}, PorCookie, nil},
		{"web: con Sec-Fetch-Site", map[string]string{"Sec-Fetch-Site": "same-origin"}, PorCookie, nil},
		{"web: con las dos", map[string]string{"Origin": "https://app.ejemplo.test", "Sec-Fetch-Site": "same-origin"}, PorCookie, nil},
		{"web: otro valor de cliente", map[string]string{EncabezadoDeCliente: "Android"}, PorCookie, nil},
		{"web: cliente ios", map[string]string{EncabezadoDeCliente: "ios"}, PorCookie, nil},
		{"android limpio", map[string]string{EncabezadoDeCliente: "android"}, PorCuerpo, nil},
		{"android con Origin", map[string]string{EncabezadoDeCliente: "android", "Origin": "https://app.ejemplo.test"}, PorCookie, ErrClienteMezclado},
		{"android con Origin null", map[string]string{EncabezadoDeCliente: "android", "Origin": "null"}, PorCookie, ErrClienteMezclado},
		{"android con Origin vacío", map[string]string{EncabezadoDeCliente: "android", "Origin": ""}, PorCookie, ErrClienteMezclado},
		{"android con Sec-Fetch-Site same-origin", map[string]string{EncabezadoDeCliente: "android", "Sec-Fetch-Site": "same-origin"}, PorCookie, ErrClienteMezclado},
		{"android con Sec-Fetch-Site none", map[string]string{EncabezadoDeCliente: "android", "Sec-Fetch-Site": "none"}, PorCookie, ErrClienteMezclado},
		{"android con Sec-Fetch-Site cualquier cosa", map[string]string{EncabezadoDeCliente: "android", "Sec-Fetch-Site": "xyz"}, PorCookie, ErrClienteMezclado},
		{"android con Sec-Fetch-Site vacío", map[string]string{EncabezadoDeCliente: "android", "Sec-Fetch-Site": ""}, PorCookie, ErrClienteMezclado},
		{"android con las dos", map[string]string{EncabezadoDeCliente: "android", "Origin": "x", "Sec-Fetch-Site": "cross-site"}, PorCookie, ErrClienteMezclado},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/api/v1/cuentas", nil)
			for k, v := range c.cabecera {
				r.Header[http.CanonicalHeaderKey(k)] = []string{v}
			}
			entrega, err := EntregaDe(r)
			if entrega != c.entrega || !errors.Is(err, c.err) {
				t.Fatalf("EntregaDe = %v, %v; se esperaba %v, %v", entrega, err, c.entrega, c.err)
			}
		})
	}
}
