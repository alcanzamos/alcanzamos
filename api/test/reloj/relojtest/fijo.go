// Package relojtest es el Reloj de las pruebas.
package relojtest

import "time"

// Fijo es un Reloj de pruebas: siempre da el mismo instante hasta que se cambie T.
type Fijo struct{ T time.Time }

// Ahora devuelve T en UTC.
func (f *Fijo) Ahora() time.Time { return f.T.UTC() }
