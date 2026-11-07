package sesion_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alcanzamos/alcanzamos/api/src/seguridad"
	"github.com/alcanzamos/alcanzamos/api/src/sesion"
	"github.com/alcanzamos/alcanzamos/api/test/reloj/relojtest"
)

var ahora = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

func TestLaCookieDeLaWebTieneLosAtributosDeD081(t *testing.T) {
	token, _ := seguridad.NuevoTokenOpaco()
	linea := sesion.Cookie(token).String()
	for _, atributo := range []string{"__Host-sesion=" + token, "Path=/", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=7776000"} {
		if !strings.Contains(linea, atributo) {
			t.Errorf("a la cookie le falta %q: %s", atributo, linea)
		}
	}
	for _, prohibido := range []string{"Domain", "Expires"} {
		if strings.Contains(linea, prohibido) {
			t.Errorf("la cookie __Host- no puede llevar %q: %s", prohibido, linea)
		}
	}
}

func TestTokenDeLaPeticion(t *testing.T) {
	casos := []struct {
		nombre string
		poner  func(*http.Request)
		quiere string
	}{
		{"nada", func(*http.Request) {}, ""},
		{"cookie", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: sesion.NombreDeLaCookie, Value: "c"}) }, "c"},
		{"bearer", func(r *http.Request) { r.Header.Set("Authorization", "Bearer b") }, "b"},
		{"bearer en minúsculas", func(r *http.Request) { r.Header.Set("Authorization", "bearer b") }, "b"},
		{"gana el encabezado", func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: sesion.NombreDeLaCookie, Value: "c"})
			r.Header.Set("Authorization", "Bearer b")
		}, "b"},
		{"otro esquema se ignora", func(r *http.Request) { r.Header.Set("Authorization", "Basic abc") }, ""},
		{"otra cookie se ignora", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: "sesion", Value: "c"}) }, ""},
	}
	for _, c := range casos {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
		c.poner(r)
		if got := sesion.TokenDe(r); got != c.quiere {
			t.Errorf("%s: %q, se esperaba %q", c.nombre, got, c.quiere)
		}
	}
}

type almacenFalso struct {
	huella  []byte
	sujeto  seguridad.Sujeto
	err     error
	llamado int
}

func (a *almacenFalso) Sujeto(_ context.Context, h []byte, _ time.Time) (seguridad.Sujeto, error) {
	a.llamado++
	if a.err != nil {
		return seguridad.Sujeto{}, a.err
	}
	if string(h) == string(a.huella) {
		return a.sujeto, nil
	}
	return seguridad.Sujeto{}, seguridad.ErrSinSesion
}

func conToken(token string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	return r
}

func TestResolutor(t *testing.T) {
	real, huellaReal := seguridad.NuevoTokenOpaco()
	falso, _ := seguridad.NuevoTokenOpaco() // un token bien formado que ninguna sesión tiene
	desconocido, _ := seguridad.NuevoTokenOpaco()
	almacen := &almacenFalso{huella: huellaReal, sujeto: seguridad.Sujeto{Persona: "p", Verificada: true}}
	res := sesion.NuevoResolutor(almacen, &relojtest.Fijo{T: ahora})

	if s, err := res.SujetoDe(conToken(real)); err != nil || s.Persona != "p" || !s.Verificada {
		t.Fatalf("sesión real: %+v %v", s, err)
	}
	// Ya no hay sesiones de mentira (D-172 (5)): un token que el almacén no tiene no tiene sesión.
	for nombre, token := range map[string]string{"desconocido": desconocido, "bien formado pero ajeno": falso, "vacío": "", "mal formado": "xyz"} {
		if _, err := res.SujetoDe(conToken(token)); !errors.Is(err, seguridad.ErrSinSesion) {
			t.Errorf("%s: se esperaba ErrSinSesion: %v", nombre, err)
		}
	}
	// El almacén se consulta con un token bien formado, no con uno roto.
	almacen.llamado = 0
	res.SujetoDe(conToken(desconocido))
	res.SujetoDe(conToken("xyz"))
	if almacen.llamado != 1 {
		t.Errorf("consultas al almacén: %d, se esperaba 1", almacen.llamado)
	}
	// Un fallo del almacén no se confunde con «sin sesión».
	almacen.err = errors.New("bd caída")
	if _, err := res.SujetoDe(conToken(falso)); err == nil || errors.Is(err, seguridad.ErrSinSesion) {
		t.Errorf("un fallo del almacén debe salir como fallo: %v", err)
	}
}
