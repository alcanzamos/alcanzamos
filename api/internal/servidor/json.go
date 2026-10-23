package servidor

import (
	"encoding/json"
	"net/http"
)

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
