package seguridad

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"testing"
)

func TestTokenOpaco(t *testing.T) {
	token, huella := NuevoTokenOpaco()
	crudo, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(crudo) != 32 {
		t.Fatalf("el token no son 32 bytes en base64 de URL: %q (%v)", token, err)
	}
	if esperado := sha256.Sum256(crudo); !bytes.Equal(huella, esperado[:]) {
		t.Fatal("la huella no es el SHA-256 de los 32 bytes")
	}
	otra, err := HuellaDeToken(token)
	if err != nil || !bytes.Equal(otra, huella) {
		t.Fatalf("HuellaDeToken no coincide: %v", err)
	}
	otroToken, _ := NuevoTokenOpaco()
	if otroToken == token {
		t.Fatal("dos tokens iguales")
	}
}

func TestHuellaDeTokenInvalido(t *testing.T) {
	for nombre, token := range map[string]string{
		"vacío":        "",
		"no es base64": "!!!",
		"muy corto":    base64.RawURLEncoding.EncodeToString(make([]byte, 31)),
		"muy largo":    base64.RawURLEncoding.EncodeToString(make([]byte, 33)),
		"con relleno":  base64.URLEncoding.EncodeToString(make([]byte, 32)),
	} {
		t.Run(nombre, func(t *testing.T) {
			if _, err := HuellaDeToken(token); !errors.Is(err, ErrTokenInvalido) {
				t.Fatalf("se esperaba ErrTokenInvalido: %v", err)
			}
		})
	}
}
