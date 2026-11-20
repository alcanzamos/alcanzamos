package servidor_test

import (
	"net/http/httptest"
	"testing"
)

// La web lee el nombre del ZIP de «Descargar mis datos» de Content-Disposition (web/src/api/cuentas.ts). En otro origen el
// navegador solo se lo deja leer si el API lo expone, y solo al origen de la web.
func TestCORSExponeContentDispositionSoloAlOrigenDeLaWeb(t *testing.T) {
	var n int
	h := apiParaCORS(t, origenDeLaWeb, &n)

	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, pedido("GET", "/api/v1/prueba/cors", origenDeLaWeb))
	if got := rr.Result().Header.Values("Access-Control-Expose-Headers"); len(got) != 1 || got[0] != "Content-Disposition" {
		t.Fatalf("Access-Control-Expose-Headers %q, se esperaba [Content-Disposition]", got)
	}

	for _, origen := range []string{"https://otro.b.test", ""} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, pedido("GET", "/api/v1/prueba/cors", origen))
		if got := rr.Result().Header.Values("Access-Control-Expose-Headers"); len(got) != 0 {
			t.Fatalf("origen %q: Access-Control-Expose-Headers %q, no debía venir", origen, got)
		}
	}
}
