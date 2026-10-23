package sesion_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alcanzamos/alcanzamos/api/src/sesion"
)

// Tabla del modo de entrega del token (D-143 (3)): cada combinación de la cabecera de cliente, Origin y Sec-Fetch-Site.
func TestEntregaDelToken(t *testing.T) {
	casos := []struct {
		nombre   string
		cabecera map[string]string
		entrega  sesion.EntregaDelToken
		err      error
	}{
		{"web: sin cabeceras", nil, sesion.PorCookie, nil},
		{"web: con Origin", map[string]string{"Origin": "https://app.ejemplo.test"}, sesion.PorCookie, nil},
		{"web: con Sec-Fetch-Site", map[string]string{"Sec-Fetch-Site": "same-origin"}, sesion.PorCookie, nil},
		{"web: con las dos", map[string]string{"Origin": "https://app.ejemplo.test", "Sec-Fetch-Site": "same-origin"}, sesion.PorCookie, nil},
		{"web: otro valor de cliente", map[string]string{sesion.EncabezadoDeCliente: "Android"}, sesion.PorCookie, nil},
		{"web: cliente ios", map[string]string{sesion.EncabezadoDeCliente: "ios"}, sesion.PorCookie, nil},
		{"android limpio", map[string]string{sesion.EncabezadoDeCliente: "android"}, sesion.PorCuerpo, nil},
		{"android con Origin", map[string]string{sesion.EncabezadoDeCliente: "android", "Origin": "https://app.ejemplo.test"}, sesion.PorCookie, sesion.ErrClienteMezclado},
		{"android con Origin null", map[string]string{sesion.EncabezadoDeCliente: "android", "Origin": "null"}, sesion.PorCookie, sesion.ErrClienteMezclado},
		{"android con Origin vacío", map[string]string{sesion.EncabezadoDeCliente: "android", "Origin": ""}, sesion.PorCookie, sesion.ErrClienteMezclado},
		{"android con Sec-Fetch-Site same-origin", map[string]string{sesion.EncabezadoDeCliente: "android", "Sec-Fetch-Site": "same-origin"}, sesion.PorCookie, sesion.ErrClienteMezclado},
		{"android con Sec-Fetch-Site none", map[string]string{sesion.EncabezadoDeCliente: "android", "Sec-Fetch-Site": "none"}, sesion.PorCookie, sesion.ErrClienteMezclado},
		{"android con Sec-Fetch-Site cualquier cosa", map[string]string{sesion.EncabezadoDeCliente: "android", "Sec-Fetch-Site": "xyz"}, sesion.PorCookie, sesion.ErrClienteMezclado},
		{"android con Sec-Fetch-Site vacío", map[string]string{sesion.EncabezadoDeCliente: "android", "Sec-Fetch-Site": ""}, sesion.PorCookie, sesion.ErrClienteMezclado},
		{"android con las dos", map[string]string{sesion.EncabezadoDeCliente: "android", "Origin": "x", "Sec-Fetch-Site": "cross-site"}, sesion.PorCookie, sesion.ErrClienteMezclado},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/api/v1/cuentas", nil)
			for k, v := range c.cabecera {
				r.Header[http.CanonicalHeaderKey(k)] = []string{v}
			}
			entrega, err := sesion.EntregaDe(r)
			if entrega != c.entrega || !errors.Is(err, c.err) {
				t.Fatalf("EntregaDe = %v, %v; se esperaba %v, %v", entrega, err, c.entrega, c.err)
			}
		})
	}
}
