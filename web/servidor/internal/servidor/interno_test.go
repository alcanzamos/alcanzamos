package servidor

import (
	"io"
	"net/http"
	"testing"
)

// El servidor de net/http escribe en ErrorLog, con la dirección del cliente, cuando un manejador entra en pánico o
// llega una conexión mal formada. Su salida estándar (stderr) llegaría a los registros de Azure: se descarta.
func TestElServidorDescartaSuRegistroDeErrores(t *testing.T) {
	srv := nuevoServidor(http.NotFoundHandler())
	if srv.ErrorLog == nil || srv.ErrorLog.Writer() != io.Discard {
		t.Fatal("ErrorLog debe descartar lo que escribe net/http: trae direcciones IP")
	}
}
