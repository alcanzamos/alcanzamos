// Package correo es el puerto de correo (E12 `Correo`) y sus adaptadores: SMTP de la biblioteca estándar
// y uno falso para las pruebas. El puerto es estrecho a propósito: solo tiene los envíos permitidos (NM-04).
package correo

import (
	"context"
	"sync"
)

// Correo son los envíos permitidos. El adaptador pone el texto: quien llama solo entrega el destino y el token.
// El token viaja dentro del enlace del mensaje; nunca se registra.
type Correo interface {
	// EnviarVerificacion manda el enlace para confirmar el correo (CU-43).
	EnviarVerificacion(ctx context.Context, destino, token string) error
	// EnviarAvisoDeCorreoRegistrado avisa al dueño de un correo con cuenta verificada que alguien intentó crear una
	// cuenta con él (D-141). No lleva enlace ni contraseña.
	EnviarAvisoDeCorreoRegistrado(ctx context.Context, destino string) error
}

// Envio es lo que el Falso recibió. Token está vacío en el aviso de correo ya registrado, que no lleva ninguno.
type Envio struct {
	Destino string
	Token   string
	Aviso   bool
}

// Falso es el adaptador de pruebas (E12 `CorreoFalso`): guarda en memoria lo que enviaría.
type Falso struct {
	mu      sync.Mutex
	enviado []Envio
	// Error, si no es nulo, es lo que devuelve cada envío (y no lo guarda).
	Error error
}

// EnviarVerificacion guarda el envío.
func (f *Falso) EnviarVerificacion(_ context.Context, destino, token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Error != nil {
		return f.Error
	}
	f.enviado = append(f.enviado, Envio{Destino: destino, Token: token})
	return nil
}

// EnviarAvisoDeCorreoRegistrado guarda el aviso.
func (f *Falso) EnviarAvisoDeCorreoRegistrado(_ context.Context, destino string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Error != nil {
		return f.Error
	}
	f.enviado = append(f.enviado, Envio{Destino: destino, Aviso: true})
	return nil
}

// Enviados devuelve una copia de los envíos hechos hasta ahora.
func (f *Falso) Enviados() []Envio {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Envio(nil), f.enviado...)
}
