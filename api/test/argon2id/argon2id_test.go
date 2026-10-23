package argon2id_test

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/argon2id"
)

func TestVectoresDeReferencia(t *testing.T) {
	h := argon2id.Nuevo(argon2id.Recomendados, argon2id.MaxSimultaneas)
	for _, v := range vectoresReferencia {
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
	h := argon2id.Predeterminado()
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
	h := argon2id.Predeterminado()
	for nombre, s := range casos {
		if ok, err := h.Verificar(context.Background(), "password", s); ok || !errors.Is(err, argon2id.ErrFormato) {
			t.Errorf("%s: dio %v, %v; se esperaba ErrFormato", nombre, ok, err)
		}
	}
}

// pesados son parámetros que tardan cientos de milisegundos: mantienen ocupado un cupo mientras la prueba mira. Ningún
// resultado de las pruebas depende de cuánto tardan: solo de que sigan en curso cuando se mira, y se vuelve a mirar
// (con un plazo generoso que solo acota el fallo) hasta verlo.
var pesados = argon2id.Parametros{MemoriaKiB: 64 * 1024, Iteraciones: 10, Paralelismo: 1}

// ocupar lanza n hashes pesados en segundo plano. El resultado espera a que terminen.
func ocupar(h *argon2id.Hasher, n int) (esperar func()) {
	var hechos sync.WaitGroup
	for range n {
		hechos.Go(func() { _, _ = h.Hashear(context.Background(), "x") })
	}
	return hechos.Wait
}

// probar intenta una verificación ligera con ese plazo para tomar cupo.
func probar(h *argon2id.Hasher, plazo time.Duration) error {
	ctx, cancelar := context.WithTimeout(context.Background(), plazo)
	defer cancelar()
	_, err := h.Verificar(ctx, "password", vectoresReferencia[2].codificado)
	return err
}

// hastaVerLleno repite la sonda hasta que no consigue cupo. No duerme: cada sonda ya espera su plazo corto. El plazo de
// 30 s solo acota el fallo (si los hashes terminaron antes de verse el cupo lleno, la prueba falla).
func hastaVerLleno(t *testing.T, h *argon2id.Hasher) {
	t.Helper()
	limite := time.Now().Add(30 * time.Second)
	for time.Now().Before(limite) {
		err := probar(h, 10*time.Millisecond)
		if errors.Is(err, context.DeadlineExceeded) {
			return
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	t.Fatal("nunca se vio el cupo lleno")
}

func TestCancelarMientrasEsperaCupo(t *testing.T) {
	h := argon2id.Nuevo(pesados, 1)
	defer ocupar(h, 1)() // el único cupo está ocupado
	hastaVerLleno(t, h)
	ctx, cancelar := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancelar()
	if _, err := h.Hashear(ctx, "x"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Hashear: %v", err)
	}
	if _, err := h.Verificar(ctx, "x", vectoresReferencia[2].codificado); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Verificar: %v", err)
	}
}

// El tope es de cuatro: con cuatro hashes pesados en curso no cabe otra operación, y mientras haya tres sí cabe (una
// sonda con plazo largo entra en cuanto hay cupo).
func TestNuncaMasDeCuatroSimultaneas(t *testing.T) {
	if argon2id.MaxSimultaneas != 4 {
		t.Fatalf("MaxSimultaneas %d, se esperaba 4", argon2id.MaxSimultaneas)
	}
	h := argon2id.Nuevo(pesados, argon2id.MaxSimultaneas)

	esperar := ocupar(h, argon2id.MaxSimultaneas-1)
	if err := probar(h, 30*time.Second); err != nil {
		t.Errorf("con tres en curso cabe una más: %v", err)
	}
	esperar()

	esperar = ocupar(h, argon2id.MaxSimultaneas)
	defer esperar()
	hastaVerLleno(t, h)
}

func BenchmarkVerificar(b *testing.B) {
	h := argon2id.Predeterminado()
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

// phc arma un hash en formato PHC con la sal y la clave dadas, sin derivar nada: sirve para NecesitaMejora, que solo
// mira los parámetros y los largos.
func phc(p argon2id.Parametros, sal, clave []byte) string {
	b64 := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", p.MemoriaKiB, p.Iteraciones, p.Paralelismo, b64(sal), b64(clave))
}

func TestNecesitaMejora(t *testing.T) {
	h := argon2id.Nuevo(argon2id.Recomendados, argon2id.MaxSimultaneas) // m=19456, t=2, p=1
	sal16, clave32 := make([]byte, 16), make([]byte, 32)
	hash := func(p argon2id.Parametros, sal, clave []byte) string { return phc(p, sal, clave) }
	con := func(f func(*argon2id.Parametros)) argon2id.Parametros { p := argon2id.Recomendados; f(&p); return p }
	casos := []struct {
		nombre string
		hash   string
		quiere bool
	}{
		{"iguales", hash(argon2id.Recomendados, sal16, clave32), false},
		{"memoria menor", hash(con(func(p *argon2id.Parametros) { p.MemoriaKiB = 8192 }), sal16, clave32), true},
		{"iteraciones menores", hash(con(func(p *argon2id.Parametros) { p.Iteraciones = 1 }), sal16, clave32), true},
		{"memoria y paralelismo mayores, iteraciones menores", hash(argon2id.Parametros{MemoriaKiB: 65536, Iteraciones: 1, Paralelismo: 4}, sal16, clave32), true},
		{"memoria mayor", hash(con(func(p *argon2id.Parametros) { p.MemoriaKiB = 32768 }), sal16, clave32), false},
		{"iteraciones mayores", hash(con(func(p *argon2id.Parametros) { p.Iteraciones = 3 }), sal16, clave32), false},
		{"paralelismo mayor", hash(con(func(p *argon2id.Parametros) { p.Paralelismo = 2 }), sal16, clave32), false},
		{"sal más corta", hash(argon2id.Recomendados, make([]byte, 8), clave32), true},
		{"clave más corta", hash(argon2id.Recomendados, sal16, make([]byte, 16)), true},
		{"sal y clave más largas", hash(argon2id.Recomendados, make([]byte, 24), make([]byte, 48)), false},
	}
	for _, c := range casos {
		got, err := h.NecesitaMejora(c.hash)
		if err != nil || got != c.quiere {
			t.Errorf("%s: dio %v, %v; se esperaba %v", c.nombre, got, err, c.quiere)
		}
	}
	// Con un Hasher de paralelismo mayor, el guardado de p=1 queda atrás.
	if got, err := argon2id.Nuevo(argon2id.Parametros{MemoriaKiB: 19456, Iteraciones: 2, Paralelismo: 2}, 1).NecesitaMejora(hash(argon2id.Recomendados, sal16, clave32)); err != nil || !got {
		t.Errorf("paralelismo menor: dio %v, %v", got, err)
	}
	for _, malo := range []string{"", "$argon2id$v=19$m=0,t=2,p=1$AAAA$AAAA", "no es un hash", strings.Replace(hash(argon2id.Recomendados, sal16, clave32), "argon2id", "argon2i", 1)} {
		if got, err := h.NecesitaMejora(malo); got || !errors.Is(err, argon2id.ErrFormato) {
			t.Errorf("%q: dio %v, %v; se esperaba ErrFormato", malo, got, err)
		}
	}
}

func TestUnHashRecienCalculadoNoNecesitaMejora(t *testing.T) {
	h := argon2id.Predeterminado()
	hash, err := h.Hashear(context.Background(), "x")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := h.NecesitaMejora(hash); err != nil || got {
		t.Errorf("dio %v, %v", got, err)
	}
}
