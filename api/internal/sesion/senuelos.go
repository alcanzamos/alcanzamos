package sesion

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"time"

	"github.com/alcanzamos/alcanzamos/api/internal/config"
	"github.com/alcanzamos/alcanzamos/api/internal/reloj"
	"github.com/alcanzamos/alcanzamos/api/internal/seguridad"
)

// Tamaños del token de mentira: 16 bytes aleatorios y los primeros 16 del HMAC-SHA-256. Suman los 32 bytes de un token
// real, y en base64 de URL sin relleno son 43 caracteres, igual que él (D-141, D-143 (2)).
const (
	bytesAleatoriosDelSenuelo = 16
	bytesDeFirmaDelSenuelo    = 16
)

// DiasDeVidaDelSenuelo son los días de calendario UTC, después del de su creación, en que un token de mentira sigue
// reconociéndose: los 7 días de la cuenta sin verificar que imita (D-135).
const DiasDeVidaDelSenuelo = 7

// formatoDelDia es el día de creación que entra en la firma: AAAA-MM-DD en UTC.
const formatoDelDia = "2006-01-02"

// ErrClaveDelSenuelo: la clave de las sesiones de mentira es más corta que lo exigido por la configuración.
var ErrClaveDelSenuelo = errors.New("la clave de las sesiones de mentira es demasiado corta")

// Senuelos crea y reconoce las sesiones de mentira de D-141: cuando alguien crea una cuenta con el correo de una ya
// verificada, la respuesta es idéntica a la de una cuenta nueva, con un token del mismo formato y largo.
//
// El token **no se guarda en ningún lado**: va firmado con HMAC-SHA-256 con una clave de la configuración
// (SESION_SENUELO_CLAVE), así que cualquier instancia del API con la misma clave lo reconoce. Eso cubre el reinicio
// (una sesión de mentira en memoria desaparecería y la real no, y esa diferencia las delataría) y varias réplicas.
//
//	token = base64url( aleatorio(16) ‖ HMAC-SHA-256(clave, aleatorio ‖ día de creación "AAAA-MM-DD" en UTC)[:16] )
//
// Reconocimiento: se recalcula la firma para cada día de creación posible, de hoy menos 7 días hasta hoy, ambos
// incluidos (8 días de calendario UTC). Un token creado el día D se reconoce hasta que termina el día D+7: entre 7 y
// 8 días después de crearse, según la hora. La cuenta real sin verificar se borra a los 7 días (D-135) en una tarea
// diaria, así que la diferencia cabe en la misma holgura de la tarea. Se calculan siempre los 8 HMAC y se comparan
// en tiempo constante, para que ni el tiempo diga en qué día se creó.
//
// Es inmutable después de crearlo y seguro desde varias goroutines.
type Senuelos struct {
	clave []byte
	reloj reloj.Reloj
}

// NuevosSenuelos crea el generador. La clave debe tener al menos config.LongitudMinimaDeClaveDeSenuelo bytes; se copia.
func NuevosSenuelos(clave []byte, r reloj.Reloj) (*Senuelos, error) {
	if len(clave) < config.LongitudMinimaDeClaveDeSenuelo {
		return nil, ErrClaveDelSenuelo
	}
	return &Senuelos{clave: append([]byte(nil), clave...), reloj: r}, nil
}

// Crear genera un token de mentira firmado con el día de hoy (UTC). No guarda nada.
func (s *Senuelos) Crear() string {
	token := make([]byte, bytesAleatoriosDelSenuelo+bytesDeFirmaDelSenuelo)
	_, _ = rand.Read(token[:bytesAleatoriosDelSenuelo]) // desde Go 1.24 no devuelve error: sin entropía, el programa termina
	copy(token[bytesAleatoriosDelSenuelo:], s.firma(token[:bytesAleatoriosDelSenuelo], s.reloj.Ahora().UTC()))
	return base64.RawURLEncoding.EncodeToString(token)
}

// Reconoce dice si el token es de mentira y no ha vencido: si su firma coincide para alguno de los días de creación
// de hoy menos 7 días hasta hoy.
func (s *Senuelos) Reconoce(token string) bool {
	crudo, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(crudo) != seguridad.LongitudDeToken {
		return false
	}
	aleatorio, recibida := crudo[:bytesAleatoriosDelSenuelo], crudo[bytesAleatoriosDelSenuelo:]
	hoy := s.reloj.Ahora().UTC()
	coincide := 0
	for atras := 0; atras <= DiasDeVidaDelSenuelo; atras++ {
		coincide |= subtle.ConstantTimeCompare(recibida, s.firma(aleatorio, hoy.AddDate(0, 0, -atras)))
	}
	return coincide == 1
}

// firma es el HMAC del aleatorio y el día de creación, recortado a 16 bytes.
func (s *Senuelos) firma(aleatorio []byte, dia time.Time) []byte {
	m := hmac.New(sha256.New, s.clave)
	m.Write(aleatorio)
	m.Write([]byte(dia.UTC().Format(formatoDelDia)))
	return m.Sum(nil)[:bytesDeFirmaDelSenuelo]
}
