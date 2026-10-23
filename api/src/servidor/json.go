package servidor

import (
	"encoding/json"
	"io"
	"net/http"
)

// tamanoMaximoDelCuerpo basta de sobra para unos pocos campos de texto y corta cuerpos abusivos antes de calcular un hash.
const tamanoMaximoDelCuerpo = 16 << 10

// LeerJSON decodifica un cuerpo JSON de un solo objeto. Un campo que no esté en destino es un error: así, un cliente
// que mande la fecha de nacimiento recibe 400 y el API nunca la lee (D-089). Si falla, ya respondió 400
// `solicitud_invalida` y devuelve false.
func LeerJSON(w http.ResponseWriter, r *http.Request, destino any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, tamanoMaximoDelCuerpo))
	d.DisallowUnknownFields()
	if err := d.Decode(destino); err != nil || d.Decode(&struct{}{}) != io.EOF {
		EscribirError(w, http.StatusBadRequest, "solicitud_invalida")
		return false
	}
	return true
}

// EscribirJSON responde con un cuerpo JSON y el código dado.
func EscribirJSON(w http.ResponseWriter, codigo int, cuerpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(codigo)
	_ = json.NewEncoder(w).Encode(cuerpo)
}

// EscribirError responde con {"error": "<código>"}. El código es estable y lo mapea el cliente a su texto (ADR-005):
// el API nunca manda el texto que ve la persona.
func EscribirError(w http.ResponseWriter, codigo int, codigoDeError string) {
	EscribirJSON(w, codigo, map[string]string{"error": codigoDeError})
}
