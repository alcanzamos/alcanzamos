// Package seguridad reúne lo de seguridad que no depende de ningún módulo de negocio (E12 §5.9): eventos de
// seguridad, política de contraseñas y tokens opacos.
package seguridad

import (
	"context"
	"crypto/rand"
	"encoding/hex"
)

type claveDelContexto int

const (
	clavePeticion claveDelContexto = iota
	clavePersona
)

// ConPeticion devuelve un contexto que lleva el identificador de la petición.
func ConPeticion(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, clavePeticion, id)
}

// PeticionDe devuelve el identificador de la petición, o "" si no hay.
func PeticionDe(ctx context.Context) string {
	id, _ := ctx.Value(clavePeticion).(string)
	return id
}

// ConPersona devuelve un contexto que lleva la persona de la sesión (uuid).
func ConPersona(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, clavePersona, id)
}

// PersonaDe devuelve la persona de la sesión, o "" si la petición no tiene sesión.
func PersonaDe(ctx context.Context) string {
	id, _ := ctx.Value(clavePersona).(string)
	return id
}

// NuevaPeticion genera un identificador de petición: 16 bytes de crypto/rand en hexadecimal.
// Siempre se genera en el servidor; nunca se acepta el que mande el cliente (inyección en el registro).
func NuevaPeticion() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b) // desde Go 1.24 crypto/rand.Read no devuelve error: si no hay entropía, el programa termina
	return hex.EncodeToString(b)
}
