package sesion_test

import (
	"bytes"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/reloj"
	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

var (
	claveA = bytes.Repeat([]byte{0xA1}, 32)
	claveB = bytes.Repeat([]byte{0xB2}, 32)
)

func nuevosSenuelosDePrueba(t *testing.T, clave []byte, r reloj.Reloj) *sesion.Senuelos {
	t.Helper()
	s, err := sesion.NuevosSenuelos(clave, r)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestUnaClaveCortaNoSirve(t *testing.T) {
	if _, err := sesion.NuevosSenuelos(make([]byte, 31), &relojtest.Fijo{T: ahora}); !errors.Is(err, sesion.ErrClaveDelSenuelo) {
		t.Fatalf("una clave de 31 bytes debe rechazarse: %v", err)
	}
}

// (a) Un token de mentira lo reconoce una instancia nueva con la misma clave (el API se reinició) y otra instancia
// al mismo tiempo (otra réplica): no hay nada guardado en la que lo creó.
func TestElSenueloSobreviveAUnReinicioYLoReconoceOtraReplica(t *testing.T) {
	reloj := &relojtest.Fijo{T: ahora}
	token := nuevosSenuelosDePrueba(t, claveA, reloj).Crear()

	reiniciada := nuevosSenuelosDePrueba(t, claveA, reloj)
	replica := nuevosSenuelosDePrueba(t, claveA, reloj)
	if !reiniciada.Reconoce(token) || !replica.Reconoce(token) {
		t.Fatal("una instancia nueva con la misma clave debe reconocerlo")
	}

	// Y a través del resolutor completo, con una instancia nueva y un almacén sin esa sesión.
	res := sesion.NuevoResolutor(&almacenFalso{}, reiniciada, reloj)
	if s, err := res.SujetoDe(conToken(token)); err != nil || !s.Senuelo {
		t.Fatalf("el resolutor de la instancia nueva: %+v %v", s, err)
	}
}

// (b) Con otra clave no se reconoce.
func TestOtraClaveNoReconoceElSenuelo(t *testing.T) {
	reloj := &relojtest.Fijo{T: ahora}
	token := nuevosSenuelosDePrueba(t, claveA, reloj).Crear()
	if nuevosSenuelosDePrueba(t, claveB, reloj).Reconoce(token) {
		t.Fatal("una clave distinta no debe reconocerlo")
	}
}

// (c) La ventana: creado el día D, se reconoce hasta que termina el día D+7 (UTC); desde el día D+8 ya no.
// Se prueba con el reloj inyectado, también en los bordes del día.
func TestElSenueloVenceDespuesDeLaVentana(t *testing.T) {
	creado := time.Date(2026, 11, 10, 23, 59, 59, 0, time.UTC) // el último segundo del día D
	r := &relojtest.Fijo{T: creado}
	s := nuevosSenuelosDePrueba(t, claveA, r)
	token := s.Crear()

	casos := []struct {
		nombre string
		ahora  time.Time
		quiere bool
	}{
		{"al crearlo", creado, true},
		{"día D+1", creado.Add(time.Second), true},
		{"día D+7, a las 00:00:00", time.Date(2026, 11, 17, 0, 0, 0, 0, time.UTC), true},
		{"día D+7, 23:59:59", time.Date(2026, 11, 17, 23, 59, 59, 0, time.UTC), true},
		{"día D+8, 00:00:00", time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC), false},
		{"un mes después", creado.AddDate(0, 1, 0), false},
	}
	for _, c := range casos {
		r.T = c.ahora
		if got := s.Reconoce(token); got != c.quiere {
			t.Errorf("%s: Reconoce = %v, se esperaba %v", c.nombre, got, c.quiere)
		}
	}

	// Creado a la primera hora del día D: igual vence al terminar el día D+7.
	r.T = time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	temprano := s.Crear()
	r.T = time.Date(2026, 11, 17, 23, 59, 59, 0, time.UTC)
	if !s.Reconoce(temprano) {
		t.Error("creado el día D a las 00:00, sirve hasta el final del día D+7")
	}
	r.T = time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC)
	if s.Reconoce(temprano) {
		t.Error("el día D+8 ya no sirve")
	}
	// Un día de creación futuro (la hora de otra réplica adelantada más de un día) no se acepta.
	r.T = time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	futuro := s.Crear()
	r.T = time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	if s.Reconoce(futuro) {
		t.Error("un token de un día que todavía no llega no debe reconocerse")
	}
}

// (d) Un token aleatorio de 32 bytes, que es lo que parece una sesión real desconocida, no es de mentira.
func TestUnTokenAleatorioNoEsDeMentira(t *testing.T) {
	s := nuevosSenuelosDePrueba(t, claveA, &relojtest.Fijo{T: ahora})
	for range 2000 {
		real, _ := seguridad.NuevoTokenOpaco()
		if s.Reconoce(real) {
			t.Fatal("un token aleatorio no debe reconocerse como de mentira")
		}
	}
	for nombre, token := range map[string]string{"vacío": "", "no es base64": "!!!", "corto": "abcd"} {
		if s.Reconoce(token) {
			t.Errorf("%s no debe reconocerse", nombre)
		}
	}
	largo := base64.RawURLEncoding.EncodeToString(make([]byte, 33))
	if s.Reconoce(largo) {
		t.Error("un token de 33 bytes no debe reconocerse")
	}
}

// (e) El token de mentira se ve igual que uno real: 43 caracteres, base64 de URL sin relleno, que decodifica a 32
// bytes y pasa por HuellaDeToken como cualquier otro.
func TestElSenueloTieneElMismoFormatoQueUnTokenReal(t *testing.T) {
	s := nuevosSenuelosDePrueba(t, claveA, &relojtest.Fijo{T: ahora})
	real, _ := seguridad.NuevoTokenOpaco()
	vistos := map[string]bool{}
	for range 200 {
		token := s.Crear()
		if len(token) != 43 || len(token) != len(real) {
			t.Fatalf("largo %d, el de uno real es %d", len(token), len(real))
		}
		if _, err := seguridad.HuellaDeToken(token); err != nil {
			t.Fatalf("no pasa por HuellaDeToken: %v", err)
		}
		if token[len(token)-1] == '=' || bytes.ContainsAny([]byte(token), "+/=") {
			t.Fatalf("no es base64 de URL sin relleno: %s", token)
		}
		if vistos[token] {
			t.Fatal("dos tokens iguales")
		}
		vistos[token] = true
	}
}

// El token nunca viaja ni se guarda a la vista: cookie y cabecera de un token de mentira son las de uno real.
func TestLaCookieDelSenueloEsIgualALaDeUnaSesionReal(t *testing.T) {
	s := nuevosSenuelosDePrueba(t, claveA, &relojtest.Fijo{T: ahora})
	real, _ := seguridad.NuevoTokenOpaco()
	a, b := sesion.Cookie(real), sesion.Cookie(s.Crear())
	a.Value, b.Value = "", ""
	if a.String() != b.String() {
		t.Fatalf("%s != %s", a, b)
	}
}
