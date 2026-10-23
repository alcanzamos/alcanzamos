package reloj_test

import (
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

func TestElRelojDelSistemaDaLaHoraActualEnUTC(t *testing.T) {
	antes := time.Now()
	ahora := reloj.Sistema{}.Ahora()
	if ahora.Location() != time.UTC {
		t.Fatalf("zona %v, se esperaba UTC", ahora.Location())
	}
	if ahora.Before(antes.Truncate(0)) || ahora.After(time.Now().Add(time.Second)) {
		t.Fatalf("hora %v fuera de lo esperado", ahora)
	}
}

func TestElRelojFijoNoAvanzaHastaQueSeCambia(t *testing.T) {
	bogota := time.FixedZone("Bogota", -5*3600)
	f := &relojtest.Fijo{T: time.Date(2026, 10, 22, 10, 0, 0, 0, bogota)}
	var r reloj.Reloj = f
	if got := r.Ahora(); !got.Equal(f.T) || got.Location() != time.UTC {
		t.Fatalf("Ahora = %v", got)
	}
	f.T = f.T.Add(time.Hour)
	if got := r.Ahora(); got.Hour() != 16 {
		t.Fatalf("tras avanzar: %v", got)
	}
}
