package seguridad

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

// LongitudDeToken son los bytes aleatorios de un token opaco (D-081).
const LongitudDeToken = 32

// ErrTokenInvalido indica un token que no tiene el formato de un token opaco.
var ErrTokenInvalido = errors.New("token inválido")

// NuevoTokenOpaco genera un token de 32 bytes de crypto/rand. Devuelve el texto que va al enlace (base64 de URL, sin
// relleno) y su SHA-256, que es lo único que se guarda en la base (E13 §5.3 y §5.4).
func NuevoTokenOpaco() (token string, huella []byte) {
	b := make([]byte, LongitudDeToken)
	_, _ = rand.Read(b) // desde Go 1.24 crypto/rand.Read no devuelve error: si no hay entropía, el programa termina
	h := sha256.Sum256(b)
	return base64.RawURLEncoding.EncodeToString(b), h[:]
}

// HuellaDeToken calcula el SHA-256 de un token recibido. Un texto que no decodifica a 32 bytes da ErrTokenInvalido,
// sin tocar la base.
func HuellaDeToken(token string) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(b) != LongitudDeToken {
		return nil, ErrTokenInvalido
	}
	h := sha256.Sum256(b)
	return h[:], nil
}
