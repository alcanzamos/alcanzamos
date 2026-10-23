// Package reloj es la única fuente de la hora del sistema (E17-ECO 3.9): el resto del código recibe un Reloj
// y las pruebas le ponen una hora fija.
package reloj

import "time"

// Reloj entrega el instante actual en UTC.
type Reloj interface {
	Ahora() time.Time
}

// Sistema es el Reloj real.
type Sistema struct{}

// Ahora lee la hora del sistema en UTC.
func (Sistema) Ahora() time.Time { return time.Now().UTC() }

// Fijo es un Reloj de pruebas: siempre da el mismo instante hasta que se cambie T.
type Fijo struct{ T time.Time }

// Ahora devuelve T en UTC.
func (f *Fijo) Ahora() time.Time { return f.T.UTC() }
