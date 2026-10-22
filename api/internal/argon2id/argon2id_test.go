package argon2id

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestVectoresDeReferencia(t *testing.T) {
	h := Nuevo(Recomendados, MaxSimultaneas)
	for _, v := range vectoresReferencia {
		p := Parametros{MemoriaKiB: 1 << v.memoriaLog2, Iteraciones: v.t, Paralelismo: v.p}
		clave := derivar(v.clave, []byte(v.sal), p, 32)
		if got := hex.EncodeToString(clave); got != v.hex {
			t.Errorf("m=2^%d t=%d p=%d: hex %s, se esperaba %s", v.memoriaLog2, v.t, v.p, got, v.hex)
		}
		if got := codificar(p, []byte(v.sal), clave); got != v.codificado {
			t.Errorf("m=2^%d: codificado %s, se esperaba %s", v.memoriaLog2, got, v.codificado)
		}
		ok, err := h.Verificar(context.Background(), v.clave, v.codificado)
		if err != nil || !ok {
			t.Errorf("m=2^%d: verificar el vector dio %v, %v", v.memoriaLog2, ok, err)
		}
		ok, err = h.Verificar(context.Background(), v.clave+"x", v.codificado)
		if err != nil || ok {
			t.Errorf("m=2^%d: una contraseña distinta dio %v, %v", v.memoriaLog2, ok, err)
		}
	}
}

func TestHashearYVerificar(t *testing.T) {
	h := Predeterminado()
	ctx := context.Background()
	a, err := h.Hashear(ctx, "contraseña de prueba")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(a, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("formato inesperado: %s", a)
	}
	b, _ := h.Hashear(ctx, "contraseña de prueba")
	if a == b {
		t.Fatal("dos hashes de la misma contraseña no deben ser iguales (sal aleatoria)")
	}
	if ok, err := h.Verificar(ctx, "contraseña de prueba", a); err != nil || !ok {
		t.Fatalf("verificar: %v, %v", ok, err)
	}
	if ok, err := h.Verificar(ctx, "otra", a); err != nil || ok {
		t.Fatalf("otra contraseña: %v, %v", ok, err)
	}
}

func TestFormatoInvalido(t *testing.T) {
	v := vectoresReferencia[0].codificado
	casos := map[string]string{
		"vacío":               "",
		"sin separador":       strings.Replace(v, "p=1$", "p=1", 1),
		"algoritmo otro":      strings.Replace(v, "argon2id", "argon2i", 1),
		"versión otra":        strings.Replace(v, "v=19", "v=16", 1),
		"memoria cero":        strings.Replace(v, "m=65536", "m=0", 1),
		"memoria enorme":      strings.Replace(v, "m=65536", "m=4294967295", 1),
		"iteraciones cero":    strings.Replace(v, "t=2", "t=0", 1),
		"iteraciones altas":   strings.Replace(v, "t=2", "t=11", 1),
		"paralelismo cero":    strings.Replace(v, "p=1", "p=0", 1),
		"orden de campos":     strings.Replace(v, "m=65536,t=2,p=1", "t=2,m=65536,p=1", 1),
		"cero a la izquierda": strings.Replace(v, "t=2", "t=02", 1),
		"base64 inválido":     strings.Replace(v, "c29tZXNhbHQ", "c29tZXNhbH!", 1),
		"sal corta":           strings.Replace(v, "c29tZXNhbHQ", "c29t", 1),
		"campo extra":         v + "$x",
	}
	h := Predeterminado()
	for nombre, s := range casos {
		if ok, err := h.Verificar(context.Background(), "password", s); ok || !errors.Is(err, ErrFormato) {
			t.Errorf("%s: dio %v, %v; se esperaba ErrFormato", nombre, ok, err)
		}
	}
}

func TestCancelarMientrasEsperaCupo(t *testing.T) {
	h := Nuevo(Recomendados, 1)
	h.cupo <- struct{}{} // el único cupo está ocupado
	ctx, cancelar := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancelar()
	if _, err := h.Hashear(ctx, "x"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Hashear: %v", err)
	}
	if _, err := h.Verificar(ctx, "x", vectoresReferencia[2].codificado); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Verificar: %v", err)
	}
}

func TestNuncaMasDeCuatroSimultaneas(t *testing.T) {
	h := Predeterminado()
	var activas, maximo atomic.Int32
	hecho := make(chan struct{})
	for range 12 {
		go func() {
			liberar, err := h.tomar(context.Background())
			if err != nil {
				t.Error(err)
				hecho <- struct{}{}
				return
			}
			n := activas.Add(1)
			for {
				m := maximo.Load()
				if n <= m || maximo.CompareAndSwap(m, n) {
					break
				}
			}
			time.Sleep(10 * time.Millisecond)
			activas.Add(-1)
			liberar()
			hecho <- struct{}{}
		}()
	}
	for range 12 {
		<-hecho
	}
	if m := maximo.Load(); m < 1 || m > MaxSimultaneas {
		t.Fatalf("máximo observado %d, se esperaba entre 1 y %d", m, MaxSimultaneas)
	}
}

func BenchmarkVerificar(b *testing.B) {
	h := Predeterminado()
	ctx := context.Background()
	codificado, err := h.Hashear(ctx, "contraseña sintética")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for b.Loop() {
		if ok, err := h.Verificar(ctx, "contraseña sintética", codificado); err != nil || !ok {
			b.Fatal(ok, err)
		}
	}
}
