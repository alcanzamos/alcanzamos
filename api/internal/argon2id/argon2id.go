// Package argon2id hashea y verifica contraseñas con Argon2id sobre golang.org/x/crypto/argon2 (ADR-002).
//
// Parámetros OWASP: 19 MiB, 2 iteraciones, paralelismo 1. El hash se guarda en formato PHC:
//
//	$argon2id$v=19$m=19456,t=2,p=1$<sal>$<clave>
//
// con sal y clave en base64 estándar sin relleno. Un semáforo limita a 4 las operaciones simultáneas
// para acotar la memoria (4 × 19 MiB).
package argon2id

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Parametros del costo de Argon2id.
type Parametros struct {
	MemoriaKiB  uint32
	Iteraciones uint32
	Paralelismo uint8
}

// Recomendados son los parámetros OWASP (19 MiB, t=2, p=1).
var Recomendados = Parametros{MemoriaKiB: 19 * 1024, Iteraciones: 2, Paralelismo: 1}

const (
	longSal   = 16
	longClave = 32
	// MaxSimultaneas es el máximo de hashes o verificaciones en curso a la vez.
	MaxSimultaneas = 4

	// Topes al leer un hash ajeno: evitan que un valor corrupto pida memoria o tiempo sin límite.
	maxMemoriaKiB  = 256 * 1024
	maxIteraciones = 10
	maxParalelismo = 8
)

// ErrFormato indica un hash que no cumple el formato PHC de este paquete.
var ErrFormato = errors.New("argon2id: formato de hash inválido")

var base64Sin = base64.RawStdEncoding.Strict()

// Hasher aplica Argon2id con un límite de operaciones simultáneas.
type Hasher struct {
	params Parametros
	cupo   chan struct{}
}

// Nuevo crea un Hasher con los parámetros y el máximo de operaciones simultáneas dados.
func Nuevo(p Parametros, maxSimultaneas int) *Hasher {
	return &Hasher{params: p, cupo: make(chan struct{}, maxSimultaneas)}
}

// Predeterminado usa los parámetros OWASP y 4 operaciones simultáneas.
func Predeterminado() *Hasher { return Nuevo(Recomendados, MaxSimultaneas) }

func (h *Hasher) tomar(ctx context.Context) (func(), error) {
	select {
	case h.cupo <- struct{}{}:
		return func() { <-h.cupo }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Hashear devuelve el hash PHC de la contraseña con una sal aleatoria nueva.
func (h *Hasher) Hashear(ctx context.Context, contrasena string) (string, error) {
	liberar, err := h.tomar(ctx)
	if err != nil {
		return "", err
	}
	defer liberar()
	sal := make([]byte, longSal)
	if _, err := rand.Read(sal); err != nil {
		return "", fmt.Errorf("argon2id: sal aleatoria: %w", err)
	}
	return codificar(h.params, sal, derivar(contrasena, sal, h.params, longClave)), nil
}

// Verificar indica si la contraseña corresponde al hash. Usa los parámetros guardados en el hash,
// así que sigue verificando hashes viejos si los parámetros recomendados cambian.
// Devuelve ErrFormato si el hash está mal formado; una contraseña distinta no es error.
func (h *Hasher) Verificar(ctx context.Context, contrasena, codificado string) (bool, error) {
	p, sal, clave, err := decodificar(codificado)
	if err != nil {
		return false, err
	}
	liberar, err := h.tomar(ctx)
	if err != nil {
		return false, err
	}
	defer liberar()
	obtenida := derivar(contrasena, sal, p, uint32(len(clave)))
	return subtle.ConstantTimeCompare(obtenida, clave) == 1, nil
}

func derivar(contrasena string, sal []byte, p Parametros, largo uint32) []byte {
	return argon2.IDKey([]byte(contrasena), sal, p.Iteraciones, p.MemoriaKiB, p.Paralelismo, largo)
}

func codificar(p Parametros, sal, clave []byte) string {
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version,
		p.MemoriaKiB, p.Iteraciones, p.Paralelismo,
		base64Sin.EncodeToString(sal), base64Sin.EncodeToString(clave))
}

func decodificar(s string) (Parametros, []byte, []byte, error) {
	var p Parametros
	partes := strings.Split(s, "$")
	if len(partes) != 6 || partes[0] != "" || partes[1] != "argon2id" || partes[2] != "v="+strconv.Itoa(argon2.Version) {
		return p, nil, nil, ErrFormato
	}
	campos := strings.Split(partes[3], ",")
	if len(campos) != 3 {
		return p, nil, nil, ErrFormato
	}
	var valores [3]uint64
	for i, nombre := range []string{"m=", "t=", "p="} {
		num, ok := strings.CutPrefix(campos[i], nombre)
		if !ok || num == "" || num[0] == '+' || (len(num) > 1 && num[0] == '0') {
			return p, nil, nil, ErrFormato
		}
		v, err := strconv.ParseUint(num, 10, 32)
		if err != nil {
			return p, nil, nil, ErrFormato
		}
		valores[i] = v
	}
	m, t, par := valores[0], valores[1], valores[2]
	if m < 8*par || m > maxMemoriaKiB || t < 1 || t > maxIteraciones || par < 1 || par > maxParalelismo {
		return p, nil, nil, ErrFormato
	}
	sal, err := base64Sin.DecodeString(partes[4])
	if err != nil || len(sal) < 8 || len(sal) > 64 {
		return p, nil, nil, ErrFormato
	}
	clave, err := base64Sin.DecodeString(partes[5])
	if err != nil || len(clave) < 16 || len(clave) > 64 {
		return p, nil, nil, ErrFormato
	}
	return Parametros{MemoriaKiB: uint32(m), Iteraciones: uint32(t), Paralelismo: uint8(par)}, sal, clave, nil
}
