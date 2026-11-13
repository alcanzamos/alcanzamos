// Package correotest es el adaptador de correo de las pruebas (E12 `CorreoFalso`): guarda en memoria lo que enviaría.
package correotest

import (
	"context"
	"sync"
	"time"
)

// Envio es lo que el Falso recibió. Token está vacío en el aviso de correo ya registrado, que no lleva ninguno.
// Recuperacion distingue el enlace de recuperación del de verificación. AvisoDePurga es el correo de antes de la purga
// (D-203): no lleva token y BorradoEn es el momento del borrado que dice.
type Envio struct {
	Destino      string
	Token        string
	Aviso        bool
	Recuperacion bool
	AvisoDePurga bool
	BorradoEn    time.Time
}

// Falso implementa correo.Correo: guarda en memoria lo que enviaría.
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

// EnviarRecuperacion guarda el envío.
func (f *Falso) EnviarRecuperacion(_ context.Context, destino, token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Error != nil {
		return f.Error
	}
	f.enviado = append(f.enviado, Envio{Destino: destino, Token: token, Recuperacion: true})
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

// EnviarAvisoDePurga guarda el aviso de antes de la purga con el momento del borrado que dice.
func (f *Falso) EnviarAvisoDePurga(_ context.Context, destino string, borradoEn time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Error != nil {
		return f.Error
	}
	f.enviado = append(f.enviado, Envio{Destino: destino, AvisoDePurga: true, BorradoEn: borradoEn})
	return nil
}

// Enviados devuelve una copia de los envíos hechos hasta ahora.
func (f *Falso) Enviados() []Envio {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Envio(nil), f.enviado...)
}
